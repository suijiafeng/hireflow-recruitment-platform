import { Semaphore, mapWithConcurrency } from './concurrency';

const tick = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe('并发控制', () => {
  it('mapWithConcurrency：同时在途不超过上限，结果顺序与输入一致，单个失败不影响其余', async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick(10 + (n % 3) * 5);
      inFlight--;
      if (n === 4) throw new Error('boom');
      return n * 10;
    });
    expect(peak).toBe(3);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : r.status))).toEqual([
      10, 20, 30, 'rejected', 50, 60, 70,
    ]);
  });

  it('mapWithConcurrency：时间预算用完后剩余任务不再启动', async () => {
    let started = 0;
    const results = await mapWithConcurrency(
      [1, 2, 3, 4, 5],
      2,
      async (n) => {
        started++;
        await tick(5);
        return n;
      },
      () => started < 2,
    );
    expect(started).toBe(2);
    expect(results.filter((r) => r.status === 'skipped')).toHaveLength(3);
  });

  it('Semaphore：排队中的请求可被中止信号取消，不占名额', async () => {
    const sem = new Semaphore(1);
    const release = await sem.acquire();
    const controller = new AbortController();
    const waiting = sem.acquire(controller.signal);
    expect(sem.waiting).toBe(1);
    controller.abort(new Error('deadline'));
    await expect(waiting).rejects.toThrow('deadline');
    expect(sem.waiting).toBe(0);
    release();
    expect(sem.inFlight).toBe(0);
    // 重复 release 不会把计数减成负数
    release();
    expect(sem.inFlight).toBe(0);
    await expect(sem.run(async () => 'ok')).resolves.toBe('ok');
  });
});
