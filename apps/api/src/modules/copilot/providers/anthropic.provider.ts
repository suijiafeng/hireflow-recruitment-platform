import Anthropic from '@anthropic-ai/sdk';
import { parseToolArgs, type ChatMessage, type CopilotProvider, type StreamEvent, type StreamRequest } from './types';

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  baseURL?: string;
  timeoutMs: number;
}

type MessageParam = Anthropic.MessageParam;
type ContentBlockParam = Anthropic.ContentBlockParam;

/** 内部消息 → Anthropic Messages：连续的 tool 结果合并成一条 user 消息里的多个 tool_result 块 */
export function toAnthropicMessages(messages: ChatMessage[]): MessageParam[] {
  const out: MessageParam[] = [];
  const push = (role: 'user' | 'assistant', blocks: ContentBlockParam[]) => {
    const last = out[out.length - 1];
    if (last && last.role === role && Array.isArray(last.content)) {
      (last.content as ContentBlockParam[]).push(...blocks);
    } else {
      out.push({ role, content: blocks });
    }
  };
  for (const m of messages) {
    if (m.role === 'user') {
      push('user', [{ type: 'text', text: m.content || '（空）' }]);
    } else if (m.role === 'assistant') {
      const blocks: ContentBlockParam[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const call of m.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args });
      }
      if (blocks.length) push('assistant', blocks);
    } else {
      push('user', [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }]);
    }
  }
  // Messages API 要求以 user 开头
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

/** 最小的流事件形状（便于单测注入假的 SDK 客户端） */
export type AnthropicStreamEvent =
  | { type: 'message_start'; message: { usage?: { input_tokens?: number; output_tokens?: number } } }
  | { type: 'content_block_start'; index: number; content_block: { type: string; id?: string; name?: string } }
  | { type: 'content_block_delta'; index: number; delta: { type: string; text?: string; partial_json?: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason?: string | null }; usage?: { input_tokens?: number | null; output_tokens?: number } }
  | { type: 'message_stop' };

export interface AnthropicLikeClient {
  messages: {
    create(body: Record<string, unknown>, options: { signal: AbortSignal }): Promise<AsyncIterable<AnthropicStreamEvent>>;
  };
}

/**
 * Anthropic 流式 + 工具调用：text_delta 逐块转发；tool_use 块的 input_json_delta 拼完整后在 content_block_stop 时给出。
 * 不开 thinking：工具循环里要回传 thinking 块，收益不抵复杂度。
 */
export class AnthropicCopilotProvider implements CopilotProvider {
  readonly kind = 'anthropic';
  readonly mode = 'llm' as const;
  readonly model: string;
  private readonly client: AnthropicLikeClient;

  constructor(options: AnthropicProviderOptions, client?: AnthropicLikeClient) {
    this.model = options.model;
    this.client =
      client ??
      (new Anthropic({
        apiKey: options.apiKey,
        baseURL: options.baseURL,
        timeout: options.timeoutMs,
        maxRetries: 0,
      }) as unknown as AnthropicLikeClient);
  }

  async *stream(request: StreamRequest): AsyncIterable<StreamEvent> {
    const stream = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: toAnthropicMessages(request.messages),
        ...(request.tools.length
          ? { tools: request.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) }
          : {}),
        stream: true,
      },
      { signal: request.signal },
    );
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason = 'end_turn';
    const tools = new Map<number, { id: string; name: string; json: string }>();
    for await (const event of stream) {
      switch (event.type) {
        case 'message_start':
          inputTokens = event.message.usage?.input_tokens ?? 0;
          outputTokens = event.message.usage?.output_tokens ?? 0;
          break;
        case 'content_block_start':
          if (event.content_block.type === 'tool_use') {
            tools.set(event.index, { id: event.content_block.id ?? `tool_${event.index}`, name: event.content_block.name ?? '', json: '' });
          }
          break;
        case 'content_block_delta':
          if (event.delta.type === 'text_delta' && event.delta.text) {
            yield { type: 'text', delta: event.delta.text };
          } else if (event.delta.type === 'input_json_delta') {
            const tool = tools.get(event.index);
            if (tool) tool.json += event.delta.partial_json ?? '';
          }
          break;
        case 'content_block_stop': {
          const tool = tools.get(event.index);
          if (tool) {
            tools.delete(event.index);
            yield { type: 'tool_call', call: { id: tool.id, name: tool.name, args: parseToolArgs(tool.json) } };
          }
          break;
        }
        case 'message_delta':
          // message_delta 的用量是累计值；新版 API 也会带 input_tokens
          if (event.usage?.output_tokens != null) outputTokens = event.usage.output_tokens;
          if (event.usage?.input_tokens) inputTokens = event.usage.input_tokens;
          if (event.delta.stop_reason) stopReason = event.delta.stop_reason;
          break;
        default:
          break;
      }
    }
    if (stopReason === 'refusal') throw new Error('模型拒绝了该请求（safety refusal）');
    yield { type: 'usage', inputTokens, outputTokens, model: this.model };
    yield { type: 'stop', reason: stopReason };
  }
}
