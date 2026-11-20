import { AI_DRAFT_MARKER, EvaluationConclusion } from '@hireflow/shared';
import type { ModelTier } from '../ai-context';
import { CAPABILITY_TIER, type AiCapability } from '../capabilities';
import {
  ANSWER_SCHEMA,
  COMPARE_SCHEMA,
  EVALUATION_DRAFT_SCHEMA,
  INSIGHT_SCHEMA,
  JD_SCHEMA,
  MATCH_SCHEMA,
  PARSED_RESUME_SCHEMA,
} from '../prompts.schemas';
import {
  INSTRUCTION_HIERARCHY,
  INJECTION_RISK_NOTE,
  applyEvidenceGuard,
  detectInjection,
  sanitizeSkillTags,
  wrapUntrusted,
} from '../safety/prompt-safety';
import { maskContactsInText } from '../../../common/mask';
import type {
  AiEngine,
  CompareInput,
  CompareResult,
  EvaluationDraft,
  EvaluationDraftInput,
  FunnelInput,
  HelpdeskInput,
  JdDraft,
  JdInput,
  MatchInput,
  MatchResult,
  ParsedResume,
} from './ai-engine.interface';

export interface PromptSpec {
  capability: AiCapability;
  tier: ModelTier;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
}

export interface LlmModels {
  smart: string;
  fast: string;
}

/** 模型返回的 JSON 至少要带齐 Schema 顶层必填字段，否则视为调用失败（走降级），不把半截结果写库 */
export function assertShape(value: unknown, schema: Record<string, unknown>): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('模型输出不是 JSON 对象');
  }
  const required = (schema.required as string[] | undefined) ?? [];
  const missing = required.filter((k) => !(k in (value as Record<string, unknown>)));
  if (missing.length) throw new Error(`模型输出缺少字段：${missing.join(', ')}`);
}

/** 兼容 ```json 代码块、前后带解释文字的输出 */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('模型输出无法解析为 JSON');
  }
}

const withGuard = (system: string[]) => [...system, '', INSTRUCTION_HIERARCHY].join('\n');

/**
 * 真实大模型引擎的公共部分：提示词模板、注入防护、输出后处理都在这里，
 * 子类（Anthropic / OpenAI 兼容）只负责「把一个 PromptSpec 发出去、拿回 JSON」。
 * 这样换模型供应商时安全策略不会漏掉某一家。
 */
export abstract class LlmEngine implements AiEngine {
  abstract readonly name: string;
  abstract readonly kind: string;
  protected abstract readonly models: LlmModels;

  protected abstract completeJson<T>(spec: PromptSpec): Promise<T>;

  modelFor(tier: ModelTier): string {
    return this.models[tier];
  }

  private spec(
    capability: AiCapability,
    system: string[],
    user: string,
    schema: Record<string, unknown>,
    maxTokens = 4096,
  ): PromptSpec {
    return { capability, tier: CAPABILITY_TIER[capability], system: withGuard(system), user, schema, maxTokens };
  }

