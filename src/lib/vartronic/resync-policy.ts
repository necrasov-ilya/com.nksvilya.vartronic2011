import type { DesiredState, DeviceSnapshot } from './types';

export interface ResyncDiff {
  targetTemperature?: number;
  mode?: NonNullable<DesiredState['mode']>;
  fanMode?: NonNullable<DesiredState['fanMode']>;
}

export function diffDesiredState(actual: DeviceSnapshot, desired: DesiredState): ResyncDiff {
  const diff: ResyncDiff = {};

  if (typeof desired.targetTemperature === 'number') {
    const delta = Math.abs((actual.targetTemperature ?? Number.NaN) - desired.targetTemperature);
    if (Number.isNaN(delta) || delta > 0.05) {
      diff.targetTemperature = desired.targetTemperature;
    }
  }

  if (desired.mode && actual.mode !== desired.mode) {
    diff.mode = desired.mode;
  }

  if (desired.fanMode && actual.fanMode !== desired.fanMode) {
    diff.fanMode = desired.fanMode;
  }

  return diff;
}
