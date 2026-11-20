import type { Job } from '../api/types';

const inFlow = (j: Job) => j._count?.applications ?? 0;

/**
 * 大盘/看板打开时默认选哪个职位：招聘中、流程人数最多的那个。
 *
 * 之前取「第一个招聘中且有人的职位」——列表按 createdAt 倒序，于是总落到最新建的、
 * 只有两三个人的岗位上（如「产品经理（B端）」2 人），漏斗大片空白、看板 6 列 4 列是空的。
 * 现在：招聘中里人数最多 → 任意状态里人数最多 → 第一个招聘中 → 第一个。人数相同保持原顺序（较新的优先）。
 */
export function pickDefaultJobId(items: Job[] | undefined): string | undefined {
  if (!items?.length) return undefined;
  const busiest = (list: Job[]) =>
    list.reduce<Job | undefined>((best, j) => (inFlow(j) > 0 && inFlow(j) > (best ? inFlow(best) : 0) ? j : best), undefined);
  return (
    busiest(items.filter((j) => j.status === 'OPEN'))?.id ??
    busiest(items)?.id ??
    items.find((j) => j.status === 'OPEN')?.id ??
    items[0].id
  );
}

/**
 * HC 进度：满编绿色、≥80% 橙色、超编红色 + 「超编 N」。
 * 之前 11 / 1 也只是一根满格绿条，看起来像「招满了、很好」，实际超出编制 10 人。
 */
export function hcProgress(used: number, headcount: number) {
  const over = headcount > 0 ? Math.max(0, used - headcount) : 0;
  const pct = headcount > 0 ? Math.min(100, Math.round((used / headcount) * 100)) : 0;
  const color = over > 0 ? '#DC2626' : pct >= 100 ? '#059669' : pct >= 80 ? '#B45309' : '#2563EB';
  return { used, over, pct, color };
}
