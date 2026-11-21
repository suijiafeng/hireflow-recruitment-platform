import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ACTIVITY_ACTIONS, StageKind } from '@hireflow/shared';
import { departmentScopeOf, isAssignedScope } from '../../common/data-scope';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { ensurePortalLink, PORTAL_TTL, portalExpiry } from '../../common/portal';
import type { Prisma } from '../../generated/prisma/client';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { AiService } from '../ai/ai.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { BatchMoveDto, BatchRejectDto, MoveStageDto, RejectApplicationDto } from './dto/move-stage.dto';

/** 批量操作结果：部分失败不回滚（错误报告模式） */
export interface BatchResult {
  total: number;
  succeeded: number;
  failed: Array<{ id: string; candidate: string | null; error: string }>;
}

/** 看板卡片上的面试轮次标签：取最近一场没有取消的面试 */
const CARD_INTERVIEWS = {
  where: { status: { not: 'CANCELED' } },
  orderBy: { round: 'desc' },
  take: 1,
  select: {
    round: true,
    status: true,
    scheduledAt: true,
    _count: { select: { interviewers: true } },
    evaluations: { where: { submittedAt: { not: null } }, select: { id: true } },
  },
} satisfies Prisma.Application$interviewsArgs;

type CardInterview = {
  round: number;
  status: string;
  scheduledAt: Date | null;
  _count: { interviewers: number };
  evaluations: Array<{ id: string }>;
};

/** 轮次标签：「二面 · 待面评」这类信息，替代原来的一面 / 二面两列 */
export function interviewTag(interviews: CardInterview[] | undefined) {
  const latest = interviews?.[0];
  if (!latest) return null;
  const submitted = latest.evaluations.length;
  const total = latest._count.interviewers;
  const state = !latest.scheduledAt
    ? 'unscheduled'
    : latest.status === 'SCHEDULED'
      ? 'scheduled'
      : submitted >= total
        ? 'evaluated'
        : 'awaiting_evaluation';
  return { round: latest.round, state, scheduledAt: latest.scheduledAt, submitted, total };
}

