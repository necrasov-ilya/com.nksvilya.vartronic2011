import type { LoggerSink } from './types';

export class VartronicLogger {
  public constructor(
    private readonly sink: LoggerSink,
    private readonly prefix = 'vartronic',
  ) {}

  public child(scope: string): VartronicLogger {
    return new VartronicLogger(this.sink, `${this.prefix}:${scope}`);
  }

  public debug(message: string, meta?: unknown): void {
    this.sink.log(this.prefix, message, meta ?? '');
  }

  public info(message: string, meta?: unknown): void {
    this.sink.log(this.prefix, message, meta ?? '');
  }

  public warn(message: string, meta?: unknown): void {
    this.sink.error(this.prefix, message, meta ?? '');
  }

  public error(message: string, meta?: unknown): void {
    this.sink.error(this.prefix, message, meta ?? '');
  }
}
