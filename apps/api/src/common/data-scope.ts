import { DataScope } from '@hireflow/shared';
import type { JwtUser } from './decorators/current-user.decorator';

/** 数据范围宽窄序：全局 > 本部门 > 仅被指派 > 仅本人 */
const SCOPE_WIDTH: Record<string, number> = {
  [DataScope.ALL]: 4,
  [DataScope.DEPARTMENT]: 3,
  [DataScope.ASSIGNED]: 2,
  [DataScope.OWN]: 1,
};

/** 多角色取最宽范围（如 管理员+面试官 → 全局） */
export function widestScope(scopes: string[]): DataScope {
  let widest: DataScope = DataScope.OWN;
  for (const s of scopes) {
    if ((SCOPE_WIDTH[s] ?? 0) > SCOPE_WIDTH[widest]) widest = s as DataScope;
  }
  return widest;
}

/**
 * 部门行级过滤（用人经理「本部门」）：
 * 返回可见的部门 id 列表（本部门 + 全部下级部门）；不需要限定返回 null。
 * 技术总监挂在「技术部」，职位可能挂在「前端组」「后端组」，只按单个 id 精确匹配会漏看整个子树。
 * 列表在登录时算好随 JWT 下发（与角色权限同一快照口径）；旧令牌没有该字段时退化为仅本部门。
 * DEPARTMENT 范围但用户未挂部门时返回哨兵值——匹配不到任何数据（宁可看不见，不可越权看）。
 *
 * 调用方用法：Prisma 条件写 `departmentId: { in: scope }`，内存判断用 inDepartmentScope()。
 */
export function departmentScopeOf(user: JwtUser): string[] | null {
  if (user.dataScope !== DataScope.DEPARTMENT) return null;
  if (!user.departmentId) return ['__no_department__'];
  return user.departmentIds?.length ? user.departmentIds : [user.departmentId];
}

/** 某个部门 id 是否落在部门范围内（scope 为 null 表示不限） */
export function inDepartmentScope(
  scope: string[] | null,
  departmentId: string | null | undefined,
): boolean {
  if (!scope) return true;
  return !!departmentId && scope.includes(departmentId);
}

/** 从部门表算出 root 及其全部下级部门 id（广度优先；带 visited 防御脏数据里的环） */
export function departmentSubtree(
  rootId: string,
  departments: Array<{ id: string; parentId: string | null }>,
): string[] {
  const children = new Map<string, string[]>();
  for (const d of departments) {
    if (!d.parentId) continue;
    children.set(d.parentId, [...(children.get(d.parentId) ?? []), d.id]);
  }
  const visited = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (visited.has(child)) continue;
      visited.add(child);
      queue.push(child);
    }
  }
  return [...visited];
}

/** 「仅被指派」范围（面试官）：候选人/面试须与本人有指派关系 */
export function isAssignedScope(user: JwtUser): boolean {
  return user.dataScope === DataScope.ASSIGNED;
}
