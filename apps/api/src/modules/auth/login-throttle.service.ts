import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/** 窗口内允许的失败次数与锁定时长 */
const ACCOUNT_MAX_FAILURES = 5;
const IP_MAX_FAILURES = 20;
const WINDOW_MS = 15 * 60 * 1000;
/** 计数表上限：攻击者可以用随机邮箱刷爆内存，超过时先清过期项，仍超则丢最旧的 */
const MAX_KEYS = 10_000;

interface Bucket {
  failures: number;
  windowStart: number;
}

/**
 * 登录失败限流（进程内存实现，单实例部署足够；多实例需换 Redis 等共享存储）。
 *
 * 两道闸：
 * - 按账号：同一邮箱 15 分钟内失败 5 次即锁定到窗口结束。这是主防线，挡住对已知账号的猜密码；
 *   不存在的邮箱也照样计数，否则「锁不锁」本身就泄露了账号是否存在。
 * - 按来源 IP：同一 IP 15 分钟内失败 20 次（换着账号试）即锁定。只有在服务端能拿到真实客户端 IP 时
 *   才有意义（TRUST_PROXY 配置正确）；拿不到时调用方传 null 跳过，避免整站共用代理 IP 被一起锁住。
 *
 * 成功登录清零该账号计数，不清 IP 计数（同一 IP 上的撞库不因猜中一个就重置）。
 */
@Injectable()
export class LoginThrottleService {
  private readonly buckets = new Map<string, Bucket>();

  /** 登录前调用：已被锁定则直接抛 429 */
  assertAllowed(email: string, ip: string | null, now = Date.now()) {
    const keys: Array<[string, number]> = [[this.accountKey(email), ACCOUNT_MAX_FAILURES]];
    if (ip) keys.push([this.ipKey(ip), IP_MAX_FAILURES]);
    for (const [key, max] of keys) {
      const bucket = this.live(key, now);
      if (bucket && bucket.failures >= max) {
        const minutes = Math.ceil((bucket.windowStart + WINDOW_MS - now) / 60_000);
        throw new HttpException(`登录失败次数过多，请 ${minutes} 分钟后再试`, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
  }

  recordFailure(email: string, ip: string | null, now = Date.now()) {
    this.bump(this.accountKey(email), now);
    if (ip) this.bump(this.ipKey(ip), now);
  }

  recordSuccess(email: string) {
    this.buckets.delete(this.accountKey(email));
  }

  private accountKey(email: string) {
    return `acct:${email.trim().toLowerCase()}`;
  }

  private ipKey(ip: string) {
    return `ip:${ip}`;
  }

  /** 取未过期的桶；过期即删除 */
  private live(key: string, now: number): Bucket | undefined {
    const bucket = this.buckets.get(key);
    if (bucket && now - bucket.windowStart >= WINDOW_MS) {
      this.buckets.delete(key);
      return undefined;
    }
    return bucket;
  }

  private bump(key: string, now: number) {
    const bucket = this.live(key, now);
    if (bucket) {
      bucket.failures += 1;
      return;
    }
    if (this.buckets.size >= MAX_KEYS) this.evict(now);
    this.buckets.set(key, { failures: 1, windowStart: now });
  }

  private evict(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= WINDOW_MS) this.buckets.delete(key);
    }
    // Map 按插入顺序迭代，仍超限时删最旧的
    while (this.buckets.size >= MAX_KEYS) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }
}
