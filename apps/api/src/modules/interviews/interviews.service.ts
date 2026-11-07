import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ACTIVITY_ACTIONS, AI_DRAFT_MARKER, EVALUATION_CONCLUSION_LABEL, PERMISSIONS, RoleCode } from '@hireflow/shared';
import { departmentScopeOf, inDepartmentScope, isAssignedScope } from '../../common/data-scope';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { candidateActor, CN_TZ_OFFSET_MS, formatCnDateTime, newPortalToken } from '../../common/portal';
import { Prisma } from '../../generated/prisma/client';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { AiService } from '../ai/ai.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInterviewDto } from './dto/create-interview.dto';
import { ScheduleInterviewDto } from './dto/schedule-interview.dto';
import { SubmitEvaluationDto } from './dto/submit-evaluation.dto';

const INTERVIEW_INCLUDE = {
  interviewers: { include: { user: { select: { id: true, name: true, email: true } } } },
  evaluations: { include: { interviewer: { select: { id: true, name: true } } } },
} as const;

@Injectable()
export class InterviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly ai: AiService,
    private readonly notifications: NotificationsService,
  ) {}

  private async schedulingTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work, { maxWait: 10_000, timeout: 10_000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        const databaseCode = error.meta?.code;
        if (error.code === 'P2034' || error.code === 'P2028' ||
          (error.code === 'P2010' && (databaseCode === '40P01' || databaseCode === '40001'))) {
          throw new ConflictException('面试日程正在被其他请求修改，请刷新后重试');
        }
      }
      throw error;
    }
  }

  /** 所有排期写入按应聘、面试、面试官顺序加行锁，保护状态与跨面试撞期检查。 */
  private async lockApplication(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM "Application" WHERE id = ${id} FOR UPDATE`;
    const application = await tx.application.findUnique({
      where: { id },
      include: { candidate: { select: { name: true } }, job: { select: { title: true, departmentId: true } } },
    });
    if (!application) throw new NotFoundException('应聘记录不存在');
    return application;
  }

  private assertActive(application: { status: string }) {
    if (application.status !== 'ACTIVE') {
      throw new BadRequestException('已终结的应聘记录不可再安排面试');
    }
  }

  private assertSchedulable(interview: { status: string }) {
    if (interview.status !== 'SCHEDULED') {
      throw new BadRequestException('已取消或已完成的面试不可再安排时间');
    }
  }

  private async lockInterview(tx: Prisma.TransactionClient, id: string) {
    const seed = await tx.interview.findUnique({ where: { id }, select: { applicationId: true } });
    if (!seed) throw new NotFoundException('面试不存在');
    const application = await this.lockApplication(tx, seed.applicationId);
    await tx.$queryRaw`SELECT id FROM "Interview" WHERE id = ${id} FOR UPDATE`;
    const interview = await tx.interview.findUnique({ where: { id }, include: { interviewers: { orderBy: { userId: 'asc' } } } });
    if (!interview) throw new NotFoundException('面试不存在');
    return { ...interview, application };
  }

  private async lockInterviewers(tx: Prisma.TransactionClient, ids: string[]) {
    if (!ids.length || new Set(ids).size !== ids.length) {
      throw new BadRequestException('请指派至少一名不重复的面试官');
    }
    const users = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "User" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE
    `;
    if (users.length !== ids.length) throw new NotFoundException('面试官不存在');
  }

  private duration(value?: number | null) {
    const durationMins = value ?? 60;
    if (!Number.isSafeInteger(durationMins) || durationMins < 5) {
      throw new BadRequestException('面试时长必须是至少 5 分钟的整数');
    }
    return durationMins;
  }

  private window(value: string | Date, durationMins: number) {
    const start = new Date(value);
    const end = new Date(start.getTime() + durationMins * 60_000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('面试时间格式不正确');
    }
    if (start <= new Date()) throw new BadRequestException('面试时间必须晚于当前时间');
    return { start, end };
  }

  private async assertNoConflict(
    tx: Prisma.TransactionClient, interviewerIds: string[], start: Date, end: Date, exceptId?: string,
  ) {
    const busy = await tx.interview.findMany({
      where: {
        ...(exceptId ? { id: { not: exceptId } } : {}),
        status: { not: 'CANCELED' },
        scheduledAt: { not: null, lt: end },
        interviewers: { some: { userId: { in: interviewerIds } } },
      },
    });
    if (busy.some((b) => new Date(b.scheduledAt!.getTime() + (b.durationMins ?? 60) * 60_000) > start)) {
      throw new ConflictException('面试官同一时间已有其他面试，请重新选择时间');
    }
  }

  /** HR 可在未维护空闲档时安排；候选人选时必须为每名面试官找到覆盖面试时长的档。 */
  private async occupySlots(
    tx: Prisma.TransactionClient, interviewId: string, interviewerIds: string[],
    start: Date, end: Date, requireAll: boolean,
  ) {
    const slots = await tx.interviewerSlot.findMany({
      where: { userId: { in: interviewerIds }, bookedBy: null, startAt: { lte: start }, endAt: { gte: end } },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    });
    const selected = interviewerIds.map((uid) => slots.find((s) => s.userId === uid));
    if (requireAll && selected.some((s) => !s)) {
      throw new ConflictException('部分面试官已无可用时段，请重新选择');
    }
    const ids = selected.flatMap((s) => s ? [s.id] : []);
    if (ids.length) {
      const claimed = await tx.interviewerSlot.updateMany({
        where: { id: { in: ids }, bookedBy: null }, data: { bookedBy: interviewId },
      });
      if (claimed.count !== ids.length) throw new ConflictException('该时段刚被约走，请重新选择');
    }
  }

  private commonSlots(
    slots: Array<{ id: string; userId: string; startAt: Date; endAt: Date }>,
    interviewerIds: string[], durationMins: number,
  ) {
    let windows = slots.filter((s) => s.userId === interviewerIds[0])
      .map(({ id, startAt, endAt }) => ({ id, startAt, endAt }));
    for (const uid of interviewerIds.slice(1)) {
      const others = slots.filter((s) => s.userId === uid);
      windows = windows.flatMap((window) => others.flatMap((other) => {
        const startAt = new Date(Math.max(window.startAt.getTime(), other.startAt.getTime()));
        const endAt = new Date(Math.min(window.endAt.getTime(), other.endAt.getTime()));
        return endAt.getTime() - startAt.getTime() >= durationMins * 60_000
          ? [{ id: window.id, startAt, endAt }] : [];
      }));
    }
    return windows.filter((s) => s.endAt.getTime() - s.startAt.getTime() >= durationMins * 60_000);
  }

  /** 安排一场面试并指派面试官；直接带时间也走同一套撞期与占档规则。 */
  async create(dto: CreateInterviewDto, user: JwtUser) {
    const { application, interview } = await this.schedulingTransaction(async (tx) => {
      const application = await this.lockApplication(tx, dto.applicationId);
      this.assertActive(application);
      await this.lockInterviewers(tx, dto.interviewerIds);
      const durationMins = this.duration(dto.durationMins);
      const window = dto.scheduledAt ? this.window(dto.scheduledAt, durationMins) : null;
      if (window) await this.assertNoConflict(tx, dto.interviewerIds, window.start, window.end);
      const interview = await tx.interview.create({
        data: {
          applicationId: dto.applicationId, round: dto.round,
          scheduledAt: window?.start ?? null, durationMins, meetingUrl: dto.meetingUrl,
          interviewers: { create: dto.interviewerIds.map((userId) => ({ userId })) },
        },
        include: INTERVIEW_INCLUDE,
      });
      if (window) await this.occupySlots(tx, interview.id, dto.interviewerIds, window.start, window.end, false);
      return { application, interview };
    });

    await this.activityLog.record(
      user,
      ACTIVITY_ACTIONS.INTERVIEW_SCHEDULED,
      'Application',
      dto.applicationId,
      {
        candidate: application.candidate.name,
        round: dto.round,
        scheduledAt: dto.scheduledAt ?? null,
        interviewers: interview.interviewers.map((i) => i.user.name),
      },
    );
    // 通知矩阵：面试确认 → 面试官（日历/IM 通道后续接入）
    await this.notifications.push(
      dto.interviewerIds,
      `新面试指派：${application.candidate.name}（第 ${dto.round} 轮）`,
      `${application.job.title}${dto.scheduledAt ? ` · ${formatCnDateTime(dto.scheduledAt)}` : ' · 时间待定'}`,
      `/interviews?candidate=${application.candidateId}`,
    );
    return interview;
  }

  /**
   * HR 直接敲定/改期面试时间——不必让候选人去点自助选时链接。
   * 与 portalPick 是同一件事的两条入口，所以时段占用规则必须一致：
   * 落在面试官空闲档内的，把档标成本场占用，否则同一档还能被别的链接选走造成双约。
   */
  async schedule(id: string, dto: ScheduleInterviewDto, user: JwtUser) {
    const { interview, updated, start, interviewerIds } = await this.schedulingTransaction(async (tx) => {
      const interview = await this.lockInterview(tx, id);
      this.assertSchedulable(interview);
      this.assertActive(interview.application);
      const durationMins = this.duration(dto.durationMins ?? interview.durationMins);
      const { start, end } = this.window(dto.scheduledAt, durationMins);
      const interviewerIds = interview.interviewers.map((i) => i.userId);
      await this.lockInterviewers(tx, interviewerIds);
      if (!dto.ignoreConflict) await this.assertNoConflict(tx, interviewerIds, start, end, id);
      await tx.interviewerSlot.updateMany({ where: { bookedBy: id }, data: { bookedBy: null } });
      await this.occupySlots(tx, id, interviewerIds, start, end, false);
      const updated = await tx.interview.update({
        where: { id }, data: { scheduledAt: start, durationMins, status: 'SCHEDULED' }, include: INTERVIEW_INCLUDE,
      });
      return { interview, updated, start, interviewerIds };
    });
    await this.activityLog.record(
      user,
      ACTIVITY_ACTIONS.INTERVIEW_SCHEDULED,
      'Application',
      interview.applicationId,
      {
        candidate: interview.application.candidate.name,
        round: interview.round,
        scheduledAt: start.toISOString(),
      },
    );
    await this.notifications.push(
      interviewerIds,
      `面试时间已确定：${interview.application.candidate.name}（第 ${interview.round} 轮）`,
      `${interview.application.job.title} · ${formatCnDateTime(start)}`,
      `/interviews?candidate=${interview.application.candidateId}`,
    );
    return updated;
  }

  /** 取消面试：仅未开始的场次；通知被指派面试官，留痕后状态终结 */
  async cancel(id: string, user: JwtUser) {
    const { interview, updated } = await this.schedulingTransaction(async (tx) => {
      const interview = await this.lockInterview(tx, id);
      this.assertSchedulable(interview);
      if (interview.scheduledAt && interview.scheduledAt <= new Date()) {
        throw new BadRequestException('已开始的面试不可取消');
      }
      await this.lockInterviewers(tx, interview.interviewers.map((i) => i.userId));
      const updated = await tx.interview.update({
        where: { id }, data: { status: 'CANCELED' }, include: INTERVIEW_INCLUDE,
      });
      await tx.interviewerSlot.updateMany({ where: { bookedBy: id }, data: { bookedBy: null } });
      return { interview, updated };
    });
    await this.activityLog.record(
      user,
      ACTIVITY_ACTIONS.INTERVIEW_CANCELED,
      'Application',
      interview.applicationId,
      { candidate: interview.application.candidate.name, round: interview.round },
    );
    await this.notifications.push(
      interview.interviewers.map((i) => i.userId),
      `面试已取消：${interview.application.candidate.name}（第 ${interview.round} 轮）`,
      `${interview.scheduledAt ? `原定 ${formatCnDateTime(interview.scheduledAt)} · ` : ''}由 ${user.name} 取消`,
      `/interviews?candidate=${interview.application.candidateId}`,
    );
    return updated;
  }

  /**
   * 惰性收口：已过约定时间且未取消的面试自动置为 COMPLETED。
   * 与 offers.expireIfDue 同一套路——没有定时任务，就在读路径上把到期状态补齐；
   * 否则 Interview 永远停在 SCHEDULED，面试管理页的「待我面评」筛选与提交入口全部够不着。
   */
  private async completeDueInterviews() {
    await this.prisma.interview.updateMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() } },
      data: { status: 'COMPLETED' },
    });
  }

  /** 按应聘记录查询；不传 applicationId 时返回近期面试总览（面试管理页用） */
  async list(applicationId?: string, user?: JwtUser) {
    await this.completeDueInterviews();
    // 数据行级权限：面试官仅被指派的面试；用人经理仅本部门
    const scopeWhere: Prisma.InterviewWhereInput = {};
    if (user && isAssignedScope(user)) {
      scopeWhere.interviewers = { some: { userId: user.sub } };
    }
    const deptScope = user ? departmentScopeOf(user) : null;
    if (deptScope) {
      scopeWhere.application = { job: { departmentId: { in: deptScope } } };
    }
    if (applicationId) {
      return this.prisma.interview.findMany({
        where: { applicationId, ...scopeWhere },
        include: INTERVIEW_INCLUDE,
        orderBy: { round: 'asc' },
      });
    }
    return this.prisma.interview.findMany({
      where: scopeWhere,
      include: {
        ...INTERVIEW_INCLUDE,
        application: {
          select: {
            id: true,
            candidate: { select: { id: true, name: true } },
            job: { select: { id: true, title: true, scorecardTemplate: true } },
            stage: { select: { name: true } },
          },
        },
      },
      orderBy: [{ scheduledAt: 'desc' }],
      take: 100,
    });
  }

  /**
   * 谁可以对某场面试写面评（草稿与提交共用）：
   * - 「仅被指派」（面试官）：只能是本场的面试官；
   * - 「本部门」（用人经理）：仅本部门职位的面试——经理可以补录面评，但不能跨部门；
   * - 全局范围（HR/管理员）：不受限，用于代录线下面试的结论。
   */
  private assertCanEvaluate(
    interview: { interviewers: Array<{ userId: string }>; application: { job: { departmentId: string | null } } },
    user: JwtUser,
  ) {
    if (isAssignedScope(user) && !interview.interviewers.some((i) => i.userId === user.sub)) {
      throw new ForbiddenException('仅可对自己被指派的面试提交评价');
    }
    const deptScope = departmentScopeOf(user);
    if (deptScope && !inDepartmentScope(deptScope, interview.application.job.departmentId)) {
      throw new ForbiddenException('仅可评价本部门职位的面试（数据范围：本部门）');
    }
  }

  /**
   * AI 面评草稿（面试 Copilot）：
   * 面试官的原始记录 → 结构化评分卡草稿，返回给前端预填，最终由人修改确认。
   */
  async draftEvaluation(interviewId: string, notes: string, user: JwtUser) {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        interviewers: true,
        application: {
          include: {
            candidate: { select: { name: true } },
            job: { select: { title: true, scorecardTemplate: true, departmentId: true } },
          },
        },
      },
    });
    if (!interview) throw new NotFoundException('面试不存在');
    // 草稿与正式提交同一道门：否则可对任意场次调用 AI，拿到候选人姓名与岗位并消耗额度
    this.assertCanEvaluate(interview, user);

    // 岗位评分卡模板：AI 草稿按模板维度输出，与面评表单一致
    const template = interview.application.job.scorecardTemplate as
      | Array<{ dimension: string }>
      | null;
    const { data, meta } = await this.ai.draftEvaluation({
      candidateName: interview.application.candidate.name,
      jobTitle: interview.application.job.title,
      round: interview.round,
      notes,
      dimensions: template?.map((t) => t.dimension),
    });
    return { ...data, aiMeta: meta };
  }

  /** 提交/更新面评（同一面试官对同一场面试仅一份，重复提交视为修订） */
  async submitEvaluation(interviewId: string, dto: SubmitEvaluationDto, user: JwtUser) {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        interviewers: true,
        application: {
          include: {
            candidate: { select: { id: true, name: true } },
            job: { select: { id: true, title: true, departmentId: true } },
          },
        },
      },
    });
    if (!interview) throw new NotFoundException('面试不存在');
    if (interview.status === 'CANCELED') {
      throw new BadRequestException('该面试已取消，不可提交评价');
    }
    this.assertCanEvaluate(interview, user);
    const revising = Boolean(
      await this.prisma.evaluation.findUnique({
        where: { interviewId_interviewerId: { interviewId, interviewerId: user.sub } },
        select: { id: true },
      }),
    );
    // 草稿标记还在，说明评语没人看过：正式面评会进入 Offer 决策，不能原样落库
    if (dto.comments?.includes(AI_DRAFT_MARKER)) {
      throw new BadRequestException(`请核对评语并删除「${AI_DRAFT_MARKER}」标记后再提交`);
    }

    const evaluation = await this.prisma.evaluation.upsert({
      where: { interviewId_interviewerId: { interviewId, interviewerId: user.sub } },
      create: {
        interviewId,
        interviewerId: user.sub,
        scorecard: dto.scorecard.map((s) => ({ ...s })),
        conclusion: dto.conclusion,
        comments: dto.comments,
        submittedAt: new Date(),
      },
      update: {
        scorecard: dto.scorecard.map((s) => ({ ...s })),
        conclusion: dto.conclusion,
        comments: dto.comments,
        submittedAt: new Date(),
      },
      include: { interviewer: { select: { id: true, name: true } } },
    });

    // 有人交了面评，这场面试就是真的发生过了——未排期（scheduledAt 为空）的场次靠时间扫不到，
    // 在这里收口，同时让同场其他面试官仍能看到提交入口。
    if (interview.status === 'SCHEDULED') {
      await this.prisma.interview.updateMany({
        where: { id: interviewId, status: 'SCHEDULED' },
        data: { status: 'COMPLETED' },
      });
    }

    await this.activityLog.record(
      user,
      ACTIVITY_ACTIONS.EVALUATION_SUBMITTED,
      'Application',
      interview.applicationId,
      {
        candidate: interview.application.candidate.name,
        round: interview.round,
        conclusion: dto.conclusion,
      },
    );
    // 面评是推进下一轮 / 发 Offer 的依据：HR 与职位负责人不该靠反复刷页面才知道有反馈
    const conclusionLabel = EVALUATION_CONCLUSION_LABEL[dto.conclusion] ?? dto.conclusion;
    const recipients = new Set([
      ...(await this.notifications.jobManagerIds(interview.application.job.id)),
      ...(await this.notifications.recipientsByPermission(PERMISSIONS.INTERVIEW_SCHEDULE, interview.application.job.departmentId)),
    ]);
    await this.notifications.push(
      [...recipients].filter((id) => id !== user.sub),
      `面评${revising ? '已修订' : '已提交'}：${interview.application.candidate.name}（第 ${interview.round} 轮 · ${conclusionLabel}）`,
      `${interview.application.job.title} · 面试官 ${user.name}`,
      `/candidates?candidate=${interview.application.candidate.id}`,
    );
    return evaluation;
  }

  // ---------- 面试官可约时段 + 候选人自助选时 ----------

  /** 我的可约时段（面试官自维护，替代外部日历集成的低成本路径） */
  async mySlots(user: JwtUser) {
    const slots = await this.prisma.interviewerSlot.findMany({
      where: { userId: user.sub, endAt: { gte: new Date() } },
      orderBy: { startAt: 'asc' },
    });
    // bookedBy 存的是 interview.id，直接给前端会渲染成一串 cuid：
    // 这里补一个「候选人 · 职位」的可读标签，前端只展示标签。
    const bookedIds = slots.map((s) => s.bookedBy).filter((v): v is string => Boolean(v));
    if (bookedIds.length === 0) return slots.map((s) => ({ ...s, bookedLabel: null }));
    const interviews = await this.prisma.interview.findMany({
      where: { id: { in: bookedIds } },
      include: {
        application: {
          include: { candidate: { select: { name: true } }, job: { select: { title: true } } },
        },
      },
    });
    const booked = new Map(
      interviews.map((i) => [
        i.id,
        {
          bookedLabel: `${i.application.candidate.name} · ${i.application.job.title}`,
          bookedCandidateId: i.application.candidateId,
          bookedRound: i.round,
        },
      ]),
    );
    const empty = { bookedLabel: null, bookedCandidateId: null, bookedRound: null };
    return slots.map((s) => ({
      ...s,
      ...empty,
      ...(s.bookedBy ? (booked.get(s.bookedBy) ?? { ...empty, bookedLabel: '已被预约' }) : empty),
    }));
  }

  async addSlot(startAt: string, endAt: string, user: JwtUser) {
    const start = new Date(startAt);
    const end = new Date(endAt);
    if (!(start < end)) throw new BadRequestException('结束时间必须晚于开始时间');
    if (start < new Date()) throw new BadRequestException('不能添加过去的时段');
    // 门户展示仅取结束时间 HH:mm，跨天会渲染成「23:00 - 01:00」的伪时段：按 +8 时区禁止跨天
    const dayOf = (d: Date) => Math.floor((d.getTime() + CN_TZ_OFFSET_MS) / 86_400_000);
    if (dayOf(start) !== dayOf(end)) {
      throw new BadRequestException('可约时段不能跨天，请拆分为多个时段');
    }
    return this.schedulingTransaction(async (tx) => {
      await this.lockInterviewers(tx, [user.sub]);
      const overlap = await tx.interviewerSlot.findFirst({
        where: { userId: user.sub, startAt: { lt: end }, endAt: { gt: start } },
      });
      if (overlap) throw new ConflictException('与已有时段重叠');
      return tx.interviewerSlot.create({ data: { userId: user.sub, startAt: start, endAt: end } });
    });
  }

  async removeSlot(id: string, user: JwtUser) {
    return this.schedulingTransaction(async (tx) => {
      await this.lockInterviewers(tx, [user.sub]);
      const slot = await tx.interviewerSlot.findUnique({ where: { id } });
      if (!slot) throw new NotFoundException('时段不存在');
      if (slot.userId !== user.sub) throw new ForbiddenException('仅可删除自己的时段');
      if (slot.bookedBy) throw new BadRequestException('该时段已被面试占用，请先与 HR 协调改期');
      await tx.interviewerSlot.delete({ where: { id } });
      return { ok: true };
    });
  }

  /** 生成候选人自助选时链接（未定时间的面试；重发复用同一令牌） */
  async selfScheduleLink(interviewId: string, user: JwtUser) {
    return this.schedulingTransaction(async (tx) => {
      const interview = await this.lockInterview(tx, interviewId);
      const canSchedule = user.permissions.includes(PERMISSIONS.INTERVIEW_SCHEDULE);
      const assigned = interview.interviewers.some((i) => i.userId === user.sub);
      if (!canSchedule && !assigned) throw new ForbiddenException('仅本场面试官或招聘负责人可生成选时链接');
      this.assertSchedulable(interview);
      this.assertActive(interview.application);
      if (interview.scheduledAt) throw new BadRequestException('该面试已确定时间，如需改期请联系 HR');
      const token = interview.portalToken ?? newPortalToken();
      if (!interview.portalToken) await tx.interview.update({ where: { id: interviewId }, data: { portalToken: token } });
      return { token };
    });
  }

  /** 候选人视角：可选时段 = 全部被指派面试官都空闲的时间窗（多面试官取重叠覆盖） */
  async portalView(token: string) {
    const interview = await this.prisma.interview.findUnique({
      where: { portalToken: token },
      include: {
        interviewers: { orderBy: { userId: 'asc' }, include: { user: { select: { id: true, name: true } } } },
        application: {
          select: {
            status: true,
            candidate: { select: { name: true } },
            job: { select: { title: true } },
          },
        },
      },
    });
    if (!interview) throw new NotFoundException('链接无效或已失效，请联系 HR');

    const base = {
      company: 'ART 科技有限公司',
      candidateName: interview.application.candidate.name,
      jobTitle: interview.application.job.title,
      round: interview.round,
      durationMins: interview.durationMins ?? 60,
      scheduledAt: interview.scheduledAt,
      status: interview.status,
      closed: interview.status !== 'SCHEDULED' || interview.application.status !== 'ACTIVE',
    };
    // 取消过的场次仍带着原定时间：先按状态判断，否则候选人会看到「已确认」并按时到场
    if (base.closed || interview.scheduledAt) return { ...base, slots: [] };

    const interviewerIds = interview.interviewers.map((i) => i.user.id);
    const now = new Date();
    const slots = await this.prisma.interviewerSlot.findMany({
      where: { userId: { in: interviewerIds }, bookedBy: null, startAt: { gte: now } },
      orderBy: { startAt: 'asc' },
    });
    return { ...base, slots: this.commonSlots(slots, interviewerIds, base.durationMins) };
  }

  /**
   * 候选人确认时段：写入条件二次校验（确认瞬间二次校验，冲突给替代时段），
   * 并发抢占返回 409，前端刷新剩余时段。
   */
  async portalPick(token: string, slotId: string, selectedStartAt?: string) {
    const { interview, start } = await this.schedulingTransaction(async (tx) => {
      const seed = await tx.interview.findUnique({ where: { portalToken: token }, select: { id: true } });
      if (!seed) throw new NotFoundException('链接无效或已失效，请联系 HR');
      const interview = await this.lockInterview(tx, seed.id);
      this.assertSchedulable(interview);
      this.assertActive(interview.application);
      if (interview.scheduledAt) throw new ConflictException('该面试时间已确定，请刷新查看');
      const interviewerIds = interview.interviewers.map((i) => i.userId);
      await this.lockInterviewers(tx, interviewerIds);
      const durationMins = this.duration(interview.durationMins);
      const slots = await tx.interviewerSlot.findMany({
        where: { userId: { in: interviewerIds }, bookedBy: null, startAt: { gt: new Date() } },
        orderBy: { startAt: 'asc' },
      });
      // 一份主档可以形成多个交集；新客户端带交集起点，旧 slotId 请求使用第一个仍可用交集。
      const chosen = this.commonSlots(slots, interviewerIds, durationMins).find((s) =>
        s.id === slotId && (!selectedStartAt || s.startAt.getTime() === new Date(selectedStartAt).getTime()),
      );
      if (!chosen) throw new ConflictException('该时段已不可用或不足面试时长，请重新选择');
      const { start, end } = this.window(chosen.startAt, durationMins);
      await this.assertNoConflict(tx, interviewerIds, start, end, interview.id);
      await this.occupySlots(tx, interview.id, interviewerIds, start, end, true);
      await tx.interview.update({ where: { id: interview.id }, data: { scheduledAt: start, status: 'SCHEDULED' } });
      return { interview, start };
    });
    const actor = candidateActor(interview.application.candidate.name);
    await this.activityLog.record(actor, ACTIVITY_ACTIONS.INTERVIEW_SELF_SCHEDULED, 'Application', interview.applicationId, {
      candidate: interview.application.candidate.name,
      round: interview.round,
      scheduledAt: start.toISOString(),
    });
    // 通知矩阵：面试确认 → 面试官 IM+日历（此处站内信），HR 站内
    await this.notifications.push(
      interview.interviewers.map((i) => i.userId),
      `候选人已确认面试时间：${interview.application.candidate.name}`,
      `${interview.application.job.title} · 第 ${interview.round} 轮 · ${formatCnDateTime(start)}`,
      `/interviews?candidate=${interview.application.candidateId}`,
    );
    await this.notifications.pushByPermission(
      PERMISSIONS.INTERVIEW_SCHEDULE,
      interview.application.job.departmentId,
      `面试时间已敲定：${interview.application.candidate.name}`,
      `${interview.application.job.title} · 第 ${interview.round} 轮`,
      `/interviews?candidate=${interview.application.candidateId}`,
    );
    return this.portalView(token);
  }
}
