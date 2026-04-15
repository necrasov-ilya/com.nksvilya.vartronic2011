import type { QueueOptions } from './types';

interface QueueItem<T> {
  id: number;
  label: string;
  priority: number;
  task: () => Promise<T>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export class RequestQueue {
  private readonly items: Array<QueueItem<unknown>> = [];

  private currentId = 0;

  private isProcessing = false;

  private isClosed = false;

  public enqueue<T>(task: () => Promise<T>, options: QueueOptions = {}): Promise<T> {
    if (this.isClosed) {
      return Promise.reject(new Error('Request queue is closed.'));
    }

    return new Promise<T>((resolve, reject) => {
      this.items.push({
        id: this.currentId++,
        label: options.label ?? 'request',
        priority: options.priority ?? 10,
        task,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.items.sort((left, right) => {
        if (left.priority === right.priority) {
          return left.id - right.id;
        }

        return left.priority - right.priority;
      });
      void this.drain();
    });
  }

  public close(): void {
    this.isClosed = true;
    while (this.items.length > 0) {
      const item = this.items.shift();
      item?.reject(new Error('Request queue was closed.'));
    }
  }

  private async drain(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    while (this.items.length > 0 && !this.isClosed) {
      const item = this.items.shift();

      if (!item) {
        continue;
      }

      try {
        const result = await item.task();
        item.resolve(result);
      } catch (error) {
        item.reject(error);
      }
    }

    this.isProcessing = false;
  }
}
