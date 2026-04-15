import { RequestQueue } from '../../src/lib/vartronic/request-queue';

describe('request queue', () => {
  it('runs higher-priority requests before lower-priority ones', async () => {
    const queue = new RequestQueue();
    const order: string[] = [];
    let releaseFirstTask!: () => void;
    const firstTask = new Promise<void>(resolve => {
      releaseFirstTask = resolve;
    });

    const first = queue.enqueue(async () => {
      order.push('first');
      await firstTask;
      return 'first';
    }, { priority: 20 });

    const slow = queue.enqueue(async () => {
      order.push('low');
      return 'low';
    }, { priority: 20 });

    const fast = queue.enqueue(async () => {
      order.push('high');
      return 'high';
    }, { priority: 1 });

    releaseFirstTask();
    await Promise.all([first, slow, fast]);

    expect(order).toEqual(['first', 'high', 'low']);
  });
});
