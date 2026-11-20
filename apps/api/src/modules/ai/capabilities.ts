import type { ModelTier } from './ai-context';

/**
 * 提示词版本：改了任何能力的 system/user 模板或 Schema 就递增。
 * 它是缓存键的一部分——旧提示词产出的缓存结果自然失效，不会在改版后继续回放。
 */
export const PROMPT_VERSION = '2026-11-20.1';

export type AiCapability =
  | 'generateJd'
  | 'parseResume'
  | 'scoreMatch'
  | 'draftEvaluation'
  | 'funnelInsight'
  | 'answerQuestion'
  | 'compareCandidates';

/** 按能力分档：两三句话的诊断/问答不需要大模型 + 深度思考 */
export const CAPABILITY_TIER: Record<AiCapability, ModelTier> = {
  generateJd: 'fast',
  funnelInsight: 'fast',
  answerQuestion: 'fast',
  parseResume: 'smart',
  scoreMatch: 'smart',
  draftEvaluation: 'smart',
  compareCandidates: 'smart',
};
