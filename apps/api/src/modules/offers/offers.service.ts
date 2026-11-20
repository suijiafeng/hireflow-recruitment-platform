import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ACTIVITY_ACTIONS, OFFER_DECLINE_REASONS, OFFER_VALID_BUSINESS_DAYS, PERMISSIONS, RoleCode, StageKind } from '@hireflow/shared';
import { companyName } from '../../common/company';
import { departmentScopeOf, inDepartmentScope } from '../../common/data-scope';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { addBusinessDays, candidateActor, CN_TZ_OFFSET_MS, ensurePortalLink, PORTAL_TTL, portalExpiry } from '../../common/portal';
import type { Offer, Prisma } from '../../generated/prisma/client';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ApplicationsService } from '../applications/applications.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOfferDto, RespondDto } from './dto/create-offer.dto';

const OFFER_INCLUDE = {
  application: {
    select: {
      id: true,
      stageId: true,
      candidate: { select: { id: true, name: true, tags: true, email: true } },
      job: { select: { id: true, title: true, departmentId: true, department: { select: { name: true } } } },
    },
  },
} satisfies Prisma.OfferInclude;

type OfferWithRelations = Prisma.OfferGetPayload<{ include: typeof OFFER_INCLUDE }>;

/** @db.Date 列按日历日下发（YYYY-MM-DD），避免前端按本地时区解析 UTC 零点后错一天 */
const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Offer 发出后候选人页至少保持到答复截止后 7 天 */
const offerPortalUntil = (expiresAt: Date) => portalExpiry(PORTAL_TTL.OFFER_AFTER_DEADLINE_MS, expiresAt);

/**
 * Offer：HR 发起即发送（不再审批），候选人在候选人页答复。
 * 接受后在同一个事务里创建入职单和合同、把卡片移到「入职」；通知在事务提交后发送。
 */
