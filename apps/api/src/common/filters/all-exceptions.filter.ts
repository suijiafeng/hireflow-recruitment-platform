import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../../generated/prisma/client';
import type { RequestWithId } from '../request-context';

/** 唯一约束字段 → 中文提示（没列到的字段给通用文案） */
const UNIQUE_FIELD_MESSAGES: Record<string, string> = {
  email: '该邮箱已被使用',
  phone: '该手机号已被使用',
  code: '编码已存在',
  name: '名称已存在',
  applicationId: '该应聘记录已存在同类记录',
};

const STATUS_CODE: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  410: 'GONE',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

function uniqueMessage(meta: Record<string, unknown> | undefined): string {
  // Prisma 7 driver adapter：meta.target 可能是字段数组，也可能在 driverAdapterError 里只给约束名
  const raw = meta?.target ?? (meta?.driverAdapterError as { cause?: { constraint?: { fields?: string[] } } } | undefined)?.cause?.constraint?.fields;
  const fields = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : [];
  for (const f of fields) {
    const hit = Object.keys(UNIQUE_FIELD_MESSAGES).find((k) => f === k || f.includes(k));
    if (hit) return UNIQUE_FIELD_MESSAGES[hit];
  }
  return '数据已存在，请勿重复提交';
}

/**
 * 全局异常出口，统一响应体：{ statusCode, code, message, requestId }。
 * - HttpException：保留原 message（字符串或校验错误数组），前端 client.ts 两种都能读；
 * - Prisma 已知错误：P2002 唯一冲突 → 409 中文提示；P2025 记录不存在 → 404；P2003 外键 → 409；
 * - 其余未知错误：500，只回「服务器开小差」+ 请求号，详细堆栈只进日志，不把内部信息带给客户端。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<RequestWithId>();
    // SSE 等已经开始写响应的情况，不能再改状态码
    if (res.headersSent) {
      this.logger.error(`响应已发出后发生异常 rid=${req?.requestId}`, (exception as Error)?.stack);
      return;
    }
    const requestId = req?.requestId;
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = '服务器开小差了，请稍后重试';
    let extra: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const { message: m, statusCode: _s, error: _e, ...rest } = body as Record<string, unknown>;
        if (typeof m === 'string' || Array.isArray(m)) message = m as string | string[];
        extra = rest;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        message = uniqueMessage(exception.meta as Record<string, unknown> | undefined);
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        message = '记录不存在或已被删除';
      } else if (exception.code === 'P2003') {
        status = HttpStatus.CONFLICT;
        message = '存在关联数据，操作无法完成';
      } else {
        this.logger.error(`Prisma ${exception.code} rid=${requestId}`, exception.stack);
      }
    } else {
      this.logger.error(`未处理异常 rid=${requestId}`, (exception as Error)?.stack ?? String(exception));
    }

    res.status(status).json({
      ...extra,
      statusCode: status,
      code: (extra.code as string | undefined) ?? STATUS_CODE[status] ?? `HTTP_${status}`,
      message,
      requestId,
    });
  }
}