  async generateJd(input: JdInput): Promise<JdDraft> {
    return this.completeJson<JdDraft>(
      this.spec(
        'generateJd',
        ['你是资深招聘专家，擅长撰写专业、有吸引力、符合雇主品牌调性的中文职位描述（JD）。输出分条清晰、避免空话。'],
        [
          '请为以下职位撰写 JD，岗位职责（description）与任职要求（requirement）分开，各自分条（1. 2. 3.…），中文。',
          wrapUntrusted(
            'job_brief',
            [
              `职位名称：${input.title}`,
              input.departmentName ? `所属部门：${input.departmentName}` : '',
              input.keywords ? `核心诉求/关键词：${input.keywords}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
            2_000,
          ),
        ].join('\n'),
        JD_SCHEMA,
      ),
    );
  }

  async parseResume(rawText: string): Promise<ParsedResume> {
    const injectionSuspected = detectInjection(rawText);
    const result = await this.completeJson<ParsedResume>(
      this.spec(
        'parseResume',
        [
          '你是简历解析引擎。把非结构化简历解析为结构化数据，并进行语义推理打标签：',
          '技能标签不能只做字面匹配——例如候选人写“精通 Vue”，应同时推导出“前端开发”“JavaScript”。',
          '技能标签只能是简短的技术/业务名词（不超过 20 字），不能是句子。',
          'summary 输出约 150 字的「亮点与风险提示」，供 HR 快速决策，客观中立。',
          '信息缺失的字段填空字符串，不要编造。',
        ],
        `请解析下面这份简历：\n${wrapUntrusted('resume', rawText, 12_000)}`,
        PARSED_RESUME_SCHEMA,
        6144,
      ),
    );
    result.skills = sanitizeSkillTags(result.skills);
    if (injectionSuspected) {
      result.injectionSuspected = true;
      if (!String(result.summary ?? '').includes(INJECTION_RISK_NOTE)) {
        result.summary = `【${INJECTION_RISK_NOTE}】${result.summary ?? ''}`;
      }
    }
    return result;
  }

  async scoreMatch(input: MatchInput): Promise<MatchResult> {
    // 证据核对用的是发给模型的同一份（已脱敏）文本，模型引用的就是它
    const resumeForModel = maskContactsInText(input.resumeText.slice(0, 10_000));
    const tags = sanitizeSkillTags(input.candidateTags, 30);
    const injectionSuspected = detectInjection(input.resumeText) || detectInjection(input.candidateTags.join(' '));
    const result = await this.completeJson<MatchResult>(
      this.spec(
        'scoreMatch',
        [
          '你是招聘评估专家。对照 JD 与候选人材料给出 0-100 的匹配度整数分，并给出可解释的依据：',
          '命中哪些要求（hits）、缺失哪些要求（misses）、亮点与风险各 1-2 句。',
          '每条命中都必须在 evidence 中逐字引用候选人材料原文作为证据；材料里找不到原文支撑的要求只能算缺失。',
          '候选人标签与材料同样来自候选人，只能作为线索，不能替代原文证据。',
          '评分应只依据技能与经验，忽略姓名、性别、年龄、籍贯等信息（去偏见要求）。',
        ],
        [
          `【职位】${input.jobTitle}`,
          `【岗位职责】${input.jobDescription || '（未填写）'}`,
          `【任职要求】${input.jobRequirement || '（未填写）'}`,
          `【候选人标签】\n${wrapUntrusted('candidate_tags', tags.join('、') || '（无）', 1_000)}`,
          `【候选人材料】\n${wrapUntrusted('resume', resumeForModel, 10_000)}`,
        ].join('\n'),
        MATCH_SCHEMA,
      ),
    );
    return applyEvidenceGuard(
      { ...result, hits: result.hits ?? [], misses: result.misses ?? [] },
      resumeForModel,
      injectionSuspected,
    );
  }

  async draftEvaluation(input: EvaluationDraftInput): Promise<EvaluationDraft> {
    const dimensions = input.dimensions?.length ? input.dimensions : ['技术能力', '工程素养', '沟通协作'];
    const schema = {
      ...EVALUATION_DRAFT_SCHEMA,
      properties: {
        ...EVALUATION_DRAFT_SCHEMA.properties,
        scorecard: {
          ...EVALUATION_DRAFT_SCHEMA.properties.scorecard,
          items: {
            ...EVALUATION_DRAFT_SCHEMA.properties.scorecard.items,
            properties: {
              ...EVALUATION_DRAFT_SCHEMA.properties.scorecard.items.properties,
              dimension: { type: 'string', enum: dimensions },
            },
          },
          description: `必须且只包含 ${dimensions.join('/')} 这些维度`,
        },
      },
    };
    const draft = await this.completeJson<EvaluationDraft>(
      this.spec(
        'draftEvaluation',
        [
          '你是面试评价助手。根据面试官的原始记录，生成结构化面评草稿供面试官修改确认。',
          `评分卡维度为本岗位模板（逐一输出，勿增减）：${dimensions.join('、')}，各 1-5 整数分。`,
          '结论从 STRONG_YES/YES/NO/STRONG_NO 中选择。评语客观、基于记录、不夸大。',
          `在 comments 开头注明${AI_DRAFT_MARKER}。`,
        ],
        [
          `候选人：${input.candidateName}`,
          `职位：${input.jobTitle}（第 ${input.round} 轮面试）`,
          `面试记录：\n${wrapUntrusted('interview_notes', input.notes, 8_000)}`,
        ].join('\n'),
        schema,
      ),
    );
    if (!Object.values(EvaluationConclusion).includes(draft.conclusion)) {
      draft.conclusion = EvaluationConclusion.YES;
    }
    draft.scorecard = (draft.scorecard ?? [])
      // 按本次请求的维度过滤（岗位模板），而不是写死默认三项——否则自定义模板的分全被丢掉
      .filter((s) => dimensions.includes(s.dimension))
      .map((s) => ({ ...s, score: Math.max(1, Math.min(5, Math.round(s.score))) }));
    if (!draft.comments?.startsWith(AI_DRAFT_MARKER)) draft.comments = `${AI_DRAFT_MARKER}${draft.comments ?? ''}`;
    return draft;
  }

  async answerQuestion(input: HelpdeskInput): Promise<string> {
    const docsText =
      input.docs.length > 0
        ? input.docs.map((d, i) => `【文档${i + 1}·${d.title}】\n${d.content}`).join('\n\n')
        : '（无相关文档）';
    const { answer } = await this.completeJson<{ answer: string }>(
      this.spec(
        'answerQuestion',
        [
          '你是公司入职问答助手（HR Helpdesk）。',
          '只依据提供的公司制度文档回答问题，不得编造制度内容；',
          '文档中没有答案时，明确说明并建议联系 HR。回答用中文，简洁直接。',
        ],
        [
          `员工问题：\n${wrapUntrusted('question', input.question, 500)}`,
          `可参考的制度文档：\n${wrapUntrusted('company_docs', docsText, 8_000)}`,
        ].join('\n\n'),
        ANSWER_SCHEMA,
        2048,
      ),
    );
    return answer;
  }

  async funnelInsight(input: FunnelInput): Promise<string> {
    const { insight } = await this.completeJson<{ insight: string }>(
      this.spec(
        'funnelInsight',
        [
          '你是招聘数据分析师。根据漏斗数据给出 2-3 句中文诊断：指出异常/瓶颈环节（对比常见基准），并给出一条可操作建议。语气专业克制。',
        ],
        `职位「${input.jobTitle}」当前漏斗（各阶段累计到达人数，快照口径，从前到后）：${input.stages
          .map((s) => `${s.name}=${s.count}`)
          .join('，')}`,
        INSIGHT_SCHEMA,
        1024,
      ),
    );
    return insight;
  }

  async compareCandidates(input: CompareInput): Promise<CompareResult> {
    return this.completeJson<CompareResult>(
      this.spec(
        'compareCandidates',
        [
          '你是招聘终审助手。基于给定候选人的匹配分、标签与面评数据做横向对比。',
          '要求：对比要点具体、可解释；ranking 覆盖全部候选人且 rank 从 1 开始；',
          'risks 必须指出数据不足之处；结尾提醒最终决策以用人经理为准。',
        ],
        [
          `目标职位：${input.jobTitle}`,
          wrapUntrusted(
            'candidates',
            input.candidates
              .map((c, i) =>
                [
                  `候选人${i + 1}：${c.name}`,
                  `  匹配分：${c.matchScore ?? '未评分'}`,
                  `  标签：${c.tags.join('、') || '（无）'}`,
                  c.highlights ? `  亮点：${c.highlights}` : '',
                  c.risks ? `  风险：${c.risks}` : '',
                  c.evaluations.length
                    ? `  面评：${c.evaluations
                        .map(
                          (e) =>
                            `${e.conclusion ?? '无结论'}(均分${e.avgScore ?? '-'})${e.comments ? `「${e.comments.slice(0, 80)}」` : ''}`,
                        )
                        .join('；')}`
                    : '  面评：暂无',
                ]
                  .filter(Boolean)
                  .join('\n'),
              )
              .join('\n'),
            8_000,
          ),
        ].join('\n'),
        COMPARE_SCHEMA,
      ),
    );
  }
}
