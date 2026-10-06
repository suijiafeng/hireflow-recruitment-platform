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
import type { Prisma } from '../../generated/prisma/client';
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

  /** 安排一场面试并指派面试官（二期接入日历协同后自动生成会议链接） */
  async create(dto: CreateInterviewDto, user: JwtUser) {
    const application = await this.prisma.application.findUnique({
      where: { id: dto.applicationId },
      include: { candidate: { select: { name: true } }, job: { select: { title: true } } },
    });
    if (!application) throw new NotFoundException('应聘记录不存在');
    if (application.status !== 'ACTIVE') {
      throw new BadRequestException('已淘汰/已入职的应聘记录不可再安排面试');
    }

    const interview = await this.prisma.interview.create({
      data: {
        applicationId: dto.applicationId,
        round: dto.round,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        durationMins: dto.durationMins,
        meetingUrl: dto.meetingUrl,
        interviewers: { create: dto.interviewerIds.map((userId) => ({ userId })) },
      },
      include: INTERVIEW_INCLUDE,
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
    const interview = await this.prisma.interview.findUnique({
      where: { id },
      include: {
        interviewers: true,
        application: {
          include: { candidate: { select: { name: true } }, job: { select: { title: true } } },
        },
      },
    });
    if (!interview) throw new NotFoundException('面试不存在');
    if (interview.status === 'CANCELED') throw new BadRequestException('已取消的面试不可再安排时间');
    if (interview.status === 'COMPLETED') throw new BadRequestException('已完成的面试不可改期');

    const start = new Date(dto.scheduledAt);
    if (Number.isNaN(start.getTime())) throw new BadRequestException('面试时间格式不正确');
    if (start < new Date()) throw new BadRequestException('面试时间不能早于当前时间');
    const durationMins = dto.durationMins ?? interview.durationMins ?? 60;
    const end = new Date(start.getTime() + durationMins * 60_000);
    const interviewerIds = interview.interviewers.map((i) => i.userId);

    // 面试官撞场检查：同一人同一时间段已有另一场未取消的面试
    if (!dto.ignoreConflict) {
      const busy = await this.prisma.interview.findMany({
        where: {
          id: { not: id },
          status: { not: 'CANCELED' },
          scheduledAt: { not: null },
          interviewers: { some: { userId: { in: interviewerIds } } },
        },
        include: {
          interviewers: { include: { user: { select: { name: true } } } },
          application: { include: { candidate: { select: { name: true } } } },
        },
      });
      const clash = busy.find((b) => {
        const bStart = b.scheduledAt!;
        const bEnd = new Date(bStart.getTime() + (b.durationMins ?? 60) * 60_000);
        return bStart < end && bEnd > start;
      });
      if (clash) {
        const who = clash.interviewers
          .filter((i) => interviewerIds.includes(i.userId))
          .map((i) => i.user.name)
          .join('、');
        throw new ConflictException(
          `${who} 同一时间已有面试：${clash.application.candidate.name}（第 ${clash.round} 轮）`,
        );
      }
    }

    // 改期时先释放原本占住的档，再占新档；顺序反了会把刚占的档又释放掉
    await this.prisma.interviewerSlot.updateMany({ where: { bookedBy: id }, data: { bookedBy: null } });
    await this.prisma.interviewerSlot.updateMany({
      where: {
        userId: { in: interviewerIds },
        bookedBy: null,
        startAt: { lte: start },
        endAt: { gte: end },
      },
      data: { bookedBy: id },
    });

    const updated = await this.prisma.interview.update({
      where: { id },
      data: { scheduledAt: start, durationMins, status: 'SCHEDULED' },
      include: INTERVIEW_INCLUDE,
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
    const interview = await this.prisma.interview.findUnique({
      where: { id },
      include: {
        interviewers: true,
        application: { include: { candidate: { select: { name: true } } } },
      },
    });
    if (!interview) throw new NotFoundException('面试不存在');
    if (interview.status !== 'SCHEDULED') {
      throw new BadRequestException('仅已安排未进行的面试可取消');
    }
    const updated = await this.prisma.interview.update({
      where: { id },
      data: { status: 'CANCELED' },
      include: INTERVIEW_INCLUDE,
    });
    // 释放候选人自助选定的面试官时段：否则该时段永久卡在「已占用」，面试官既约不出去也删不掉
    await this.prisma.interviewerSlot.updateMany({
      where: { bookedBy: id },
      data: { bookedBy: null },
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
    const overlap = await this.prisma.interviewerSlot.findFirst({
      where: { userId: user.sub, startAt: { lt: end }, endAt: { gt: start } },
    });
    if (overlap) throw new ConflictException('与已有时段重叠');
    return this.prisma.interviewerSlot.create({
      data: { userId: user.sub, startAt: start, endAt: end },
    });
  }

  async removeSlot(id: string, user: JwtUser) {
    const slot = await this.prisma.interviewerSlot.findUnique({ where: { id } });
    if (!slot) throw new NotFoundException('时段不存在');
    if (slot.userId !== user.sub) throw new ForbiddenException('仅可删除自己的时段');
    if (slot.bookedBy) throw new BadRequestException('该时段已被面试占用，请先与 HR 协调改期');
    await this.prisma.interviewerSlot.delete({ where: { id } });
    return { ok: true };
  }

  /** 生成候选人自助选时链接（未定时间的面试；重发复用同一令牌） */
  async selfScheduleLink(interviewId: string, user: JwtUser) {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        interviewers: true,
        application: { include: { candidate: { select: { name: true } } } },
      },
    });
    if (!interview) throw new NotFoundException('面试不存在');
    const canSchedule = user.permissions.includes(PERMISSIONS.INTERVIEW_SCHEDULE);
    const assigned = interview.interviewers.some((i) => i.userId === user.sub);
    if (!canSchedule && !assigned) {
      throw new ForbiddenException('仅本场面试官或招聘负责人可生成选时链接');
    }
    if (interview.scheduledAt) throw new BadRequestException('该面试已确定时间，如需改期请先取消原时间');

    let token = interview.portalToken;
    if (!token) {
      token = newPortalToken();
      await this.prisma.interview.update({ where: { id: interviewId }, data: { portalToken: token } });
    }
    return { token };
  }

  /** 候选人视角：可选时段 = 全部被指派面试官都空闲的时间窗（多面试官取重叠覆盖） */
  async portalView(token: string) {
    const interview = await this.prisma.interview.findUnique({
      where: { portalToken: token },
      include: {
        interviewers: { include: { user: { select: { id: true, name: true } } } },
        application: {
          select: {
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
    };
    // 取消过的场次仍带着原定时间：先按状态判断，否则候选人会看到「已确认」并按时到场
    if (interview.status === 'CANCELED' || interview.scheduledAt) return { ...base, slots: [] };

    const interviewerIds = interview.interviewers.map((i) => i.user.id);
    const now = new Date();
    const durationMs = (interview.durationMins ?? 60) * 60_000;
    const slots = await this.prisma.interviewerSlot.findMany({
      where: { userId: { in: interviewerIds }, bookedBy: null, startAt: { gte: now } },
      orderBy: { startAt: 'asc' },
    });
    // 档长短于本场面试时长的不展示：否则候选人选定后面试会溢出到下一档
    const longEnough = slots.filter((s) => s.endAt.getTime() - s.startAt.getTime() >= durationMs);
    // 主时段取第一位面试官的空闲档；多面试官时要求其余面试官有覆盖该时间窗的空闲档
    const primary = longEnough.filter((s) => s.userId === interviewerIds[0]);
    const available = primary.filter((slot) =>
      interviewerIds.slice(1).every((uid) =>
        longEnough.some((o) => o.userId === uid && o.startAt <= slot.startAt && o.endAt >= slot.endAt),
      ),
    );
    return {
      ...base,
      slots: available.map((s) => ({ id: s.id, startAt: s.startAt, endAt: s.endAt })),
    };
  }

  /**
   * 候选人确认时段：写入条件二次校验（确认瞬间二次校验，冲突给替代时段），
   * 并发抢占返回 409，前端刷新剩余时段。
   */
  async portalPick(token: string, slotId: string) {
    const interview = await this.prisma.interview.findUnique({
      where: { portalToken: token },
      include: {
        interviewers: true,
        application: {
          select: { candidateId: true, candidate: { select: { name: true } }, job: { select: { title: true, departmentId: true } } },
        },
      },
    });
    if (!interview) throw new NotFoundException('链接无效或已失效，请联系 HR');
    if (interview.scheduledAt) throw new BadRequestException('该面试时间已确定');

    // slotId 必须归属本场面试的被指派面试官之一，防止跨面试劫持他人空闲时段
    const interviewerIds = interview.interviewers.map((i) => i.userId);
    const claimed = await this.prisma.interviewerSlot.updateMany({
      where: { id: slotId, bookedBy: null, userId: { in: interviewerIds } },
      data: { bookedBy: interview.id },
    });
    if (claimed.count === 0) {
      throw new ConflictException('该时段刚被约走，请从剩余时段中重新选择');
    }
    const slot = await this.prisma.interviewerSlot.findUniqueOrThrow({ where: { id: slotId } });
    // 与 HR 直接敲定同一规则：其余面试官覆盖该时间窗的空闲档一并占用，避免双约
    if (interviewerIds.length > 1) {
      await this.prisma.interviewerSlot.updateMany({
        where: {
          id: { not: slotId },
          userId: { in: interviewerIds },
          bookedBy: null,
          startAt: { lte: slot.startAt },
          endAt: { gte: slot.endAt },
        },
        data: { bookedBy: interview.id },
      });
    }
    await this.prisma.interview.update({
      where: { id: interview.id },
      data: { scheduledAt: slot.startAt, status: 'SCHEDULED' },
    });
    const actor = candidateActor(interview.application.candidate.name);
    await this.activityLog.record(actor, ACTIVITY_ACTIONS.INTERVIEW_SELF_SCHEDULED, 'Application', interview.applicationId, {
      candidate: interview.application.candidate.name,
      round: interview.round,
      scheduledAt: slot.startAt.toISOString(),
    });
    // 通知矩阵：面试确认 → 面试官 IM+日历（此处站内信），HR 站内
    await this.notifications.push(
      interview.interviewers.map((i) => i.userId),
      `候选人已确认面试时间：${interview.application.candidate.name}`,
      `${interview.application.job.title} · 第 ${interview.round} 轮 · ${formatCnDateTime(slot.startAt)}`,
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
