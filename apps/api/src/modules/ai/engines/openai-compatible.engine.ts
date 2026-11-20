import { currentSignal, reportUsage } from '../ai-context';
import { LlmEngine, assertShape, parseJsonLoose, type LlmModels, type PromptSpec } from './llm.engine';

export type JsonMode = 'json_object' | 'json_schema';

export interface OpenAiCompatibleOptions {
  apiKey: string;
  /** 例：https://api.deepseek.com/v1、https://dashscope.aliyuncs.com/compatible-mode/v1、http://localhost:8000/v1 */
  baseURL: string;
  models: LlmModels;
  timeoutMs: number;
  maxRetries: number;
  /**
   * json_object：DeepSeek / 通义等普遍支持，Schema 写进 system 提示；
   * json_schema：OpenAI、vLLM 等支持严格结构化输出时使用。
   */
  jsonMode: JsonMode;
  /** 显示用的供应商名（openai / deepseek / qwen …），默认按 baseURL 猜 */
  label?: string;
}

interface ChatCompletionResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);

export function guessProviderLabel(baseURL: string): string {
  const host = (() => {
    try {
      return new URL(baseURL).host;
    } catch {
      return baseURL;
    }
  })();
  if (/deepseek/i.test(host)) return 'deepseek';
  if (/dashscope|aliyun/i.test(host)) return 'qwen';
  if (/moonshot/i.test(host)) return 'kimi';
  if (/bigmodel|zhipu/i.test(host)) return 'glm';
  if (/openai\.com/i.test(host)) return 'openai';
  return 'openai-compatible';
}

/**
 * OpenAI 兼容 Chat Completions 引擎：DeepSeek、通义千问、Kimi、智谱、本地 vLLM / Ollama 都走这一个实现。
 * 不引 openai SDK，直接 fetch：协议只用到 /chat/completions 一个接口，自己控制超时与重试更透明。
 */
export class OpenAiCompatibleEngine extends LlmEngine {
  readonly kind: string;
  readonly name: string;
  protected readonly models: LlmModels;
  private readonly endpoint: string;

  constructor(private readonly options: OpenAiCompatibleOptions) {
    super();
    this.models = options.models;
    this.kind = options.label || guessProviderLabel(options.baseURL);
    this.name = `${this.kind}:${options.models.smart}`;
    this.endpoint = `${options.baseURL.replace(/\/+$/, '')}/chat/completions`;
  }

  protected async completeJson<T>(spec: PromptSpec): Promise<T> {
    const model = this.modelFor(spec.tier);
    const system =
      this.options.jsonMode === 'json_object'
        ? `${spec.system}\n\n只输出一个 JSON 对象，不要输出任何其他文字。JSON 必须符合以下 JSON Schema：\n${JSON.stringify(spec.schema)}`
        : spec.system;
    const body = {
      model,
      max_tokens: spec.maxTokens,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: spec.user },
      ],
      response_format:
        this.options.jsonMode === 'json_schema'
          ? { type: 'json_schema', json_schema: { name: spec.capability, schema: spec.schema, strict: true } }
          : { type: 'json_object' },
    };

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      try {
        const res = await this.post(body);
        reportUsage(model, res.usage?.prompt_tokens ?? 0, res.usage?.completion_tokens ?? 0);
        const choice = res.choices?.[0];
        if (choice?.message?.refusal) throw new Error('模型拒绝了该请求（refusal）');
        const content = choice?.message?.content;
        if (!content) throw new Error(`模型未返回内容（finish_reason=${choice?.finish_reason ?? '未知'}）`);
        const data = parseJsonLoose(content);
        assertShape(data, spec.schema);
        return data as T;
      } catch (error) {
        lastError = error;
        const retryable = error instanceof HttpStatusError ? RETRYABLE.has(error.status) : isNetworkError(error);
        if (!retryable || attempt === this.options.maxRetries || currentSignal()?.aborted) throw error;
        await sleep(500 * 2 ** attempt, currentSignal());
      }
    }
    throw lastError;
  }

  private async post(body: unknown): Promise<ChatCompletionResponse> {
    const signals = [AbortSignal.timeout(this.options.timeoutMs)];
    const outer = currentSignal();
    if (outer) signals.push(outer);
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.any(signals),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new HttpStatusError(res.status, `模型接口返回 ${res.status}：${text.slice(0, 200)}`);
    }
    return (await res.json()) as ChatCompletionResponse;
  }
}

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // 超时 / 主动中止不重试：外层截止时间已经到了，再试只会拖更久
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return false;
  return error instanceof TypeError; // fetch 的网络错误是 TypeError
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });
}
