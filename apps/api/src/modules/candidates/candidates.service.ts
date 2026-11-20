import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ACTIVITY_ACTIONS, RoleCode } from '@hireflow/shared';
import { departmentScopeOf, isAssignedScope } from '../../common/data-scope';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { assertResumeFile } from '../../common/upload';
import { maskContactsDeep, maskContactsInText, maskEmail, maskPhone } from '../../common/mask';
import type { Prisma } from '../../generated/prisma/client';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { AiService } from '../ai/ai.service';
import { sanitizeSkillTags } from '../ai/safety/prompt-safety';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AddResumeDto } from './dto/add-resume.dto';
import { CreateCandidateDto } from './dto/create-candidate.dto';
import { CandidateFilterDto, QueryCandidatesDto } from './dto/query-candidates.dto';
import { canExtractText, extractResumeText } from './resume-text';

/**
 * 「待处理新简历」：在招职位里仍停在第一阶段的在途应聘。大盘待办与候选人列表筛选共用这一个口径，
 * 保证「点 12 看到 12」。经理视角同时收紧到本部门职位。
 */
export function pendingScreeningWhere(deptScope: string[] | null): Prisma.CandidateWhereInput {
  return {
    applications: {
      some: {
        status: 'ACTIVE',
        stage: { order: 0 },
        job: { status: 'OPEN', ...(deptScope ? { departmentId: { in: deptScope } } : {}) },
      },
    },
  };
}

/** 简历 PARSING 状态的超时：超过即视为上次解析进程已中断，可重新发起（需大于 AI 调用截止时间） */
export const PARSE_STALE_MS = 120_000;

/** 单次导出上限：再多就该用分析报表，而不是把整库联系方式拉成一个文件 */
export const EXPORT_LIMIT = 5000;

const APPLICATION_STATUS_LABEL: Record<string, string> = {
  ACTIVE: '流程中',
  HIRED: '已入职',
  REJECTED: '已淘汰',
  WITHDRAWN: '已撤回',
};

