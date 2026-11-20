import { AsyncLocalStorage } from 'node:async_hooks';

/** 模型档位：fast = 简单任务（小模型、不开思考）；smart = 需要推理的任务 */
export type ModelTier = 'fast' | 'smart';

/**
 * 单次 AI 能力调用的上下文（AsyncLocalStorage 透传，引擎接口签名不用变）：
 * - signal：AiService 统一的超时预算，引擎把它一路传到 HTTP 请求；
 * - usage：引擎把每次模型请求的 token 用量累加进来，AiService 结束时写 AiCallLog。
 */
export interface AiCallScope {
  capability: string;
  signal?: AbortSignal;
  usage: { inputTokens: number; outputTokens: number; requests: number; model?: string };
}

export const aiCallContext = new AsyncLocalStorage<AiCallScope>();

/** 引擎侧上报一次模型请求的用量 */
export function reportUsage(model: string, inputTokens: number, outputTokens: number) {
  const scope = aiCallContext.getStore();
  if (!scope) return;
  scope.usage.inputTokens += Math.max(0, inputTokens || 0);
  scope.usage.outputTokens += Math.max(0, outputTokens || 0);
  scope.usage.requests += 1;
  scope.usage.model = model;
}

export function currentSignal(): AbortSignal | undefined {
  return aiCallContext.getStore()?.signal;
}
