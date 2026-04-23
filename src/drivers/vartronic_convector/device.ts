import * as Homey from 'homey';

import type VartronicApp from '../../app';
import { DEFAULT_POLLING_INTERVAL_SEC, normalizePollingIntervalSec } from '../../lib/vartronic/register-profile';
import type {
  DesiredState,
  DeviceSnapshot,
  GatewayAvailability,
  GatewaySettings,
  ManagedVartronicDevice,
  ProtocolSettings,
  VartronicDeviceData,
  VartronicDeviceSettings,
  VartronicFanMode,
  VartronicMode,
} from '../../lib/vartronic/types';

const DESIRED_STATE_STORE_KEY = 'desiredState';
const LAST_ACTUAL_STATE_STORE_KEY = 'lastActualState';
const ONLINE_STORE_KEY = 'online';
const HEAT_VALVE_CAPABILITY_ID = 'vartronic_heat_valve_open';

export class VartronicConvectorDevice extends Homey.Device implements ManagedVartronicDevice {
  public get deviceId(): string {
    return this.getData<VartronicDeviceData>().id;
  }

  public get gatewayKey(): string {
    return this.getData<VartronicDeviceData>().gatewayKey;
  }

  public get modbusId(): number {
    return this.getData<VartronicDeviceData>().modbusId;
  }

  public async onInit(): Promise<void> {
    await this.ensureCapability(HEAT_VALVE_CAPABILITY_ID);

    this.registerCapabilityListener('target_temperature', async value => {
      await this.setDesiredState({ targetTemperature: Number(value) });
      await (this.homey.app as VartronicApp).writeTargetTemperature(this, Number(value));
    });

    this.registerCapabilityListener('vartronic_mode', async value => {
      await this.setDesiredState({ mode: value as VartronicMode });
      await (this.homey.app as VartronicApp).writeMode(this, value as VartronicMode);
    });

    this.registerCapabilityListener('vartronic_fan_mode', async value => {
      await this.setDesiredState({ fanMode: value as VartronicFanMode });
      await (this.homey.app as VartronicApp).writeFanMode(this, value as VartronicFanMode);
    });

    await (this.homey.app as VartronicApp).registerVartronicDevice(this);
  }

  public async onDeleted(): Promise<void> {
    await (this.homey.app as VartronicApp).unregisterVartronicDevice(this);
  }

  public async onSettings(event: {
    oldSettings: Record<string, unknown>;
    newSettings: Record<string, unknown>;
    changedKeys: string[];
  }): Promise<string | void> {
    const changedGatewayKeys = ['host', 'port', 'pollingIntervalSec'].filter(key => event.changedKeys.includes(key));
    if (changedGatewayKeys.length > 0) {
      const currentTimeLanSec = this.requireTimeLanSec();
      const app = this.homey.app as VartronicApp;
      if (!app.getRegistry().isCascadeLocked(this.gatewayKey)) {
        await app.cascadeGatewaySettings(this, {
          host: String(event.newSettings.host),
          port: Number(event.newSettings.port),
          timeLanSec: currentTimeLanSec,
          pollingIntervalSec: normalizePollingIntervalSec(
            Number(event.newSettings.pollingIntervalSec ?? DEFAULT_POLLING_INTERVAL_SEC),
          ),
        });
      }

      return 'Gateway settings were updated for all devices on the same gateway key.';
    }

    if (
      event.changedKeys.includes('disableThermostatModeOnLan') ||
      event.changedKeys.includes('forceFanControlFromNetwork')
    ) {
      return 'Protocol settings were saved. They will be applied on the next mode or fan write.';
    }

    return undefined;
  }

  public getGatewaySettings(): GatewaySettings {
    const settings = this.getSettings<VartronicDeviceSettings>();
    return {
      gatewayKey: this.gatewayKey,
      host: settings.host,
      port: settings.port,
      pollingIntervalSec: normalizePollingIntervalSec(
        Number(settings.pollingIntervalSec ?? DEFAULT_POLLING_INTERVAL_SEC),
      ),
      timeLanSec: this.requireTimeLanSec(),
    };
  }

  public getProtocolSettings(): ProtocolSettings {
    const settings = this.getSettings<VartronicDeviceSettings>();
    return {
      disableThermostatModeOnLan: settings.disableThermostatModeOnLan,
      forceFanControlFromNetwork: settings.forceFanControlFromNetwork,
    };
  }

  public getDesiredState(): DesiredState {
    return (this.getStoreValue<DesiredState>(DESIRED_STATE_STORE_KEY) ?? {});
  }

