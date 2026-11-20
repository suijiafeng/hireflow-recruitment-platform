/** AI 来源显示名：mock → 规则引擎；未知（状态还没加载）→ 空串，避免先闪一下「规则引擎」 */
export function providerLabel(provider?: string | null): string {
  if (!provider) return '';
  if (provider === 'mock') return '规则引擎';
  return provider.replace(/·缓存$/, ' · 缓存');
}

export type AiSource = { kind: 'ai' | 'rule' | 'cache'; label: string; detail: string };

/**
 * AI 产出的统一来源口径（匹配分、摘要、对比、草稿、诊断、问答共用）：
 * - 规则：未接大模型（mock）或本次降级
 * - 缓存：命中缓存，内容与上次一致
 * - AI · 模型名：大模型实时生成
 */
export function aiSourceOf(meta?: { provider?: string | null; degraded?: boolean; cached?: boolean } | null): AiSource | null {
  if (!meta?.provider) return null;
  const raw = meta.provider;
  if (raw === 'mock' || meta.degraded) {
    return { kind: 'rule', label: '规则', detail: meta.degraded ? '大模型暂不可用，本次由规则引擎估算' : '未接入大模型，由规则引擎生成' };
  }
  const base = raw.replace(/·缓存$/, '');
  const model = base.includes(':') ? base.slice(base.indexOf(':') + 1) : base;
  if (meta.cached || raw.endsWith('·缓存')) {
    return { kind: 'cache', label: `AI · 缓存`, detail: `命中缓存（${base}），与上次生成结果一致` };
  }
  return { kind: 'ai', label: `AI · ${model}`, detail: `由 ${base} 生成，仅供参考` };
}
