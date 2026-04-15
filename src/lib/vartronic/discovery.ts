import type { VartronicLogger } from './logger';
import { ModbusTcpTransport } from './modbus-tcp-transport';
import {
  FULL_STATE_READ,
  VARTRONIC_REGISTERS,
  decodeFullState,
} from './register-profile';
import type { DiscoveredDevice, GatewayScanRequest, VartronicDeviceSettings } from './types';

export async function probeGateway(
  request: GatewayScanRequest,
  logger: VartronicLogger,
): Promise<DiscoveredDevice[]> {
  const transport = new ModbusTcpTransport(request, logger.child(`probe:${request.gatewayKey}`));
  const discovered: DiscoveredDevice[] = [];

  try {
    for (let modbusId = request.idStart; modbusId <= request.idEnd; modbusId += 1) {
      try {
        const registers = await transport.readHoldingRegisters(modbusId, FULL_STATE_READ.address, FULL_STATE_READ.count);
        const snapshot = decodeFullState(registers);
        const timeLanRegister = await transport.readHoldingRegisters(modbusId, VARTRONIC_REGISTERS.TIME_LAN, 1);
        const discoveredTimeLanSec = timeLanRegister[0];

        if (!Number.isInteger(discoveredTimeLanSec) || discoveredTimeLanSec <= 0) {
          throw new Error(`Device ${modbusId} returned an invalid TimeLan value.`);
        }

        const settings: VartronicDeviceSettings = {
          host: request.host,
          port: request.port,
          disableThermostatModeOnLan: false,
          forceFanControlFromNetwork: false,
        };

        const isLikelyRealDevice =
          snapshot.targetTemperature !== 0 ||
          snapshot.measureTemperature !== 0 ||
          snapshot.mode !== null;

        if (!isLikelyRealDevice) {
          continue;
        }

        discovered.push({
          gatewayKey: request.gatewayKey,
          modbusId,
          name: `Vartronic ${modbusId}`,
          settings,
          snapshot: {
            ...snapshot,
            timeLanSec: discoveredTimeLanSec,
          },
        });
      } catch (error) {
        logger.debug(`Probe missed device ${modbusId}`, error);
      }
    }
  } finally {
    await transport.close();
  }

  return discovered;
}
