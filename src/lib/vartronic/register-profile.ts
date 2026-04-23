import type {
  DeviceSnapshot,
  ProtocolSettings,
  VartronicFanMode,
  VartronicMode,
} from './types';

const MODE_TO_RAW: Record<VartronicMode, number> = {
  heat: 1,
  cool: 2,
  heat_cool: 3,
};

const RAW_TO_MODE = new Map<number, VartronicMode>(
  Object.entries(MODE_TO_RAW).map(([mode, raw]) => [raw, mode as VartronicMode]),
);

const FAN_MODE_TO_PERCENT: Record<VartronicFanMode, number> = {
  off: 0,
  low: 33,
  medium: 66,
  high: 85,
  auto: 100,
};

const FAN_PERCENT_TO_MODE: Array<{ max: number; mode: VartronicFanMode }> = [
  { max: 0, mode: 'off' },
  { max: 40, mode: 'low' },
  { max: 75, mode: 'medium' },
  { max: 95, mode: 'high' },
  { max: Number.POSITIVE_INFINITY, mode: 'auto' },
];

const HEAT_CHILL_DISABLE_FAN_FLAG = 0x0100;
const HEAT_CHILL_MANUAL_FAN_FLAG = 0x0200;

export const VARTRONIC_REGISTERS = {
  UST_TMP: 0x0002,
  HEAT_CHILL: 0x0003,
  UST_FAN: 0x0006,
  VALVE_HEAT: 0x0007,
  VALVE_CHILL: 0x0008,
  O_HEAT: 0x000d,
  O_CHILL: 0x000e,
  TMP_OUT: 0x0009,
  TIME_LAN: 0x000a,
  ALARM: 0x000f,
} as const;

export const FULL_STATE_READ = {
  address: VARTRONIC_REGISTERS.UST_TMP,
  count: 14,
};

export const SAFE_HEARTBEAT_READ = {
  address: VARTRONIC_REGISTERS.O_HEAT,
  count: 3,
};

export const MIN_SUPPORTED_TIME_LAN_SEC = 10;

export const DEFAULT_POLLING_INTERVAL_SEC = 5;

export const POLLING_INTERVAL_RANGE = {
  min: 2,
  max: 60,
} as const;

export const EXTERNAL_TEMPERATURE_RANGE = {
  min: 1,
  max: 50,
} as const;

export function formatUnsupportedTimeLanMessage(devices: Array<{ modbusId: number; timeLanSec: number }>): string {
  const details = devices
    .map(device => `device ${device.modbusId}: TimeLan=${device.timeLanSec}s`)
    .join(', ');

  return `${details}. Set TimeLan to at least ${MIN_SUPPORTED_TIME_LAN_SEC}s on every Vartronic controller and pair again.`;
}

export function normalizePollingIntervalSec(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('Polling interval must be a finite number of seconds.');
  }

  const normalized = Math.round(value);
  if (normalized < POLLING_INTERVAL_RANGE.min || normalized > POLLING_INTERVAL_RANGE.max) {
    throw new Error(
      `Polling interval must be between ${POLLING_INTERVAL_RANGE.min}s and ${POLLING_INTERVAL_RANGE.max}s.`,
    );
  }

  return normalized;
}

export function formatUnsafePollingIntervalMessage(devices: Array<{
  modbusId: number;
  timeLanSec: number;
  pollingIntervalSec: number;
}>): string {
  const details = devices
    .map(device =>
      `device ${device.modbusId}: TimeLan=${device.timeLanSec}s, polling interval=${device.pollingIntervalSec}s`,
    )
    .join(', ');

  return `${details}. Use a polling interval no greater than half of the lowest controller TimeLan.`;
}

export function isPollingIntervalSafeForTimeLan(pollingIntervalSec: number, timeLanSec: number): boolean {
  return pollingIntervalSec * 2 <= timeLanSec;
}

export function normalizeExternalTemperature(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('External room temperature must be a finite number.');
  }

  const normalized = Math.round(value * 10) / 10;
  if (normalized < EXTERNAL_TEMPERATURE_RANGE.min || normalized > EXTERNAL_TEMPERATURE_RANGE.max) {
    throw new Error(
      `External room temperature must be between ${EXTERNAL_TEMPERATURE_RANGE.min} C and ${EXTERNAL_TEMPERATURE_RANGE.max} C.`,
    );
  }

  return normalized;
}

