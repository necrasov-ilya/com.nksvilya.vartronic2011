import type { VartronicLogger } from './logger';
import { ModbusTcpTransport } from './modbus-tcp-transport';
import { PollScheduler } from './poll-scheduler';
import { RequestQueue } from './request-queue';
import {
  FULL_STATE_READ,
  SAFE_HEARTBEAT_READ,
  VARTRONIC_REGISTERS,
  decodeAlarmHeartbeat,
  decodeFullState,
  encodeFanMode,
  encodeMode,
  encodeTemperature,
  normalizeExternalTemperature,
} from './register-profile';
import { diffDesiredState } from './resync-policy';
import type {
  DeviceSnapshot,
  GatewayAvailability,
  GatewaySettings,
  ManagedVartronicDevice,
  TimerHost,
  VartronicFanMode,
  VartronicMode,
} from './types';

const WRITE_PRIORITY = 1;
const FULL_REFRESH_PRIORITY = 10;
const HEARTBEAT_PRIORITY = 20;
const FULL_REFRESH_EVERY_SUCCESSFUL_WINDOWS = 5;

interface DebouncedTemperatureWrite {
  timeout: NodeJS.Timeout;
  value: number;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

export class GatewayManager {
  private readonly devices = new Map<string, ManagedVartronicDevice>();

  private readonly snapshots = new Map<string, DeviceSnapshot>();

  private readonly requestQueue = new RequestQueue();

  private readonly scheduler: PollScheduler;

  private readonly debouncedSetpoints = new Map<string, DebouncedTemperatureWrite>();

  private readonly debouncedExternalTemperatures = new Map<string, DebouncedTemperatureWrite>();

  private readonly transport: ModbusTcpTransport;

  private reconnectAttempt = 0;

  private nextReconnectAt = 0;

  private failedWindows = 0;

  private successfulWindows = 0;

  private roundRobinCursor = 0;

  private pendingFullRefresh = true;

  public constructor(
    private settings: GatewaySettings,
    private readonly timerHost: TimerHost,
    private readonly logger: VartronicLogger,
  ) {
    this.transport = new ModbusTcpTransport(this.settings, logger.child(`gateway:${settings.gatewayKey}`));
    this.scheduler = new PollScheduler(timerHost, this, () => this.getHeartbeatWindowMs());
  }

  public attachDevice(device: ManagedVartronicDevice): void {
    this.devices.set(device.deviceId, device);
    this.scheduler.start();
    this.pendingFullRefresh = true;
    this.scheduler.triggerSoon();
  }

  public async detachDevice(deviceId: string): Promise<void> {
    this.devices.delete(deviceId);
    this.snapshots.delete(deviceId);

    const pending = this.debouncedSetpoints.get(deviceId);
    if (pending) {
      this.timerHost.clearTimeout(pending.timeout);
      this.debouncedSetpoints.delete(deviceId);
    }

    const pendingExternalTemperature = this.debouncedExternalTemperatures.get(deviceId);
    if (pendingExternalTemperature) {
      this.timerHost.clearTimeout(pendingExternalTemperature.timeout);
      this.debouncedExternalTemperatures.delete(deviceId);
    }

    if (this.devices.size === 0) {
      await this.destroy();
    }
  }

  public async destroy(): Promise<void> {
    this.scheduler.stop();
    for (const pending of this.debouncedSetpoints.values()) {
      this.timerHost.clearTimeout(pending.timeout);
      pending.reject(new Error('Gateway manager is shutting down.'));
    }
    this.debouncedSetpoints.clear();
    for (const pending of this.debouncedExternalTemperatures.values()) {
      this.timerHost.clearTimeout(pending.timeout);
      pending.reject(new Error('Gateway manager is shutting down.'));
    }
    this.debouncedExternalTemperatures.clear();
    this.requestQueue.close();
    await this.transport.close();
  }

  public updateGatewaySettings(settings: GatewaySettings): void {
    this.settings = settings;
    this.transport.updateSettings(settings);
    this.pendingFullRefresh = true;
    this.scheduler.triggerSoon();
  }

  public getGatewaySettings(): GatewaySettings {
    return this.settings;
  }

  public hasDevices(): boolean {
    return this.devices.size > 0;
  }

  public async writeTargetTemperature(device: ManagedVartronicDevice, value: number): Promise<void> {
    const existing = this.debouncedSetpoints.get(device.deviceId);
    if (existing) {
      this.timerHost.clearTimeout(existing.timeout);
      existing.value = value;
      existing.timeout = this.scheduleTemperatureWrite(
        device,
        existing,
        VARTRONIC_REGISTERS.UST_TMP,
        'target_temperature',
        this.debouncedSetpoints,
      );
      return existing.promise;
    }

    let resolvePromise!: () => void;
    let rejectPromise!: (error: unknown) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const pending: DebouncedTemperatureWrite = {
      timeout: null as unknown as NodeJS.Timeout,
      value,
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
    };

    pending.timeout = this.scheduleTemperatureWrite(
      device,
      pending,
      VARTRONIC_REGISTERS.UST_TMP,
      'target_temperature',
      this.debouncedSetpoints,
    );
    this.debouncedSetpoints.set(device.deviceId, pending);
    await promise;
  }

