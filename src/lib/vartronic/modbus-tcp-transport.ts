import ModbusRTU from 'modbus-serial';

import type { VartronicLogger } from './logger';
import type { GatewayEndpoint } from './types';

interface ModbusReadResult {
  data: number[];
}

interface ModbusClient {
  connectTCP(host: string, options: { port: number }): Promise<void>;
  setTimeout(timeoutMs: number): void;
  setID(unitId: number): void;
  readHoldingRegisters(address: number, length: number): Promise<ModbusReadResult>;
  writeRegister(address: number, value: number): Promise<unknown>;
  close(callback?: () => void): void;
}

export class ModbusTcpTransport {
  private client: ModbusClient | null = null;

  private connectedTo: GatewayEndpoint | null = null;

  public constructor(
    private settings: GatewayEndpoint,
    private readonly logger: VartronicLogger,
    private readonly timeoutMs = 1_000,
    private readonly clientFactory: () => ModbusClient = () => new ModbusRTU() as unknown as ModbusClient,
  ) {}

  public updateSettings(settings: GatewayEndpoint): void {
    if (this.settings.host !== settings.host || this.settings.port !== settings.port) {
      void this.close();
    }

    this.settings = settings;
  }

  public async readHoldingRegisters(unitId: number, address: number, length: number): Promise<number[]> {
    const client = await this.ensureConnected();
    client.setID(unitId);
    const response = await client.readHoldingRegisters(address, length);
    return response.data;
  }

  public async writeSingleRegister(unitId: number, address: number, value: number): Promise<void> {
    const client = await this.ensureConnected();
    client.setID(unitId);
    await client.writeRegister(address, value);
  }

  public async close(): Promise<void> {
    if (!this.client) {
      return;
    }

    const client = this.client;
    this.client = null;
    this.connectedTo = null;

    await new Promise<void>(resolve => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      try {
        client.close(done);
      } catch {
        done();
        return;
      }

      setTimeout(done, 50);
    });
  }

  private async ensureConnected(): Promise<ModbusClient> {
    const shouldReconnect =
      !this.client ||
      !this.connectedTo ||
      this.connectedTo.host !== this.settings.host ||
      this.connectedTo.port !== this.settings.port;

    if (shouldReconnect) {
      if (this.client) {
        await this.close();
      }

      const client = this.clientFactory();
      client.setTimeout(this.timeoutMs);
      await client.connectTCP(this.settings.host, { port: this.settings.port });
      this.client = client;
      this.connectedTo = { host: this.settings.host, port: this.settings.port };
      this.logger.info('Connected to gateway', this.connectedTo);
    }

    return this.client!;
  }
}
