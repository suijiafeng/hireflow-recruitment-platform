import { HttpException, HttpStatus } from '@nestjs/common';
import { LoginThrottleService, THROTTLE, type LoginSource } from './login-throttle.service';

const SEC = 1000;
const MIN = 60 * SEC;
const attacker: LoginSource = { ip: '203.0.113.9', trusted: true };
const victim: LoginSource = { ip: '198.51.100.7', trusted: true };
const behindProxy: LoginSource = { ip: '10.0.0.1', trusted: false };

function expect429(fn: () => void) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(HttpException);
    expect((e as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    return;
  }
  throw new Error('expected 429');
}

describe('LoginThrottleService（渐进退避，不按账号单独锁死）', () => {
  let t: LoginThrottleService;
  beforeEach(() => (t = new LoginThrottleService()));

  it('同一来源前 5 次失败不受限，之后 30s → 60s → 120s 翻倍退避（邮箱大小写不敏感）', () => {
    for (let i = 0; i < 5; i++) {
      t.assertAllowed('Admin@x.com', attacker, i);
      t.recordFailure('admin@x.com', attacker, i);
    }
    expect429(() => t.assertAllowed('ADMIN@x.com', attacker, 5));
    expect(t.waitMs('admin@x.com', attacker, 4)).toBe(30 * SEC);
    expect(() => t.assertAllowed('admin@x.com', attacker, 4 + 30 * SEC)).not.toThrow();
    t.recordFailure('admin@x.com', attacker, 4 + 30 * SEC);
    expect(t.waitMs('admin@x.com', attacker, 4 + 30 * SEC)).toBe(60 * SEC);
    t.recordFailure('admin@x.com', attacker, 4 + 90 * SEC);
    expect(t.waitMs('admin@x.com', attacker, 4 + 90 * SEC)).toBe(120 * SEC);
  });

  it('退避封顶 15 分钟（IP 可信时）', () => {
    for (let i = 0; i < 30; i++) t.recordFailure('a@x.com', attacker, 0);
    expect(t.waitMs('a@x.com', attacker, 0)).toBe(THROTTLE.PAIR_MAX_DELAY_MS);
  });

  it('DoS 回归：攻击者把某账号输错 50 次，本人从自己常用的网络仍能立即登录', () => {
    // 本人此前在自己的网络成功登录过
    t.recordSuccess('boss@x.com', victim, 0);
    for (let i = 0; i < 50; i++) t.recordFailure('boss@x.com', attacker, 1000 + i);
    expect429(() => t.assertAllowed('boss@x.com', attacker, 2000));
    expect(() => t.assertAllowed('boss@x.com', victim, 2000)).not.toThrow();
  });

  it('即使本人换了新网络，也只需等最多 30 秒，而不是被锁 15 分钟', () => {
    for (let i = 0; i < 50; i++) t.recordFailure('boss@x.com', attacker, i);
    const fresh: LoginSource = { ip: '192.0.2.44', trusted: true };
    expect(t.waitMs('boss@x.com', fresh, 49)).toBeLessThanOrEqual(THROTTLE.ACCOUNT_UNTRUSTED_INTERVAL_MS);
    expect(() => t.assertAllowed('boss@x.com', fresh, 49 + 30 * SEC)).not.toThrow();
  });

  it('分布式猜单个账号：失败累计 ≥20 次后，陌生来源每次尝试需间隔 30 秒', () => {
    for (let i = 0; i < 20; i++) t.recordFailure('a@x.com', { ip: `203.0.113.${i}`, trusted: true }, i);
    const next: LoginSource = { ip: '203.0.113.200', trusted: true };
    expect429(() => t.assertAllowed('a@x.com', next, 100));
    expect(() => t.assertAllowed('a@x.com', next, 19 + 30 * SEC)).not.toThrow();
  });

  it('密码喷洒：同一 IP 换着账号失败 30 次后被退避，其他 IP 不受影响', () => {
    for (let i = 0; i < 30; i++) t.recordFailure(`user${i}@x.com`, attacker, 0);
    expect429(() => t.assertAllowed('fresh@x.com', attacker, 1));
    expect(() => t.assertAllowed('fresh@x.com', victim, 1)).not.toThrow();
  });

  it('成功登录清零「账号+来源」计数，但不清 IP 计数', () => {
    for (let i = 0; i < 4; i++) t.recordFailure('a@x.com', victim, 0);
    t.recordSuccess('a@x.com', victim, 1);
    for (let i = 0; i < 4; i++) t.recordFailure('a@x.com', victim, 2);
    expect(() => t.assertAllowed('a@x.com', victim, 3)).not.toThrow();

    for (let i = 0; i < 30; i++) t.recordFailure(`user${i}@x.com`, attacker, 0);
    t.recordSuccess('user0@x.com', attacker, 1);
    expect429(() => t.assertAllowed('user0@x.com', attacker, 2));
  });

  it('静默 15 分钟后计数清零', () => {
    for (let i = 0; i < 8; i++) t.recordFailure('a@x.com', attacker, 0);
    expect(() => t.assertAllowed('a@x.com', attacker, 15 * MIN)).not.toThrow();
  });

  it('IP 不可信（未配 TRUST_PROXY）时退化为按账号，但最长只等 60 秒，且不启用 IP 闸', () => {
    for (let i = 0; i < 40; i++) t.recordFailure('a@x.com', behindProxy, 0);
    expect(t.waitMs('a@x.com', behindProxy, 0)).toBe(THROTTLE.PAIR_MAX_DELAY_UNTRUSTED_IP_MS);
    expect(() => t.assertAllowed('a@x.com', behindProxy, 60 * SEC)).not.toThrow();
    expect(() => t.assertAllowed('other@x.com', behindProxy, 1)).not.toThrow();
  });

  it('429 响应带 retryAfter 秒数与可读提示', () => {
    for (let i = 0; i < 5; i++) t.recordFailure('a@x.com', attacker, 0);
    try {
      t.assertAllowed('a@x.com', attacker, 0);
      throw new Error('expected 429');
    } catch (e) {
      const body = (e as HttpException).getResponse() as { message: string; retryAfter: number };
      expect(body.retryAfter).toBe(30);
      expect(body.message).toContain('30 秒');
    }
  });
});
