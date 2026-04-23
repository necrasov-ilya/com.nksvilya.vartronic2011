import { probeGateway } from '../../src/lib/vartronic/discovery';
import { VartronicLogger } from '../../src/lib/vartronic/logger';
import { VARTRONIC_REGISTERS } from '../../src/lib/vartronic/register-profile';
import { FakeModbusTcpServer } from '../support/FakeModbusTcpServer';

describe('probeGateway', () => {
  it('discovers responsive devices inside the provided Modbus range', async () => {
    const server = new FakeModbusTcpServer();
    const port = await server.start();

    server.seedRegisters(16, {
      [VARTRONIC_REGISTERS.UST_TMP]: 225,
      [VARTRONIC_REGISTERS.HEAT_CHILL]: 1,
      [VARTRONIC_REGISTERS.UST_FAN]: 33,
      [VARTRONIC_REGISTERS.TMP_OUT]: 210,
      [VARTRONIC_REGISTERS.TIME_LAN]: 10,
      [VARTRONIC_REGISTERS.ALARM]: 0,
    });

    server.seedRegisters(17, {
      [VARTRONIC_REGISTERS.UST_TMP]: 230,
      [VARTRONIC_REGISTERS.HEAT_CHILL]: 2,
      [VARTRONIC_REGISTERS.UST_FAN]: 66,
      [VARTRONIC_REGISTERS.TMP_OUT]: 205,
      [VARTRONIC_REGISTERS.TIME_LAN]: 12,
      [VARTRONIC_REGISTERS.ALARM]: 1,
    });

    const devices = await probeGateway(
      {
        gatewayKey: 'default',
        host: '127.0.0.1',
        port,
        idStart: 16,
        idEnd: 18,
        pollingIntervalSec: 5,
      },
      new VartronicLogger(console),
    );

    expect(devices).toHaveLength(2);
    expect(devices[0]).toMatchObject({
      gatewayKey: 'default',
      modbusId: 16,
      settings: {
        host: '127.0.0.1',
        port,
      },
    });
    expect(devices[0].snapshot.timeLanSec).toBe(10);
    expect(devices[1].snapshot.alarmActive).toBe(true);

    await server.stop();
  });

  it('rejects responsive devices whose TimeLan is below the supported minimum', async () => {
    const server = new FakeModbusTcpServer();
    const port = await server.start();

    server.seedRegisters(16, {
      [VARTRONIC_REGISTERS.UST_TMP]: 225,
      [VARTRONIC_REGISTERS.HEAT_CHILL]: 1,
      [VARTRONIC_REGISTERS.UST_FAN]: 33,
      [VARTRONIC_REGISTERS.TMP_OUT]: 210,
      [VARTRONIC_REGISTERS.TIME_LAN]: 4,
      [VARTRONIC_REGISTERS.ALARM]: 0,
    });

    await expect(probeGateway(
      {
        gatewayKey: 'default',
        host: '127.0.0.1',
        port,
        idStart: 16,
        idEnd: 16,
        pollingIntervalSec: 5,
      },
      new VartronicLogger(console),
    )).rejects.toThrow('device 16: TimeLan=4s');

    await server.stop();
  });

  it('rejects polling intervals that are too close to controller TimeLan', async () => {
    const server = new FakeModbusTcpServer();
    const port = await server.start();

    server.seedRegisters(16, {
      [VARTRONIC_REGISTERS.UST_TMP]: 225,
      [VARTRONIC_REGISTERS.HEAT_CHILL]: 1,
      [VARTRONIC_REGISTERS.UST_FAN]: 33,
      [VARTRONIC_REGISTERS.TMP_OUT]: 210,
      [VARTRONIC_REGISTERS.TIME_LAN]: 10,
      [VARTRONIC_REGISTERS.ALARM]: 0,
    });

    await expect(probeGateway(
      {
        gatewayKey: 'default',
        host: '127.0.0.1',
        port,
        idStart: 16,
        idEnd: 16,
        pollingIntervalSec: 6,
      },
      new VartronicLogger(console),
    )).rejects.toThrow('polling interval=6s');

    await server.stop();
  });
});