/** 导出表格里的时间按北京时间展示 */
function formatBeijing(date: Date): string {
  return new Date(date.getTime() + 8 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
}

@Injectable()
export class CandidatesService {
  private readonly logger = new Logger(CandidatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly ai: AiService,
    private readonly storage: StorageService,
  ) {}

  /**
   * 去偏见/字段级脱敏：纯面试官视角默认看不到候选人联系方式；
   * 管理员/HR/用人经理不受影响。
   */
  private shouldMaskContact(user: JwtUser): boolean {
    const privileged: string[] = [RoleCode.ADMIN, RoleCode.HR, RoleCode.HIRING_MANAGER];
    return (
      user.roles.includes(RoleCode.INTERVIEWER) && !user.roles.some((r) => privileged.includes(r))
    );
  }

  private maskContact<
    T extends {
      email?: string | null;
      phone?: string | null;
      resumes?: Array<{ rawText: string | null; parsed: unknown; fileKey: string | null }>;
    },
  >(candidate: T, user: JwtUser): T {
    if (!this.shouldMaskContact(user)) return candidate;
    return {
      ...candidate,
      email: candidate.email ? maskEmail(candidate.email) : null,
      phone: candidate.phone ? maskPhone(candidate.phone) : null,
      // 简历正文与 AI 解析结果同样打码；原件文件无法打码，对该视角隐藏（fileKey 置空，前端据此不显示「原件」）
      ...(candidate.resumes
        ? {
            resumes: candidate.resumes.map((r) => ({
              ...r,
              rawText: r.rawText ? maskContactsInText(r.rawText) : r.rawText,
              parsed: maskContactsDeep(r.parsed),
              fileKey: null,
            })),
          }
        : {}),
    };
  }

  /**
   * 数据行级范围：
   * 用人经理 = 投递过本部门职位的候选人；面试官 = 被指派面试的候选人。
   */
  private candidateScopeWhere(user: JwtUser): Prisma.CandidateWhereInput {
    const deptScope = departmentScopeOf(user);
    if (deptScope) {
      return { applications: { some: { job: { departmentId: { in: deptScope } } } } };
    }
    if (isAssignedScope(user)) {
      return {
        applications: {
          some: { interviews: { some: { interviewers: { some: { userId: user.sub } } } } },
        },
      };
    }
    return {};
  }

  /** 列表与导出共用的筛选条件；各条件用 AND 组合（范围、待初筛、应聘条件都落在 applications 上，展开合并会互相覆盖） */
  private filterWhere(query: CandidateFilterDto, user: JwtUser): Prisma.CandidateWhereInput {
    const { keyword, stage, jobId, stageKind, status, source, minScore, createdFrom, createdTo } = query;
    const app: Prisma.ApplicationWhereInput = {
      ...(jobId ? { jobId } : {}),
      ...(stageKind ? { stage: { kind: stageKind } } : {}),
      ...(status && status !== 'NONE' ? { status } : {}),
      ...(minScore != null ? { matchScore: { gte: minScore } } : {}),
    };
    const created: Prisma.DateTimeFilter = {};
    if (createdFrom) created.gte = new Date(`${createdFrom.slice(0, 10)}T00:00:00+08:00`);
    if (createdTo) created.lt = new Date(new Date(`${createdTo.slice(0, 10)}T00:00:00+08:00`).getTime() + 86_400_000);
    const trimmed = keyword?.trim();
    return {
      AND: [
        this.candidateScopeWhere(user),
        trimmed
          ? {
              OR: [
                { name: { contains: trimmed, mode: 'insensitive' } },
                { email: { contains: trimmed, mode: 'insensitive' } },
                { phone: { contains: trimmed } },
                { tags: { has: trimmed } },
              ],
            }
          : {},
        stage === 'screening' ? pendingScreeningWhere(departmentScopeOf(user)) : {},
        status === 'NONE' ? { applications: { none: {} } } : {},
        Object.keys(app).length ? { applications: { some: app } } : {},
        source ? { source } : {},
        created.gte || created.lt ? { createdAt: created } : {},
      ],
    };
  }

  async list(query: QueryCandidatesDto, user: JwtUser) {
    const { page = 1, pageSize = 20 } = query;
    const where = this.filterWhere(query, user);
    const [total, items] = await this.prisma.$transaction([
      this.prisma.candidate.count({ where }),
      this.prisma.candidate.findMany({
        where,
        include: {
          applications: {
            include: {
              job: { select: { id: true, title: true } },
              stage: { select: { id: true, name: true, kind: true } },
            },
          },
          _count: { select: { resumes: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items: items.map((c) => this.maskContact(c, user)) };
  }

  /** 列表中出现过的来源渠道（筛选下拉用） */
  async sources(user: JwtUser) {
    const rows = await this.prisma.candidate.findMany({
      where: { AND: [this.candidateScopeWhere(user), { source: { not: null } }] },
      distinct: ['source'],
      select: { source: true },
      orderBy: { source: 'asc' },
      take: 100,
    });
    return rows.map((r) => r.source).filter((s): s is string => Boolean(s));
  }

  /**
   * 按当前筛选导出 Excel。联系方式与列表同一脱敏口径；单次最多 EXPORT_LIMIT 行，超出提示缩小范围。
   * 导出动作记入审计（含筛选条件与行数），不记具体名单。
   */
  async exportXlsx(query: CandidateFilterDto, user: JwtUser): Promise<{ buffer: Buffer; fileName: string; rows: number }> {
    const where = this.filterWhere(query, user);
    const total = await this.prisma.candidate.count({ where });
    if (total > EXPORT_LIMIT) {
      throw new BadRequestException(`符合条件的候选人有 ${total} 人，单次最多导出 ${EXPORT_LIMIT} 人，请缩小筛选范围`);
    }
    const items = await this.prisma.candidate.findMany({
      where,
      include: {
        applications: {
          include: { job: { select: { title: true } }, stage: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'HireFlow 招聘';
    const sheet = workbook.addWorksheet('候选人');
    sheet.columns = [
      { header: '姓名', key: 'name', width: 12 },
      { header: '邮箱', key: 'email', width: 26 },
      { header: '手机号', key: 'phone', width: 16 },
      { header: '来源', key: 'source', width: 12 },
      { header: '技能标签', key: 'tags', width: 30 },
      { header: '应聘职位', key: 'jobs', width: 24 },
      { header: '当前阶段', key: 'stages', width: 14 },
      { header: '应聘状态', key: 'statuses', width: 12 },
      { header: '最高匹配分', key: 'score', width: 11 },
      { header: '建档时间', key: 'createdAt', width: 18 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    for (const raw of items) {
      const c = this.maskContact(raw, user);
      const scores = c.applications.map((a) => a.matchScore).filter((n): n is number => n != null);
      sheet.addRow({
        name: c.name,
        email: c.email ?? '',
        phone: c.phone ?? '',
        source: c.source ?? '',
        tags: c.tags.join('、'),
        jobs: c.applications.map((a) => a.job.title).join('；'),
        stages: c.applications.map((a) => a.stage.name).join('；'),
        statuses: c.applications.map((a) => APPLICATION_STATUS_LABEL[a.status] ?? a.status).join('；'),
        score: scores.length ? Math.max(...scores) : null,
        createdAt: formatBeijing(c.createdAt),
      });
    }
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await this.activityLog.record(user, ACTIVITY_ACTIONS.CANDIDATES_EXPORTED, 'Candidate', 'export', {
      rows: items.length,
      filters: { ...query } as Prisma.InputJsonValue,
    } as Prisma.InputJsonValue);
    return { buffer, fileName: `候选人-${formatBeijing(new Date()).slice(0, 10)}.xlsx`, rows: items.length };
  }

  async create(dto: CreateCandidateDto, user: JwtUser) {
    // 去重：手机号/邮箱强匹配 → 拦截并指向已有档案
    const orConditions: Prisma.CandidateWhereInput[] = [];
    if (dto.phone?.trim()) orConditions.push({ phone: dto.phone.trim() });
    if (dto.email?.trim()) orConditions.push({ email: dto.email.trim() });
    if (orConditions.length > 0) {
      const duplicate = await this.prisma.candidate.findFirst({ where: { OR: orConditions } });
      if (duplicate) {
        const matched = duplicate.phone === dto.phone?.trim() ? '手机号' : '邮箱';
        throw new ConflictException(
          `${matched}与已有候选人「${duplicate.name}」重复，请在原档案上追加应聘记录（去重合并规则）`,
        );
      }
    }
    const candidate = await this.prisma.candidate.create({
      data: { ...dto, tags: dto.tags ?? [] },
    });
    await this.activityLog.record(user, ACTIVITY_ACTIONS.CANDIDATE_CREATED, 'Candidate', candidate.id, {
      name: candidate.name,
      source: candidate.source,
    });
    return candidate;
  }

  /** 行级范围校验：范围外的候选人按不可见处理（403），后端兜底前端过滤 */
  private async assertCandidateInScope(candidateId: string, user: JwtUser) {
    const scopeWhere = this.candidateScopeWhere(user);
    if (Object.keys(scopeWhere).length === 0) return;
    const inScope = await this.prisma.candidate.findFirst({
      where: { id: candidateId, ...scopeWhere },
      select: { id: true },
    });
    if (!inScope) {
      throw new ForbiddenException('该候选人不在您的数据范围内（本部门/仅被指派）');
    }
  }

  /** 360° 候选人详情：结构化信息 + 应聘记录 + 时间轴 */
  async findOne(id: string, user: JwtUser) {
    await this.assertCandidateInScope(id, user);
    const candidate = await this.prisma.candidate.findUnique({
      where: { id },
      include: {
        resumes: { orderBy: { createdAt: 'desc' } },
        applications: {
          include: {
            job: { select: { id: true, title: true, scorecardTemplate: true } },
            stage: { select: { id: true, name: true, kind: true } },
            // 详情里要知道这条应聘是否已有 Offer：有就给「查看 Offer」，别让 HR 填完才被告知已存在
            offer: { select: { id: true, status: true, decision: true } },
            interviews: {
              include: {
                interviewers: { include: { user: { select: { id: true, name: true } } } },
                evaluations: {
                  include: { interviewer: { select: { id: true, name: true } } },
                },
              },
              orderBy: { round: 'asc' },
            },
          },
        },
      },
    });
    if (!candidate) throw new NotFoundException('候选人不存在');

    // 时间轴聚合：候选人自身 + 其所有应聘记录的留痕 + 作用在他身上的 Copilot 操作（确认 / 取消 / 失败）
    const applicationIds = candidate.applications.map((a) => a.id);
    const copilotActions = await this.prisma.copilotAction.findMany({
      where: {
        status: { in: ['EXECUTED', 'REJECTED', 'FAILED'] },
        OR: [
          { args: { path: ['candidateId'], equals: id } },
          ...applicationIds.map((appId) => ({ args: { path: ['applicationId'], equals: appId } })),
        ],
      },
      select: { id: true },
      take: 200,
    });
    const timeline = await this.prisma.activityLog.findMany({
      where: {
        OR: [
          { entityType: 'Candidate', entityId: id },
          ...(applicationIds.length > 0
            ? [{ entityType: 'Application', entityId: { in: applicationIds } }]
            : []),
          ...(copilotActions.length > 0
            ? [{ entityType: 'CopilotAction', entityId: { in: copilotActions.map((a) => a.id) } }]
            : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { actor: { select: { id: true, name: true } } },
    });

    return { ...this.maskContact(candidate, user), timeline };
  }

  async update(id: string, dto: Partial<CreateCandidateDto>, user: JwtUser) {
    await this.assertCandidateInScope(id, user);
    const exists = await this.prisma.candidate.count({ where: { id } });
    if (exists === 0) throw new NotFoundException('候选人不存在');
    const candidate = await this.prisma.candidate.update({ where: { id }, data: dto });
    await this.activityLog.record(user, ACTIVITY_ACTIONS.CANDIDATE_UPDATED, 'Candidate', id, {
      ...dto,
    });
    return candidate;
  }

  /**
   * 删除候选人。与职位删除同一口径：有应聘记录就拒绝。
   * 候选人一旦进过流程，面试、面评、Offer 全挂在应聘记录下，删掉等于抹掉招聘留痕；
   * 这里只放行「录错了、还没投过任何职位」的记录。简历是候选人的从属数据，随之清理。
   */
  async remove(id: string, user: JwtUser) {
    const candidate = await this.prisma.candidate.findUnique({
      where: { id },
      select: { id: true, name: true, _count: { select: { applications: true } } },
    });
    if (!candidate) throw new NotFoundException('候选人不存在');
    if (candidate._count.applications > 0) {
      throw new BadRequestException(
        `该候选人已有 ${candidate._count.applications} 条应聘记录，不能删除。如需终止流程请在流程中做「淘汰」`,
      );
    }
    await this.prisma.resume.deleteMany({ where: { candidateId: id } });
    await this.prisma.candidate.delete({ where: { id } });
    await this.activityLog.record(user, ACTIVITY_ACTIONS.CANDIDATE_DELETED, 'Candidate', id, {
      name: candidate.name,
    });
    return { ok: true };
  }

  /**
   * AI 解析简历：结构化抽取 + 语义技能标签 + 150 字亮点风险摘要，标签合并进候选人。
   */
  async parseResume(resumeId: string, user: JwtUser) {
    const resume = await this.prisma.resume.findUnique({
      where: { id: resumeId },
      include: { candidate: true },
    });
    if (!resume) throw new NotFoundException('简历不存在');
    await this.assertCandidateInScope(resume.candidateId, user);
    const rawText = resume.rawText?.trim();
    if (!rawText) throw new BadRequestException('该简历没有可解析的文本内容');

    // 原子「认领」：同一份简历同时只允许一个解析在跑（防重复点击、多标签页各点一次，每次都是一笔 token）；
    // PARSING 超过 PARSE_STALE_MS 视为上次进程中途挂掉，允许重新认领，不会永久卡在「解析中」
    const claimed = await this.prisma.resume.updateMany({
      where: {
        id: resumeId,
        OR: [
          { parseStatus: { not: 'PARSING' } },
          { parseStartedAt: null },
          { parseStartedAt: { lt: new Date(Date.now() - PARSE_STALE_MS) } },
        ],
      },
      data: { parseStatus: 'PARSING', parseStartedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new ConflictException('这份简历正在解析中，请稍候，完成后会自动刷新');
    }
    try {
      const { data, meta } = await this.ai.parseResume(rawText);
      // 落库前再归一化一次（纵深防御）：标签会进候选人档案、再喂给匹配评分，是注入内容持久化的主要通道
      const skills = sanitizeSkillTags(data.skills);
      const mergedTags = [...new Set([...resume.candidate.tags, ...skills])].slice(0, 15);
      data.skills = skills;

      const [updatedResume] = await this.prisma.$transaction([
        this.prisma.resume.update({
          where: { id: resumeId },
          data: {
            parsed: { ...data, aiMeta: meta } as unknown as Prisma.InputJsonValue,
            skills,
            parseStatus: 'DONE',
          },
        }),
        this.prisma.candidate.update({
          where: { id: resume.candidateId },
          data: { tags: mergedTags },
        }),
      ]);
      await this.activityLog.record(user, ACTIVITY_ACTIONS.RESUME_PARSED, 'Candidate', resume.candidateId, {
        resumeId,
        provider: meta.provider,
        skills,
        degraded: meta.degraded,
        ...(data.injectionSuspected ? { injectionSuspected: true } : {}),
      });
      return { ...updatedResume, aiMeta: meta };
    } catch (error) {
      await this.prisma.resume.update({ where: { id: resumeId }, data: { parseStatus: 'FAILED' } });
      throw error;
    }
  }

  /** 文本导入一份简历（导入后可调用 /resumes/:id/parse 做 AI 解析） */
  async addResume(candidateId: string, dto: AddResumeDto, user: JwtUser) {
    await this.assertCandidateInScope(candidateId, user);
    const rawText = typeof dto.rawText === 'string' ? dto.rawText.trim() : '';
    if (rawText.length < 20) throw new BadRequestException('简历文本过短');
    const candidate = await this.prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!candidate) throw new NotFoundException('候选人不存在');
    const resume = await this.prisma.resume.create({
      data: {
        candidateId,
        rawText,
        fileName: dto.fileName ?? `${candidate.name}-简历.txt`,
        parseStatus: 'PENDING',
      },
    });
    await this.activityLog.record(user, ACTIVITY_ACTIONS.RESUME_ADDED, 'Candidate', candidateId, {
      resumeId: resume.id,
      fileName: resume.fileName,
      length: rawText.length,
    });
    return resume;
  }

  /**
   * 上传简历原件：原件入对象存储留档，PDF/Word/文本自动抽取文字进入既有 AI 解析链路；
   * 抽不出文字的格式（扫描件/.doc）留档后由 HR 粘贴文本补充（人工兜底）。
   */
  async addResumeFile(candidateId: string, file: Express.Multer.File, user: JwtUser) {
    await this.assertCandidateInScope(candidateId, user);
    const candidate = await this.prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!candidate) throw new NotFoundException('候选人不存在');
    assertResumeFile(file);

    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8'); // multer 中文名乱码修正
    const fileKey = this.storage.objectKey(`resumes/${candidateId}`, fileName);
    await this.storage.put(fileKey, file.buffer, file.mimetype);

    const rawText = await this.extractText(file.buffer, file.mimetype, fileName);
    const resume = await this.prisma.resume.create({
      data: {
        candidateId,
        fileKey,
        fileName,
        rawText,
        parseStatus: 'PENDING',
      },
    });
    await this.activityLog.record(user, ACTIVITY_ACTIONS.RESUME_ADDED, 'Candidate', candidateId, {
      resumeId: resume.id,
      fileName,
      size: file.size,
      textExtracted: Boolean(rawText),
    });
    return { ...resume, textExtracted: Boolean(rawText) };
  }

  /** 简历原件下载链接：历史文件未必经过内容校验，一律用 attachment 避免当网页预览。 */
  async resumeFileUrl(resumeId: string, user: JwtUser) {
    const resume = await this.prisma.resume.findUnique({
      where: { id: resumeId },
      select: { fileKey: true, fileName: true, candidateId: true },
    });
    if (!resume) throw new NotFoundException('简历不存在');
    await this.assertCandidateInScope(resume.candidateId, user);
    // 原件 PDF/图片里的联系方式无法打码：脱敏视角（纯面试官）只能看打码后的简历正文
    if (this.shouldMaskContact(user)) {
      throw new ForbiddenException('简历原件含候选人联系方式，面试官视角仅可查看正文');
    }
    if (!resume.fileKey) throw new NotFoundException('该简历为文本导入，无原件文件');
    return { url: await this.storage.presignedGetUrl(resume.fileKey, resume.fileName ?? undefined, 600, 'attachment') };
  }

  /** PDF / Word（.docx）/ 纯文本抽取文字；其余格式返回 null（留档不解析） */
  private async extractText(buffer: Buffer, mimetype: string, fileName: string): Promise<string | null> {
    if (!canExtractText(mimetype, fileName)) return null;
    try {
      return await extractResumeText(buffer, mimetype, fileName);
    } catch (error) {
      this.logger.warn(`简历文字抽取失败（${fileName}）：${error instanceof Error ? error.message : error}`);
      return null;
    }
  }
}
