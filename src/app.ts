import Homey, { type FlowCardTriggerDevice } from 'homey';

import { GatewayRegistry } from './lib/vartronic/gateway-registry';
import { VartronicLogger } from './lib/vartronic/logger';
import type { VartronicConvectorDevice } from './drivers/vartronic_convector/device';
import type { VartronicFanMode, VartronicMode } from './lib/vartronic/types';

export default class VartronicApp extends Homey.App {
  private logger!: VartronicLogger;

  private gatewayRegistry!: GatewayRegistry;

  private connectionLostTrigger!: FlowCardTriggerDevice;

  private connectionRestoredTrigger!: FlowCardTriggerDevice;

  public async onInit(): Promise<void> {
    this.logger = new VartronicLogger(this);
    this.gatewayRegistry = new GatewayRegistry(this.homey, this.logger);
    this.connectionLostTrigger = this.homey.flow.getDeviceTriggerCard('connection_lost');
    this.connectionRestoredTrigger = this.homey.flow.getDeviceTriggerCard('connection_restored');
    this.registerFlowCards();
    this.log('Vartronic app initialized.');
  }

  public getRegistry(): GatewayRegistry {
    return this.gatewayRegistry;
  }

  public async registerVartronicDevice(device: VartronicConvectorDevice): Promise<void> {
    await this.gatewayRegistry.registerDevice(device);
  }

  public async unregisterVartronicDevice(device: VartronicConvectorDevice): Promise<void> {
    await this.gatewayRegistry.unregisterDevice(device);
  }

  public async writeTargetTemperature(device: VartronicConvectorDevice, value: number): Promise<void> {
    await this.gatewayRegistry.writeTargetTemperature(device, value);
  }

  public async writeMode(device: VartronicConvectorDevice, value: VartronicMode): Promise<void> {
    await this.gatewayRegistry.writeMode(device, value);
  }

  public async writeFanMode(device: VartronicConvectorDevice, value: VartronicFanMode): Promise<void> {
    await this.gatewayRegistry.writeFanMode(device, value);
  }

  public async resyncDevice(device: VartronicConvectorDevice): Promise<void> {
    await this.gatewayRegistry.resyncDevice(device);
  }

  public async cascadeGatewaySettings(
    device: VartronicConvectorDevice,
    payload: { host: string; port: number; timeLanSec: number },
  ): Promise<void> {
    await this.gatewayRegistry.cascadeGatewaySettings(device, payload);
  }

  public async triggerConnectionLost(device: VartronicConvectorDevice, reason: string): Promise<void> {
    await this.connectionLostTrigger.trigger(device, { reason });
  }

  public async triggerConnectionRestored(device: VartronicConvectorDevice): Promise<void> {
    await this.connectionRestoredTrigger.trigger(device);
  }

  private registerFlowCards(): void {
    this.homey.flow
      .getActionCard('set_mode')
      .registerRunListener(async args => {
        await this.writeMode(args.device as VartronicConvectorDevice, args.mode as VartronicMode);
        return true;
      });

    this.homey.flow
      .getActionCard('set_fan_mode')
      .registerRunListener(async args => {
        await this.writeFanMode(args.device as VartronicConvectorDevice, args.fan_mode as VartronicFanMode);
        return true;
      });

    this.homey.flow
      .getActionCard('resync_now')
      .registerRunListener(async args => {
        await this.resyncDevice(args.device as VartronicConvectorDevice);
        return true;
      });

    this.homey.flow
      .getConditionCard('has_alarm')
      .registerRunListener(async args => (args.device as VartronicConvectorDevice).hasAlarm());

    this.homey.flow
      .getConditionCard('is_online')
      .registerRunListener(async args => (args.device as VartronicConvectorDevice).isOnline());
  }
}
