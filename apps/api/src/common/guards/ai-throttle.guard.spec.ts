import { Controller, Post, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AiRateLimit, RateLimitStore, aiRateLimitStore } from './ai-throttle.guard';

@Controller('t')
class LimitedController {
  @Post('ask')
  @AiRateLimit()
  ask() {
    return { ok: true };
  }

  @Post('other')
  @AiRateLimit()
  other() {
    return { ok: true };
  }

  @Post('free')
  free() {
    return { ok: true };
  }
}

describe('AI 接口限流（按用户 × 接口）', () => {
  let app: INestApplication;
  let base: string;
  let currentUser: { sub: string } | undefined;
  const previous = process.env.AI_RATE_LIMIT_PER_MIN;

  beforeAll(async () => {
    process.env.AI_RATE_LIMIT_PER_MIN = '3';
    const module = await Test.createTestingModule({
      controllers: [LimitedController],
      providers: [
        {
          provide: APP_GUARD,
          useValue: {
            canActivate(context: ExecutionContext) {
              context.switchToHttp().getRequest().user = currentUser;
              return true;
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  afterAll(async () => {
    process.env.AI_RATE_LIMIT_PER_MIN = previous;
    aiRateLimitStore.reset();
    await app.close();
  });

  const post = (path: string) => fetch(`${base}${path}`, { method: 'POST' });

  it('超过上限返回 429 + Retry-After + 中文提示；其他用户、其他接口、未标注接口不受影响', async () => {
    currentUser = { sub: 'u1' };
    for (let i = 0; i < 3; i++) expect((await post('/t/ask')).status).toBe(201);
    const blocked = await post('/t/ask');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await blocked.json()).message).toContain('AI 请求过于频繁');

    expect((await post('/t/other')).status).toBe(201);
    for (let i = 0; i < 5; i++) expect((await post('/t/free')).status).toBe(201);

    currentUser = { sub: 'u2' };
    expect((await post('/t/ask')).status).toBe(201);
  });

  it('窗口过期后自动恢复', () => {
    const store = new RateLimitStore();
    expect(store.hit('k', 1, 0)).toBeNull();
    expect(store.hit('k', 1, 30_000)).toBe(30);
    expect(store.hit('k', 1, 60_000)).toBeNull();
  });
});
