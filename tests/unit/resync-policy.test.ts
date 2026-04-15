import { diffDesiredState } from '../../src/lib/vartronic/resync-policy';

describe('resync policy', () => {
  it('returns only the fields that drifted from the desired state', () => {
    const actual = {
      timestamp: Date.now(),
      targetTemperature: 22,
      measureTemperature: 21.5,
      alarmActive: false,
      mode: 'heat' as const,
      fanMode: 'low' as const,
      fanPercent: 33,
      timeLanSec: 2,
    };

    expect(
      diffDesiredState(actual, {
        targetTemperature: 24,
        mode: 'heat',
        fanMode: 'medium',
      }),
    ).toEqual({
      targetTemperature: 24,
      fanMode: 'medium',
    });
  });
});
