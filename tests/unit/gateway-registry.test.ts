import { GatewayRegistry } from '../../src/lib/vartronic/gateway-registry';
import { VartronicLogger } from '../../src/lib/vartronic/logger';
import { FakeTimerHost } from '../support/FakeTimerHost';

describe('gateway registry', () => {
  it('cascades gateway settings to all sibling devices', async () => {
    const timerHost = new FakeTimerHost();
    const logger = new VartronicLogger(console);
    const registry = new GatewayRegistry(timerHost, logger);
    const applied: Array<Record<string, unknown>> = [];

    type FakeRegistryDevice = {
      gatewayKey: string;
      deviceId: string;
      modbusId: number;
      driver: {
        getDevices: () => FakeRegistryDevice[];
      };
      setSettings: (settings: Record<string, unknown>) => Promise<void>;
      getData: () => { gatewayKey: string };
    };

    const source: FakeRegistryDevice = {
      gatewayKey: 'default',
      deviceId: 'default:16',
      modbusId: 16,
      driver: {
        getDevices: () => [
          source,
          sibling,
        ],
      },
      setSettings: async (settings: Record<string, unknown>) => {
        applied.push(settings);
      },
      getData: () => ({
        gatewayKey: 'default',
      }),
    };

    const sibling: FakeRegistryDevice = {
      gatewayKey: 'default',
      deviceId: 'default:17',
      modbusId: 17,
      driver: source.driver,
      setSettings: async (settings: Record<string, unknown>) => {
        applied.push(settings);
      },
      getData: () => ({
        gatewayKey: 'default',
      }),
    };

    await registry.cascadeGatewaySettings(source as never, {
      host: '192.168.1.9',
      port: 1502,
      timeLanSec: 5,
      pollingIntervalSec: 2,
    });

    expect(applied).toHaveLength(2);
    expect(applied[0]).toEqual({
      host: '192.168.1.9',
      port: 1502,
      pollingIntervalSec: 2,
    });
  });
});