@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly onboarding: OnboardingService,
    private readonly applications: ApplicationsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** 薪资是敏感字段：无 salary:view 权限时整体抹除 */
  private present<T extends Partial<Offer>>(offer: T, user: JwtUser): T {
    const rest = (offer.startDate ? { ...offer, startDate: dateOnly(offer.startDate) } : offer) as T;
    if (user.permissions.includes(PERMISSIONS.SALARY_VIEW)) return rest;
    return { ...rest, salary: null };
  }

  private ensureCanRead(user: JwtUser) {
    const ok =
      user.permissions.includes(PERMISSIONS.OFFER_INITIATE) || user.permissions.includes(PERMISSIONS.OFFER_READ);
    if (!ok) throw new ForbiddenException('无权查看 Offer 数据');
  }

  async list(user: JwtUser) {
    this.ensureCanRead(user);
    // 数据行级权限：用人经理仅本部门职位的 Offer
    const deptScope = departmentScopeOf(user);
    const offers = await this.prisma.offer.findMany({
      where: deptScope ? { application: { job: { departmentId: { in: deptScope } } } } : undefined,
      include: OFFER_INCLUDE,
      orderBy: { updatedAt: 'desc' },
    });
    // 兜底的懒过期：定时任务之外，读取时也把到期未答复的置为失效
    const swept = await Promise.all(offers.map((o) => this.expireIfDue(o)));
    return swept.map((o) => this.present(o, user));
  }

  /**
   * 发起并发送 Offer（HR）：不经审批，直接进入 5 个工作日答复期，候选人页同时可以答复。
   * 上一份 Offer 已终结（候选人拒绝 / 过期）时可以重新发起，旧方案记在时间轴 payload.previous。
   */
  async create(dto: CreateOfferDto, user: JwtUser) {
    const application = await this.prisma.application.findUnique({
      where: { id: dto.applicationId },
      include: { candidate: true, job: true, offer: true },
    });
    if (!application) throw new NotFoundException('应聘记录不存在');
    if (application.status !== 'ACTIVE') throw new BadRequestException('该应聘已不在流程中');
    this.assertDepartment(user, application.job.departmentId);
    const previous = application.offer;
    const previousClosed = previous && (previous.decision === 'DECLINED' || previous.status === 'EXPIRED');
    if (previous && !previousClosed) throw new ConflictException('该应聘记录已存在 Offer');

    const now = new Date();
    const expiresAt = addBusinessDays(now, OFFER_VALID_BUSINESS_DAYS);
    const data = {
      salary: { base: dto.salaryBase, bonusMonths: dto.bonusMonths ?? 0, note: dto.note ?? null },
      grade: dto.grade,
      startDate: this.parseStartDate(dto.startDate),
      status: 'SENT' as const,
      sentAt: now,
      expiresAt,
      extendedOnce: false,
      respondedAt: null,
      decision: null,
      decisionReason: null,
    };
    const offer = await this.prisma.$transaction(async (tx) => {
      const offer = previous
        ? await tx.offer.update({ where: { id: previous.id }, data, include: OFFER_INCLUDE })
        : await tx.offer.create({ data: { applicationId: dto.applicationId, ...data }, include: OFFER_INCLUDE });
      await ensurePortalLink(tx, dto.applicationId, offerPortalUntil(expiresAt));
      await this.activityLog.record(
        user,
        ACTIVITY_ACTIONS.OFFER_SENT,
        'Application',
        dto.applicationId,
        {
          candidate: application.candidate.name,
          job: application.job.title,
          grade: dto.grade ?? null,
          expiresAt: expiresAt.toISOString(),
          ...(previous
            ? {
                reissued: true,
                previous: {
                  salary: previous.salary,
                  grade: previous.grade,
                  decision: previous.decision,
                  decisionReason: previous.decisionReason,
                  status: previous.status,
                },
              }
            : {}),
        },
        tx,
      );
      // 看板与实体状态对齐：发出 Offer 即自动移卡到「录用」
      await this.applications.moveToStageKind(dto.applicationId, StageKind.OFFER, user, tx);
      return offer;
    });
    await this.notifications.push(
      await this.notifications.jobManagerIds(application.job.id),
      `Offer 已发出：${application.candidate.name}`,
      `${application.job.title} · 由 ${user.name} 发出，答复截止 ${dateOnly(expiresAt)}`,
      `/offers?focus=${offer.id}`,
    );
    return this.present(offer, user);
  }

  /** 发送迁移前遗留的未发出 Offer（DRAFT → SENT） */
  async send(id: string, user: JwtUser) {
    const offer = await this.findOrThrow(id);
    this.assertDepartment(user, offer.application.job.departmentId);
    if (offer.status !== 'DRAFT') throw new BadRequestException('该 Offer 已发出');
    const expiresAt = addBusinessDays(new Date(), OFFER_VALID_BUSINESS_DAYS);
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.offer.updateMany({
        where: { id, status: 'DRAFT' },
        data: { status: 'SENT', sentAt: new Date(), expiresAt },
      });
      if (result.count === 0) throw new ConflictException('该 Offer 刚被他人处理，请刷新');
      await ensurePortalLink(tx, offer.applicationId, offerPortalUntil(expiresAt));
      await this.activityLog.record(
        user,
        ACTIVITY_ACTIONS.OFFER_SENT,
        'Application',
        offer.applicationId,
        { candidate: offer.application.candidate.name, expiresAt: expiresAt.toISOString() },
        tx,
      );
      await this.applications.moveToStageKind(offer.applicationId, StageKind.OFFER, user, tx);
    });
    return this.present(await this.findOrThrow(id), user);
  }

  /** 续期一次：SENT/EXPIRED 未答复的 Offer 重新给 5 个工作日 */
  async extend(id: string, user: JwtUser) {
    let offer = await this.findOrThrow(id);
    this.assertDepartment(user, offer.application.job.departmentId);
    offer = await this.expireIfDue(offer);
    if (offer.decision) throw new BadRequestException('该 Offer 已有答复，无需续期');
    if (offer.status !== 'SENT' && offer.status !== 'EXPIRED') {
      throw new BadRequestException('仅已发送/已失效的 Offer 可续期');
    }
    if (offer.extendedOnce) throw new BadRequestException('有效期仅可续期一次');

    const expiresAt = addBusinessDays(new Date(), OFFER_VALID_BUSINESS_DAYS);
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.offer.updateMany({
        where: { id, decision: null, extendedOnce: false },
        data: { status: 'SENT', expiresAt, extendedOnce: true },
      });
      if (result.count === 0) throw new ConflictException('该 Offer 刚被他人处理，请刷新');
      await ensurePortalLink(tx, offer.applicationId, offerPortalUntil(expiresAt));
      await this.activityLog.record(
        user,
        ACTIVITY_ACTIONS.OFFER_EXTENDED,
        'Application',
        offer.applicationId,
        { candidate: offer.application.candidate.name, until: expiresAt.toISOString() },
        tx,
      );
      return tx.offer.findUniqueOrThrow({ where: { id }, include: OFFER_INCLUDE });
    });
    return this.present(updated, user);
  }

  /** 录入候选人答复（HR 代录，如电话确认）。拒绝必选原因码。 */
  async respond(id: string, dto: RespondDto, user: JwtUser) {
    const current = await this.findOrThrow(id);
    this.assertDepartment(user, current.application.job.departmentId);
    const offer = await this.applyDecision(id, dto.decision, dto.reason, user);
    return this.present(offer, user);
  }

  // ---------- 候选人页 ----------

  /** 候选人页上的 Offer 部分（链接即凭证；未发出时不展示薪资） */
  async portalSection(applicationId: string) {
    let offer = await this.prisma.offer.findUnique({ where: { applicationId }, include: OFFER_INCLUDE });
    if (!offer) return null;
    offer = await this.expireIfDue(offer);
    const base = {
      status: offer.status,
      decision: offer.decision,
      decisionReason: offer.decisionReason,
      respondedAt: offer.respondedAt,
      declineReasons: OFFER_DECLINE_REASONS,
    };
    if (offer.status === 'DRAFT') return { ...base, preparing: true as const };
    return {
      ...base,
      preparing: false as const,
      salary: offer.salary,
      grade: offer.grade,
      startDate: dateOnly(offer.startDate),
      sentAt: offer.sentAt,
      expiresAt: offer.expiresAt,
      extendedOnce: offer.extendedOnce,
    };
  }

  /** 候选人在候选人页接受 / 拒绝 Offer */
  async portalRespond(applicationId: string, candidateName: string, dto: RespondDto) {
    const offer = await this.prisma.offer.findUnique({ where: { applicationId }, select: { id: true } });
    if (!offer) throw new BadRequestException('还没有收到 Offer');
    await this.applyDecision(offer.id, dto.decision, dto.reason, candidateActor(candidateName));
  }

  /** 候选人的对接 HR：最近一次发出该 Offer 的人；查不到（如旧数据）时取任一在职 HR */
  async hrContactFor(applicationId: string): Promise<{ name: string; email: string } | null> {
    const log = await this.prisma.activityLog.findFirst({
      where: {
        entityType: 'Application',
        entityId: applicationId,
        action: { in: [ACTIVITY_ACTIONS.OFFER_SENT, ACTIVITY_ACTIONS.INTERVIEW_SCHEDULED] },
        actorId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: { actor: { select: { name: true, email: true, status: true } } },
    });
    if (log?.actor && log.actor.status === 'ACTIVE') return { name: log.actor.name, email: log.actor.email };
    const hr = await this.prisma.user.findFirst({
      where: { status: 'ACTIVE', roles: { some: { role: { code: RoleCode.HR } } } },
      select: { name: true, email: true },
      orderBy: { createdAt: 'asc' },
    });
    return hr ? { name: hr.name, email: hr.email } : null;
  }

  // ---------- 内部实现 ----------

  /**
   * 答复落库 + 自动化，HR 代录与候选人页共用。核心状态变更在一个事务里：
   * 接受 → 写答复、创建入职单和合同、卡片移到「入职」、候选人页顺延到入职环节；
   * 拒绝 → 写答复、应聘置为 WITHDRAWN（原因码留痕）。
   * 满编检查和通知在事务提交后执行，失败不影响已经落库的答复。
   */
  private async applyDecision(
    offerId: string,
    decision: 'ACCEPTED' | 'DECLINED',
    reason: string | undefined,
    actor: JwtUser,
  ) {
    let offer = await this.findOrThrow(offerId);
    offer = await this.expireIfDue(offer);
    if (offer.status === 'EXPIRED') {
      throw new BadRequestException('该 Offer 已超过答复期失效，请联系 HR 续期后再答复');
    }
    if (offer.status !== 'SENT') throw new BadRequestException('仅已发送的 Offer 可录入答复');
    if (offer.decision) throw new BadRequestException('该 Offer 已有答复');
    if (decision === 'DECLINED' && !reason?.trim()) {
      throw new BadRequestException('拒绝 Offer 必须选择原因码');
    }

    const { candidate, job } = offer.application;
    const onboardingId = await this.prisma.$transaction(async (tx) => {
      // 并发双答复（如 HR 代录与候选人同时提交）只允许一个成功
      const result = await tx.offer.updateMany({
        where: { id: offerId, status: 'SENT', decision: null },
        data: { decision, respondedAt: new Date(), decisionReason: decision === 'DECLINED' ? reason : null },
      });
      if (result.count === 0) throw new ConflictException('该 Offer 刚被答复过，请刷新查看');
      await this.activityLog.record(
        actor,
        ACTIVITY_ACTIONS.OFFER_RESPONDED,
        'Application',
        offer.applicationId,
        { candidate: candidate.name, decision, reason: reason ?? null },
        tx,
      );
      if (decision === 'ACCEPTED') {
        const onboarding = await this.onboarding.createForApplication(offer.applicationId, actor, tx);
        await this.applications.moveToStageKind(offer.applicationId, StageKind.ONBOARDING, actor, tx);
        await ensurePortalLink(tx, offer.applicationId, portalExpiry(PORTAL_TTL.ONBOARDING_MS));
        return onboarding.id;
      }
      await tx.application.update({
        where: { id: offer.applicationId },
        data: { status: 'WITHDRAWN', rejectReason: reason, version: { increment: 1 } },
      });
      await this.activityLog.record(
        actor,
        ACTIVITY_ACTIONS.APPLICATION_WITHDRAWN,
        'Application',
        offer.applicationId,
        { candidate: candidate.name, job: job.title, reason },
        tx,
      );
      return null;
    });

    if (onboardingId) {
      await this.checkHeadcount(job.id, actor);
      const link = `/onboarding?onboarding=${onboardingId}`;
      await this.notifications.pushByPermission(
        PERMISSIONS.ONBOARDING_MANAGE,
        job.departmentId,
        `Offer 已接受：${candidate.name}`,
        `${job.title} · 入职单和劳动合同已自动生成，候选人可在同一个链接里填写入职信息`,
        link,
      );
      await this.notifications.push(
        await this.notifications.jobManagerIds(job.id),
        `Offer 已接受：${candidate.name}`,
        `${job.title} · 候选人已接受 Offer，进入入职流程`,
        link,
      );
    } else {
      // 提示激活同职位仍在流程中的备选候选人
      const alternatives = await this.prisma.application.count({
        where: { jobId: job.id, status: 'ACTIVE', id: { not: offer.applicationId } },
      });
      await this.notifications.pushByPermission(
        PERMISSIONS.OFFER_INITIATE,
        job.departmentId,
        `Offer 被拒绝：${candidate.name}（${reason}）`,
        alternatives > 0
          ? `${job.title} · 该职位仍有 ${alternatives} 位流程中候选人，建议激活备选`
          : `${job.title} · 该职位暂无其他流程中候选人，建议补充招聘`,
        `/offers?focus=${offer.id}`,
      );
    }
    return this.findOrThrow(offerId);
  }

  /** 到期失效：SENT + 未答复 + 已过截止 → EXPIRED，通知 HR（状态迁移一次性，通知不会重复） */
  async expireIfDue(offer: OfferWithRelations): Promise<OfferWithRelations> {
    if (offer.status !== 'SENT' || offer.decision !== null || !offer.expiresAt || offer.expiresAt.getTime() > Date.now()) {
      return offer;
    }
    // 状态前置条件进写入条件：并发扫描只会有一个真正执行失效副作用
    const result = await this.prisma.offer.updateMany({
      where: { id: offer.id, status: 'SENT', decision: null },
      data: { status: 'EXPIRED' },
    });
    if (result.count === 0) return this.findOrThrow(offer.id);
    await this.activityLog.record(null, ACTIVITY_ACTIONS.OFFER_EXPIRED, 'Application', offer.applicationId, {
      candidate: offer.application.candidate.name,
      expiresAt: offer.expiresAt.toISOString(),
    });
    await this.notifications.pushByPermission(
      PERMISSIONS.OFFER_INITIATE,
      offer.application.job.departmentId,
      `Offer 已失效：${offer.application.candidate.name}`,
      `${offer.application.job.title} · 超过答复期未答复${offer.extendedOnce ? '（已用过续期）' : '，可续期一次'}`,
      `/offers?focus=${offer.id}`,
    );
    return { ...offer, status: 'EXPIRED' };
  }

  /** 定时任务：把所有到期未答复的 Offer 置为失效 */
  async expireDueOffers(): Promise<number> {
    const due = await this.prisma.offer.findMany({
      where: { status: 'SENT', decision: null, expiresAt: { lte: new Date() } },
      include: OFFER_INCLUDE,
    });
    for (const offer of due) await this.expireIfDue(offer);
    return due.length;
  }

  private async findOrThrow(id: string): Promise<OfferWithRelations> {
    const offer = await this.prisma.offer.findUnique({ where: { id }, include: OFFER_INCLUDE });
    if (!offer) throw new NotFoundException('Offer 不存在');
    return offer;
  }

  /** 数据行级权限：部门范围的账号只能操作本部门职位的 Offer */
  private assertDepartment(user: JwtUser, departmentId: string) {
    const deptScope = departmentScopeOf(user);
    if (deptScope && !inDepartmentScope(deptScope, departmentId)) {
      throw new ForbiddenException('仅可操作本部门职位的 Offer（数据范围：本部门）');
    }
  }

  /** HC 满编自动暂停职位，并通知 HR 与职位负责人 */
  private async checkHeadcount(jobId: string, user: JwtUser) {
    const job = await this.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    if (job.status !== 'OPEN') return;
    const used = await this.prisma.application.count({
      where: {
        jobId,
        OR: [{ status: 'HIRED' }, { status: 'ACTIVE', offer: { decision: 'ACCEPTED' } }],
      },
    });
    if (used < job.headcount) return;
    await this.prisma.job.update({ where: { id: jobId }, data: { status: 'PAUSED' } });
    await this.activityLog.recordAuto(user, ACTIVITY_ACTIONS.JOB_UPDATED, 'Job', jobId, {
      reason: `HC 已满（${used}/${job.headcount}），职位自动暂停`,
    });
    const recipients = [
      ...(await this.notifications.jobManagerIds(jobId)),
      ...(await this.notifications.recipientsByPermission(PERMISSIONS.OFFER_INITIATE, job.departmentId)),
    ];
    await this.notifications.push(
      recipients,
      `职位已满编自动暂停：${job.title}`,
      `HC ${used}/${job.headcount}，如需继续招聘请调整编制`,
      `/jobs?q=${encodeURIComponent(job.title)}`,
    );
  }

  /** 入职日期按北京时间的日历日比较：不能早于今天 */
  private parseStartDate(value: string): Date {
    const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
    const today = new Date(Date.now() + CN_TZ_OFFSET_MS).toISOString().slice(0, 10);
    if (Number.isNaN(date.getTime()) || value.slice(0, 10) < today) {
      throw new BadRequestException('预计入职日期不能早于今天');
    }
    return date;
  }
}

