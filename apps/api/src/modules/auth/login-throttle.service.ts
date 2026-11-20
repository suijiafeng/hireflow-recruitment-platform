import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/**
 * 登录失败限流（进程内存实现，单实例部署足够；多实例需换 Redis 等共享存储）。
 *
 * 旧实现「同一邮箱 15 分钟失败 5 次即锁 15 分钟」有 DoS 问题：任何人知道你的邮箱，
 * 随手输错 5 次就能把你锁在门外。现在改成不按账号单独上锁，而是三道「渐进退避」闸：
 *
 * 1. 账号 + 来源 IP（主防线）：同一来源对同一账号前 5 次失败不受限，之后每次失败都要等
 *    30s → 60s → 120s …（翻倍，封顶 15 分钟）。攻击者只能拖慢自己那个来源，受害者从自己的网络照常登录。
 * 2. 账号维度（防分布式撞单个账号）：同一账号 15 分钟内累计失败 ≥ 20 次后，
 *    「从未在该账号成功登录过的来源」每次尝试需间隔 30 秒；最近 30 天在该账号成功登录过的来源不受此闸影响。
 *    即使攻击者换 IP 猜密码，单账号也只能约 2 次/分钟，而本人不受影响。
 * 3. 来源 IP 维度（防撞库 / 密码喷洒）：同一 IP 换着账号失败 ≥ 30 次后按 1 分钟起翻倍退避，封顶 15 分钟。
 *
 * 只有配置了 TRUST_PROXY（req.ip 是真实客户端）时 IP 才可信：
 * - 可信：三道闸全开；
 * - 不可信（拿到的可能是代理地址，全站共用）：IP 闸与「可信来源」豁免都没有意义，关闭；
 *   第 1 道闸退化为按账号，退避上限降到 60 秒——宁可慢一点，也不让别人把账号锁住 15 分钟。
 *
 * 不存在的邮箱也照样计数、同样退避，否则「是否被限流」本身就泄露了账号是否存在。
 * 成功登录清零「账号 + 来源」计数并把该来源记为可信；不清 IP 计数（撞库猜中一个不重置）。
 */
export const THROTTLE = {
  PAIR_FREE_FAILURES: 5,
  PAIR_BASE_DELAY_MS: 30_000,
  PAIR_MAX_DELAY_MS: 15 * 60_000,
  PAIR_MAX_DELAY_UNTRUSTED_IP_MS: 60_000,
  ACCOUNT_FREE_FAILURES: 20,
  ACCOUNT_UNTRUSTED_INTERVAL_MS: 30_000,
  IP_FREE_FAILURES: 30,
  IP_BASE_DELAY_MS: 60_000,
  IP_MAX_DELAY_MS: 15 * 60_000,
  /** 计数在最后一次失败后静默这么久即清零 */
  DECAY_MS: 15 * 60_000,
  TRUSTED_SOURCE_TTL_MS: 30 * 24 * 3600_000,
  /** 计数表上限：攻击者可以用随机邮箱刷爆内存，超过时先清过期项，仍超则丢最旧的 */
  MAX_KEYS: 20_000,
} as const;

export interface LoginSource {
  /** 客户端地址；拿不到时为 null */
  ip: string | null;
  /** ip 是否可信（TRUST_PROXY 已正确配置） */
  trusted: boolean;
}

interface Bucket {
  failures: number;
  lastFailureAt: number;
}

const UNTRUSTED: LoginSource = { ip: null, trusted: false };

@Injectable()
export class LoginThrottleService {
  private readonly buckets = new Map<string, Bucket>();
  /** 「来源在该账号成功登录过」：key → 过期时间 */
  private readonly trustedSources = new Map<string, number>();

