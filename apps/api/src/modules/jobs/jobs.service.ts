import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ACTIVITY_ACTIONS, DEFAULT_PIPELINE_STAGES, StageKind, SYSTEM_STAGE_KINDS } from '@hireflow/shared';
import { mapWithConcurrency } from '../../common/concurrency';
import { departmentScopeOf, inDepartmentScope, isAssignedScope } from '../../common/data-scope';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import type { Prisma } from '../../generated/prisma/client';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { AiService } from '../ai/ai.service';
import { ApplicationsService } from '../applications/applications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateJobDto } from './dto/create-job.dto';
import { QueryJobsDto } from './dto/query-jobs.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { UpdateStagesDto } from './dto/update-stages.dto';

/** 人才库唤醒：候选池上限（粗排是纯本地计算，可以多扫一些） */
const TALENT_POOL_SCAN_LIMIT = 40;
/** 粗排后只把前 N 名交给大模型精排：控 token 成本，也让结果在前端超时之前回来 */
export const TALENT_POOL_AI_TOP = 10;
/** 同时在途的大模型请求数（AiService 另有全局上限，这里再收一道，避免一次扫描占满全局配额） */
export const TALENT_POOL_CONCURRENCY = 3;
/** 整体时间预算：超过后剩余候选人不再发起新的模型请求（已在途的仍受单次截止时间约束） */
export const TALENT_POOL_BUDGET_MS = 45_000;

