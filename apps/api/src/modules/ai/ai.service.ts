import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Semaphore } from '../../common/concurrency';
import { aiCallContext, type AiCallScope } from './ai-context';
import { CAPABILITY_TIER, PROMPT_VERSION, type AiCapability } from './capabilities';
import type {
  AiEngine,
  CompareInput,
  EvaluationDraftInput,
  FunnelInput,
  HelpdeskInput,
  JdInput,
  MatchInput,
} from './engines/ai-engine.interface';
import { AnthropicAiEngine } from './engines/anthropic.engine';
import type { LlmEngine } from './engines/llm.engine';
import { MockAiEngine } from './engines/mock.engine';
import { OpenAiCompatibleEngine, type JsonMode } from './engines/openai-compatible.engine';
import { PricingTable } from './pricing';
import { sanitizeSkillTags } from './safety/prompt-safety';

/** 所有 AI 输出都附带来源标记，前端据此提示（可解释 + 可追溯） */
export interface AiMeta {
  provider: string;
  degraded: boolean;
  cached?: boolean;
}

export interface AiStatus {
  provider: string;
  mode: 'llm' | 'mock';
  label: string;
  models: { smart: string; fast: string } | null;
  promptVersion: string;
  timeoutMs: number;
  deadlineMs: number;
  maxConcurrency: number;
}

const num = (raw: string | undefined, fallback: number, min = 0) => {
  const n = Number(raw);
  return Number.isFinite(n) && raw !== undefined && raw !== '' && n >= min ? n : fallback;
};

