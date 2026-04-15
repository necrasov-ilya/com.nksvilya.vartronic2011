declare module 'homey' {
  export interface PairSession {
    setHandler(name: string, handler: (data?: unknown) => unknown | Promise<unknown>): void;
  }

  export interface FlowCardAction {
    registerRunListener(
      listener: (args: Record<string, unknown>, state?: Record<string, unknown>) => boolean | Promise<boolean>,
    ): this;
  }

  export interface FlowCardCondition {
    registerRunListener(
      listener: (args: Record<string, unknown>, state?: Record<string, unknown>) => boolean | Promise<boolean>,
    ): this;
  }

  export interface FlowCardTriggerDevice {
    trigger(
      device: Device,
      tokens?: Record<string, unknown>,
      state?: Record<string, unknown>,
    ): Promise<void>;
  }

  export interface FlowManager {
    getActionCard(id: string): FlowCardAction;
    getConditionCard(id: string): FlowCardCondition;
    getDeviceTriggerCard(id: string): FlowCardTriggerDevice;
  }

  class Base {
    readonly homey: Base;
    readonly flow: FlowManager;
    readonly app: App;
    log(...args: unknown[]): void;
    error(...args: unknown[]): void;
    setTimeout(callback: (...args: unknown[]) => void, delay: number): NodeJS.Timeout;
    clearTimeout(timeout: NodeJS.Timeout): void;
    getDriver(id: string): Driver;
  }

  export class App extends Base {
    onInit?(): Promise<void> | void;
    onUninit?(): Promise<void> | void;
  }

  export class Driver extends Base {
    onInit?(): Promise<void> | void;
    onPair?(session: PairSession): Promise<void> | void;
    onRepair?(session: PairSession, device: Device): Promise<void> | void;
    getDevices(): Promise<Device[]> | Device[];
  }

  export class Device extends Base {
    readonly driver: Driver;
    onInit?(): Promise<void> | void;
    onAdded?(): Promise<void> | void;
    onDeleted?(): Promise<void> | void;
    onSettings?(event: {
      oldSettings: Record<string, unknown>;
      newSettings: Record<string, unknown>;
      changedKeys: string[];
    }): Promise<string | void> | string | void;
    getData<T = Record<string, unknown>>(): T;
    getSettings<T = Record<string, unknown>>(): T;
    setSettings(settings: Record<string, unknown>): Promise<void>;
    getStoreValue<T = unknown>(key: string): T | null;
    setStoreValue(key: string, value: unknown): Promise<void>;
    registerCapabilityListener(
      capabilityId: string,
      listener: (value: unknown) => Promise<void> | void,
    ): void;
    setCapabilityValue(capabilityId: string, value: unknown): Promise<void>;
    getCapabilityValue<T = unknown>(capabilityId: string): T;
    setUnavailable(message?: string): Promise<void>;
    setAvailable(): Promise<void>;
    setWarning(message: string): Promise<void>;
    unsetWarning(): Promise<void>;
    getName(): string;
  }

  const Homey: {
    App: typeof App;
    Driver: typeof Driver;
    Device: typeof Device;
  };

  export default Homey;
}
