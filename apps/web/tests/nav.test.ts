import { PERMISSIONS } from '@hireflow/shared';
import { describe, expect, it } from 'vitest';
import { firstVisiblePath, locate, NAV_ITEMS, visibleSections } from '../src/layouts/nav';

const can = (...perms: string[]) => (p: string) => perms.includes(p);

describe('侧栏：5 个菜单项，其余是页签', () => {
  it('菜单项固定为 看板 / 候选人 / 录用入职 / 数据 / 设置', () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(['看板', '候选人', '录用入职', '数据', '设置']);
  });

  it('职位与面试是「看板」下的页签，Offer 与入职是「录用入职」下的页签', () => {
    expect(locate('/jobs')?.item.label).toBe('看板');
    expect(locate('/interviews')?.item.label).toBe('看板');
    expect(locate('/onboarding')?.item.label).toBe('录用入职');
    expect(locate('/insights')?.item.label).toBe('数据');
    expect(locate('/helpdesk')).toBeUndefined();
  });

  it('首页按权限落到第一个可见页签：面试官落到面试页签', () => {
    expect(firstVisiblePath(can(PERMISSIONS.JOB_READ))).toBe('/pipeline');
    expect(firstVisiblePath(can(PERMISSIONS.EVALUATION_SUBMIT, PERMISSIONS.CANDIDATE_READ))).toBe('/interviews');
    const board = NAV_ITEMS[0];
    expect(visibleSections(board, can(PERMISSIONS.EVALUATION_SUBMIT)).map((s) => s.key)).toEqual(['/interviews']);
  });
});