  public async writeExternalTemperature(device: ManagedVartronicDevice, value: number): Promise<void> {
    const normalizedValue = normalizeExternalTemperature(value);
    const existing = this.debouncedExternalTemperatures.get(device.deviceId);
    if (existing) {
      this.timerHost.clearTimeout(existing.timeout);
      existing.value = normalizedValue;
      existing.timeout = this.scheduleTemperatureWrite(
        device,
        existing,
        VARTRONIC_REGISTERS.TMP_OUT,
        'external_temperature',
        this.debouncedExternalTemperatures,
      );
      return existing.promise;
    }

    let resolvePromise!: () => void;
    let rejectPromise!: (error: unknown) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const pending: DebouncedTemperatureWrite = {
      timeout: null as unknown as NodeJS.Timeout,
      value: normalizedValue,
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
    };

    pending.timeout = this.scheduleTemperatureWrite(
      device,
      pending,
      VARTRONIC_REGISTERS.TMP_OUT,
      'external_temperature',
      this.debouncedExternalTemperatures,
    );
    this.debouncedExternalTemperatures.set(device.deviceId, pending);
    await promise;
  }

  public async writeMode(device: ManagedVartronicDevice, mode: VartronicMode): Promise<void> {
    await this.requestQueue.enqueue(async () => {
      await this.performWrite(
        device.modbusId,
        VARTRONIC_REGISTERS.HEAT_CHILL,
        encodeMode(mode, device.getProtocolSettings()),
      );
      await this.refreshDevice(device);
    }, { label: `mode:${device.modbusId}`, priority: WRITE_PRIORITY });
  }

  public async writeFanMode(device: ManagedVartronicDevice, fanMode: VartronicFanMode): Promise<void> {
    await this.requestQueue.enqueue(async () => {
      await this.performWrite(device.modbusId, VARTRONIC_REGISTERS.UST_FAN, encodeFanMode(fanMode));
      await this.refreshDevice(device);
    }, { label: `fan:${device.modbusId}`, priority: WRITE_PRIORITY });
  }

  public async resyncDevice(device: ManagedVartronicDevice): Promise<void> {
    await this.requestQueue.enqueue(async () => {
      await this.refreshDevice(device);
    }, { label: `resync:${device.modbusId}`, priority: FULL_REFRESH_PRIORITY });
  }

  public async onPollWindow(): Promise<void> {
    const orderedDevices = this.getOrderedDevices();
    if (orderedDevices.length === 0) {
      return;
    }

    const startedAt = Date.now();
    const runFullRefresh = this.pendingFullRefresh
      || (this.successfulWindows + 1) % FULL_REFRESH_EVERY_SUCCESSFUL_WINDOWS === 0;
    let failed = false;

    for (const device of orderedDevices) {
      try {
        await this.requestQueue.enqueue(async () => {
          const heartbeat = await this.readHeartbeat(device);
          await device.updateSnapshot(heartbeat);
          this.snapshots.set(device.deviceId, heartbeat);

          if (runFullRefresh) {
            await this.refreshDevice(device);
          }
        }, { label: `heartbeat:${device.modbusId}`, priority: HEARTBEAT_PRIORITY });
      } catch (error) {
        failed = true;
        this.logger.warn(`Heartbeat failed for device ${device.modbusId}`, error);
      }
    }

    const elapsed = Date.now() - startedAt;

    if (!failed && elapsed <= this.getHeartbeatWindowMs()) {
      this.failedWindows = 0;
      this.successfulWindows += 1;
      this.pendingFullRefresh = false;
      await this.broadcastAvailability({
        online: true,
        warning: null,
      });
      return;
    }

    this.failedWindows += 1;
    const reason = failed
      ? 'Gateway polling failed.'
      : `Gateway polling exceeded the ${this.getHeartbeatWindowMs()}ms heartbeat window.`;
    const warning =
      'Polling is unstable. Increase the controller TimeLan or reduce the number of paired devices on this gateway.';

    if (this.failedWindows >= 3) {
      await this.broadcastAvailability({
        online: false,
        reason,
        warning,
      });
    } else {
      await this.broadcastAvailability({
        online: true,
        warning,
      });
    }
  }

