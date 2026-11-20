import { randomBytes } from 'node:crypto';
import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import type { JwtUser } from './decorators/current-user.decorator';

/**
 * 候选人页（免登录）公共工具。
 * 一条应聘只有一个随机令牌（Application.portalToken），选面试时间、答复 Offer、填写入职信息都在 /portal/:token。
 * 令牌不可枚举、链接即凭证，并且有硬过期时间：每进入一个新环节就把过期时间顺延到该环节需要的时长，
 * 过期返回 410；「重新生成链接」让旧链接立即失效（误发 / 疑似泄露时用）。
 */
export function newPortalToken(): string {
  return randomBytes(24).toString('base64url');
}

const DAY = 24 * 3600 * 1000;

/** 候选人页在各环节至少保持可用的时长 */
export const PORTAL_TTL = {
  /** HR 手动复制链接：至少 14 天 */
  DEFAULT_MS: 14 * DAY,
  /** 有待选时间的面试：14 天 */
  INTERVIEW_MS: 14 * DAY,
  /** 面试时间确定后，链接保留到面试开始后 1 天 */
  INTERVIEW_AFTER_START_MS: 1 * DAY,
  /** Offer：答复截止后再留 7 天（看到「已过期，请联系 HR 续期」而不是 404） */
  OFFER_AFTER_DEADLINE_MS: 7 * DAY,
  /** 接受 Offer 后进入入职环节：60 天，覆盖常见的到岗周期 */
  ONBOARDING_MS: 60 * DAY,
  /** 入职完成后只留 7 天回看（页面上有未脱敏的证件号和薪资） */
  AFTER_COMPLETION_MS: 7 * DAY,
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

/** 未设置过期时间按「已过期」处理——失败即关闭 */
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
    roles: [],
    permissions: [],
    departmentId: null,
  };
}

type PortalLinkClient = Pick<Prisma.TransactionClient, 'application'>;

/**
 * 确保应聘有可用的候选人页链接，并把过期时间顺延到至少 until。
 * - 没有令牌、令牌已过期、或 rotate=true：换新令牌（旧链接立即失效）
 * - 已有可用令牌：沿用，只顺延过期时间（不会缩短）
 */
export async function ensurePortalLink(
  db: PortalLinkClient,
  applicationId: string,
  until: Date,
  rotate = false,
): Promise<{ token: string; expiresAt: Date; rotated: boolean }> {
  const app = await db.application.findUnique({
    where: { id: applicationId },
    select: { portalToken: true, portalExpiresAt: true },
  });
  if (!app) throw new NotFoundException('应聘记录不存在');
  const live = Boolean(app.portalToken) && isPortalLive(app.portalExpiresAt);
  const fresh = rotate || !live;
  const token = fresh ? newPortalToken() : app.portalToken!;
  const current = live && !rotate ? app.portalExpiresAt!.getTime() : 0;
  const expiresAt = new Date(Math.max(current, until.getTime()));
  await db.application.update({ where: { id: applicationId }, data: { portalToken: token, portalExpiresAt: expiresAt } });
  return { token, expiresAt, rotated: Boolean(app.portalToken) && fresh };
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
