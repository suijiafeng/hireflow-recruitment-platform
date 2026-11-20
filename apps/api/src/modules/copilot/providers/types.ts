/** Copilot 模型层的统一抽象：三种引擎（Anthropic / OpenAI 兼容 / Mock）都实现同一个流式 + 工具调用接口 */

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

/** 提供给模型的工具声明（JSON Schema 参数） */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
}

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'usage'; inputTokens: number; outputTokens: number; model: string }
  | { type: 'stop'; reason: string };

export interface StreamRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  maxTokens: number;
  signal: AbortSignal;
}

export interface CopilotProvider {
  /** anthropic / openai / deepseek / … / mock */
  readonly kind: string;
  readonly model: string;
  readonly mode: 'llm' | 'mock';
  stream(request: StreamRequest): AsyncIterable<StreamEvent>;
}

/** 模型返回的工具参数可能不是合法 JSON（截断 / 胡写）：解析失败给空对象，由工具层参数校验报错 */
export function parseToolArgs(raw: string | undefined | null): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
