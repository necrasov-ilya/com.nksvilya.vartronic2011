import type { TimerHost } from '../../src/lib/vartronic/types';

interface PendingTimeout {
  id: number;
  callback: () => void;
}

export class FakeTimerHost implements TimerHost {
  private pending = new Map<number, PendingTimeout>();

  private nextId = 1;

  public setTimeout(callback: () => void): NodeJS.Timeout {
    const id = this.nextId++;
    this.pending.set(id, { id, callback });
    return id as unknown as NodeJS.Timeout;
  }

  public clearTimeout(timeout: NodeJS.Timeout): void {
    this.pending.delete(Number(timeout));
  }

  public async flushAll(): Promise<void> {
    while (this.pending.size > 0) {
      const tasks = Array.from(this.pending.values());
      this.pending.clear();

      for (const task of tasks) {
        task.callback();
        await Promise.resolve();
      }
    }
  }
}