  /** 登录前调用：仍在退避期内则抛 429（带 Retry-After 秒数） */
  assertAllowed(email: string, source: LoginSource = UNTRUSTED, now = Date.now()) {
    const wait = this.waitMs(email, source, now);
    if (wait > 0) {
      const seconds = Math.ceil(wait / 1000);
      const human = seconds >= 90 ? `${Math.ceil(seconds / 60)} 分钟` : `${seconds} 秒`;
      throw new HttpException(
        { statusCode: 429, message: `尝试过于频繁，请 ${human}后再试`, retryAfter: seconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** 需要再等多久（ms），0 表示放行。导出给测试与响应头使用 */
  waitMs(email: string, source: LoginSource = UNTRUSTED, now = Date.now()): number {
    const acct = this.normalize(email);
    let wait = 0;

    const pair = this.live(this.pairKey(acct, source), now);
    if (pair && pair.failures >= THROTTLE.PAIR_FREE_FAILURES) {
      const cap = source.trusted ? THROTTLE.PAIR_MAX_DELAY_MS : THROTTLE.PAIR_MAX_DELAY_UNTRUSTED_IP_MS;
      const delay = Math.min(THROTTLE.PAIR_BASE_DELAY_MS * 2 ** (pair.failures - THROTTLE.PAIR_FREE_FAILURES), cap);
      wait = Math.max(wait, pair.lastFailureAt + delay - now);
    }

    if (source.trusted && source.ip) {
      const account = this.live(`acct:${acct}`, now);
      if (
        account &&
        account.failures >= THROTTLE.ACCOUNT_FREE_FAILURES &&
        !this.isTrustedSource(acct, source.ip, now)
      ) {
        wait = Math.max(wait, account.lastFailureAt + THROTTLE.ACCOUNT_UNTRUSTED_INTERVAL_MS - now);
      }
      const ip = this.live(`ip:${source.ip}`, now);
      if (ip && ip.failures >= THROTTLE.IP_FREE_FAILURES) {
        const delay = Math.min(THROTTLE.IP_BASE_DELAY_MS * 2 ** (ip.failures - THROTTLE.IP_FREE_FAILURES), THROTTLE.IP_MAX_DELAY_MS);
        wait = Math.max(wait, ip.lastFailureAt + delay - now);
      }
    }
    return Math.max(0, wait);
  }

  recordFailure(email: string, source: LoginSource = UNTRUSTED, now = Date.now()) {
    const acct = this.normalize(email);
    this.bump(this.pairKey(acct, source), now);
    if (source.trusted && source.ip) {
      this.bump(`acct:${acct}`, now);
      this.bump(`ip:${source.ip}`, now);
    }
  }

  recordSuccess(email: string, source: LoginSource = UNTRUSTED, now = Date.now()) {
    const acct = this.normalize(email);
    this.buckets.delete(this.pairKey(acct, source));
    if (source.trusted && source.ip) {
      if (this.trustedSources.size >= THROTTLE.MAX_KEYS) this.evictTrusted(now);
      this.trustedSources.set(`${acct}|${source.ip}`, now + THROTTLE.TRUSTED_SOURCE_TTL_MS);
    }
  }

  private normalize(email: string) {
    return email.trim().toLowerCase();
  }

  /** IP 不可信时不拼 IP：拿到的是代理地址，拼上也等于按账号 */
  private pairKey(acct: string, source: LoginSource) {
    return source.trusted && source.ip ? `pair:${acct}|${source.ip}` : `pair:${acct}`;
  }

  private isTrustedSource(acct: string, ip: string, now: number) {
    const until = this.trustedSources.get(`${acct}|${ip}`);
    if (until === undefined) return false;
    if (until <= now) {
      this.trustedSources.delete(`${acct}|${ip}`);
      return false;
    }
    return true;
  }

  /** 取未衰减的桶；最后一次失败后静默超过 DECAY_MS 即删除 */
  private live(key: string, now: number): Bucket | undefined {
    const bucket = this.buckets.get(key);
    if (bucket && now - bucket.lastFailureAt >= THROTTLE.DECAY_MS) {
      this.buckets.delete(key);
      return undefined;
    }
    return bucket;
  }

  private bump(key: string, now: number) {
    const bucket = this.live(key, now);
    if (bucket) {
      bucket.failures += 1;
      bucket.lastFailureAt = now;
      return;
    }
    if (this.buckets.size >= THROTTLE.MAX_KEYS) this.evict(now);
    this.buckets.set(key, { failures: 1, lastFailureAt: now });
  }

  private evict(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastFailureAt >= THROTTLE.DECAY_MS) this.buckets.delete(key);
    }
    // Map 按插入顺序迭代，仍超限时删最旧的
    while (this.buckets.size >= THROTTLE.MAX_KEYS) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }

  private evictTrusted(now: number) {
    for (const [key, until] of this.trustedSources) if (until <= now) this.trustedSources.delete(key);
    while (this.trustedSources.size >= THROTTLE.MAX_KEYS) {
      const oldest = this.trustedSources.keys().next().value;
      if (oldest === undefined) break;
      this.trustedSources.delete(oldest);
    }
  }
}
