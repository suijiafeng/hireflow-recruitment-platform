import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ACTIVITY_ACTIONS, DEFAULT_PIPELINE_STAGES } from '@hireflow/shared';
import { departmentScopeOf, inDepartmentScope } from '../../common/data-scope';
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

/** 人才库唤醒单次扫描上限：真实 AI 引擎下控 Token 成本（mock 引擎零成本） */
const TALENT_POOL_SCAN_LIMIT = 20;

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
    // 数据行级权限：用人经理仅本部门职位
    const deptScope = user ? departmentScopeOf(user) : null;
    const where: Prisma.JobWhereInput = {
      ...(keyword ? { title: { contains: keyword, mode: 'insensitive' } } : {}),
      ...(status ? { status } : {}),
      ...(deptScope ? { departmentId: { in: deptScope } } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
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
    ]);
    // HC 占用：已入职 + 已接受 Offer 的在途者
    const usage = await this.prisma.application.groupBy({
      by: ['jobId'],
      where: {
        jobId: { in: items.map((j) => j.id) },
        OR: [{ status: 'HIRED' }, { status: 'ACTIVE', offer: { decision: 'ACCEPTED' } }],
      },
      _count: { _all: true },
    });
    const usageMap = new Map(usage.map((u) => [u.jobId, u._count._all]));
    return {
      total,
      page,
      pageSize,
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
    const department = await this.prisma.department.findUnique({ where: { id: dto.departmentId } });
    if (!department) throw new BadRequestException('所属部门不存在');
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
          create: DEFAULT_PIPELINE_STAGES.map((name, index) => ({ name, order: index })),
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
    await this.ensureExists(id);
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
   * 全量更新职位的 Pipeline 阶段：
   * 传入有 id 的做改名/排序，无 id 的新增；未出现的阶段删除。
   */
  async updateStages(jobId: string, dto: UpdateStagesDto, user: JwtUser) {
    await this.ensureExists(jobId);
    const existing = await this.prisma.pipelineStage.findMany({ where: { jobId } });
    const existingIds = new Set(existing.map((s) => s.id));
    const incomingIds = new Set(dto.stages.filter((s) => s.id).map((s) => s.id as string));

    for (const item of dto.stages) {
      if (item.id && !existingIds.has(item.id)) {
        throw new BadRequestException(`阶段 ${item.id} 不属于该职位`);
      }
    }

    const toDelete = existing.filter((s) => !incomingIds.has(s.id));
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
    return this.getStages(jobId);
  }

  /**
   * 人才库唤醒：历史淘汰/撤回候选人 × 本职位 JD 重新 AI 打分，推荐 Top 10。
   * 复用现有 scoreMatch 引擎；候选池按最近更新取前 N 控制 Token 成本。
   */
  async talentPoolScan(jobId: string, user: JwtUser) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('职位不存在');

    // 候选池：有淘汰/撤回记录的候选人，排除已在本职位在途/已入职的（避免重复推荐）
    const pool = await this.prisma.candidate.findMany({
      where: {
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

    // allSettled：单个候选人打分失败（如 AI 服务瞬时抖动）不拖累其余已成功的结果
    const settled = await Promise.allSettled(
      pool.map(async (candidate) => {
        const resume = candidate.resumes[0];
        const resumeText = resume?.rawText ?? (resume?.parsed ? JSON.stringify(resume.parsed) : '');
        if (!resumeText && candidate.tags.length === 0) return null; // 无简历无标签，不可评估
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
          lastApplication: last
            ? {
                jobTitle: last.job.title,
                status: last.status,
                rejectReason: last.rejectReason,
                updatedAt: last.updatedAt,
              }
            : null,
        };
      }),
    );
    const scored = settled.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      this.logger.warn(`人才库唤醒打分失败（候选人 ${pool[i].id}）：${r.reason instanceof Error ? r.reason.message : r.reason}`);
      return null;
    });
    const recommendations = scored
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    await this.activityLog.record(user, ACTIVITY_ACTIONS.TALENT_POOL_SCANNED, 'Job', jobId, {
      job: job.title,
      scanned: pool.length,
      recommended: recommendations.length,
    });
    return { job: { id: job.id, title: job.title }, scanned: pool.length, recommendations };
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

  private async ensureExists(id: string) {
    const count = await this.prisma.job.count({ where: { id } });
    if (count === 0) throw new NotFoundException('职位不存在');
  }

  /** 部门数据范围校验（用人经理仅本部门职位；ALL scope / 无 user 直接放行） */
  private assertJobInDeptScope(job: { departmentId: string }, user?: JwtUser) {
    const deptScope = user ? departmentScopeOf(user) : null;
    if (deptScope && !inDepartmentScope(deptScope, job.departmentId)) {
      throw new ForbiddenException('仅可访问本部门职位（数据范围：本部门）');
    }
  }
}
