/** AI 来源显示名：mock → 规则引擎；未知（状态还没加载）→ 空串，避免先闪一下「规则引擎」 */
export function providerLabel(provider?: string | null): string {
  if (!provider) return '';
  if (provider === 'mock') return '规则引擎';
  return provider.replace(/·缓存$/, ' · 缓存');
}