/**
 * 统一 AI 网关：
 * - 引擎可插拔：Anthropic、OpenAI 兼容（DeepSeek / 通义 / vLLM …）、规则引擎（mock）；
 * - 统一超时预算：单次 HTTP 尝试 AI_TIMEOUT_MS（默认 30s）、最多重试 AI_MAX_RETRIES 次（默认 1），
 *   整个能力调用（含排队）不超过 AI_DEADLINE_MS（默认 40s），超时即降级，不让前端干等；
 * - 全局并发上限 AI_MAX_CONCURRENCY（默认 4），批量场景不会一次打出几十个请求；
 * - 每次调用写 AiCallLog（token、估算成本、耗时、缓存、降级）；
 * - LLM 调用失败自动降级到规则引擎，不阻断人工流程。
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly mock = new MockAiEngine();
  private readonly llm: LlmEngine | null = null;
  private readonly semaphore: Semaphore;
  private readonly pricing: PricingTable;
  readonly timeoutMs: number;
  readonly deadlineMs: number;
  private readonly maxConcurrency: number;
  private readonly cacheTtlMs: number;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.timeoutMs = num(config.get<string>('AI_TIMEOUT_MS'), 30_000, 1);
    const maxRetries = num(config.get<string>('AI_MAX_RETRIES'), 1, 0);
    this.deadlineMs = num(config.get<string>('AI_DEADLINE_MS'), 40_000, 1);
    this.maxConcurrency = Math.floor(num(config.get<string>('AI_MAX_CONCURRENCY'), 4, 1));
    this.cacheTtlMs = num(config.get<string>('AI_CACHE_TTL_HOURS'), 168, 0) * 3_600_000;
    this.semaphore = new Semaphore(this.maxConcurrency);
    this.pricing = new PricingTable(config.get<string>('AI_PRICING_JSON'));

    const provider = (config.get<string>('AI_PROVIDER') ?? 'auto').toLowerCase();
    const anthropicKey = config.get<string>('ANTHROPIC_API_KEY');
    const openaiKey = config.get<string>('AI_API_KEY');
    const openaiBase = config.get<string>('AI_BASE_URL');

    const useAnthropic = provider === 'anthropic' || (provider === 'auto' && Boolean(anthropicKey));
    const useOpenAi = provider === 'openai' || (provider === 'auto' && !anthropicKey && Boolean(openaiKey && openaiBase));

    if (useAnthropic && anthropicKey) {
      const smart = config.get<string>('ANTHROPIC_MODEL') || 'claude-opus-4-8';
      this.llm = new AnthropicAiEngine({
        apiKey: anthropicKey,
        baseURL: config.get<string>('ANTHROPIC_BASE_URL') || undefined,
        models: { smart, fast: config.get<string>('ANTHROPIC_MODEL_FAST') || 'claude-haiku-4-5' },
        timeoutMs: this.timeoutMs,
        maxRetries,
      });
    } else if (useOpenAi && openaiKey && openaiBase) {
      const smart = config.get<string>('AI_MODEL') || 'deepseek-chat';
      const jsonMode = (config.get<string>('AI_JSON_MODE') as JsonMode) || 'json_object';
      this.llm = new OpenAiCompatibleEngine({
        apiKey: openaiKey,
        baseURL: openaiBase,
        models: { smart, fast: config.get<string>('AI_MODEL_FAST') || smart },
        timeoutMs: this.timeoutMs,
        maxRetries,
        jsonMode: jsonMode === 'json_schema' ? 'json_schema' : 'json_object',
        label: config.get<string>('AI_PROVIDER_LABEL') || undefined,
      });
    }

    if (this.llm) {
      this.logger.log(
        `AI 引擎已启用：${this.llm.name}（fast=${this.llm.modelFor('fast')}，超时 ${this.timeoutMs}ms/次，截止 ${this.deadlineMs}ms，并发 ${this.maxConcurrency}）`,
      );
    } else if (provider !== 'mock' && (provider !== 'auto' || anthropicKey || openaiKey)) {
      this.logger.warn(`AI_PROVIDER=${provider} 但缺少对应的 key / base URL，AI 能力使用规则引擎（mock）兜底`);
    } else {
      this.logger.warn('未配置大模型（ANTHROPIC_API_KEY 或 AI_API_KEY + AI_BASE_URL），AI 能力使用规则引擎（mock）兜底');
    }
  }

  /** 当前引擎信息（前端标题、AI 徽标用；不含任何密钥） */
  status(): AiStatus {
    return {
      provider: this.llm?.kind ?? 'mock',
      mode: this.llm ? 'llm' : 'mock',
      label: this.llm?.name ?? 'mock',
      models: this.llm ? { smart: this.llm.modelFor('smart'), fast: this.llm.modelFor('fast') } : null,
      promptVersion: PROMPT_VERSION,
      timeoutMs: this.timeoutMs,
      deadlineMs: this.deadlineMs,
      maxConcurrency: this.maxConcurrency,
    };
  }

  get llmEnabled() {
    return this.llm !== null;
  }

  private async run<T>(
    capability: AiCapability,
    fn: (engine: AiEngine) => Promise<T>,
  ): Promise<{ data: T; meta: AiMeta }> {
    const started = Date.now();
    if (!this.llm) {
      const data = await fn(this.mock);
      this.log({ capability, provider: 'mock', latencyMs: Date.now() - started });
      return { data, meta: { provider: this.mock.name, degraded: false } };
    }

    const llm = this.llm;
    const model = llm.modelFor(CAPABILITY_TIER[capability]);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`AI 调用超过 ${this.deadlineMs}ms 截止时间`)),
      this.deadlineMs,
    );
    const scope: AiCallScope = {
      capability,
      signal: controller.signal,
      usage: { inputTokens: 0, outputTokens: 0, requests: 0 },
    };
    try {
      const data = await aiCallContext.run(scope, () =>
        this.semaphore.run(() => fn(llm), controller.signal),
      );
      this.log({ capability, provider: llm.kind, model, usage: scope.usage, latencyMs: Date.now() - started });
      return { data, meta: { provider: `${llm.kind}:${model}`, degraded: false } };
    } catch (error) {
      const reason = controller.signal.aborted
        ? `超时（>${this.deadlineMs}ms）`
        : error instanceof Error
          ? error.message
          : String(error);
      this.logger.warn(`LLM 调用失败（${capability}），已降级到规则引擎：${reason}`);
      const data = await fn(this.mock);
      this.log({
        capability,
        provider: llm.kind,
        model,
        usage: scope.usage,
        latencyMs: Date.now() - started,
        degraded: true,
        error: reason,
      });
      return { data, meta: { provider: this.mock.name, degraded: true } };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 调用日志写入失败不影响主流程（fire-and-forget） */
  private log(entry: {
    capability: string;
    provider: string;
    model?: string;
    usage?: AiCallScope['usage'];
    latencyMs: number;
    cached?: boolean;
    degraded?: boolean;
    error?: string;
  }) {
    const inputTokens = entry.usage?.inputTokens ?? 0;
    const outputTokens = entry.usage?.outputTokens ?? 0;
    const model = entry.usage?.model ?? entry.model;
    const costUsd =
      entry.provider === 'mock' || entry.cached ? 0 : this.pricing.estimateUsd(model, inputTokens, outputTokens);
    void Promise.resolve()
      .then(() =>
        this.prisma.aiCallLog.create({
          data: {
            capability: entry.capability,
            provider: entry.provider,
            model: model ?? null,
            inputTokens,
            outputTokens,
            costUsd,
            latencyMs: Math.round(entry.latencyMs),
            cached: Boolean(entry.cached),
            degraded: Boolean(entry.degraded),
            error: entry.error?.slice(0, 300) ?? null,
          },
        }),
      )
      .catch((error: unknown) =>
        this.logger.debug(`AiCallLog 写入失败：${error instanceof Error ? error.message : error}`),
      );
  }

  /** 缓存键：能力 + 模型 + 提示词版本 + 输入。换模型或改提示词后旧结果自然失效 */
  cacheKey(capability: AiCapability, input: unknown): string {
    const model = this.llm?.modelFor(CAPABILITY_TIER[capability]) ?? 'mock';
    return createHash('sha256')
      .update(JSON.stringify({ v: PROMPT_VERSION, model, input }))
      .digest('hex');
  }

  /**
   * 结果缓存（Token FinOps）：相同输入命中即回放，防重复解析刷 Token。
   * 仅在真实 LLM 引擎启用时生效（mock 零成本无需缓存）；超过 AI_CACHE_TTL_HOURS 视为过期；
   * 缓存读写失败静默跳过不阻断。降级结果不入缓存。
   */
  private async cachedRun<T>(
    capability: AiCapability,
    input: unknown,
    fn: (engine: AiEngine) => Promise<T>,
  ): Promise<{ data: T; meta: AiMeta }> {
    if (!this.llm) return this.run(capability, fn);
    const started = Date.now();
    const hash = this.cacheKey(capability, input);
    try {
      const hit = await this.prisma.aiCache.findUnique({
        where: { capability_hash: { capability, hash } },
      });
      if (hit && (this.cacheTtlMs === 0 || Date.now() - hit.createdAt.getTime() < this.cacheTtlMs)) {
        this.log({
          capability,
          provider: this.llm.kind,
          model: this.llm.modelFor(CAPABILITY_TIER[capability]),
          latencyMs: Date.now() - started,
          cached: true,
        });
        return { data: hit.payload as T, meta: { provider: `${hit.provider}·缓存`, degraded: false, cached: true } };
      }
    } catch {
      /* 缓存不可用不影响主流程 */
    }
    const result = await this.run(capability, fn);
    if (!result.meta.degraded) {
      try {
        const payload = result.data as unknown as Prisma.InputJsonValue;
        await this.prisma.aiCache.upsert({
          where: { capability_hash: { capability, hash } },
          create: { capability, hash, payload, provider: result.meta.provider },
          update: { payload, provider: result.meta.provider, createdAt: new Date() },
        });
      } catch {
        /* 并发写重复等冲突静默忽略 */
      }
    }
    return result;
  }

  generateJd(input: JdInput) {
    return this.run('generateJd', (e) => e.generateJd(input));
  }

  async parseResume(rawText: string) {
    const result = await this.cachedRun('parseResume', rawText, (e) => e.parseResume(rawText));
    // 出口再归一化一次：覆盖规则引擎与升级前写入的旧缓存
    result.data = { ...result.data, skills: sanitizeSkillTags(result.data.skills) };
    return result;
  }

  scoreMatch(input: MatchInput) {
    return this.cachedRun('scoreMatch', input, (e) => e.scoreMatch(input));
  }

  draftEvaluation(input: EvaluationDraftInput) {
    return this.run('draftEvaluation', (e) => e.draftEvaluation(input));
  }

  funnelInsight(input: FunnelInput) {
    return this.run('funnelInsight', (e) => e.funnelInsight(input));
  }

  answerQuestion(input: HelpdeskInput) {
    return this.run('answerQuestion', (e) => e.answerQuestion(input));
  }

  compareCandidates(input: CompareInput) {
    return this.run('compareCandidates', (e) => e.compareCandidates(input));
  }

  /** 用量面板：最近 N 天按能力汇总（调用数、token、估算成本、P95 延迟、缓存命中率、降级率） */
  async usage(days = 7) {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.aiCallLog.findMany({
      where: { createdAt: { gte: since } },
      select: {
        capability: true,
        provider: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        costUsd: true,
        latencyMs: true,
        cached: true,
        degraded: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20_000,
    });
    const summarize = (list: typeof rows) => {
      const live = list.filter((r) => !r.cached);
      const latencies = live.map((r) => r.latencyMs).sort((a, b) => a - b);
      const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)] : null;
      const priced = list.filter((r) => r.costUsd != null);
      return {
        calls: list.length,
        inputTokens: list.reduce((s, r) => s + r.inputTokens, 0),
        outputTokens: list.reduce((s, r) => s + r.outputTokens, 0),
        costUsd: priced.length ? Number(priced.reduce((s, r) => s + (r.costUsd ?? 0), 0).toFixed(6)) : null,
        unpricedCalls: list.length - priced.length,
        p95LatencyMs: p95,
        cacheHitRate: list.length ? list.filter((r) => r.cached).length / list.length : 0,
        degradeRate: list.length ? list.filter((r) => r.degraded).length / list.length : 0,
      };
    };
    const byCapability = [...new Set(rows.map((r) => r.capability))]
      .map((capability) => ({ capability, ...summarize(rows.filter((r) => r.capability === capability)) }))
      .sort((a, b) => b.calls - a.calls);
    return { days, since: since.toISOString(), status: this.status(), total: summarize(rows), byCapability };
  }
}
