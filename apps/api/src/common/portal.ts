import { randomBytes } from 'node:crypto';
import { RoleCode } from '@hireflow/shared';
import type { JwtUser } from './decorators/current-user.decorator';

/**
 * 候选人/新员工免登录门户（H5）公共工具。
 * 门户不走 JWT：一条记录一个不可枚举的随机令牌，链接即凭证。
 * 令牌只在 HR 发送动作时生成，泄露可通过重新生成作废旧链接（TODO：续期/重发时轮换）。
 */
export function newPortalToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * 门户操作的留痕主体：候选人没有 User 账号，actorId 落 null（ActivityLog 外键安全），
 * actorName 显示候选人姓名，保证时间轴上"谁做的"依然可读。
 */
export function candidateActor(name: string): JwtUser {
  return {
    sub: null as unknown as string,
    email: '',
    name: `${name}（候选人）`,
    roles: [RoleCode.CANDIDATE],
    permissions: [],
    departmentId: null,
  };
}

/** 中国时区偏移（+8h）：部署环境（容器默认 UTC）不保证配置 TZ，涉及"当天"的日期计算一律按此显式换算，不依赖服务器本地时区 */
export const CN_TZ_OFFSET_MS = 8 * 3600 * 1000;

/** 通知 / 门户里的时间一律按北京时间显示：容器默认 UTC，toLocaleString 会差 8 小时 */
export function formatCnDateTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return `${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/** 从 from 起加 N 个工作日（跳过周六日；法定节假日后续接日历服务），按北京时间计算，截止到当天 23:59:59 */
export function addBusinessDays(from: Date, days: number): Date {
  // 平移到「以 UTC 方法读写 = 读写北京时间」的等效时刻，日期算术跑完再平移回真实 UTC 时刻
  const shifted = new Date(from.getTime() + CN_TZ_OFFSET_MS);
  let remaining = days;
  while (remaining > 0) {
    shifted.setUTCDate(shifted.getUTCDate() + 1);
    const dow = shifted.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  shifted.setUTCHours(23, 59, 59, 999);
  return new Date(shifted.getTime() - CN_TZ_OFFSET_MS);
}
