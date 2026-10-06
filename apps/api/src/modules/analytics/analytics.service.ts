import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ACTIVITY_ACTIONS, PERMISSIONS } from '@hireflow/shared';
import { pendingScreeningWhere } from '../candidates/candidates.service';
import { departmentScopeOf, inDepartmentScope } from '../../common/data-scope';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { AiService } from '../ai/ai.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type { QueryInsightsDto } from './dto/query-insights.dto';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  /**
   * 报表侧的行级范围：用人经理（DEPARTMENT）只统计本部门职位的应聘。
   * 看板/候选人/Offer 都按部门收紧，报表若不收紧，同一批数据换个端点就全公司可见
   * （TTH、渠道效能、面试官姓名 + 通过率偏离度都在里面）。
   */
  private deptScopeOf(user: JwtUser): string[] | null {
    return departmentScopeOf(user);
  }

  /** 待办事项聚合 To-Do Center */
  async todos(user: JwtUser) {
    const now = new Date();
    // 用人经理（本部门）：各计数与对应列表页同口径，只算本部门职位；
    // 否则大盘提示「待审批 1」而录用管理页里一条都找不到
    const dept = this.deptScopeOf(user);
    const appScope = dept ? { application: { job: { departmentId: { in: dept } } } } : {};
    // 待处理新简历：按人计（与候选人列表「待初筛」筛选同口径，点进去看到的人数一致）；
    // 无 job:read 的角色如 IT/新员工不该看到这个数字
    const newResumes = user.permissions.includes(PERMISSIONS.JOB_READ)
      ? await this.prisma.candidate.count({ where: pendingScreeningWhere(dept) })
      : null;
    // 我的待提交面评：我被指派、面试时间已过、且我尚未提交评价
    const myPendingEvaluations = await this.prisma.interview.count({
      where: {
        status: { not: 'CANCELED' },
        scheduledAt: { lte: now },
        interviewers: { some: { userId: user.sub } },
        evaluations: { none: { interviewerId: user.sub } },
      },
    });
    const pendingOffers = user.permissions.includes(PERMISSIONS.OFFER_APPROVE)
      ? await this.prisma.offer.count({ where: { approvalStatus: 'PENDING', ...appScope } })
      : null;
    // Offer 双待办：通知会被刷走，待办卡才是工作驱动
    const canInitiate = user.permissions.includes(PERMISSIONS.OFFER_INITIATE);
    const rejectedOffers = canInitiate
      ? await this.prisma.offer.count({ where: { approvalStatus: 'REJECTED', ...appScope } })
      : null;
    const offersDue = canInitiate
      ? await this.prisma.offer.count({
          where: {
            ...appScope,
            OR: [
              { approvalStatus: 'EXPIRED', extendedOnce: false }, // 已失效可续期
              {
                approvalStatus: 'SENT',
                decision: null,
                expiresAt: { lte: new Date(now.getTime() + 24 * 3600 * 1000) }, // 24h 内到期
              },
            ],
          },
        })
      : null;
    const canReadOnboarding = user.permissions.includes(PERMISSIONS.ONBOARDING_READ);
    const onboardingInProgress = canReadOnboarding
      ? await this.prisma.onboarding.count({ where: { status: 'IN_PROGRESS', ...appScope } })
      : null;
    // 待人工核对材料（低置信度阻断）：documents 为 JSON 数组，量小直接内存过滤
    // 「材料待核对」是 HR 的活：IT 看不到证件内容，这个数字对他没有意义
    const docsNeedReview = user.permissions.includes(PERMISSIONS.ONBOARDING_MANAGE)
      ? await this.prisma.onboarding
          .findMany({ where: { status: 'IN_PROGRESS', ...appScope }, select: { documents: true } })
          .then((inProgress) =>
            inProgress.reduce((sum, o) => {
              const docs = (o.documents as Array<{ needsReview?: boolean }> | null) ?? [];
              return sum + docs.filter((d) => d.needsReview).length;
            }, 0),
          )
      : null;
    return {
      newResumes,
      myPendingEvaluations,
      pendingOffers,
      rejectedOffers,
      offersDue,
      onboardingInProgress,
      docsNeedReview,
    };
  }

  /** 大盘总览指标。pausedJobs 单列：满编自动暂停后「招聘中 0」需要有解释 */
  async overview(user: JwtUser) {
    const now = new Date();
    const dept = this.deptScopeOf(user);
    const jobWhere = dept ? { departmentId: { in: dept } } : {};
    const appJobWhere = dept ? { job: { departmentId: { in: dept } } } : {};
    const [openJobs, pausedJobs, candidates, upcomingInterviews, hired] = await this.prisma.$transaction([
      this.prisma.job.count({ where: { ...jobWhere, status: 'OPEN' } }),
      this.prisma.job.count({ where: { ...jobWhere, status: 'PAUSED' } }),
      this.prisma.candidate.count(dept ? { where: { applications: { some: appJobWhere } } } : undefined),
      this.prisma.interview.count({
        where: { status: 'SCHEDULED', scheduledAt: { gte: now }, ...(dept ? { application: appJobWhere } : {}) },
      }),
      this.prisma.application.count({ where: { status: 'HIRED', ...appJobWhere } }),
    ]);
    return { openJobs, pausedJobs, candidates, upcomingInterviews, hired };
  }

  /**
   * 招聘漏斗：
   * 「到达过某阶段」按 ActivityLog 回放真实历史，而不是拿当前停留人数做后缀和——
   * 后者会把淘汰/撤回的人整个丢掉，导致每一级转化率恒等于 100%（全员淘汰的职位则一片空白），
   * 漏斗最该回答的「卡在哪一环」反而看不出来。回放口径与阶段停留 P50/P90 一致（见 insights）。
   * current 仍是快照：停留在该阶段的在途 + 末列已入职。
   */
  async funnel(jobId: string, user: JwtUser) {
    const dept = this.deptScopeOf(user);
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
    if (!job) throw new NotFoundException('职位不存在');
    // 与看板同规则：用人经理只看本部门职位的漏斗
    if (dept && !inDepartmentScope(dept, job.departmentId)) {
      throw new ForbiddenException('仅可查看本部门职位的漏斗（数据范围：本部门）');
    }

    const apps = await this.prisma.application.findMany({
      where: { jobId },
      select: { id: true, stageId: true, status: true },
    });
    const stageIndexById = new Map(job.stages.map((s, i) => [s.id, i]));
    const stageIndexByName = new Map(job.stages.map((s, i) => [s.name, i]));
    const lastIndex = job.stages.length - 1;

    // 当前停留：中间列只计 ACTIVE（淘汰/撤回已离开漏斗），末列以 status=HIRED 为准
    const counts = job.stages.map(() => 0);
    for (const a of apps) {
      const i = stageIndexById.get(a.stageId);
      if (i == null) continue;
      if (a.status === 'ACTIVE' || (a.status === 'HIRED' && i === lastIndex)) counts[i] += 1;
    }

    // 到达过：每条应聘的最深足迹 = max(建档落首列 0, 当前所在列, 历史流转日志里所有 payload.to)
    const events = await this.prisma.activityLog.findMany({
      where: {
        action: { in: [ACTIVITY_ACTIONS.APPLICATION_STAGE_CHANGED, ACTIVITY_ACTIONS.APPLICATION_STAGE_REVERTED] },
        entityId: { in: apps.map((a) => a.id) },
      },
      select: { entityId: true, payload: true },
    });
    const deepest = new Map<string, number>();
    for (const a of apps) deepest.set(a.id, stageIndexById.get(a.stageId) ?? 0);
    for (const ev of events) {
      if (!ev.entityId) continue;
      const to = (ev.payload as { to?: string } | null)?.to;
      const i = to ? stageIndexByName.get(to) : undefined;
      if (i == null) continue; // 阶段被改名/删除后的历史日志：对不上就不计，不猜
      deepest.set(ev.entityId, Math.max(deepest.get(ev.entityId) ?? 0, i));
    }
    const reached = job.stages.map(
      (_, i) => [...deepest.values()].filter((d) => d >= i).length,
    );

    return {
      job: { id: job.id, title: job.title },
      stages: job.stages.map((stage, i) => ({
        id: stage.id,
        name: stage.name,
        /** 当前停留人数 */
        current: counts[i],
        /** 历史上到达过该阶段（含之后阶段）的人数 */
        reached: reached[i],
        /**
         * 相对上一阶段的转化率（0-1，首阶段为 null）。分母只算上一阶段「已有结果」的人：
         * 还停在上一阶段的在途者（如 Offer 待审批）既没转化也没流失，算进去会把进行中的流程误判成流失。
         */
        conversion: (() => {
          if (i === 0) return null;
          const decided = reached[i - 1] - counts[i - 1];
          return decided > 0 ? Math.min(1, reached[i] / decided) : null;
        })(),
      })),
    };
  }

  /** AI 招聘健康度诊断 */
  async insight(jobId: string, user: JwtUser) {
    const funnel = await this.funnel(jobId, user);
    const { data, meta } = await this.ai.funnelInsight({
      jobTitle: funnel.job.title,
      stages: funnel.stages.map((s) => ({ name: s.name, count: s.reached })),
    });
    return { insight: data, aiMeta: meta };
  }

  /**
   * 近 N 周投递/入职趋势（大盘折线图）：
   * 投递 = Application.createdAt；入职 = onboarding.completed 留痕（与 TTH 口径一致）。
   * 周一为周起点；当前数据量级直接内存分桶。
   */
  async trend(user: JwtUser, weeks = 8) {
    const dept = this.deptScopeOf(user);
    const WEEK = 7 * 86_400_000;
    const now = new Date();
    const dayOfWeek = (now.getDay() + 6) % 7; // 周一=0
    const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
    const start = new Date(thisMonday.getTime() - (weeks - 1) * WEEK);

    // onboarding.completed 留痕的 entityId 是 Application id，部门收紧时先取本部门应聘 id 再回查留痕
    const scopedAppIds = dept
      ? (
          await this.prisma.application.findMany({
            where: { job: { departmentId: { in: dept } } },
            select: { id: true },
          })
        ).map((a) => a.id)
      : null;
    const [apps, completions] = await Promise.all([
      this.prisma.application.findMany({
        where: { createdAt: { gte: start }, ...(dept ? { job: { departmentId: { in: dept } } } : {}) },
        select: { createdAt: true },
      }),
      this.prisma.activityLog.findMany({
        where: {
          action: 'onboarding.completed',
          createdAt: { gte: start },
          ...(scopedAppIds ? { entityId: { in: scopedAppIds } } : {}),
        },
        select: { createdAt: true },
      }),
    ]);

    const label = (d: Date) =>
      `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const points = Array.from({ length: weeks }, (_, i) => ({
      week: label(new Date(start.getTime() + i * WEEK)),
      applied: 0,
      hired: 0,
    }));
    const bucketOf = (d: Date) =>
      Math.min(weeks - 1, Math.max(0, Math.floor((d.getTime() - start.getTime()) / WEEK)));
    for (const a of apps) points[bucketOf(a.createdAt)].applied += 1;
    for (const c of completions) points[bucketOf(c.createdAt)].hired += 1;
    return { weeks, start: start.toISOString(), points };
  }

  /**
   * 数据洞察（全部基于 Application 状态机事件计算）：
   * TTH 中位数 / 渠道效能 / Offer 接受率 / 面试官效能 / 毁约率 / 阶段停留 P50-P90（ActivityLog 回放）。
   * 当前数据量级直接内存聚合；上量后迁移为物化视图或定时汇总表。
   *
   * 筛选口径：按「应聘创建时间」划同期群（cohort），而不是按事件发生时间。
   * 理由是 TTH、阶段停留这类指标本身横跨多个周期——若按事件时间切，
   * 同一个候选人的入口和出口会落进不同区间，各图之间不再可比。
   * 同期群口径下所有指标回答的是同一个问题：「这批进入流程的人表现如何」。
   *
   * 五组指标（TTH / 渠道 / Offer / 面试官 / 阶段停留）共用下面这一个 scope，
   * 不允许只过滤其中一部分——那会让四张图的分母互相对不上。
   */
  async insights(query: QueryInsightsDto = {}, user?: JwtUser) {
    const DAY = 86_400_000;
    const { range = 'all' } = query;
    // 行级范围优先于查询参数：用人经理传任何 deptId 都被本部门覆盖，不是「默认值」而是上限
    const forcedDept = user ? this.deptScopeOf(user) : null;
    // 查询参数是 HR 的单部门筛选；经理的范围是本部门子树
    const deptIds = forcedDept ?? (query.deptId ? [query.deptId] : null);

    const rangeStart = (() => {
      const now = new Date();
      if (range === '30d') return new Date(now.getTime() - 30 * 86_400_000);
      if (range === 'quarter') return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      if (range === 'year') return new Date(now.getFullYear(), 0, 1);
      return null;
    })();

    const appWhere: Prisma.ApplicationWhereInput = {
      ...(rangeStart ? { createdAt: { gte: rangeStart } } : {}),
      ...(deptIds ? { job: { departmentId: { in: deptIds } } } : {}),
    };

    /** 同期群内的应聘；stageStay 需要按 id 反查留痕，顺带复用它的 createdAt */
    const scopedApps = await this.prisma.application.findMany({
      where: appWhere,
      select: { id: true, createdAt: true },
    });
    const scopedIds = scopedApps.map((a) => a.id);

    const median = (nums: number[]) => {
      if (nums.length === 0) return null;
      const s = [...nums].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    };
    const percentile = (nums: number[], p: number) => {
      if (nums.length === 0) return null;
      const s = [...nums].sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
    };
    const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

    // ---- TTH：Application 创建 → 入职闭环（onboarding.completed 留痕时间，兜底 updatedAt） ----
    const hired = await this.prisma.application.findMany({
      where: { ...appWhere, status: 'HIRED' },
      select: { id: true, createdAt: true, updatedAt: true, job: { select: { title: true } } },
    });
    const completions = await this.prisma.activityLog.findMany({
      where: { action: 'onboarding.completed', entityId: { in: hired.map((h) => h.id) } },
      select: { entityId: true, createdAt: true },
    });
    const completedAt = new Map(completions.map((c) => [c.entityId, c.createdAt]));
    const tthByJob = new Map<string, number[]>();
    const tthAll: number[] = [];
    for (const h of hired) {
      const days = ((completedAt.get(h.id) ?? h.updatedAt).getTime() - h.createdAt.getTime()) / DAY;
      tthAll.push(days);
      tthByJob.set(h.job.title, [...(tthByJob.get(h.job.title) ?? []), days]);
    }

    // ---- 渠道效能：投递 / 进面 / Offer / 接受 / 入职（首次有效渠道 = candidate.source） ----
    const apps = await this.prisma.application.findMany({
      where: appWhere,
      select: {
        status: true,
        candidate: { select: { source: true } },
        interviews: { select: { id: true }, take: 1 },
        offer: { select: { sentAt: true, decision: true } },
      },
    });
    const channelMap = new Map<
      string,
      { applied: number; interviewed: number; offered: number; accepted: number; hired: number }
    >();
    for (const a of apps) {
      const key = a.candidate.source ?? '未知渠道';
      const c = channelMap.get(key) ?? { applied: 0, interviewed: 0, offered: 0, accepted: 0, hired: 0 };
      c.applied += 1;
      if (a.interviews.length > 0) c.interviewed += 1;
      if (a.offer?.sentAt) c.offered += 1;
      if (a.offer?.decision === 'ACCEPTED') c.accepted += 1;
      if (a.status === 'HIRED') c.hired += 1;
      channelMap.set(key, c);
    }

    // ---- Offer 接受率（分母 = 已发出；撤回场景暂无独立状态，后续议价流程补充口径） ----
    const sentOffers = await this.prisma.offer.findMany({
      where: { sentAt: { not: null }, application: appWhere },
      select: { decision: true, application: { select: { status: true } } },
    });
    const acceptedCount = sentOffers.filter((o) => o.decision === 'ACCEPTED').length;
    // ---- 毁约率：接受 Offer 后（待入职语义）应聘被撤回 ----
    const renegeCount = sentOffers.filter(
      (o) => o.decision === 'ACCEPTED' && o.application.status === 'WITHDRAWN',
    ).length;

    // ---- 面试官效能：面评及时率（24h SLA）+ 结论通过率与全局均值偏离 ----
    const evals = await this.prisma.evaluation.findMany({
      where: { submittedAt: { not: null }, interview: { application: appWhere } },
      select: {
        conclusion: true,
        submittedAt: true,
        interviewer: { select: { id: true, name: true } },
        interview: { select: { scheduledAt: true } },
      },
    });
    const isPass = (c: string | null) => c === 'YES' || c === 'STRONG_YES';
    const overallPassRate = evals.length
      ? evals.filter((e) => isPass(e.conclusion)).length / evals.length
      : 0;
    const interviewerMap = new Map<
      string,
      { name: string; total: number; onTime: number; pass: number }
    >();
    for (const e of evals) {
      const cur =
        interviewerMap.get(e.interviewer.id) ?? { name: e.interviewer.name, total: 0, onTime: 0, pass: 0 };
      cur.total += 1;
      if (
        !e.interview.scheduledAt ||
        (e.submittedAt && e.submittedAt.getTime() - e.interview.scheduledAt.getTime() <= DAY)
      ) {
        cur.onTime += 1;
      }
      if (isPass(e.conclusion)) cur.pass += 1;
      interviewerMap.set(e.interviewer.id, cur);
    }

    // ---- 阶段停留 P50/P90：ActivityLog 回放（进入时间 → 离开时间），精确口径而非快照 ----
    const stageEvents = await this.prisma.activityLog.findMany({
      where: {
        action: { in: ['application.stage_changed', 'application.stage_reverted'] },
        entityId: { in: scopedIds },
      },
      orderBy: { createdAt: 'asc' },
      select: { entityId: true, createdAt: true, payload: true },
    });
    const appCreated = new Map(scopedApps.map((a) => [a.id, a.createdAt]));
    const byApp = new Map<string, Array<{ at: Date; from: string; to: string }>>();
    for (const ev of stageEvents) {
      const p = ev.payload as { from?: string; to?: string } | null;
      if (!p?.from || !p?.to || !ev.entityId) continue;
      byApp.set(ev.entityId, [
        ...(byApp.get(ev.entityId) ?? []),
        { at: ev.createdAt, from: p.from, to: p.to },
      ]);
    }
    const stayByStage = new Map<string, number[]>();
    for (const [appId, events] of byApp) {
      let enteredAt = appCreated.get(appId);
      for (const ev of events) {
        if (enteredAt) {
          const days = (ev.at.getTime() - enteredAt.getTime()) / DAY;
          stayByStage.set(ev.from, [...(stayByStage.get(ev.from) ?? []), days]);
        }
        enteredAt = ev.at; // 进入 ev.to 的时间
      }
    }

    return {
      /** 回显实际生效的口径与样本量：前端可据此提示「本区间样本过少」而不是干画一张空图 */
      scope: {
        range,
        // 回显筛选的根部门（经理为本部门；实际统计含其下级部门）
        deptId: forcedDept ? (user?.departmentId ?? null) : (query.deptId ?? null),
        since: rangeStart?.toISOString() ?? null,
        applications: scopedApps.length,
      },
      tth: {
        medianDays: round1(median(tthAll)),
        hiredCount: hired.length,
        byJob: [...tthByJob.entries()].map(([title, days]) => ({
          jobTitle: title,
          medianDays: round1(median(days)),
          hired: days.length,
        })),
      },
      offer: {
        sent: sentOffers.length,
        accepted: acceptedCount,
        acceptRate: sentOffers.length ? round1((acceptedCount / sentOffers.length) * 100) : null,
        renegeCount,
        renegeRate: acceptedCount ? round1((renegeCount / acceptedCount) * 100) : null,
      },
      channels: [...channelMap.entries()]
        .map(([source, c]) => ({
          source,
          ...c,
          interviewRate: c.applied ? round1((c.interviewed / c.applied) * 100) : null,
          hireRate: c.applied ? round1((c.hired / c.applied) * 100) : null,
        }))
        .sort((a, b) => b.applied - a.applied),
      interviewers: [...interviewerMap.values()]
        .map((i) => ({
          name: i.name,
          evaluations: i.total,
          onTimeRate: round1((i.onTime / i.total) * 100),
          passRate: round1((i.pass / i.total) * 100),
          passRateDeviation: round1(((i.pass / i.total) - overallPassRate) * 100),
        }))
        .sort((a, b) => b.evaluations - a.evaluations),
      overallPassRate: round1(overallPassRate * 100),
      stageStay: [...stayByStage.entries()].map(([stage, days]) => ({
        stage,
        samples: days.length,
        p50Days: round1(percentile(days, 50)),
        p90Days: round1(percentile(days, 90)),
      })),
    };
  }
}
