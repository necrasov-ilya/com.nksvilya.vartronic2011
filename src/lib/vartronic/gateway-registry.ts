import type { Device } from 'homey';

import { probeGateway } from './discovery';
import { GatewayManager } from './gateway-manager';
import type { VartronicLogger } from './logger';
import type {
  GatewayScanRequest,
  GatewaySettings,
  ManagedVartronicDevice,
  TimerHost,
  VartronicFanMode,
  VartronicMode,
} from './types';

export class GatewayRegistry {
  private readonly managers = new Map<string, GatewayManager>();

  private readonly cascadeLocks = new Set<string>();

  public constructor(
    private readonly timerHost: TimerHost,
    private readonly logger: VartronicLogger,
  ) {}

  public async registerDevice(device: ManagedVartronicDevice): Promise<void> {
    const gatewaySettings = device.getGatewaySettings();
    const manager = this.getOrCreateManager(gatewaySettings);
    manager.attachDevice(device);
  }

  public async unregisterDevice(device: ManagedVartronicDevice): Promise<void> {
    const manager = this.managers.get(device.gatewayKey);
    if (!manager) {
      return;
    }

    await manager.detachDevice(device.deviceId);
    if (!manager.hasDevices()) {
      this.managers.delete(device.gatewayKey);
    }
  }

  public async writeTargetTemperature(device: ManagedVartronicDevice, value: number): Promise<void> {
    await this.getOrCreateManager(device.getGatewaySettings()).writeTargetTemperature(device, value);
  }

  public async writeExternalTemperature(device: ManagedVartronicDevice, value: number): Promise<void> {
    await this.getOrCreateManager(device.getGatewaySettings()).writeExternalTemperature(device, value);
  }

  public async writeMode(device: ManagedVartronicDevice, value: VartronicMode): Promise<void> {
    await this.getOrCreateManager(device.getGatewaySettings()).writeMode(device, value);
  }

  public async writeFanMode(device: ManagedVartronicDevice, value: VartronicFanMode): Promise<void> {
    await this.getOrCreateManager(device.getGatewaySettings()).writeFanMode(device, value);
  }

  public async resyncDevice(device: ManagedVartronicDevice): Promise<void> {
    await this.getOrCreateManager(device.getGatewaySettings()).resyncDevice(device);
  }

  public async probeGateway(request: GatewayScanRequest) {
    return probeGateway(request, this.logger);
  }

  public async cascadeGatewaySettings(
    sourceDevice: Device & ManagedVartronicDevice,
    settingsPatch: Pick<GatewaySettings, 'host' | 'port' | 'timeLanSec'>,
  ): Promise<void> {
    const gatewayKey = sourceDevice.gatewayKey;
    if (this.cascadeLocks.has(gatewayKey)) {
      return;
    }

    this.cascadeLocks.add(gatewayKey);

    try {
      const siblings = await Promise.resolve(
        sourceDevice.driver.getDevices(),
      ) as Array<Device & ManagedVartronicDevice>;
      const updates = siblings
        .filter(device => device.getData<{ gatewayKey: string }>().gatewayKey === gatewayKey)
        .map(device =>
          device.setSettings({
            host: settingsPatch.host,
            port: settingsPatch.port,
          }),
        );

      await Promise.all(updates);

      const manager = this.managers.get(gatewayKey);
      manager?.updateGatewaySettings({
        gatewayKey,
        host: settingsPatch.host,
        port: settingsPatch.port,
        timeLanSec: settingsPatch.timeLanSec,
      });
    } finally {
      this.cascadeLocks.delete(gatewayKey);
    }
  }

  public isCascadeLocked(gatewayKey: string): boolean {
    return this.cascadeLocks.has(gatewayKey);
  }

  private getOrCreateManager(settings: GatewaySettings): GatewayManager {
    const existing = this.managers.get(settings.gatewayKey);
    if (existing) {
      existing.updateGatewaySettings(settings);
      return existing;
    }

    const manager = new GatewayManager(settings, this.timerHost, this.logger.child(settings.gatewayKey));
    this.managers.set(settings.gatewayKey, manager);
    return manager;
  }
}
