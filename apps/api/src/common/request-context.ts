import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** 上游（nginx / 平台边缘）传入的请求号只接受这种形状，防止日志注入 */
const INCOMING_ID = /^[A-Za-z0-9._-]{8,64}$/;

export type RequestWithId = Request & { requestId?: string; user?: { sub?: string } };

const logger = new Logger('HTTP');

/** 健康检查每几秒一次，记下来全是噪音 */
const QUIET = new Set(['/api/health', '/api/ready']);

/**
 * 请求号 + 访问日志：
 * - 沿用上游的 X-Request-Id（合法时），否则生成一个；写回响应头，前端报错 / 用户截图时能对上日志；
 * - 请求结束打一行：方法 路径 状态码 耗时 用户 请求号。查询串不记（可能带门户令牌等敏感信息）。
 */
export function requestContext(req: RequestWithId, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  const id = incoming && INCOMING_ID.test(incoming) ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);

  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const path = req.originalUrl.split('?')[0];
    if (QUIET.has(path) && res.statusCode < 400) return;
    // 门户令牌在路径里，日志只留前 6 位
    const safePath = path.replace(/^(\/api\/portal\/)([^/]{6})[^/]*/, '$1$2…');
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const line = `${req.method} ${safePath} ${res.statusCode} ${ms.toFixed(0)}ms user=${req.user?.sub ?? '-'} rid=${id}`;
    if (res.statusCode >= 500) logger.error(line);
    else if (res.statusCode >= 400) logger.warn(line);
    else logger.log(line);
  });
  next();
}
