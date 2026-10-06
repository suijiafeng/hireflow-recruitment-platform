import type { DepartmentItem } from '../api/types';

/**
 * 部门下拉选项：按树深度优先排好序，标签带上级路径（「技术部 / 测试组」），
 * 平铺列表里看不出「测试组」属于哪个部门，同名子部门也无从区分。
 */
export function departmentOptions(depts: DepartmentItem[] | undefined) {
  if (!depts) return undefined;
  const ids = new Set(depts.map((d) => d.id));
  const children = new Map<string | null, DepartmentItem[]>();
  for (const d of depts) {
    // 上级不在列表里（被删或无权限）就当根节点，别让它消失
    const parent = d.parentId && ids.has(d.parentId) ? d.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), d]);
  }
  const out: Array<{ value: string; label: string }> = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, path: string[]) => {
    for (const d of (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const names = [...path, d.name];
      out.push({ value: d.id, label: names.join(' / ') });
      walk(d.id, names);
    }
  };
  walk(null, []);
  return out;
}
