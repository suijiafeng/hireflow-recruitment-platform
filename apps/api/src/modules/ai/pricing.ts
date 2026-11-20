/**
 * 估算成本用的单价表（美元 / 百万 token，[输入, 输出]）。
 * 只用于用量面板的「估算成本」，不是账单；价格变动或私有化部署时用 AI_PRICING_JSON 覆盖，
 * 例：AI_PRICING_JSON='{"deepseek-chat":[0.28,0.42],"my-vllm-model":[0,0]}'（按模型名前缀匹配，最长前缀优先）。
 */
const DEFAULT_PRICING: Record<string, [number, number]> = {
  'claude-opus': [5, 25],
  'claude-sonnet': [3, 15],
  'claude-haiku': [1, 5],
  'deepseek-chat': [0.28, 0.42],
  'deepseek-reasoner': [0.28, 0.42],
  'qwen-max': [1.6, 6.4],
  'qwen-plus': [0.4, 1.2],
  'qwen-turbo': [0.05, 0.2],
  'gpt-4o-mini': [0.15, 0.6],
  'gpt-4o': [2.5, 10],
};

export class PricingTable {
  private readonly table: Record<string, [number, number]>;

  constructor(overrideJson?: string) {
    let override: Record<string, [number, number]> = {};
    if (overrideJson) {
      try {
        override = JSON.parse(overrideJson) as Record<string, [number, number]>;
      } catch {
        override = {};
      }
    }
    this.table = { ...DEFAULT_PRICING, ...override };
  }

  /** 未知模型返回 null（面板显示「未定价」，而不是假装成本为 0） */
  estimateUsd(model: string | undefined, inputTokens: number, outputTokens: number): number | null {
    if (!model) return null;
    const key = Object.keys(this.table)
      .filter((prefix) => model.startsWith(prefix))
      .sort((a, b) => b.length - a.length)[0];
    if (!key) return null;
    const [inPrice, outPrice] = this.table[key];
    return (inputTokens * inPrice + outputTokens * outPrice) / 1_000_000;
  }
}
