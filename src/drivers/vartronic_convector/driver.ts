import Homey, { type Device as HomeyDevice, type PairSession } from 'homey';

import type VartronicApp from '../../app';
import type { GatewayScanRequest, VartronicDeviceData, VartronicDeviceSettings } from '../../lib/vartronic/types';
import type { VartronicConvectorDevice } from './device';

function normalizePairingRequest(payload: unknown): GatewayScanRequest {
  const data = payload as Record<string, unknown>;

  const gatewayKey = String(data.gatewayKey ?? '').trim();
  const host = String(data.host ?? '').trim();
  const port = Number(data.port);
  const idStart = Number(data.idStart);
  const idEnd = Number(data.idEnd);

  if (!gatewayKey) {
    throw new Error('Gateway key is required.');
  }

  if (!host) {
    throw new Error('Host is required.');
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Port must be between 1 and 65535.');
  }

  if (!Number.isInteger(idStart) || !Number.isInteger(idEnd) || idStart < 1 || idEnd > 247 || idStart > idEnd) {
    throw new Error('The Modbus ID range is invalid.');
  }

  return {
    gatewayKey,
    host,
    port,
    idStart,
    idEnd,
  };
}

export default class VartronicConvectorDriver extends Homey.Driver {
  public async onPair(session: PairSession): Promise<void> {
    const app = this.homey.app as VartronicApp;
    let request: GatewayScanRequest | null = null;
    let devices: Array<{
      name: string;
      data: VartronicDeviceData;
      settings: VartronicDeviceSettings;
      store: Record<string, unknown>;
    }> = [];

    session.setHandler('validate_gateway', async (payload: unknown) => {
      const normalized = normalizePairingRequest(payload);
      const pairedDevices = await Promise.resolve(this.getDevices());
      const existingGatewayKeys = new Set(
        pairedDevices.map(device => (device.getData<{ gatewayKey: string }>().gatewayKey)),
      );

      if (existingGatewayKeys.size > 0 && !existingGatewayKeys.has(normalized.gatewayKey)) {
        throw new Error('This v1 app supports only one gateway key per installation.');
      }

      const discovered = await app.getRegistry().probeGateway(normalized);
      const existingIds = new Set(
        pairedDevices.map(device => device.getData<{ id: string }>().id),
      );
      devices = discovered
        .filter(device => !existingIds.has(`${device.gatewayKey}:${device.modbusId}`))
        .map(device => ({
          name: device.name,
          data: {
            id: `${device.gatewayKey}:${device.modbusId}`,
            gatewayKey: device.gatewayKey,
            modbusId: device.modbusId,
          },
          settings: device.settings,
          store: {
            desiredState: {},
            lastActualState: device.snapshot,
            online: false,
          },
        }));

      if (devices.length === 0) {
        throw new Error('No new Vartronic devices responded in the provided Modbus range.');
      }

      request = normalized;
      return {
        count: devices.length,
      };
    });

    session.setHandler('list_devices', async () => {
      if (!request) {
        throw new Error('Validate the gateway before listing devices.');
      }

      return devices;
    });
  }

  public async onRepair(session: PairSession, device: HomeyDevice): Promise<void> {
    const app = this.homey.app as VartronicApp;

    session.setHandler('get_gateway_configuration', async () => {
      const settings = device.getSettings<VartronicDeviceSettings>();
      const data = device.getData<VartronicDeviceData>();
      return {
        gatewayKey: data.gatewayKey,
        host: settings.host,
        port: settings.port,
      };
    });

    session.setHandler('save_gateway_configuration', async (payload: unknown) => {
      const current = device.getData<VartronicDeviceData>();
      const normalized = normalizePairingRequest({
        gatewayKey: current.gatewayKey,
        idStart: current.modbusId,
        idEnd: current.modbusId,
        ...payload as Record<string, unknown>,
      });

      const discovered = await app.getRegistry().probeGateway(normalized);
      const currentDevice = discovered.find(item => item.modbusId === current.modbusId);
      if (!currentDevice || !currentDevice.snapshot.timeLanSec) {
        throw new Error('The controller did not return a valid TimeLan value from the new gateway.');
      }

      await app.cascadeGatewaySettings(device as VartronicConvectorDevice, {
        host: normalized.host,
        port: normalized.port,
        timeLanSec: currentDevice.snapshot.timeLanSec,
      });
    });
  }
}
