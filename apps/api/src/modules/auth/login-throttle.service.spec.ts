import { HttpException, HttpStatus } from '@nestjs/common';
import { LoginThrottleService } from './login-throttle.service';

const MIN = 60_000;

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

describe('LoginThrottleService', () => {
  let t: LoginThrottleService;
  beforeEach(() => (t = new LoginThrottleService()));

  it('locks an account after 5 failures within the window, regardless of email case', () => {
    for (let i = 0; i < 5; i++) {
      t.assertAllowed('Admin@x.com', null, 0);
      t.recordFailure('admin@x.com', null, 0);
    }
    expect429(() => t.assertAllowed('ADMIN@x.com', null, 1));
  });

  it('unlocks once the 15-minute window has passed', () => {
    for (let i = 0; i < 5; i++) t.recordFailure('a@x.com', null, 0);
    expect(() => t.assertAllowed('a@x.com', null, 15 * MIN)).not.toThrow();
  });

  it('resets the account counter on successful login', () => {
    for (let i = 0; i < 4; i++) t.recordFailure('a@x.com', null, 0);
    t.recordSuccess('a@x.com');
    t.recordFailure('a@x.com', null, 1);
    expect(() => t.assertAllowed('a@x.com', null, 2)).not.toThrow();
  });

  it('locks an IP that sprays many accounts, but only when an IP is supplied', () => {
    for (let i = 0; i < 20; i++) t.recordFailure(`user${i}@x.com`, '203.0.113.9', 0);
    expect429(() => t.assertAllowed('fresh@x.com', '203.0.113.9', 1));
    expect(() => t.assertAllowed('fresh@x.com', '198.51.100.1', 1)).not.toThrow();
    expect(() => t.assertAllowed('fresh@x.com', null, 1)).not.toThrow();
  });

  it('keeps the IP counter after a success on that IP', () => {
    for (let i = 0; i < 20; i++) t.recordFailure(`user${i}@x.com`, '203.0.113.9', 0);
    t.recordSuccess('user0@x.com');
    expect429(() => t.assertAllowed('user0@x.com', '203.0.113.9', 1));
  });
});
