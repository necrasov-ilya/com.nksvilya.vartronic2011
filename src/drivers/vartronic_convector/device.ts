import Homey from 'homey';

import type VartronicApp from '../../app';
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
    const changedGatewayKeys = ['host', 'port'].filter(key => event.changedKeys.includes(key));
    const currentTimeLanSec = this.requireTimeLanSec();
    if (changedGatewayKeys.length > 0) {
      const app = this.homey.app as VartronicApp;
      if (!app.getRegistry().isCascadeLocked(this.gatewayKey)) {
        await app.cascadeGatewaySettings(this, {
          host: String(event.newSettings.host),
          port: Number(event.newSettings.port),
          timeLanSec: currentTimeLanSec,
        });
      }

      return 'Gateway settings were updated for all devices on the same gateway key.';
    }

    await (this.homey.app as VartronicApp).resyncDevice(this);
    return undefined;
  }

  public getGatewaySettings(): GatewaySettings {
    const settings = this.getSettings<VartronicDeviceSettings>();
    return {
      gatewayKey: this.gatewayKey,
      host: settings.host,
      port: settings.port,
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
    await this.setStoreValue(LAST_ACTUAL_STATE_STORE_KEY, snapshot);
    await this.setStoreValue(ONLINE_STORE_KEY, true);

    await Promise.all([
      this.setCapabilityValue('measure_temperature', snapshot.measureTemperature).catch(this.error),
      this.setCapabilityValue('target_temperature', snapshot.targetTemperature).catch(this.error),
      this.setCapabilityValue('alarm_generic', snapshot.alarmActive).catch(this.error),
      snapshot.mode ? this.setCapabilityValue('vartronic_mode', snapshot.mode).catch(this.error) : Promise.resolve(),
      snapshot.fanMode ? this.setCapabilityValue('vartronic_fan_mode', snapshot.fanMode).catch(this.error) : Promise.resolve(),
    ]);
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

  private getLastActualState(): DeviceSnapshot | null {
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
}

export default VartronicConvectorDevice;