export function decodeTemperature(raw: number): number {
  return raw / 10;
}

export function encodeTemperature(value: number): number {
  return Math.round(value * 10);
}

export function decodeFanMode(rawPercent: number): {
  fanMode: VartronicFanMode;
  fanPercent: number;
} {
  const normalized = Math.max(0, Math.min(100, rawPercent));
  const mapping = FAN_PERCENT_TO_MODE.find(item => normalized <= item.max) ?? FAN_PERCENT_TO_MODE.at(-1)!;

  return {
    fanMode: mapping.mode,
    fanPercent: normalized,
  };
}

export function encodeFanMode(mode: VartronicFanMode): number {
  return FAN_MODE_TO_PERCENT[mode];
}

export function getHeatChillFanMode(rawHeatChill: number, rawFanPercent: number): {
  fanMode: VartronicFanMode;
  fanPercent: number;
} {
  const fanDisabled = (rawHeatChill & HEAT_CHILL_DISABLE_FAN_FLAG) !== 0;
  if (fanDisabled) {
    return {
      fanMode: 'off',
      fanPercent: 0,
    };
  }

  const manualFan = (rawHeatChill & HEAT_CHILL_MANUAL_FAN_FLAG) !== 0;
  if (!manualFan) {
    return {
      fanMode: 'auto',
      fanPercent: Math.max(0, Math.min(100, rawFanPercent)),
    };
  }

  return decodeFanMode(rawFanPercent);
}

export function decodeMode(rawValue: number): VartronicMode | null {
  const lowByte = rawValue & 0x00ff;
  return RAW_TO_MODE.get(lowByte) ?? null;
}

export function encodeMode(
  mode: VartronicMode,
  protocolSettings: ProtocolSettings,
  fanMode?: VartronicFanMode | null,
): number {
  let flags = 0;

  if (fanMode === 'off' || protocolSettings.disableThermostatModeOnLan) {
    flags |= HEAT_CHILL_DISABLE_FAN_FLAG;
  }

  if (fanMode && fanMode !== 'off' && fanMode !== 'auto') {
    flags |= HEAT_CHILL_MANUAL_FAN_FLAG;
  } else if (!fanMode && protocolSettings.forceFanControlFromNetwork) {
    flags |= HEAT_CHILL_MANUAL_FAN_FLAG;
  }

  return flags | MODE_TO_RAW[mode];
}

export function decodeFullState(registers: number[], timestamp = Date.now()): DeviceSnapshot {
  if (registers.length < FULL_STATE_READ.count) {
    throw new Error(`Expected ${FULL_STATE_READ.count} registers, received ${registers.length}.`);
  }

  const targetTemperature = decodeTemperature(registers[0]);
  const mode = decodeMode(registers[1]);
  const fan = getHeatChillFanMode(registers[1], registers[4]);
  const measureTemperature = decodeTemperature(registers[7]);
  const timeLanSec = registers[8] > 0 ? registers[8] : null;
  const heatValveOpen = registers[11] > 0;
  const alarmActive = registers[13] > 0;

  return {
    timestamp,
    targetTemperature,
    measureTemperature,
    alarmActive,
    heatValveOpen,
    mode,
    fanMode: fan.fanMode,
    fanPercent: fan.fanPercent,
    timeLanSec,
  };
}

export function decodeHeartbeatState(registers: number[], previous: DeviceSnapshot | null, timestamp = Date.now()): DeviceSnapshot {
  if (registers.length < SAFE_HEARTBEAT_READ.count) {
    throw new Error(`Expected ${SAFE_HEARTBEAT_READ.count} heartbeat registers, received ${registers.length}.`);
  }

  return {
    timestamp,
    targetTemperature: previous?.targetTemperature ?? null,
    measureTemperature: previous?.measureTemperature ?? null,
    alarmActive: registers[2] > 0,
    heatValveOpen: registers[0] > 0,
    mode: previous?.mode ?? null,
    fanMode: previous?.fanMode ?? null,
    fanPercent: previous?.fanPercent ?? null,
    timeLanSec: previous?.timeLanSec ?? null,
  };
}
