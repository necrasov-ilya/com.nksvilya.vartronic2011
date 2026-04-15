import type { TimerHost } from './types';

export interface PollSchedulerDelegate {
  onPollWindow(): Promise<void>;
}

export class PollScheduler {
  private timeout: NodeJS.Timeout | null = null;

  private running = false;

  public constructor(
    private readonly timerHost: TimerHost,
    private readonly delegate: PollSchedulerDelegate,
    private readonly getWindowMs: () => number,
  ) {}

  public start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.schedule(0);
  }

  public stop(): void {
    this.running = false;

    if (this.timeout) {
      this.timerHost.clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  public triggerSoon(): void {
    if (!this.running) {
      this.start();
      return;
    }

    this.schedule(0);
  }

  private schedule(delay: number): void {
    if (this.timeout) {
      this.timerHost.clearTimeout(this.timeout);
    }

    this.timeout = this.timerHost.setTimeout(() => {
      void this.run();
    }, delay);
  }

  private async run(): Promise<void> {
    if (!this.running) {
      return;
    }

    const startedAt = Date.now();
    await this.delegate.onPollWindow();
    const elapsed = Date.now() - startedAt;
    const windowMs = this.getWindowMs();
    const nextDelay = Math.max(0, windowMs - elapsed);
    this.schedule(nextDelay);
  }
}
