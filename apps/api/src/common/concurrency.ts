/**
 * 计数信号量：限制同时在途的大模型请求数。
 * 单实例内有效（多实例部署时每个实例各自限流，总并发 = 实例数 × 上限）。
 */
export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Semaphore limit 必须是正整数');
  }

  get inFlight() {
    return this.active;
  }

  get waiting() {
    return this.queue.length;
  }

  /** 获取许可；signal 中止时放弃排队并抛出中止原因 */
  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('aborted'));
    return new Promise((resolve, reject) => {
      const grant = () => {
        this.active++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.active--;
          this.queue.shift()?.();
        });
      };
      if (this.active < this.limit) return grant();
      const onAbort = () => {
        const i = this.queue.indexOf(waiter);
        if (i >= 0) this.queue.splice(i, 1);
        reject(signal?.reason ?? new Error('aborted'));
      };
      const waiter = () => {
        signal?.removeEventListener('abort', onAbort);
        grant();
      };
      this.queue.push(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/**
 * 有并发上限的 map（等价于 p-limit + Promise.allSettled），结果顺序与输入一致。
 * shouldStart 返回 false 时剩余任务不再启动，结果记为 skipped（用于整体时间预算）。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  shouldStart: () => boolean = () => true,
): Promise<Array<PromiseSettledResult<R> | { status: 'skipped' }>> {
  const results: Array<PromiseSettledResult<R> | { status: 'skipped' }> = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      if (!shouldStart()) {
        results[i] = { status: 'skipped' };
        continue;
      }
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
