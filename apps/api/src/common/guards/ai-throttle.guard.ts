import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

const WINDOW_MS = 60_000;
/** 计数表上限：防止大量不同 key 撑爆内存 */
const MAX_KEYS = 10_000;

/**
 * 固定窗口计数器（进程内存）。按「用户 × 接口」计数：每次 AI 调用都是真金白银的 token，
 * 入职问答这类任何登录用户都能调的接口尤其需要。多实例部署时每个实例各算各的，需换 Redis。
 */
export class RateLimitStore {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();

  /** 记一次请求；返回 null 表示放行，否则返回需要等待的秒数 */
  hit(key: string, limit: number, now = Date.now(), windowMs = WINDOW_MS): number | null {
    let bucket = this.hits.get(key);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      if (!bucket && this.hits.size >= MAX_KEYS) this.prune(now, windowMs);
      bucket = { count: 0, windowStart: now };
      this.hits.set(key, bucket);
    }
    if (bucket.count >= limit) return Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000));
    bucket.count++;
    return null;
  }

  reset() {
    this.hits.clear();
  }

  private prune(now: number, windowMs: number) {
    for (const [k, b] of this.hits) if (now - b.windowStart >= windowMs) this.hits.delete(k);
    while (this.hits.size >= MAX_KEYS) this.hits.delete(this.hits.keys().next().value as string);
  }
}

export const aiRateLimitStore = new RateLimitStore();

/** 每分钟上限；Jest 下（NODE_ENV=test）未显式配置时不限流，避免和业务回归测试互相干扰 */
export function aiRateLimitPerMinute(): number {
  const raw = process.env.AI_RATE_LIMIT_PER_MIN;
  const n = Number(raw);
  if (raw && Number.isFinite(n) && n > 0) return Math.floor(n);
  return process.env.NODE_ENV === 'test' ? Number.POSITIVE_INFINITY : 10;
}

/**
 * AI 接口限流守卫（默认每用户每接口每分钟 10 次，AI_RATE_LIMIT_PER_MIN 可调）。
 * 全局 JwtAuthGuard 先跑，所以这里能拿到 req.user；没有用户时退回按 IP。
 * 不依赖任何模块注入，挂在哪个控制器上都能直接用。
 */
@Injectable()
export class AiThrottleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { user?: { sub?: string } }>();
    const tracker = req.user?.sub ? `user:${req.user.sub}` : `ip:${req.ip ?? 'unknown'}`;
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    const retryAfter = aiRateLimitStore.hit(`${route}:${tracker}`, aiRateLimitPerMinute());
    if (retryAfter === null) return true;
    http.getResponse<Response>().setHeader?.('Retry-After', String(retryAfter));
    throw new HttpException(
      `AI 请求过于频繁，请 ${retryAfter} 秒后再试（每分钟最多 ${aiRateLimitPerMinute()} 次）`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** 标在会触发大模型调用的接口上 */
export const AiRateLimit = () => applyDecorators(UseGuards(AiThrottleGuard));
