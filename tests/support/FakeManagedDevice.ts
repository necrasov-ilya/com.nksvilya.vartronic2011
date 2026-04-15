import type {
  DesiredState,
  DeviceSnapshot,
  GatewayAvailability,
  GatewaySettings,
  ManagedVartronicDevice,
  ProtocolSettings,
} from '../../src/lib/vartronic/types';

export class FakeManagedDevice implements ManagedVartronicDevice {
  public readonly deviceId: string;

  public readonly gatewayKey: string;

  public readonly modbusId: number;

  public readonly snapshots: DeviceSnapshot[] = [];

  public readonly availabilityEvents: GatewayAvailability[] = [];

  private desiredState: DesiredState;

  public constructor(
    private readonly gatewaySettings: GatewaySettings,
    modbusId: number,
    desiredState: DesiredState = {},
    private readonly protocolSettings: ProtocolSettings = {
      disableThermostatModeOnLan: false,
      forceFanControlFromNetwork: false,
    },
  ) {
    this.gatewayKey = gatewaySettings.gatewayKey;
    this.modbusId = modbusId;
    this.deviceId = `${gatewaySettings.gatewayKey}:${modbusId}`;
    this.desiredState = desiredState;
  }

  public getGatewaySettings(): GatewaySettings {
    return this.gatewaySettings;
  }

  public getProtocolSettings(): ProtocolSettings {
    return this.protocolSettings;
  }

  public getDesiredState(): DesiredState {
    return this.desiredState;
  }

  public setDesiredState(next: DesiredState): void {
    this.desiredState = next;
  }

  public async updateSnapshot(snapshot: DeviceSnapshot): Promise<void> {
    this.snapshots.push(snapshot);
  }

  public async handleGatewayAvailability(availability: GatewayAvailability): Promise<void> {
    this.availabilityEvents.push(availability);
  }
}
