import { randomBytes } from 'node:crypto';
import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { RoleCode } from '@hireflow/shared';
import type { JwtUser } from './decorators/current-user.decorator';

/**
 * 候选人/新员工免登录门户（H5）公共工具。
 * 门户不走 JWT：一条记录一个不可枚举的随机令牌，链接即凭证。
 * 令牌只在 HR 发送动作时生成；每个令牌都有硬过期时间（PORTAL_TTL），过期返回 410，
 * HR 重新发送会换新令牌；「重新生成链接」让旧链接立即失效（误发 / 疑似泄露时用）。
 */
export function newPortalToken(): string {
  return randomBytes(24).toString('base64url');
}

const DAY = 24 * 3600 * 1000;

/** 各门户链接的有效期策略 */
export const PORTAL_TTL = {
  /** 预筛问卷：发出后 7 天 */
  PRESCREEN_MS: 7 * DAY,
  /** 预筛提交后只留 3 天回看「已提交」 */
  PRESCREEN_AFTER_SUBMIT_MS: 3 * DAY,
  /** 面试自助选时：发出后 7 天 */
  INTERVIEW_MS: 7 * DAY,
  /** 选定时间后链接保留到面试开始后 1 天（候选人回看时间地点） */
  INTERVIEW_AFTER_START_MS: 1 * DAY,
  /** Offer：答复截止后再留 7 天（看到「已过期，请联系 HR 续期」而不是 404） */
  OFFER_AFTER_DEADLINE_MS: 7 * DAY,
  /** Offer 答复后保留 14 天（接受者从这里进入入职门户） */
  OFFER_AFTER_DECISION_MS: 14 * DAY,
  /** 新员工门户：发出后 60 天（覆盖常见的到岗周期） */
  ONBOARDING_MS: 60 * DAY,
} as const;

export function portalExpiry(ttlMs: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + ttlMs);
}

/** 链接过期：410 Gone + code，前端据此展示「链接已过期」友好页（区别于无效链接 404） */
export class PortalLinkExpiredException extends HttpException {
  constructor(message = '该链接已过期，请联系 HR 重新发送') {
    super({ statusCode: HttpStatus.GONE, code: 'PORTAL_EXPIRED', message }, HttpStatus.GONE);
  }
}

export function portalLinkInvalid(): NotFoundException {
  return new NotFoundException({ statusCode: 404, code: 'PORTAL_INVALID', message: '链接无效或已被作废，请联系 HR 获取最新链接' });
}

/** 未设置过期时间按「已过期」处理（存量链接在迁移里补了 7 天宽限期）——失败即关闭 */
export function isPortalLive(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  return Boolean(expiresAt && expiresAt.getTime() > now.getTime());
}

export function assertPortalLive(expiresAt: Date | null | undefined, now: Date = new Date()): void {
  if (!isPortalLive(expiresAt, now)) throw new PortalLinkExpiredException();
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
