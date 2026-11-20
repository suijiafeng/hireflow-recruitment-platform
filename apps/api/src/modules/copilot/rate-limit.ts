/**
 * 每人每分钟的提问次数（滑动窗口）+ 同一账号同时只能有一条回复在生成。
 * 单实例内存实现：多实例部署时每个实例各算各的（README 已注明，可换 Redis）。
 */
export class CopilotRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly active = new Set<string>();

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** 返回需要等待的秒数；0 表示放行并计数 */
  take(userId: string): number {
    const t = this.now();
    const recent = (this.hits.get(userId) ?? []).filter((x) => t - x < 60_000);
    if (recent.length >= this.perMinute) {
      this.hits.set(userId, recent);
      return Math.max(1, Math.ceil((60_000 - (t - recent[0])) / 1000));
    }
    recent.push(t);
    this.hits.set(userId, recent);
    return 0;
  }

  /** 占用「正在生成」名额；已有则返回 false */
  acquire(userId: string): boolean {
    if (this.active.has(userId)) return false;
    this.active.add(userId);
    return true;
  }

  release(userId: string) {
    this.active.delete(userId);
  }
}
