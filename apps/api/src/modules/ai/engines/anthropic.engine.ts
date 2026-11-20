import Anthropic from '@anthropic-ai/sdk';
import { currentSignal, reportUsage } from '../ai-context';
import { LlmEngine, assertShape, parseJsonLoose, type LlmModels, type PromptSpec } from './llm.engine';

export interface AnthropicEngineOptions {
  apiKey: string;
  models: LlmModels;
  baseURL?: string;
  /** 单次 HTTP 尝试的超时 */
  timeoutMs: number;
  maxRetries: number;
}

/**
 * Anthropic Messages API 引擎：结构化输出（output_config.format）保证 JSON 可解析。
 * smart 档开自适应思考，fast 档（小模型）不开思考——两三句话的诊断不值得付思考 token。
 * 超时 / 重试由 AiService 统一配置（默认单次 30s、最多重试 1 次），并接收整体截止的 AbortSignal。
 */
export class AnthropicAiEngine extends LlmEngine {
  readonly kind = 'anthropic';
  readonly name: string;
  protected readonly models: LlmModels;
  private readonly client: Anthropic;

  constructor(options: AnthropicEngineOptions) {
    super();
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      timeout: options.timeoutMs,
      maxRetries: options.maxRetries,
    });
    this.models = options.models;
    this.name = `anthropic:${options.models.smart}`;
  }

  protected async completeJson<T>(spec: PromptSpec): Promise<T> {
    const model = this.modelFor(spec.tier);
    const response = await this.client.messages.create(
      {
        model,
        max_tokens: spec.maxTokens,
        ...(spec.tier === 'smart' ? { thinking: { type: 'adaptive' as const } } : {}),
        system: spec.system,
        output_config: { format: { type: 'json_schema', schema: spec.schema } },
        messages: [{ role: 'user', content: spec.user }],
      },
      { signal: currentSignal() },
    );
    reportUsage(model, response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0);

    if (response.stop_reason === 'refusal') {
      throw new Error('模型拒绝了该请求（safety refusal）');
    }
    const text = response.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
    if (!text) {
      throw new Error(`模型未返回文本内容（stop_reason=${response.stop_reason}）`);
    }
    const data = parseJsonLoose(text.text);
    assertShape(data, spec.schema);
    return data as T;
  }
}
