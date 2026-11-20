import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ACTIVITY_ACTIONS } from '@hireflow/shared';
import { departmentScopeOf, isAssignedScope } from '../../common/data-scope';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { assertResumeFile } from '../../common/upload';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ApplicationsService } from '../applications/applications.service';
import { StorageService } from '../storage/storage.service';
import { CandidatesService } from './candidates.service';
import type { IntakeResumeDto } from './dto/intake-resume.dto';
import { canExtractText, extractContacts, extractResumeText } from './resume-text';

export interface IntakeResult {
  candidate: { id: string; name: string };
  /** true = 新建档案；false = 按邮箱/手机号合并到已有档案 */
  created: boolean;
  matchedBy: 'email' | 'phone' | null;
  /** 合并时从简历补上的空字段 */
  backfilled: string[];
  resumeId: string;
  parsed: boolean;
  skills: string[];
  application: { id: string; revived: boolean } | null;
  score: number | null;
  warnings: string[];
}

/**
 * 上传简历自动建档：抽文字 → 识别联系方式 → 按邮箱/手机号去重（合并或新建）→ 原件留档
 * → AI 解析回填技能 → 投递所选职位 → AI 匹配评分。
 * 建档与留档是硬步骤（失败整单报错）；解析、评分属于 AI 步骤，失败只记为提醒，HR 可在详情里重试。
 */
@Injectable()
export class ResumeIntakeService {
  private readonly logger = new Logger(ResumeIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly storage: StorageService,
    private readonly candidates: CandidatesService,
    private readonly applications: ApplicationsService,
  ) {}

  async intake(file: Express.Multer.File, dto: IntakeResumeDto, user: JwtUser): Promise<IntakeResult> {
    assertResumeFile(file);
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8'); // multer 中文名乱码修正

    const job = await this.prisma.job.findUnique({
      where: { id: dto.jobId },
      select: { id: true, title: true, status: true, departmentId: true },
    });
    if (!job) throw new NotFoundException('职位不存在');
    if (job.status !== 'OPEN') throw new BadRequestException(`职位「${job.title}」未在招聘中，不能投递`);
    // 先查范围再建档：否则越权上传会留下一个孤儿候选人
    const deptScope = departmentScopeOf(user);
    if ((deptScope && !deptScope.includes(job.departmentId)) || isAssignedScope(user)) {
      throw new ForbiddenException('只能向本部门的职位导入简历');
    }

    if (!canExtractText(file.mimetype, fileName)) {
      throw new BadRequestException('自动建档支持 PDF、Word（.docx）和纯文本；图片或 .doc 请手工新增候选人后上传原件');
    }
    let text: string | null = null;
    try {
      text = await extractResumeText(file.buffer, file.mimetype, fileName);
    } catch (error) {
      this.logger.warn(`简历文字抽取失败（${fileName}）：${error instanceof Error ? error.message : error}`);
    }
    if (!text || text.length < 20) {
      throw new BadRequestException('没能从文件里读出文字（可能是扫描件），请手工新增候选人');
    }
    const contacts = extractContacts(text, fileName);
    if (!contacts.email && !contacts.phone) {
      throw new BadRequestException('简历里没有识别到邮箱或手机号，无法去重建档，请手工新增候选人');
    }

    const or: Prisma.CandidateWhereInput[] = [];
    if (contacts.email) or.push({ email: { equals: contacts.email, mode: 'insensitive' } });
    if (contacts.phone) or.push({ phone: contacts.phone });
    const existing = await this.prisma.candidate.findFirst({ where: { OR: or }, orderBy: { createdAt: 'asc' } });
    const matchedBy: IntakeResult['matchedBy'] = !existing
      ? null
      : contacts.email && existing.email?.toLowerCase() === contacts.email
        ? 'email'
        : 'phone';

    const fileKey = this.storage.objectKey('resumes/intake', fileName);
    await this.storage.put(fileKey, file.buffer, file.mimetype);

    const backfilled: string[] = [];
    const { candidate, resume } = await this.prisma.$transaction(async (tx) => {
      let candidate;
      if (existing) {
        // 合并：只补空字段，不覆盖 HR 手工维护过的信息
        const patch: Prisma.CandidateUpdateInput = {};
        if (!existing.email && contacts.email) { patch.email = contacts.email; backfilled.push('邮箱'); }
        if (!existing.phone && contacts.phone) { patch.phone = contacts.phone; backfilled.push('手机号'); }
        if (!existing.source && dto.source) { patch.source = dto.source; backfilled.push('来源'); }
        candidate = backfilled.length
          ? await tx.candidate.update({ where: { id: existing.id }, data: patch })
          : existing;
      } else {
        candidate = await tx.candidate.create({
          data: {
            name: contacts.name ?? '未识别姓名',
            email: contacts.email ?? null,
            phone: contacts.phone ?? null,
            source: dto.source ?? null,
            tags: [],
          },
        });
        await this.activityLog.record(user, ACTIVITY_ACTIONS.CANDIDATE_CREATED, 'Candidate', candidate.id, {
          name: candidate.name,
          source: candidate.source,
          via: 'resume_intake',
        }, tx);
      }
      const resume = await tx.resume.create({
        data: { candidateId: candidate.id, fileKey, fileName, rawText: text, parseStatus: 'PENDING' },
      });
      await this.activityLog.record(user, ACTIVITY_ACTIONS.RESUME_INTAKE, 'Candidate', candidate.id, {
        resumeId: resume.id,
        fileName,
        job: job.title,
        created: !existing,
        ...(matchedBy ? { matchedBy } : {}),
        ...(backfilled.length ? { backfilled } : {}),
      }, tx);
      return { candidate, resume };
    });

    const warnings: string[] = [];
    if (!existing && !contacts.name) warnings.push('没有识别出姓名，已记为「未识别姓名」，请在档案里修改');

    let parsed = false;
    let skills: string[] = [];
    try {
      const result = await this.candidates.parseResume(resume.id, user);
      parsed = true;
      skills = result.skills;
    } catch (error) {
      warnings.push(`AI 解析失败：${this.reason(error)}（可在候选人详情里重新解析）`);
    }

    let application: IntakeResult['application'] = null;
    try {
      const app = await this.applications.create({ candidateId: candidate.id, jobId: job.id }, user);
      application = { id: app.id, revived: app.revived };
    } catch (error) {
      if (error instanceof ConflictException) {
        warnings.push(this.reason(error));
        // 已在流程中：仍然给原应聘重新评分（新简历可能更完整）
        const current = await this.prisma.application.findUnique({
          where: { candidateId_jobId: { candidateId: candidate.id, jobId: job.id } },
          select: { id: true, status: true },
        });
        if (current?.status === 'ACTIVE') application = { id: current.id, revived: false };
      } else {
        throw error;
      }
    }

    let score: number | null = null;
    if (application) {
      try {
        const scored = await this.applications.score(application.id, user);
        score = scored.matchScore ?? null;
      } catch (error) {
        warnings.push(`AI 评分失败：${this.reason(error)}（可在看板卡片上重新评分）`);
      }
    }

    return {
      candidate: { id: candidate.id, name: candidate.name },
      created: !existing,
      matchedBy,
      backfilled,
      resumeId: resume.id,
      parsed,
      skills,
      application,
      score,
      warnings,
    };
  }

  private reason(error: unknown): string {
    if (error instanceof HttpException) {
      const body = error.getResponse();
      if (typeof body === 'string') return body;
      const message = (body as { message?: string | string[] }).message;
      return Array.isArray(message) ? message.join('；') : (message ?? error.message);
    }
    return '服务暂不可用';
  }
}