  private getHeartbeatWindowMs(): number {
    const knownTimeLanValues = Array.from(this.devices.values())
      .map(device => this.snapshots.get(device.deviceId)?.timeLanSec ?? device.getGatewaySettings().timeLanSec)
      .filter((value): value is number => Number.isInteger(value) && value > 0);

    const effectiveTimeLanSec = knownTimeLanValues.length > 0
      ? Math.min(...knownTimeLanValues)
      : this.settings.timeLanSec;

    return Math.max(700, effectiveTimeLanSec * 700);
  }

  private getOrderedDevices(): ManagedVartronicDevice[] {
    const devices = Array.from(this.devices.values());
    if (devices.length === 0) {
      return devices;
    }

    const start = this.roundRobinCursor % devices.length;
    this.roundRobinCursor = (this.roundRobinCursor + 1) % devices.length;
    return [...devices.slice(start), ...devices.slice(0, start)];
  }

  private async readHeartbeat(device: ManagedVartronicDevice): Promise<DeviceSnapshot> {
    const raw = await this.withTransport(() =>
      this.transport.readHoldingRegisters(device.modbusId, SAFE_HEARTBEAT_READ.address, SAFE_HEARTBEAT_READ.count),
    );

    return decodeAlarmHeartbeat(raw[0], this.snapshots.get(device.deviceId) ?? null);
  }

  private async refreshDevice(device: ManagedVartronicDevice): Promise<void> {
    const registers = await this.withTransport(() =>
      this.transport.readHoldingRegisters(device.modbusId, FULL_STATE_READ.address, FULL_STATE_READ.count),
    );
    const snapshot = decodeFullState(registers);
    this.snapshots.set(device.deviceId, snapshot);
    await device.updateSnapshot(snapshot);

    const desired = device.getDesiredState();
    const drift = diffDesiredState(snapshot, desired);

    if (typeof drift.targetTemperature === 'number') {
      await this.performWrite(device.modbusId, VARTRONIC_REGISTERS.UST_TMP, encodeTemperature(drift.targetTemperature));
    }

    if (typeof drift.externalTemperature === 'number') {
      await this.performWrite(
        device.modbusId,
        VARTRONIC_REGISTERS.TMP_OUT,
        encodeTemperature(normalizeExternalTemperature(drift.externalTemperature)),
      );
    }

    if (drift.mode) {
      await this.performWrite(
        device.modbusId,
        VARTRONIC_REGISTERS.HEAT_CHILL,
        encodeMode(drift.mode, device.getProtocolSettings()),
      );
    }

    if (drift.fanMode) {
      await this.performWrite(device.modbusId, VARTRONIC_REGISTERS.UST_FAN, encodeFanMode(drift.fanMode));
    }

    if (Object.keys(drift).length > 0) {
      const verified = await this.withTransport(() =>
        this.transport.readHoldingRegisters(device.modbusId, FULL_STATE_READ.address, FULL_STATE_READ.count),
      );
      const verifiedSnapshot = decodeFullState(verified);
      this.snapshots.set(device.deviceId, verifiedSnapshot);
      await device.updateSnapshot(verifiedSnapshot);
    }
  }

  private async performWrite(unitId: number, address: number, value: number): Promise<void> {
    await this.withTransport(() => this.transport.writeSingleRegister(unitId, address, value));
    this.pendingFullRefresh = true;
  }

  private scheduleTemperatureWrite(
    device: ManagedVartronicDevice,
    pending: DebouncedTemperatureWrite,
    register: number,
    label: string,
    pendingWrites: Map<string, DebouncedTemperatureWrite>,
  ): NodeJS.Timeout {
    return this.timerHost.setTimeout(() => {
      void this.requestQueue
        .enqueue(async () => {
          await this.performWrite(device.modbusId, register, encodeTemperature(pending.value));
          await this.refreshDevice(device);
        }, { label: `${label}:${device.modbusId}`, priority: WRITE_PRIORITY })
        .then(() => pending.resolve(), error => pending.reject(error))
        .finally(() => {
          pendingWrites.delete(device.deviceId);
        });
    }, 250);
  }

  private async withTransport<T>(operation: () => Promise<T>): Promise<T> {
    const now = Date.now();

    if (now < this.nextReconnectAt) {
      throw new Error(`Reconnect backoff is active until ${new Date(this.nextReconnectAt).toISOString()}.`);
    }

    try {
      const result = await operation();
      this.reconnectAttempt = 0;
      return result;
    } catch (error) {
      await this.transport.close();
      this.reconnectAttempt += 1;
      const backoffMs = Math.min(30_000, 1_000 * 2 ** (this.reconnectAttempt - 1));
      const jitterMs = Math.min(250, this.reconnectAttempt * 25);
      this.nextReconnectAt = Date.now() + backoffMs + jitterMs;
      this.pendingFullRefresh = true;
      throw error;
    }
  }

  private async broadcastAvailability(availability: GatewayAvailability): Promise<void> {
    await Promise.all(Array.from(this.devices.values()).map(device => device.handleGatewayAvailability(availability)));
  }
}
