import {
  decodeFullState,
  encodeFanMode,
  encodeMode,
  encodeTemperature,
} from '../../src/lib/vartronic/register-profile';

describe('register profile', () => {
  it('decodes a full register snapshot into Homey-friendly state', () => {
    const registers = [
      225,
      0x0203,
      0,
      0,
      100,
      0,
      0,
      214,
      5,
      0,
      0,
      0,
      0,
      1,
    ];

    expect(decodeFullState(registers)).toMatchObject({
      targetTemperature: 22.5,
      measureTemperature: 21.4,
      mode: 'heat_cool',
      fanMode: 'auto',
      alarmActive: true,
      timeLanSec: 5,
    });
  });

  it('encodes writes for temperature, mode, and fan mode', () => {
    expect(encodeTemperature(23.5)).toBe(235);
    expect(
      encodeMode('cool', {
        disableThermostatModeOnLan: true,
        forceFanControlFromNetwork: false,
      }),
    ).toBe(0x0102);
    expect(encodeFanMode('high')).toBe(85);
  });
});