/** 粗排分：候选人标签在职位文本里出现的个数（大小写不敏感）。零成本，只用于决定谁值得花 token 精排 */
export function coarseTagScore(tags: string[], jobText: string): number {
  const text = jobText.toLowerCase();
  return tags.filter((t) => t && text.includes(t.toLowerCase())).length;
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly ai: AiService,
    private readonly applications: ApplicationsService,
  ) {}

  async list(query: QueryJobsDto, user?: JwtUser) {
    const { page = 1, pageSize = 20, keyword, status } = query;
    // 空字符串不是「不筛选」：?? 不会把它当成缺省，后面的真值判断又会整段丢掉部门条件，
    // 本部门账号就能用 ?departmentId= 看到全部职位。空白一律视为未传。
    const departmentId = query.departmentId?.trim() || undefined;
    // 数据行级权限：用人经理仅本部门职位
    const deptScope = user ? departmentScopeOf(user) : null;
    const empty = {
      total: 0,
      page,
      pageSize,
      items: [] as Array<never>,
      summary: { open: 0, draft: 0, headcount: 0, hcUsed: 0, inFlow: 0 },
    };
    // 显式选了范围外的部门：空结果，不把汇总放宽到其他部门
    if (departmentId && !inDepartmentScope(deptScope, departmentId)) return empty;

    const departmentFilter = departmentId ?? (deptScope ? { in: deptScope } : undefined);
    // 汇总跟搜索、部门、数据范围走，但不跟状态页签和分页走。
    // 页签是在同一批职位里切片；若汇总也跟着切片，第一页的「招聘中 / HC 总量」
    // 会小于大盘的在招职位，新建一条职位还可能把编制更大的旧职位挤出本页，总数不升反降。
    const summaryWhere: Prisma.JobWhereInput = {
      ...(keyword ? { title: { contains: keyword, mode: 'insensitive' } } : {}),
      ...(departmentFilter ? { departmentId: departmentFilter } : {}),
    };
    const where: Prisma.JobWhereInput = {
      ...summaryWhere,
      ...(status ? { status } : {}),
    };
    const [total, items, open, draft, headcountAgg, hcUsed, inFlow] = await this.prisma.$transaction([
      this.prisma.job.count({ where }),
      this.prisma.job.findMany({
        where,
        include: {
          department: { select: { id: true, name: true } },
          hiringManager: { select: { id: true, name: true } },
          _count: { select: { applications: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.job.count({ where: { ...summaryWhere, status: 'OPEN' } }),
      this.prisma.job.count({ where: { ...summaryWhere, status: 'DRAFT' } }),
      this.prisma.job.aggregate({ where: summaryWhere, _sum: { headcount: true } }),
      this.prisma.application.count({
        where: {
          job: summaryWhere,
          OR: [{ status: 'HIRED' }, { status: 'ACTIVE', offer: { decision: 'ACCEPTED' } }],
        },
      }),
      this.prisma.application.count({ where: { job: summaryWhere } }),
    ]);
    // HC 占用：已入职 + 已接受 Offer 的在途者（行内进度条仍按本页职位算）
    const usage = items.length
      ? await this.prisma.application.groupBy({
          by: ['jobId'],
          where: {
            jobId: { in: items.map((j) => j.id) },
            OR: [{ status: 'HIRED' }, { status: 'ACTIVE', offer: { decision: 'ACCEPTED' } }],
          },
          _count: { _all: true },
        })
      : [];
    const usageMap = new Map(usage.map((u) => [u.jobId, u._count._all]));
    const summary = {
      open,
      draft,
      headcount: headcountAgg._sum.headcount ?? 0,
      hcUsed,
      inFlow,
    };
    return {
      total,
      page,
      pageSize,
      summary,
      items: items.map((job) => ({ ...job, hcUsed: usageMap.get(job.id) ?? 0 })),
    };
  }

  /** HC 占用数：已入职 + 已接受 Offer 在途（预占/正式占用的简化口径） */
  async hcUsed(jobId: string): Promise<number> {
    return this.prisma.application.count({
      where: {
        jobId,
        OR: [{ status: 'HIRED' }, { status: 'ACTIVE', offer: { decision: 'ACCEPTED' } }],
      },
    });
  }

  /** 创建职位并生成默认 Pipeline 阶段（骨架期直接置为 OPEN，审批流三期接入） */
  async create(dto: CreateJobDto, user: JwtUser) {
    await this.assertDepartmentInScope(dto.departmentId, user);
    if (dto.hiringManagerId) {
      await this.assertManagerActive(dto.hiringManagerId);
    }
    const job = await this.prisma.job.create({
      data: {
        title: dto.title,
        departmentId: dto.departmentId,
        hiringManagerId: dto.hiringManagerId,
        description: dto.description,
        requirement: dto.requirement,
        headcount: dto.headcount ?? 1,
        status: 'OPEN',
        createdById: user.sub,
        stages: {
          create: DEFAULT_PIPELINE_STAGES.map((stage, index) => ({ name: stage.name, kind: stage.kind, order: index })),
        },
      },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
    await this.activityLog.record(user, ACTIVITY_ACTIONS.JOB_CREATED, 'Job', job.id, {
      title: job.title,
    });
    return job;
  }

  async findOne(id: string, user?: JwtUser) {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: {
        department: { select: { id: true, name: true } },
        hiringManager: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        stages: { orderBy: { order: 'asc' }, include: { _count: { select: { applications: true } } } },
        _count: { select: { applications: true } },
      },
    });
    if (!job) throw new NotFoundException('职位不存在');
    this.assertJobInDeptScope(job, user);
    return job;
  }

  private async assertManagerActive(hiringManagerId: string) {
    const manager = await this.prisma.user.findUnique({ where: { id: hiringManagerId }, select: { status: true } });
    if (!manager) throw new BadRequestException('用人经理不存在');
    if (manager.status !== 'ACTIVE') throw new BadRequestException('该用人经理账号已停用，请改选在职成员');
  }

  async update(id: string, dto: UpdateJobDto, user: JwtUser) {
    const existing = await this.prisma.job.findUnique({ where: { id }, select: { departmentId: true } });
    if (!existing) throw new NotFoundException('职位不存在');
    this.assertJobInDeptScope(existing, user);
    if (dto.departmentId !== undefined) await this.assertDepartmentInScope(dto.departmentId, user);
    if (dto.hiringManagerId) await this.assertManagerActive(dto.hiringManagerId);
    const { scorecardTemplate, ...rest } = dto;
    const job = await this.prisma.job.update({
      where: { id },
      data: {
        ...rest,
        // Json 列需显式转换（DTO 类实例缺 index signature）
        ...(scorecardTemplate !== undefined
          ? { scorecardTemplate: scorecardTemplate as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    await this.activityLog.record(user, ACTIVITY_ACTIONS.JOB_UPDATED, 'Job', id, {
      ...dto,
    } as unknown as Prisma.InputJsonValue);
    return job;
  }

  /**
   * 删除职位。沿用部门删除的口径：有关联数据就拒绝，不做级联。
   * 职位一旦有人投递，其 Pipeline、面试、Offer 全挂在应聘记录上，级联删会把招聘留痕一并抹掉；
   * 想让职位下线用「关闭」状态，删除只留给建错了的空职位。
   */
  async remove(id: string, user: JwtUser) {
    const job = await this.prisma.job.findUnique({
      where: { id },
      select: { id: true, title: true, departmentId: true, _count: { select: { applications: true } } },
    });
    if (!job) throw new NotFoundException('职位不存在');
    this.assertJobInDeptScope(job, user);
    if (job._count.applications > 0) {
      throw new BadRequestException(
        `该职位下还有 ${job._count.applications} 条应聘记录，不能删除。如需下线请把状态改为「已关闭」`,
      );
    }
    // Pipeline 阶段是职位的从属数据，且上面已确认无人投递，随职位一起清掉
    await this.prisma.pipelineStage.deleteMany({ where: { jobId: id } });
    await this.prisma.job.delete({ where: { id } });
    await this.activityLog.record(user, ACTIVITY_ACTIONS.JOB_DELETED, 'Job', id, { title: job.title });
    return { ok: true };
  }

  async getStages(jobId: string, user?: JwtUser) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, select: { departmentId: true } });
    if (!job) throw new NotFoundException('职位不存在');
    this.assertJobInDeptScope(job, user);
    return this.prisma.pipelineStage.findMany({
      where: { jobId },
      orderBy: { order: 'asc' },
      include: { _count: { select: { applications: true } } },
    });
  }

  /**
   * 全量更新职位的阶段：传入有 id 的做改名/排序，无 id 的新增为自定义阶段；未出现的自定义阶段删除。
   */
  async updateStages(jobId: string, dto: UpdateStagesDto, user: JwtUser) {
    // 写入与读取遵守同一部门范围；功能权限仍由控制器守卫校验。
    const existing = await this.getStages(jobId, user);
    const existingIds = new Set(existing.map((s) => s.id));
    const incomingIds = new Set(dto.stages.filter((s) => s.id).map((s) => s.id as string));

    if (incomingIds.size !== dto.stages.filter((s) => s.id).length) {
      throw new BadRequestException('同一阶段不能重复提交');
    }

    for (const item of dto.stages) {
      if (item.id && !existingIds.has(item.id)) {
        throw new BadRequestException(`阶段 ${item.id} 不属于该职位`);
      }
    }

    const toDelete = existing.filter((s) => !incomingIds.has(s.id));
    // 系统阶段（筛选 / 面试 / 录用 / 入职）驱动自动流转：可以改名、不能删除，先后顺序也不能打乱
    const systemDeleted = toDelete.filter((s) => s.kind !== StageKind.CUSTOM);
    if (systemDeleted.length > 0) {
      throw new BadRequestException(`「${systemDeleted.map((s) => s.name).join('、')}」是系统阶段，可以改名但不能删除`);
    }
    const kindById = new Map(existing.map((s) => [s.id, s.kind]));
    const systemOrder = dto.stages
      .map((item) => (item.id ? kindById.get(item.id) : undefined))
      .filter((k): k is StageKind => Boolean(k) && k !== StageKind.CUSTOM);
    if (systemOrder.some((k, i) => SYSTEM_STAGE_KINDS.indexOf(k as (typeof SYSTEM_STAGE_KINDS)[number]) !== i)) {
      throw new BadRequestException('系统阶段的先后顺序固定为：筛选 → 面试 → 录用 → 入职，自定义阶段可以插在它们之间');
    }
    if (toDelete.length > 0) {
      const blocked = await this.prisma.application.count({
        where: { stageId: { in: toDelete.map((s) => s.id) } },
      });
      if (blocked > 0) {
        throw new BadRequestException('待删除的阶段中仍有候选人，请先移出后再删除');
      }
    }

    await this.prisma.$transaction([
      this.prisma.pipelineStage.deleteMany({ where: { id: { in: toDelete.map((s) => s.id) } } }),
      ...dto.stages.map((item, index) =>
        item.id
          ? this.prisma.pipelineStage.update({
              where: { id: item.id },
              data: { name: item.name, order: index },
            })
          : this.prisma.pipelineStage.create({ data: { jobId, name: item.name, order: index } }),
      ),
    ]);

    await this.activityLog.record(user, ACTIVITY_ACTIONS.STAGES_UPDATED, 'Job', jobId, {
      stages: dto.stages.map((s) => s.name),
    });
    return this.getStages(jobId, user);
  }

  /**
   * 人才库唤醒：历史淘汰/撤回候选人 × 本职位 JD 重新 AI 打分，推荐 Top 10。
   * 复用现有 scoreMatch 引擎；候选池按最近更新取前 N 控制 Token 成本。
   */
  async talentPoolScan(jobId: string, user: JwtUser) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('职位不存在');
    this.assertJobInDeptScope(job, user);

    // 与候选人列表保持相同范围；共享候选人只要有范围内的应聘即视为可见。
    const deptScope = departmentScopeOf(user);
    let candidateScope: Prisma.CandidateWhereInput = {};
    if (deptScope) {
      candidateScope = { applications: { some: { job: { departmentId: { in: deptScope } } } } };
    } else if (isAssignedScope(user)) {
      candidateScope = {
        applications: {
          some: { interviews: { some: { interviewers: { some: { userId: user.sub } } } } },
        },
      };
    }

    // 候选池：有淘汰/撤回记录的候选人，排除已在本职位在途/已入职的（避免重复推荐）
    const pool = await this.prisma.candidate.findMany({
      where: {
        AND: [candidateScope],
        applications: { some: { status: { in: ['REJECTED', 'WITHDRAWN'] } } },
        NOT: { applications: { some: { jobId, status: { in: ['ACTIVE', 'HIRED'] } } } },
      },
      include: {
        resumes: { orderBy: { createdAt: 'desc' }, take: 1 },
        applications: {
          where: { status: { in: ['REJECTED', 'WITHDRAWN'] } },
          orderBy: { updatedAt: 'desc' },
          take: 1,
          include: { job: { select: { title: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: TALENT_POOL_SCAN_LIMIT,
    });

    // 两段式：先按标签粗排（本地、零成本），只对前 N 名调用大模型精排；并发受限，整体有时间预算
    const jobText = [job.title, job.description ?? '', job.requirement ?? ''].join('\n');
    const evaluable = pool
      .map((candidate, i) => ({ candidate, i, coarse: coarseTagScore(candidate.tags, jobText) }))
      .filter(({ candidate }) => {
        const resume = candidate.resumes[0];
        return Boolean(resume?.rawText || resume?.parsed || candidate.tags.length);
      })
      .sort((a, b) => b.coarse - a.coarse || a.i - b.i)
      .slice(0, TALENT_POOL_AI_TOP);

    const startedAt = Date.now();
    const settled = await mapWithConcurrency(
      evaluable,
      TALENT_POOL_CONCURRENCY,
      async ({ candidate }) => {
        const resume = candidate.resumes[0];
        const resumeText = resume?.rawText ?? (resume?.parsed ? JSON.stringify(resume.parsed) : '');
        const { data, meta } = await this.ai.scoreMatch({
          jobTitle: job.title,
          jobDescription: job.description ?? '',
          jobRequirement: job.requirement ?? '',
          resumeText,
          candidateTags: candidate.tags,
        });
        const last = candidate.applications[0];
        return {
          candidate: {
            id: candidate.id,
            name: candidate.name,
            tags: candidate.tags,
            source: candidate.source,
          },
          score: data.score,
          hits: data.hits.slice(0, 4),
          highlights: data.highlights,
          aiMeta: meta,
          // 降级（规则引擎）打的分和大模型不是一个口径：单独标出，排在大模型结果之后，不混排
          ranked: !meta.degraded,
          lastApplication: last
            ? {
                jobTitle: last.job.title,
                status: last.status,
                rejectReason: last.rejectReason,
                updatedAt: last.updatedAt,
              }
            : null,
        };
      },
      () => Date.now() - startedAt < TALENT_POOL_BUDGET_MS,
    );
    let skipped = 0;
    const scored = settled.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      if (r.status === 'skipped') {
        skipped++;
        return null;
      }
      this.logger.warn(
        `人才库唤醒打分失败（候选人 ${evaluable[i].candidate.id}）：${r.reason instanceof Error ? r.reason.message : r.reason}`,
      );
      return null;
    });
    const ok = scored.filter((r): r is NonNullable<typeof r> => r !== null);
    const byScore = (a: { score: number }, b: { score: number }) => b.score - a.score;
    const recommendations = [
      ...ok.filter((r) => r.ranked).sort(byScore),
      ...ok.filter((r) => !r.ranked).sort(byScore),
    ].slice(0, 10);
    const degraded = ok.filter((r) => !r.ranked).length;

    await this.activityLog.record(user, ACTIVITY_ACTIONS.TALENT_POOL_SCANNED, 'Job', jobId, {
      job: job.title,
      scanned: pool.length,
      aiScored: evaluable.length - skipped,
      recommended: recommendations.length,
      degraded,
    });
    return {
      job: { id: job.id, title: job.title },
      scanned: pool.length,
      aiScored: evaluable.length - skipped,
      skipped,
      degraded,
      recommendations,
    };
  }

  /** 唤醒激活：为历史候选人在本职位生成新应聘进入首列（复用创建守卫；同职位重复会 409 由前端提示） */
  async talentPoolActivate(jobId: string, candidateId: string, user: JwtUser) {
    const application = await this.applications.create({ candidateId, jobId }, user);
    await this.activityLog.record(user, ACTIVITY_ACTIONS.TALENT_POOL_ACTIVATED, 'Application', application.id, {
      candidate: application.candidate.name,
      via: 'talent_pool',
    });
    return application;
  }

  private async assertDepartmentInScope(departmentId: string, user: JwtUser) {
    if (typeof departmentId !== 'string' || !departmentId) {
      throw new BadRequestException('所属部门不能为空');
    }
    const department = await this.prisma.department.findUnique({ where: { id: departmentId } });
    if (!department) throw new BadRequestException('所属部门不存在');
    this.assertJobInDeptScope({ departmentId }, user);
  }

  /** 部门数据范围校验（用人经理仅本部门职位；ALL scope / 无 user 直接放行） */
  private assertJobInDeptScope(job: { departmentId: string }, user?: JwtUser) {
    const deptScope = user ? departmentScopeOf(user) : null;
    if (deptScope && !inDepartmentScope(deptScope, job.departmentId)) {
      throw new ForbiddenException('仅可访问本部门职位（数据范围：本部门）');
    }
  }
}
