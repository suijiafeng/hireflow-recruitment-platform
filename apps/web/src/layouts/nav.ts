import { PERMISSIONS } from '@hireflow/shared';

export type NavSection = {
  key: string;
  label: string;
  /** 任一命中即可见；不配 = 全员可见 */
  perms?: string[];
};

/** 一个侧栏菜单项 = 一组页签。只有一个可见页签时不画页签条。 */
export type NavItem = {
  key: string;
  label: string;
  sections: NavSection[];
};

/**
 * 侧栏只有 5 项：看板、候选人、录用入职、数据、设置。
 * 职位和面试是「看板」下的页签，Offer 和入职是「录用入职」下的页签。
 * 首页落点、侧栏显隐和页签显隐共用这一份。
 */
export const NAV_ITEMS: NavItem[] = [
  {
    key: 'board',
    label: '看板',
    sections: [
      { key: '/pipeline', label: '招聘看板', perms: [PERMISSIONS.JOB_READ] },
      { key: '/jobs', label: '职位', perms: [PERMISSIONS.JOB_READ] },
      { key: '/interviews', label: '面试', perms: [PERMISSIONS.INTERVIEW_SCHEDULE, PERMISSIONS.EVALUATION_SUBMIT] },
    ],
  },
  {
    key: 'candidates',
    label: '候选人',
    sections: [{ key: '/candidates', label: '候选人', perms: [PERMISSIONS.CANDIDATE_READ] }],
  },
  {
    key: 'hire',
    label: '录用入职',
    sections: [
      { key: '/offers', label: 'Offer', perms: [PERMISSIONS.OFFER_INITIATE, PERMISSIONS.OFFER_READ] },
      { key: '/onboarding', label: '入职', perms: [PERMISSIONS.ONBOARDING_READ] },
    ],
  },
  {
    key: 'data',
    label: '数据',
    sections: [
      { key: '/dashboard', label: '概览', perms: [PERMISSIONS.DASHBOARD_VIEW] },
      { key: '/insights', label: '趋势与渠道', perms: [PERMISSIONS.DASHBOARD_VIEW] },
    ],
  },
  {
    key: 'settings',
    label: '设置',
    sections: [{ key: '/settings', label: '设置', perms: [PERMISSIONS.USER_MANAGE, PERMISSIONS.CONFIG_MANAGE] }],
  },
];

type HasPermission = (p: string) => boolean;

export function sectionVisible(section: NavSection, hasPermission: HasPermission): boolean {
  return !section.perms || section.perms.some((p) => hasPermission(p));
}

export function visibleSections(item: NavItem, hasPermission: HasPermission): NavSection[] {
  return item.sections.filter((s) => sectionVisible(s, hasPermission));
}

/** 当前路径落在哪个菜单项、哪个页签 */
export function locate(pathname: string): { item: NavItem; section: NavSection } | undefined {
  for (const item of NAV_ITEMS) {
    const section = item.sections.find((s) => pathname === s.key || pathname.startsWith(`${s.key}/`));
    if (section) return { item, section };
  }
  return undefined;
}

/** 登录后的首页 = 第一个有权限看的页签；一个都没有时落到候选人页（页面会提示无权访问）。 */
export function firstVisiblePath(hasPermission: HasPermission): string {
  for (const item of NAV_ITEMS) {
    const first = visibleSections(item, hasPermission)[0];
    if (first) return first.key;
  }
  return '/candidates';
}
