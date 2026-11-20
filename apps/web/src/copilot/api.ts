import type { CopilotActionView, CopilotStreamEventName, CopilotStreamEvents } from '@hireflow/shared';
import { http } from '../api/client';
import { useAuthStore } from '../stores/auth';

export interface CopilotStatus {
  provider: string;
  model: string;
  mode: 'llm' | 'mock';
  tools: string[];
  suggestions: string[];
  limits: { ratePerMinute: number; maxInputChars: number };
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  contextType: string | null;
  contextId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName: string | null;
  toolCallId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface ResolvedContext {
  type: 'candidate' | 'job';
  id: string;
  label: string;
}

export interface ConversationDetail extends ConversationSummary {
  context: ResolvedContext | null;
  messages: StoredMessage[];
  actions: CopilotActionView[];
}

export const copilotApi = {
  status: () => http.get<CopilotStatus>('/copilot/status').then((r) => r.data),
  context: (type: string, id: string) =>
    http.get<{ context: ResolvedContext | null }>('/copilot/context', { params: { type, id } }).then((r) => r.data.context),
  list: () => http.get<ConversationSummary[]>('/copilot/conversations').then((r) => r.data),
  create: (body: { title?: string; contextType?: string; contextId?: string } = {}) =>
    http.post<ConversationSummary>('/copilot/conversations', body).then((r) => r.data),
  detail: (id: string) => http.get<ConversationDetail>(`/copilot/conversations/${id}`).then((r) => r.data),
  rename: (id: string, title: string) => http.patch<ConversationSummary>(`/copilot/conversations/${id}`, { title }).then((r) => r.data),
  remove: (id: string) => http.delete(`/copilot/conversations/${id}`).then((r) => r.data),
  confirm: (id: string) => http.post<CopilotActionView>(`/copilot/actions/${id}/confirm`).then((r) => r.data),
  reject: (id: string) => http.post<CopilotActionView>(`/copilot/actions/${id}/reject`).then((r) => r.data),
};

export type StreamHandler = <K extends CopilotStreamEventName>(event: K, data: CopilotStreamEvents[K]) => void;

export class CopilotHttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** 解析 SSE 文本流：按空行分帧，忽略注释帧（心跳 `: ping`） */
export async function readSse(body: ReadableStream<Uint8Array>, onEvent: StreamHandler) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (!data.length) continue;
      try {
        onEvent(event as CopilotStreamEventName, JSON.parse(data.join('\n')));
      } catch {
        /* 半帧 / 非 JSON：忽略 */
      }
    }
  }
}

/**
 * 发送消息并读取 SSE。用 fetch 而不是 EventSource：要 POST 正文和 Authorization 头，
 * 「停止」= abort 这个请求，服务端感知断开后中止模型调用。
 */
export async function streamMessage(
  conversationId: string,
  body: { content: string; contextType?: string; contextId?: string },
  onEvent: StreamHandler,
  signal: AbortSignal,
) {
  const token = useAuthStore.getState().token;
  const res = await fetch(`/api/copilot/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let message = '发送失败，请稍后重试';
    try {
      const json = (await res.json()) as { message?: string | string[] };
      if (json.message) message = Array.isArray(json.message) ? json.message.join('；') : json.message;
    } catch {
      /* 非 JSON */
    }
    if (res.status === 401) useAuthStore.getState().logout();
    throw new CopilotHttpError(message, res.status);
  }
  await readSse(res.body, onEvent);
}
