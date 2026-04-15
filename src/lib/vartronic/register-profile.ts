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

export const VARTRONIC_REGISTERS = {
  UST_TMP: 0x0002,
  HEAT_CHILL: 0x0003,
  UST_FAN: 0x0006,
  TMP_OUT: 0x0009,
  TIME_LAN: 0x000a,
  ALARM: 0x000f,
} as const;

export const FULL_STATE_READ = {
  address: VARTRONIC_REGISTERS.UST_TMP,
  count: 14,
};

export const SAFE_HEARTBEAT_READ = {
  address: VARTRONIC_REGISTERS.ALARM,
  count: 1,
};

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

export function decodeMode(rawValue: number): VartronicMode | null {
  const lowByte = rawValue & 0x00ff;
  return RAW_TO_MODE.get(lowByte) ?? null;
}

export function encodeMode(mode: VartronicMode, protocolSettings: ProtocolSettings): number {
  let flags = 0;

  if (protocolSettings.disableThermostatModeOnLan) {
    flags |= 0x0100;
  }

  if (protocolSettings.forceFanControlFromNetwork) {
    flags |= 0x0200;
  }

  return flags | MODE_TO_RAW[mode];
}

export function decodeFullState(registers: number[], timestamp = Date.now()): DeviceSnapshot {
  if (registers.length < FULL_STATE_READ.count) {
    throw new Error(`Expected ${FULL_STATE_READ.count} registers, received ${registers.length}.`);
  }

  const targetTemperature = decodeTemperature(registers[0]);
  const mode = decodeMode(registers[1]);
  const fan = decodeFanMode(registers[4]);
  const measureTemperature = decodeTemperature(registers[7]);
  const timeLanSec = registers[8] > 0 ? registers[8] : null;
  const alarmActive = registers[13] > 0;

  return {
    timestamp,
    targetTemperature,
    measureTemperature,
    alarmActive,
    mode,
    fanMode: fan.fanMode,
    fanPercent: fan.fanPercent,
    timeLanSec,
  };
}

export function decodeAlarmHeartbeat(rawAlarm: number, previous: DeviceSnapshot | null, timestamp = Date.now()): DeviceSnapshot {
  return {
    timestamp,
    targetTemperature: previous?.targetTemperature ?? null,
    measureTemperature: previous?.measureTemperature ?? null,
    alarmActive: rawAlarm > 0,
    mode: previous?.mode ?? null,
    fanMode: previous?.fanMode ?? null,
    fanPercent: previous?.fanPercent ?? null,
    timeLanSec: previous?.timeLanSec ?? null,
  };
}
