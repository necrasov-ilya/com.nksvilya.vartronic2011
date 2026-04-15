import { GatewayManager } from '../../src/lib/vartronic/gateway-manager';
import { VartronicLogger } from '../../src/lib/vartronic/logger';
import { VARTRONIC_REGISTERS } from '../../src/lib/vartronic/register-profile';
import { FakeManagedDevice } from '../support/FakeManagedDevice';
import { FakeModbusTcpServer } from '../support/FakeModbusTcpServer';
import { FakeTimerHost } from '../support/FakeTimerHost';

describe('GatewayManager', () => {
  it('coalesces target temperature writes and verifies the final state', async () => {
    const server = new FakeModbusTcpServer();
    const port = await server.start();
    const timerHost = new FakeTimerHost();
    const logger = new VartronicLogger(console);
    const manager = new GatewayManager(
      {
        gatewayKey: 'default',
        host: '127.0.0.1',
        port,
        timeLanSec: 2,
      },
      timerHost,
      logger,
    );
    const device = new FakeManagedDevice(
      {
        gatewayKey: 'default',
        host: '127.0.0.1',
        port,
        timeLanSec: 2,
      },
      16,
    );

    server.seedRegisters(16, {
      [VARTRONIC_REGISTERS.UST_TMP]: 220,
      [VARTRONIC_REGISTERS.HEAT_CHILL]: 1,
      [VARTRONIC_REGISTERS.UST_FAN]: 33,
      [VARTRONIC_REGISTERS.TMP_OUT]: 215,
      [VARTRONIC_REGISTERS.TIME_LAN]: 2,
      [VARTRONIC_REGISTERS.ALARM]: 0,
    });

    const first = manager.writeTargetTemperature(device, 23);
    const second = manager.writeTargetTemperature(device, 24.5);

    await timerHost.flushAll();
    await Promise.all([first, second]);

    expect(server.getRegister(16, VARTRONIC_REGISTERS.UST_TMP)).toBe(245);
    expect(device.snapshots.at(-1)?.targetTemperature).toBe(24.5);

    await manager.destroy();
    await server.stop();
  }, 10_000);

  it('marks devices unavailable after three failed heartbeat windows', async () => {
    const server = new FakeModbusTcpServer();
    const port = await server.start();
    const timerHost = new FakeTimerHost();
    const logger = new VartronicLogger(console);
    const manager = new GatewayManager(
      {
        gatewayKey: 'default',
        host: '127.0.0.1',
        port,
        timeLanSec: 2,
      },
      timerHost,
      logger,
    );
    const device = new FakeManagedDevice(
      {
        gatewayKey: 'default',
        host: '127.0.0.1',
        port,
        timeLanSec: 2,
      },
      16,
    );

    server.seedRegisters(16, {
      [VARTRONIC_REGISTERS.UST_TMP]: 220,
      [VARTRONIC_REGISTERS.HEAT_CHILL]: 1,
      [VARTRONIC_REGISTERS.UST_FAN]: 33,
      [VARTRONIC_REGISTERS.TMP_OUT]: 215,
      [VARTRONIC_REGISTERS.TIME_LAN]: 2,
      [VARTRONIC_REGISTERS.ALARM]: 0,
    });

    manager.attachDevice(device);
    await manager.onPollWindow();

    server.dropNextRequests(10);
    await manager.onPollWindow();
    await manager.onPollWindow();
    await manager.onPollWindow();

    expect(device.availabilityEvents.at(-1)).toMatchObject({
      online: false,
    });

    await manager.destroy();
    await server.stop();
  }, 10_000);
});
