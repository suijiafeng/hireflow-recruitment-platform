import type { CopilotStreamEventName, CopilotStreamEvents } from '@hireflow/shared';
import type { Response } from 'express';

/**
 * SSE 写出：event + data(JSON) 一帧；定时发注释心跳（`: ping`），
 * 防止代理 / 浏览器在长时间无输出（模型思考、工具查询）时判定空闲断开。
 */
export class SseWriter {
  private closed = false;
  private readonly heartbeat: NodeJS.Timeout;

  constructor(
    private readonly res: Response,
    heartbeatMs: number,
  ) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // nginx 关闭该响应的缓冲
    res.flushHeaders();
    res.write(': open\n\n');
    this.heartbeat = setInterval(() => this.raw(': ping\n\n'), heartbeatMs);
    this.heartbeat.unref?.();
    res.on('close', () => this.dispose());
  }

  get isClosed() {
    return this.closed;
  }

  send<K extends CopilotStreamEventName>(event: K, data: CopilotStreamEvents[K]) {
    this.raw(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  end() {
    if (this.closed) return;
    this.dispose();
    this.res.end();
  }

  private raw(chunk: string) {
    if (this.closed || this.res.writableEnded) return;
    this.res.write(chunk);
  }

  private dispose() {
    this.closed = true;
    clearInterval(this.heartbeat);
  }
}

/** 流的抽象出口（服务层只认这个接口，单测里用数组收集） */
export interface CopilotSink {
  send<K extends CopilotStreamEventName>(event: K, data: CopilotStreamEvents[K]): void;
}
