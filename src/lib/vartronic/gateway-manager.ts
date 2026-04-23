import type { VartronicLogger } from './logger';
import { ModbusTcpTransport } from './modbus-tcp-transport';
import { PollScheduler } from './poll-scheduler';
import { RequestQueue } from './request-queue';
import {
  FULL_STATE_READ,
  MIN_SUPPORTED_TIME_LAN_SEC,
  SAFE_HEARTBEAT_READ,
  VARTRONIC_REGISTERS,
  decodeFullState,
  decodeHeartbeatState,
  encodeFanMode,
  encodeMode,
  encodeTemperature,
  normalizeExternalTemperature,
} from './register-profile';
import { diffDesiredState } from './resync-policy';
import type {
  DeviceSnapshot,
  GatewaySettings,
  ManagedVartronicDevice,
  TimerHost,
  VartronicFanMode,
  VartronicMode,
} from './types';

const WRITE_PRIORITY = 1;
const FULL_REFRESH_PRIORITY = 10;
const HEARTBEAT_PRIORITY = 20;
const DEVICE_FAILURE_THRESHOLD = 3;
const POLLING_UNSTABLE_WARNING =
  `Polling is unstable. Verify every controller TimeLan is at least ${MIN_SUPPORTED_TIME_LAN_SEC}s and that the gateway responds reliably.`;

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

  private roundRobinCursor = 0;

  private readonly failedHeartbeatsByDeviceId = new Map<string, number>();

  public constructor(
    private settings: GatewaySettings,
    private readonly timerHost: TimerHost,
    private readonly logger: VartronicLogger,
  ) {
    this.transport = new ModbusTcpTransport(this.settings, logger.child(`gateway:${settings.gatewayKey}`));
    this.scheduler = new PollScheduler(timerHost, this, () => this.getPollingIntervalMs());
  }

  public attachDevice(device: ManagedVartronicDevice): void {
    this.devices.set(device.deviceId, device);
    this.scheduler.start();
    this.scheduler.triggerSoon();
  }

  public async detachDevice(deviceId: string): Promise<void> {
    this.devices.delete(deviceId);
    this.snapshots.delete(deviceId);
    this.failedHeartbeatsByDeviceId.delete(deviceId);

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
        encodeMode(mode, device.getProtocolSettings(), this.getEffectiveFanMode(device)),
      );
      await this.refreshDevice(device);
    }, { label: `mode:${device.modbusId}`, priority: WRITE_PRIORITY });
  }

  public async writeFanMode(device: ManagedVartronicDevice, fanMode: VartronicFanMode): Promise<void> {
    await this.requestQueue.enqueue(async () => {
      await this.performWrite(
        device.modbusId,
        VARTRONIC_REGISTERS.HEAT_CHILL,
        encodeMode(this.getEffectiveMode(device), device.getProtocolSettings(), fanMode),
      );

      if (fanMode !== 'auto') {
        await this.performWrite(device.modbusId, VARTRONIC_REGISTERS.UST_FAN, encodeFanMode(fanMode));
      }

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
    const pollingIntervalMs = this.getPollingIntervalMs();
    const heartbeatSuccessfulDeviceIds = new Set<string>();
    let hadHeartbeatFailure = false;

    for (const device of orderedDevices) {
      if (await this.handleUnsupportedTimeLanIfNeeded(device)) {
        continue;
      }

      try {
        const heartbeat = await this.requestQueue.enqueue(async () => this.readHeartbeat(device), {
          label: `heartbeat:${device.modbusId}`,
          priority: HEARTBEAT_PRIORITY,
        });
        await this.handleHeartbeatSuccess(device, heartbeat);
        heartbeatSuccessfulDeviceIds.add(device.deviceId);
      } catch (error) {
        hadHeartbeatFailure = true;
        await this.handleHeartbeatFailure(device, error);
      }
    }

    const elapsed = Date.now() - startedAt;
    const windowExceeded = elapsed > pollingIntervalMs;

    await Promise.all(orderedDevices
      .filter(device => heartbeatSuccessfulDeviceIds.has(device.deviceId))
      .map(device => device.handleGatewayAvailability({
        online: true,
        warning: windowExceeded || hadHeartbeatFailure ? POLLING_UNSTABLE_WARNING : null,
      })));

  }

  private getPollingIntervalMs(): number {
    return Math.max(1_000, this.settings.pollingIntervalSec * 1_000);
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

  private async handleUnsupportedTimeLanIfNeeded(device: ManagedVartronicDevice): Promise<boolean> {
    const timeLanSec = this.getConfirmedTimeLanSec(device);
    if (timeLanSec === null || timeLanSec >= MIN_SUPPORTED_TIME_LAN_SEC) {
      return false;
    }

    this.failedHeartbeatsByDeviceId.delete(device.deviceId);

    await device.handleGatewayAvailability({
      online: false,
      reason: 'Unsupported TimeLan configuration.',
      warning: `Device ${device.modbusId} has TimeLan=${timeLanSec}s. Set TimeLan to at least ${MIN_SUPPORTED_TIME_LAN_SEC}s.`,
    });

    return true;
  }

  private async handleHeartbeatSuccess(device: ManagedVartronicDevice, heartbeat: DeviceSnapshot): Promise<void> {
    await device.updateSnapshot(heartbeat);
    this.snapshots.set(device.deviceId, heartbeat);
    this.failedHeartbeatsByDeviceId.delete(device.deviceId);
  }

  private async handleHeartbeatFailure(device: ManagedVartronicDevice, error: unknown): Promise<void> {
    const failedHeartbeats = (this.failedHeartbeatsByDeviceId.get(device.deviceId) ?? 0) + 1;
    this.failedHeartbeatsByDeviceId.set(device.deviceId, failedHeartbeats);
    this.logger.warn(`Heartbeat failed for device ${device.modbusId}`, error);

    if (failedHeartbeats >= DEVICE_FAILURE_THRESHOLD) {
      await device.handleGatewayAvailability({
        online: false,
        reason: `Device ${device.modbusId} did not respond for ${failedHeartbeats} polling windows.`,
        warning: POLLING_UNSTABLE_WARNING,
      });
      return;
    }

    await device.handleGatewayAvailability({
      online: true,
      warning: POLLING_UNSTABLE_WARNING,
    });
  }

  private getEffectiveMode(device: ManagedVartronicDevice): VartronicMode {
    return this.snapshots.get(device.deviceId)?.mode ??
      device.getDesiredState().mode ??
      device.getLastActualState()?.mode ??
      'heat';
  }

  private getEffectiveFanMode(device: ManagedVartronicDevice): VartronicFanMode | null {
    return device.getDesiredState().fanMode ??
      this.snapshots.get(device.deviceId)?.fanMode ??
      device.getLastActualState()?.fanMode ??
      null;
  }

  private getConfirmedTimeLanSec(device: ManagedVartronicDevice): number | null {
    const snapshotValue = this.snapshots.get(device.deviceId)?.timeLanSec;
    if (typeof snapshotValue === 'number' && Number.isInteger(snapshotValue) && snapshotValue > 0) {
      return snapshotValue;
    }

    return null;
  }

  private async readHeartbeat(device: ManagedVartronicDevice): Promise<DeviceSnapshot> {
    const raw = await this.withTransport(() =>
      this.transport.readHoldingRegisters(device.modbusId, SAFE_HEARTBEAT_READ.address, SAFE_HEARTBEAT_READ.count),
    );

    return decodeHeartbeatState(raw, this.snapshots.get(device.deviceId) ?? device.getLastActualState());
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
        encodeMode(drift.mode, device.getProtocolSettings(), drift.fanMode ?? this.getEffectiveFanMode(device)),
      );
    }

    if (!drift.mode && drift.fanMode) {
      await this.performWrite(
        device.modbusId,
        VARTRONIC_REGISTERS.HEAT_CHILL,
        encodeMode(this.getEffectiveMode(device), device.getProtocolSettings(), drift.fanMode),
      );
    }

    if (drift.fanMode && drift.fanMode !== 'auto') {
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
    try {
      return await operation();
    } catch (error) {
      await this.transport.close();
      throw error;
    }
  }
}