  public async updateSnapshot(snapshot: DeviceSnapshot): Promise<void> {
    const previous = this.getLastActualState();
    const nextSnapshot: DeviceSnapshot = {
      ...snapshot,
      targetTemperature: snapshot.targetTemperature ?? previous?.targetTemperature ?? null,
      measureTemperature: snapshot.measureTemperature ?? previous?.measureTemperature ?? null,
      heatValveOpen: snapshot.heatValveOpen ?? previous?.heatValveOpen ?? null,
      mode: snapshot.mode ?? previous?.mode ?? null,
      fanMode: snapshot.fanMode ?? previous?.fanMode ?? null,
      fanPercent: snapshot.fanPercent ?? previous?.fanPercent ?? null,
      timeLanSec: snapshot.timeLanSec ?? previous?.timeLanSec ?? null,
    };

    await this.setStoreValue(LAST_ACTUAL_STATE_STORE_KEY, nextSnapshot);
    await this.setStoreValue(ONLINE_STORE_KEY, true);

    const updates = [
      this.setCapabilityValue('alarm_generic', nextSnapshot.alarmActive).catch(this.error),
    ];

    if (typeof nextSnapshot.measureTemperature === 'number') {
      updates.push(this.setCapabilityValue('measure_temperature', nextSnapshot.measureTemperature).catch(this.error));
    }

    if (typeof nextSnapshot.targetTemperature === 'number') {
      updates.push(this.setCapabilityValue('target_temperature', nextSnapshot.targetTemperature).catch(this.error));
    }

    if (typeof nextSnapshot.heatValveOpen === 'boolean') {
      updates.push(this.setCapabilityValue(HEAT_VALVE_CAPABILITY_ID, nextSnapshot.heatValveOpen).catch(this.error));
    }

    if (nextSnapshot.mode) {
      updates.push(this.setCapabilityValue('vartronic_mode', nextSnapshot.mode).catch(this.error));
    }

    if (nextSnapshot.fanMode) {
      updates.push(this.setCapabilityValue('vartronic_fan_mode', nextSnapshot.fanMode).catch(this.error));
    }

    await Promise.all(updates);

    if (
      typeof previous?.heatValveOpen === 'boolean' &&
      typeof nextSnapshot.heatValveOpen === 'boolean' &&
      previous.heatValveOpen !== nextSnapshot.heatValveOpen
    ) {
      const app = this.homey.app as VartronicApp;
      if (nextSnapshot.heatValveOpen) {
        await app.triggerHeatValveOpened(this);
      } else {
        await app.triggerHeatValveClosed(this);
      }
    }
  }

  public async handleGatewayAvailability(availability: GatewayAvailability): Promise<void> {
    const wasOnline = this.isOnline();

    if (availability.warning) {
      await this.setWarning(availability.warning);
    } else {
      await this.unsetWarning().catch(this.error);
    }

    if (availability.online) {
      await this.setAvailable();
      await this.setStoreValue(ONLINE_STORE_KEY, true);

      if (!wasOnline) {
        await (this.homey.app as VartronicApp).triggerConnectionRestored(this);
      }
      return;
    }

    await this.setStoreValue(ONLINE_STORE_KEY, false);
    await this.setUnavailable(availability.reason ?? 'Connection lost.');
    if (wasOnline) {
      await (this.homey.app as VartronicApp).triggerConnectionLost(this, availability.reason ?? 'Connection lost.');
    }
  }

  public async setDesiredState(patch: Partial<DesiredState>): Promise<void> {
    const nextState = {
      ...this.getDesiredState(),
      ...patch,
    };
    await this.setStoreValue(DESIRED_STATE_STORE_KEY, nextState);
  }

  public getLastActualState(): DeviceSnapshot | null {
    return this.getStoreValue<DeviceSnapshot>(LAST_ACTUAL_STATE_STORE_KEY);
  }

  private requireTimeLanSec(): number {
    const timeLanSec = this.getLastActualState()?.timeLanSec;
    if (typeof timeLanSec !== 'number' || !Number.isInteger(timeLanSec) || timeLanSec <= 0) {
      throw new Error('The device does not have a valid TimeLan value from the controller.');
    }

    return timeLanSec;
  }

  public hasAlarm(): boolean {
    return Boolean(this.getCapabilityValue('alarm_generic'));
  }

  public isOnline(): boolean {
    return Boolean(this.getStoreValue<boolean>(ONLINE_STORE_KEY));
  }

  public isHeatValveOpen(): boolean {
    return Boolean(this.getCapabilityValue<boolean>(HEAT_VALVE_CAPABILITY_ID));
  }

  private async ensureCapability(capabilityId: string): Promise<void> {
    if (!this.hasCapability(capabilityId)) {
      await this.addCapability(capabilityId);
    }
  }
}

export default VartronicConvectorDevice;
module.exports = VartronicConvectorDevice;
