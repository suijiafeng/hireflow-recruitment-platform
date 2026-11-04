import { PERMISSIONS } from '@hireflow/shared';

export type NavItem = {
  key: string;
  label: string;
  /** 任一命中即可见；不配 = 全员可见 */
  perms?: string[];
};

export type NavGroup = {
  label: string;
  children: NavItem[];
};

/** 菜单项与所需权限码。首页落点和侧边栏显隐共用这一份，避免默认页和菜单第一项对不上。 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: '招聘',
    children: [
      { key: '/dashboard', label: '数据大盘', perms: [PERMISSIONS.DASHBOARD_VIEW] },
      { key: '/insights', label: '数据洞察', perms: [PERMISSIONS.DASHBOARD_VIEW] },
      { key: '/jobs', label: '职位管理', perms: [PERMISSIONS.JOB_READ] },
      { key: '/candidates', label: '候选人', perms: [PERMISSIONS.CANDIDATE_READ] },
      { key: '/pipeline', label: '招聘看板', perms: [PERMISSIONS.JOB_READ] },
      {
        key: '/interviews',
        label: '面试管理',
        perms: [PERMISSIONS.INTERVIEW_SCHEDULE, PERMISSIONS.EVALUATION_SUBMIT],
      },
    ],
  },
  {
    label: '录用与入职',
    children: [
      {
        key: '/offers',
        label: '录用管理',
        perms: [PERMISSIONS.OFFER_INITIATE, PERMISSIONS.OFFER_APPROVE],
      },
      { key: '/onboarding', label: '入职管理', perms: [PERMISSIONS.ONBOARDING_READ] },
      { key: '/helpdesk', label: '入职问答' },
    ],
  },
  {
    label: '系统',
    children: [
      {
        key: '/settings',
        label: '系统设置',
        perms: [PERMISSIONS.USER_MANAGE, PERMISSIONS.CONFIG_MANAGE],
      },
    ],
  },
];

/**
 * 登录后的首页 = 菜单里第一个有权限看的菜单项。
 * 「入职问答」不配权限、全员可见，所以兜底一定能找到。
 */
export function firstVisiblePath(hasPermission: (p: string) => boolean): string {
  const items = NAV_GROUPS.flatMap((group) => group.children);
  return items.find((item) => !item.perms || item.perms.some((p) => hasPermission(p)))?.key ?? '/helpdesk';
}