const CARD_SELECT = {
  id: true,
  status: true,
  matchScore: true,
  matchSource: true,
  position: true,
  createdAt: true,
  stageId: true,
  stageEnteredAt: true,
  version: true,
  candidate: { select: { id: true, name: true, tags: true, source: true } },
} as const;

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly ai: AiService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * AI 岗位匹配度评分：JD × 简历 → 分数 + 可解释报告，回写应聘记录。
   */
  async score(id: string, user: JwtUser) {
    const application = await this.prisma.application.findUnique({
      where: { id },
      include: {
        job: true,
        candidate: { include: { resumes: { orderBy: { createdAt: 'desc' }, take: 1 } } },
      },
    });
    if (!application) throw new NotFoundException('应聘记录不存在');
    await this.assertJobDepartmentScope(application.jobId, user);

    const resume = application.candidate.resumes[0];
    const resumeText = resume?.rawText ?? (resume?.parsed ? JSON.stringify(resume.parsed) : '');
    if (!resumeText && application.candidate.tags.length === 0) {
      throw new BadRequestException('该候选人暂无简历或标签，无法评分，请先导入简历');
    }

    const { data, meta } = await this.ai.scoreMatch({
      jobTitle: application.job.title,
      jobDescription: application.job.description ?? '',
      jobRequirement: application.job.requirement ?? '',
      resumeText,
      candidateTags: application.candidate.tags,
    });

    // 分数口径：大模型 = ai；规则引擎（未配模型或本次降级）= rule。
    // 降级时如果已有一份大模型分数，不拿规则分去覆盖它——列表 / 看板只显示一个数，混口径会误导排序
    const source = meta.provider === 'mock' ? 'rule' : 'ai';
    const keepExisting = meta.degraded && application.matchSource === 'ai' && application.matchScore != null;
    if (keepExisting) {
      this.logger.warn(`应聘 ${id} 本次评分降级到规则引擎，保留原大模型分数 ${application.matchScore}`);
      const current = await this.prisma.application.findUniqueOrThrow({
        where: { id },
        select: { ...CARD_SELECT, matchReport: true },
      });
      return { ...current, aiMeta: meta, degradedKept: true };
    }

    const updated = await this.prisma.application.update({
      where: { id },
      data: {
        matchScore: data.score,
        matchSource: source,
        matchReport: { ...data, aiMeta: meta } as unknown as Prisma.InputJsonValue,
      },
      select: { ...CARD_SELECT, matchReport: true },
    });
    await this.activityLog.record(user, ACTIVITY_ACTIONS.APPLICATION_SCORED, 'Application', id, {
      candidate: application.candidate.name,
      job: application.job.title,
      score: data.score,
      provider: meta.provider,
      source,
      ...(data.injectionSuspected ? { injectionSuspected: true } : {}),
    });
    return { ...updated, aiMeta: meta };
  }

  /** 创建应聘记录（候选人投递/HR 导入），进入指定或默认首个阶段 */
  async create(dto: CreateApplicationDto, user: JwtUser) {
    const job = await this.prisma.job.findUnique({
      where: { id: dto.jobId },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
    if (!job) throw new NotFoundException('职位不存在');
    await this.assertJobDepartmentScope(job.id, user);
    if (job.stages.length === 0) throw new BadRequestException('该职位尚未配置 Pipeline 阶段');

    const stage = dto.stageId
      ? job.stages.find((s) => s.id === dto.stageId)
      : job.stages[0];
    if (!stage) throw new BadRequestException('目标阶段不属于该职位');

    const candidate = await this.prisma.candidate.findUnique({ where: { id: dto.candidateId } });
    if (!candidate) throw new NotFoundException('候选人不存在');

    // 先查再建：已有记录（含淘汰 / 撤回）直接走复活 / 拒绝分支，不靠撞唯一键再回查——
    // 本地 PGlite 在唯一键报错后同一连接的回查会拿到空结果，复活就会被误判成「仍在流程中」
    const existing = await this.prisma.application.findUnique({
      where: { candidateId_jobId: { candidateId: dto.candidateId, jobId: dto.jobId } },
      select: { id: true, status: true },
    });
    if (existing) return this.reviveOrReject(existing, candidate, job, stage, user);

    try {
      const application = await this.prisma.application.create({
        data: {
          candidateId: dto.candidateId,
          jobId: dto.jobId,
          stageId: stage.id,
          position: await this.nextPosition(stage.id),
        },
        select: CARD_SELECT,
      });
      await this.activityLog.record(
        user,
        ACTIVITY_ACTIONS.APPLICATION_CREATED,
        'Application',
        application.id,
        { candidate: candidate.name, job: job.title, stage: stage.name },
      );
      return { ...application, revived: false };
    } catch (e: unknown) {
      // P2002 = 唯一约束冲突（candidateId + jobId）
      if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') {
        // 并发下两次同时加入：后到的撞唯一键，回查后按同一规则处理
        const raced = await this.prisma.application.findUnique({
          where: { candidateId_jobId: { candidateId: dto.candidateId, jobId: dto.jobId } },
          select: { id: true, status: true },
        });
        if (raced) return this.reviveOrReject(raced, candidate, job, stage, user);
      }
      throw e;
    }
  }

  /**
   * 已淘汰/已撤回的人重新进入本职位流程：复活原记录，而不是硬撞唯一键报 409。
   * 唯一键 (candidateId, jobId) 决定了「新建一条」永远不可能，所以复活是唯一可行语义；
   * 顺带保住同一条时间轴（历史面评/打分/淘汰原因都还挂在这条记录上）。
   * 仍在流程中 / 已入职：重复投递不静默丢弃，在原应聘时间轴留痕后拒绝。
   */
  private async reviveOrReject(
    existing: { id: string; status: string },
    candidate: { name: string },
    job: { title: string },
    stage: { id: string; name: string },
    user: JwtUser,
  ) {
    if (existing.status === 'REJECTED' || existing.status === 'WITHDRAWN') {
      const revived = await this.prisma.application.update({
        where: { id: existing.id },
        data: {
          status: 'ACTIVE',
          stageId: stage.id,
          position: await this.nextPosition(stage.id),
          stageEnteredAt: new Date(),
          rejectReason: null,
          version: { increment: 1 },
        },
        select: CARD_SELECT,
      });
      await this.activityLog.record(
        user,
        ACTIVITY_ACTIONS.APPLICATION_REACTIVATED,
        'Application',
        existing.id,
        { candidate: candidate.name, job: job.title, stage: stage.name, from: existing.status },
      );
      return { ...revived, revived: true };
    }
    await this.activityLog.record(user, ACTIVITY_ACTIONS.APPLICATION_REAPPLIED, 'Application', existing.id, {
      candidate: candidate.name,
      job: job.title,
      existingStatus: existing.status,
    });
    throw new ConflictException(
      existing.status === 'HIRED'
        ? '该候选人已通过此职位入职，无需重复加入'
        : '该候选人已在此职位流程中（重复投递已记录到原应聘时间轴）',
    );
  }

  /**
   * 看板数据：按阶段分组返回该职位在途 + 已入职的候选人。
   * HIRED 也一起返回：入职完成后卡片留在「入职」列并标记已入职，只查 ACTIVE 会让卡片在到达终点时消失。
   * 淘汰/撤回仍然不进看板：它们已经离开流程，在候选人详情的时间轴里查看。
   */
  async board(jobId: string, user?: JwtUser) {
    // 数据行级权限：用人经理仅可打开本部门职位的看板
    if (user) {
      // 「仅被指派」（面试官）没有职位视角：看板会暴露整条流程上所有候选人，
      // 面试官只能经由「我的面试」/候选人详情看到被指派的人
      if (isAssignedScope(user)) {
        throw new ForbiddenException('仅可查看被指派的候选人，无权打开职位看板（数据范围：仅被指派）');
      }
      const deptScope = departmentScopeOf(user);
      if (deptScope) {
        const owned = await this.prisma.job.findFirst({
          where: { id: jobId, departmentId: { in: deptScope } },
          select: { id: true },
        });
        if (!owned) throw new ForbiddenException('仅可查看本部门职位的看板（数据范围：本部门）');
      }
    }
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        stages: {
          orderBy: { order: 'asc' },
          include: {
            applications: {
              where: { status: { in: ['ACTIVE', 'HIRED'] } },
              orderBy: { position: 'asc' },
              select: { ...CARD_SELECT, interviews: CARD_INTERVIEWS },
            },
          },
        },
      },
    });
    if (!job) throw new NotFoundException('职位不存在');
    // 已离场人数：看板上一张卡都没有时，用它区分「真的还没招过人」和「招过但都淘汰了」，
    // 否则一个收了 11 份简历全部淘汰的职位会被空态文案说成「还没有候选人」
    const closedCount = await this.prisma.application.count({
      where: { jobId, status: { in: ['REJECTED', 'WITHDRAWN'] } },
    });
    return {
      job: { id: job.id, title: job.title, status: job.status },
      closedCount,
      columns: job.stages.map((stage) => ({
        stage: { id: stage.id, name: stage.name, kind: stage.kind, order: stage.order },
        applications: stage.applications.map(({ interviews, ...card }) => ({
          ...card,
          interview: stage.kind === StageKind.INTERVIEW ? interviewTag(interviews) : null,
        })),
      })),
    };
  }

  /**
   * 移动看板卡片 = 变更应聘阶段（状态迁移规则）：
   * 终态不可移动；回退必填原因；乐观锁防并发；stageEnteredAt 重置支撑停留时长统计。
   */
  async moveStage(id: string, dto: MoveStageDto, user: JwtUser) {
    const application = await this.prisma.application.findUnique({
      where: { id },
      include: { stage: true, candidate: { select: { name: true } } },
    });
    if (!application) throw new NotFoundException('应聘记录不存在');
    await this.assertJobDepartmentScope(application.jobId, user);
    if (application.status !== 'ACTIVE') {
      throw new BadRequestException('已淘汰/已入职的应聘记录不可再流转（终态不可逆，可重新激活生成新应聘）');
    }
    if (dto.expectedVersion != null && dto.expectedVersion !== application.version) {
      throw new ConflictException('该卡片刚被他人移动过，看板已刷新，请确认后重试');
    }

    const targetStage = await this.prisma.pipelineStage.findUnique({ where: { id: dto.stageId } });
    if (!targetStage || targetStage.jobId !== application.jobId) {
      throw new BadRequestException('目标阶段不属于该职位');
    }

    const isBackward = targetStage.order < application.stage.order;
    if (isBackward && !dto.reason?.trim()) {
      throw new BadRequestException('回退阶段必须填写原因（受控回退）');
    }
    // 「入职」列由候选人接受 Offer 驱动：手动拖入需要实体状态背书，否则看板和实际状态脱钩、漏斗虚报。
    // 按阶段类型判断，阶段改名不影响
    if (!isBackward && targetStage.kind === StageKind.ONBOARDING) {
      const offer = await this.prisma.offer.findUnique({
        where: { applicationId: id },
        select: { decision: true },
      });
      if (offer?.decision !== 'ACCEPTED') {
        throw new BadRequestException(`「${targetStage.name}」在候选人接受 Offer 后自动进入，请先发送 Offer`);
      }
    }

    // 无位移的拖回原列：不写库、不加版本，直接返回当前卡片
    if (targetStage.id === application.stageId) {
      return this.prisma.application.findUniqueOrThrow({ where: { id }, select: CARD_SELECT });
    }

    // 乐观锁落到写入条件里：读-写窗口内被他人抢先移动时，本次更新影响 0 行 → 409
    const result = await this.prisma.application.updateMany({
      where: {
        id,
        status: 'ACTIVE',
        ...(dto.expectedVersion != null ? { version: dto.expectedVersion } : {}),
      },
      data: {
        stageId: targetStage.id,
        position: dto.position ?? (await this.nextPosition(targetStage.id)),
        stageEnteredAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (result.count === 0) {
      throw new ConflictException('该卡片刚被他人移动过，看板已刷新，请确认后重试');
    }

    await this.activityLog.record(
      user,
      isBackward ? ACTIVITY_ACTIONS.APPLICATION_STAGE_REVERTED : ACTIVITY_ACTIONS.APPLICATION_STAGE_CHANGED,
      'Application',
      id,
      {
        candidate: application.candidate.name,
        from: application.stage.name,
        to: targetStage.name,
        fromStageId: application.stageId,
        toStageId: targetStage.id,
        toKind: targetStage.kind,
        ...(isBackward ? { reason: dto.reason } : {}),
      },
    );
    return this.prisma.application.findUniqueOrThrow({ where: { id }, select: CARD_SELECT });
  }

  /** 淘汰：原因码强制，终态 + 留痕（感谢信通道接入后在此触发延迟发送） */
  async reject(id: string, dto: RejectApplicationDto, user: JwtUser) {
    const application = await this.prisma.application.findUnique({
      where: { id },
      include: { candidate: { select: { name: true } }, job: { select: { title: true } } },
    });
    if (!application) throw new NotFoundException('应聘记录不存在');
    await this.assertJobDepartmentScope(application.jobId, user);
    if (application.status !== 'ACTIVE') throw new BadRequestException('该应聘已不在流程中');

    const updated = await this.prisma.application.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectReason: dto.reason,
        version: { increment: 1 },
      },
      select: { ...CARD_SELECT, rejectReason: true },
    });
    await this.activityLog.record(user, ACTIVITY_ACTIONS.APPLICATION_REJECTED, 'Application', id, {
      candidate: application.candidate.name,
      job: application.job.title,
      reason: dto.reason,
      note: dto.note ?? null,
    });
    return updated;
  }

  /**
   * 批量淘汰：逐条复用单卡守卫（终态检查/原因码/留痕），
   * 部分失败不回滚，返回成败明细供前端展示错误报告。
   */
  async batchReject(dto: BatchRejectDto, user: JwtUser): Promise<BatchResult> {
    return this.runBatch(dto.ids, (id) => this.reject(id, { reason: dto.reason, note: dto.note }, user));
  }

  /** 批量移动阶段：逐条复用 moveStage 全部守卫（同职位/回退原因/自动化接管列拦截/乐观锁） */
  async batchMove(dto: BatchMoveDto, user: JwtUser): Promise<BatchResult> {
    return this.runBatch(dto.ids, (id) =>
      this.moveStage(id, { stageId: dto.stageId, reason: dto.reason }, user),
    );
  }

  /**
   * 候选人对比（2-4 人并排 + AI 综合对比意见）。
   * 数据（匹配分/标签/面评）与 AI 意见分开返回：AI 永远是辅助，终审权在用人经理。
   */
  async compare(ids: string[], user: JwtUser) {
    // 服务也可能被其他入口调用，不依赖 HTTP DTO 才能拒绝错误类型。
    if (
      !Array.isArray(ids) || ids.length < 2 || ids.length > 4 ||
      ids.some((id) => typeof id !== 'string' || !id.trim())
    ) {
      throw new BadRequestException('对比需提供 2-4 个非空的应聘记录 ID');
    }
    const unique = [...new Set(ids)];
    if (unique.length !== ids.length) {
      throw new BadRequestException('对比的应聘记录 ID 不能重复');
    }
    const apps = await this.prisma.application.findMany({
      where: { id: { in: unique } },
      include: {
        candidate: { select: { id: true, name: true, tags: true, source: true } },
        job: { select: { id: true, title: true } },
        interviews: {
          include: {
            evaluations: {
              where: { submittedAt: { not: null } },
              select: { conclusion: true, comments: true, scorecard: true },
            },
          },
        },
      },
    });
    if (apps.length !== unique.length) throw new NotFoundException('部分应聘记录不存在');
    if (new Set(apps.map((a) => a.jobId)).size > 1) {
      throw new BadRequestException('仅支持同一职位内的候选人对比');
    }
    await this.assertJobDepartmentScope(apps[0].jobId, user);
    if (isAssignedScope(user)) {
      const assigned = await this.prisma.application.count({
        where: { id: { in: unique }, interviews: { some: { interviewers: { some: { userId: user.sub } } } } },
      });
      if (assigned !== unique.length) {
        throw new ForbiddenException('仅可对比被指派面试的候选人（数据范围：仅被指派）');
      }
    }

    const candidates = apps.map((a) => {
      const evaluations = a.interviews
        .flatMap((iv) => iv.evaluations)
        .map((ev) => {
          const sc = ev.scorecard as Array<{ score: number }> | null;
          const avg = sc?.length ? sc.reduce((s, x) => s + x.score, 0) / sc.length : null;
          return {
            conclusion: ev.conclusion,
            avgScore: avg != null ? Math.round(avg * 10) / 10 : null,
            comments: ev.comments,
          };
        });
      const report = a.matchReport as { highlights?: string; risks?: string } | null;
      return {
        applicationId: a.id,
        name: a.candidate.name,
        matchScore: a.matchScore,
        tags: a.candidate.tags,
        highlights: report?.highlights ?? null,
        risks: report?.risks ?? null,
        evaluations,
      };
    });

    const { data, meta } = await this.ai.compareCandidates({
      jobTitle: apps[0].job.title,
      candidates: candidates.map(({ applicationId: _id, ...rest }) => rest),
    });
    await this.activityLog.record(user, ACTIVITY_ACTIONS.CANDIDATES_COMPARED, 'Job', apps[0].job.id, {
      job: apps[0].job.title,
      candidates: candidates.map((c) => c.name),
    });
    return { jobTitle: apps[0].job.title, candidates, ai: data, aiMeta: meta };
  }


  /** 顺序执行保证列内 position 分配与留痕顺序稳定；单次上限已由 DTO 约束（≤100） */
  private async runBatch(ids: string[], op: (id: string) => Promise<unknown>): Promise<BatchResult> {
    const uniqueIds = [...new Set(ids)];
    const failed: BatchResult['failed'] = [];
    let succeeded = 0;
    for (const id of uniqueIds) {
      try {
        await op(id);
        succeeded += 1;
      } catch (error) {
        const candidate = await this.prisma.application
          .findUnique({ where: { id }, select: { candidate: { select: { name: true } } } })
          .then((a) => a?.candidate.name ?? null)
          .catch(() => null);
        failed.push({
          id,
          candidate,
          error: error instanceof Error ? error.message : '未知错误',
        });
      }
    }
    return { total: uniqueIds.length, succeeded, failed };
  }

  /**
   * 自动流转：按阶段类型移卡（约面试 → 面试、发 Offer → 录用、接受 Offer → 入职）。
   * 只向前推进，卡片已经越过目标列时不回拖；可以传入事务客户端，和触发它的状态变更一起提交。
   */
  async moveToStageKind(applicationId: string, kind: StageKind, user: JwtUser, db: Prisma.TransactionClient = this.prisma) {
    const application = await db.application.findUniqueOrThrow({
      where: { id: applicationId },
      include: { stage: true, candidate: { select: { name: true } } },
    });
    if (application.status !== 'ACTIVE') return;
    const target = await db.pipelineStage.findFirst({ where: { jobId: application.jobId, kind } });
    if (!target) {
      // 系统阶段不允许删除，正常不会走到这里；旧数据缺阶段时不中断主流程，但要留下日志
      this.logger.warn(`自动流转跳过：职位 ${application.jobId} 没有类型为 ${kind} 的阶段（应聘 ${applicationId}）`);
      return;
    }
    if (target.id === application.stageId || target.order < application.stage.order) return;
    const last = await db.application.aggregate({ where: { stageId: target.id }, _max: { position: true } });
    await db.application.update({
      where: { id: applicationId },
      data: {
        stageId: target.id,
        position: (last._max.position ?? 0) + 1,
        // 与手动移卡一致：重置停留时长起点并递增乐观锁版本
        stageEnteredAt: new Date(),
        version: { increment: 1 },
      },
    });
    await this.activityLog.recordAuto(
      user,
      ACTIVITY_ACTIONS.APPLICATION_STAGE_CHANGED,
      'Application',
      applicationId,
      {
        candidate: application.candidate.name,
        from: application.stage.name,
        to: target.name,
        fromStageId: application.stageId,
        toStageId: target.id,
        toKind: target.kind,
      },
      db,
    );
  }

  /** HR 获取 / 重新生成候选人页链接（rotate：旧链接立即失效） */
  async portalLink(id: string, user: JwtUser, rotate = false) {
    const application = await this.prisma.application.findUnique({
      where: { id },
      select: { id: true, jobId: true, status: true, candidate: { select: { name: true } } },
    });
    if (!application) throw new NotFoundException('应聘记录不存在');
    await this.assertJobDepartmentScope(application.jobId, user);
    if (application.status === 'REJECTED' || application.status === 'WITHDRAWN') {
      throw new BadRequestException('该应聘已结束，不再发放候选人页链接');
    }
    const link = await ensurePortalLink(this.prisma, id, portalExpiry(PORTAL_TTL.DEFAULT_MS), rotate);
    if (link.rotated) {
      await this.activityLog.record(user, ACTIVITY_ACTIONS.PORTAL_LINK_ROTATED, 'Application', id, {
        candidate: application.candidate.name,
      });
    }
    return { token: link.token, expiresAt: link.expiresAt };
  }

  private async nextPosition(stageId: string): Promise<number> {
    const last = await this.prisma.application.aggregate({
      where: { stageId },
      _max: { position: true },
    });
    return (last._max.position ?? 0) + 1;
  }

  /** 数据行级权限：应聘记录所属职位需落在调用者部门内（与 board() 同规则，仅 DEPARTMENT scope 生效） */
  private async assertJobDepartmentScope(jobId: string, user: JwtUser) {
    const deptScope = departmentScopeOf(user);
    if (!deptScope) return;
    const owned = await this.prisma.job.findFirst({ where: { id: jobId, departmentId: { in: deptScope } }, select: { id: true } });
    if (!owned) throw new ForbiddenException('无权操作其他部门的应聘记录（数据范围：本部门）');
  }
}
