export type VartronicMode = 'heat' | 'cool' | 'heat_cool';

export type VartronicFanMode = 'off' | 'low' | 'medium' | 'high' | 'auto';

export interface GatewayEndpoint {
  host: string;
  port: number;
}

export interface GatewaySettings extends GatewayEndpoint {
  gatewayKey: string;
  timeLanSec: number;
  pollingIntervalSec: number;
}

export interface ProtocolSettings {
  disableThermostatModeOnLan: boolean;
  forceFanControlFromNetwork: boolean;
}

export interface VartronicDeviceSettings extends ProtocolSettings {
  host: string;
  port: number;
  pollingIntervalSec: number;
}

export interface VartronicDeviceData {
  id: string;
  gatewayKey: string;
  modbusId: number;
}

export interface DesiredState {
  targetTemperature?: number | null;
  externalTemperature?: number | null;
  mode?: VartronicMode | null;
  fanMode?: VartronicFanMode | null;
}

export interface DeviceSnapshot {
  timestamp: number;
  targetTemperature: number | null;
  measureTemperature: number | null;
  alarmActive: boolean;
  heatValveOpen: boolean | null;
  mode: VartronicMode | null;
  fanMode: VartronicFanMode | null;
  fanPercent: number | null;
  timeLanSec: number | null;
}

export interface GatewayAvailability {
  online: boolean;
  reason?: string;
  warning?: string | null;
}

export interface ManagedVartronicDevice {
  readonly deviceId: string;
  readonly gatewayKey: string;
  readonly modbusId: number;
  getGatewaySettings(): GatewaySettings;
  getProtocolSettings(): ProtocolSettings;
  getDesiredState(): DesiredState;
  getLastActualState(): DeviceSnapshot | null;
  updateSnapshot(snapshot: DeviceSnapshot): Promise<void>;
  handleGatewayAvailability(availability: GatewayAvailability): Promise<void>;
}

export interface GatewayScanRequest extends GatewayEndpoint {
  gatewayKey: string;
  idStart: number;
  idEnd: number;
  pollingIntervalSec: number;
}

export interface DiscoveredDevice {
  gatewayKey: string;
  modbusId: number;
  name: string;
  settings: VartronicDeviceSettings;
  snapshot: DeviceSnapshot;
}

export interface QueueOptions {
  label?: string;
  priority?: number;
}

export interface TimerHost {
  setTimeout(callback: () => void, delay: number): NodeJS.Timeout;
  clearTimeout(timeout: NodeJS.Timeout): void;
}

export interface LoggerSink {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}
