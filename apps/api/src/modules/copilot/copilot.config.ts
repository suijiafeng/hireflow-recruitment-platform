import type { ConfigService } from '@nestjs/config';

const num = (raw: string | undefined, fallback: number, min = 0) => {
  const n = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(n) && n >= min ? n : fallback;
};

/** Copilot 运行上限（全部可用环境变量覆盖，见 README「Copilot」一节） */
export interface CopilotLimits {
  /** 每轮最多几次「模型 → 工具 → 模型」迭代 */
  maxIterations: number;
  /** 每轮最多调用多少次工具 */
  maxToolCalls: number;
  /** 单轮回复总时长上限 */
  timeoutMs: number;
  /** 单次模型调用输出 token 上限 */
  maxOutputTokens: number;
  /** 单轮估算成本上限（美元），超出后停止继续调用工具 */
  turnMaxCostUsd: number;
  /** 每人每日 token 预算（输入 + 输出） */
  dailyTokenBudget: number;
  /** 每人每分钟提问次数 */
  ratePerMinute: number;
  /** SSE 心跳间隔 */
  heartbeatMs: number;
  /** 待确认操作的有效期 */
  actionTtlMs: number;
  /** 带给模型的历史消息条数 */
  historyLimit: number;
  /** 单条用户消息最大长度 */
  maxInputChars: number;
}

export function readCopilotLimits(config: ConfigService): CopilotLimits {
  const g = (k: string) => config.get<string>(k);
  return {
    maxIterations: Math.floor(num(g('COPILOT_MAX_ITERATIONS'), 5, 1)),
    maxToolCalls: Math.floor(num(g('COPILOT_MAX_TOOL_CALLS'), 8, 1)),
    timeoutMs: num(g('COPILOT_TIMEOUT_MS'), 90_000, 1_000),
    maxOutputTokens: Math.floor(num(g('COPILOT_MAX_OUTPUT_TOKENS'), 1_500, 64)),
    turnMaxCostUsd: num(g('COPILOT_TURN_MAX_COST_USD'), 0.1, 0),
    dailyTokenBudget: Math.floor(num(g('COPILOT_DAILY_TOKEN_BUDGET'), 400_000, 1)),
    ratePerMinute: Math.floor(num(g('COPILOT_RATE_PER_MIN'), 12, 1)),
    heartbeatMs: num(g('COPILOT_HEARTBEAT_MS'), 15_000, 50),
    actionTtlMs: num(g('COPILOT_ACTION_TTL_MIN'), 30, 1) * 60_000,
    historyLimit: Math.floor(num(g('COPILOT_HISTORY_LIMIT'), 30, 2)),
    maxInputChars: 2_000,
  };
}
