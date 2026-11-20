import type { EvaluationConclusion } from '@hireflow/shared';

/** AI 生成的 JD 草稿 */
export interface JdDraft {
  description: string;
  requirement: string;
}

/** 简历结构化解析结果（语义理解，非关键词匹配） */
export interface ParsedResume {
  /** 约 150 字「候选人亮点与风险提示」 */
  summary: string;
  /** 语义推理出的技能标签（如「精通 Vue」→ 前端开发/JavaScript） */
  skills: string[];
  educations: Array<{ school: string; degree?: string; major?: string }>;
  experiences: Array<{ company: string; title?: string; years?: string; highlights?: string }>;
  /** 简历原文命中疑似指令注入特征（提示 HR 人工复核） */
  injectionSuspected?: boolean;
}

/** 岗位匹配度评分（可解释，给出命中/缺失依据） */
export interface MatchResult {
  /** 0-100 整数 */
  score: number;
  hits: string[];
  misses: string[];
  highlights: string;
  risks: string;
  /** 经过原文核对的命中证据（LLM 引擎才有） */
  evidence?: Array<{ requirement: string; quote: string }>;
  /** 候选人材料命中疑似指令注入特征，分数已封顶 */
  injectionSuspected?: boolean;
}

/** 面评草稿 */
export interface EvaluationDraft {
  scorecard: Array<{ dimension: string; score: number; comment: string }>;
  conclusion: EvaluationConclusion;
  comments: string;
}

export interface JdInput {
  title: string;
  departmentName?: string;
  keywords?: string;
}

export interface MatchInput {
  jobTitle: string;
  jobDescription: string;
  jobRequirement: string;
  resumeText: string;
  candidateTags: string[];
}

export interface EvaluationDraftInput {
  candidateName: string;
  jobTitle: string;
  round: number;
  notes: string;
  /** 岗位评分卡维度；缺省用全局默认三维 */
  dimensions?: string[];
}

export interface FunnelInput {
  jobTitle: string;
  stages: Array<{ name: string; count: number }>;
}

export interface HelpdeskInput {
  question: string;
  docs: Array<{ title: string; content: string }>;
}

/**
 * AI 能力引擎（模型可插拔）：
 * 同一接口下可切换真实 LLM（Anthropic）与确定性 Mock（无 key 时全链路可用）。
 */
export interface AiEngine {
  readonly name: string;
  generateJd(input: JdInput): Promise<JdDraft>;
  parseResume(rawText: string): Promise<ParsedResume>;
  scoreMatch(input: MatchInput): Promise<MatchResult>;
  draftEvaluation(input: EvaluationDraftInput): Promise<EvaluationDraft>;
  funnelInsight(input: FunnelInput): Promise<string>;
  /** 入职问答（HR Helpdesk）：仅依据提供的制度文档回答 */
  answerQuestion(input: HelpdeskInput): Promise<string>;
  /** 候选人对比（2-4 人并排 + AI 综合对比意见） */
  compareCandidates(input: CompareInput): Promise<CompareResult>;
}

export interface CompareInput {
  jobTitle: string;
  candidates: Array<{
    name: string;
    matchScore: number | null;
    tags: string[];
    highlights: string | null;
    risks: string | null;
    evaluations: Array<{ conclusion: string | null; avgScore: number | null; comments: string | null }>;
  }>;
}

export interface CompareResult {
  /** 综合对比意见（谁更适合、为什么） */
  summary: string;
  ranking: Array<{ name: string; rank: number; rationale: string }>;
  /** 决策风险提示（信息不足/维度缺失等） */
  risks: string;
}
