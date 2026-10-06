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
import { maskContactsDeep, maskContactsInText, maskEmail, maskPhone } from '../../common/mask';
import type { Prisma } from '../../generated/prisma/client';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { AiService } from '../ai/ai.service';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AddResumeDto } from './dto/add-resume.dto';
import { CreateCandidateDto } from './dto/create-candidate.dto';
import { QueryCandidatesDto } from './dto/query-candidates.dto';

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

  async list(query: QueryCandidatesDto, user: JwtUser) {
    const { page = 1, pageSize = 20, keyword, stage } = query;
    // 各条件用 AND 组合：范围条件与「待初筛」都落在 applications 上，展开合并会互相覆盖
    const where: Prisma.CandidateWhereInput = {
      AND: [
        this.candidateScopeWhere(user),
        keyword
          ? {
              OR: [
                { name: { contains: keyword, mode: 'insensitive' } },
                { email: { contains: keyword, mode: 'insensitive' } },
                { phone: { contains: keyword } },
                { tags: { has: keyword } },
              ],
            }
          : {},
        stage === 'screening' ? pendingScreeningWhere(departmentScopeOf(user)) : {},
      ],
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.candidate.count({ where }),
      this.prisma.candidate.findMany({
        where,
        include: {
          applications: {
            include: {
              job: { select: { id: true, title: true } },
              stage: { select: { id: true, name: true } },
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
            stage: { select: { id: true, name: true } },
            // 详情里要知道这条应聘是否已有 Offer：有就给「查看 Offer」，别让 HR 填完才被告知已存在
            offer: { select: { id: true, approvalStatus: true, decision: true } },
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

    // 时间轴聚合：候选人自身 + 其所有应聘记录的留痕
    const applicationIds = candidate.applications.map((a) => a.id);
    const timeline = await this.prisma.activityLog.findMany({
      where: {
        OR: [
          { entityType: 'Candidate', entityId: id },
          ...(applicationIds.length > 0
            ? [{ entityType: 'Application', entityId: { in: applicationIds } }]
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
    if (!resume.rawText) throw new BadRequestException('该简历没有可解析的文本内容');

    await this.prisma.resume.update({ where: { id: resumeId }, data: { parseStatus: 'PARSING' } });
    try {
      const { data, meta } = await this.ai.parseResume(resume.rawText);
      const mergedTags = [...new Set([...resume.candidate.tags, ...data.skills])].slice(0, 15);

      const [updatedResume] = await this.prisma.$transaction([
        this.prisma.resume.update({
          where: { id: resumeId },
          data: {
            parsed: { ...data, aiMeta: meta } as unknown as Prisma.InputJsonValue,
            skills: data.skills,
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
        skills: data.skills,
      });
      return { ...updatedResume, aiMeta: meta };
    } catch (error) {
      await this.prisma.resume.update({ where: { id: resumeId }, data: { parseStatus: 'FAILED' } });
      throw error;
    }
  }

  /** 文本导入一份简历（导入后可调用 /resumes/:id/parse 做 AI 解析） */
  async addResume(candidateId: string, dto: AddResumeDto, user: JwtUser) {
    const candidate = await this.prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!candidate) throw new NotFoundException('候选人不存在');
    const resume = await this.prisma.resume.create({
      data: {
        candidateId,
        rawText: dto.rawText,
        fileName: dto.fileName ?? `${candidate.name}-简历.txt`,
        parseStatus: 'PENDING',
      },
    });
    await this.activityLog.record(user, ACTIVITY_ACTIONS.RESUME_ADDED, 'Candidate', candidateId, {
      resumeId: resume.id,
      fileName: resume.fileName,
      length: dto.rawText.length,
    });
    return resume;
  }

  /**
   * 上传简历原件：原件入对象存储留档，PDF/文本自动抽取文字进入既有 AI 解析链路；
   * 抽不出文字的格式（扫描件/Word）留档后由 HR 粘贴文本补充（人工兜底）。
   */
  async addResumeFile(candidateId: string, file: Express.Multer.File, user: JwtUser) {
    const candidate = await this.prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!candidate) throw new NotFoundException('候选人不存在');

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

  /** 简历原件预览链接（预签名，10 分钟有效） */
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
    return { url: await this.storage.presignedGetUrl(resume.fileKey, resume.fileName ?? undefined) };
  }

  /** PDF / 纯文本抽取文字；其余格式返回 null（留档不解析） */
  private async extractText(buffer: Buffer, mimetype: string, fileName: string): Promise<string | null> {
    try {
      if (mimetype === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: new Uint8Array(buffer) });
        try {
          const result = await parser.getText();
          const text = result.text?.trim();
          return text ? text.slice(0, 50_000) : null;
        } finally {
          await parser.destroy();
        }
      }
      if (mimetype.startsWith('text/') || /\.(txt|md|markdown)$/i.test(fileName)) {
        const text = buffer.toString('utf8').trim();
        return text ? text.slice(0, 50_000) : null;
      }
    } catch (error) {
      this.logger.warn(`简历文字抽取失败（${fileName}）：${error instanceof Error ? error.message : error}`);
    }
    return null;
  }
}
