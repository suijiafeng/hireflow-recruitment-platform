import { parseToolArgs, type ChatMessage, type CopilotProvider, type StreamEvent, type StreamRequest } from './types';

export interface OpenAiProviderOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  /** 显示用供应商名（openai / deepseek / qwen …） */
  kind: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/** 内部消息 → Chat Completions 消息 */
export function toOpenAiMessages(system: string, messages: ChatMessage[]) {
  const out: Array<Record<string, unknown>> = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: m.content || null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.args) },
              })),
            }
          : {}),
      });
    } else {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    }
  }
  return out;
}

interface ChunkDelta {
  content?: string | null;
  tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
}
interface Chunk {
  choices?: Array<{ delta?: ChunkDelta; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/** 把字节流切成 SSE 的 data 行（兼容 \r\n、跨块拆行） */
export async function* sseDataLines(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('data:')) yield line.slice(5).trimStart();
      }
    }
    const rest = buffer.trim();
    if (rest.startsWith('data:')) yield rest.slice(5).trimStart();
  } finally {
    reader.releaseLock();
  }
}

/**
 * OpenAI 兼容流式 + function calling（DeepSeek / 通义 / Kimi / vLLM …）：
 * delta.tool_calls 按 index 累积 name / arguments，流结束时一次性给出；
 * stream_options.include_usage 拿最后一块的 token 用量（不支持的服务商没有就记 0）。
 */
export class OpenAiCopilotProvider implements CopilotProvider {
  readonly kind: string;
  readonly model: string;
  readonly mode = 'llm' as const;
  private readonly endpoint: string;

  constructor(private readonly options: OpenAiProviderOptions) {
    this.kind = options.kind;
    this.model = options.model;
    this.endpoint = `${options.baseURL.replace(/\/+$/, '')}/chat/completions`;
  }

  async *stream(request: StreamRequest): AsyncIterable<StreamEvent> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const res = await doFetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: request.maxTokens,
        temperature: 0.3,
        messages: toOpenAiMessages(request.system, request.messages),
        ...(request.tools.length
          ? {
              tools: request.tools.map((t) => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.parameters },
              })),
            }
          : {}),
      }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(this.options.timeoutMs)]),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`模型接口返回 ${res.status}：${text.slice(0, 200)}`);
    }
    const calls = new Map<number, { id: string; name: string; args: string }>();
    let inputTokens = 0;
    let outputTokens = 0;
    let finish = 'stop';
    for await (const data of sseDataLines(res.body)) {
      if (data === '[DONE]') break;
      let chunk: Chunk;
      try {
        chunk = JSON.parse(data) as Chunk;
      } catch {
        continue;
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
        outputTokens = chunk.usage.completion_tokens ?? outputTokens;
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (delta.content) yield { type: 'text', delta: delta.content };
      for (const tc of delta.tool_calls ?? []) {
        const current = calls.get(tc.index) ?? { id: '', name: '', args: '' };
        if (tc.id) current.id = tc.id;
        if (tc.function?.name) current.name += tc.function.name;
        if (tc.function?.arguments) current.args += tc.function.arguments;
        calls.set(tc.index, current);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
    for (const [index, call] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
      if (!call.name) continue;
      yield { type: 'tool_call', call: { id: call.id || `call_${index}`, name: call.name, args: parseToolArgs(call.args) } };
    }
    yield { type: 'usage', inputTokens, outputTokens, model: this.model };
    yield { type: 'stop', reason: finish };
  }
}
