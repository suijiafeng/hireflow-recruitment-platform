import {
  EVALUATION_CONCLUSION_LABEL,
  ACTIVITY_ACTIONS,
  COPILOT_READ_TOOLS,
  COPILOT_WRITE_TOOLS,
  PERMISSIONS,
  REJECT_REASONS,
  type CopilotToolName,
  type CopilotWriteTool,
} from '@hireflow/shared';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { departmentScopeOf, inDepartmentScope } from '../../../common/data-scope';
import type { JwtUser } from '../../../common/decorators/current-user.decorator';
import { PrismaService } from '../../../prisma/prisma.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { AnalyticsService } from '../../analytics/analytics.service';
import { ApplicationsService } from '../../applications/applications.service';
import { CandidatesService } from '../../candidates/candidates.service';
import { InterviewsService } from '../../interviews/interviews.service';
import { JobsService } from '../../jobs/jobs.service';
import { OffersService } from '../../offers/offers.service';
import type { ToolSpec } from '../providers/types';
import { int, oneOf, str, strList, ToolArgError } from './tool-args';
import { UntrustedCollector } from './tool-output';

type Args = Record<string, unknown>;

export interface ReadResult {
  data: unknown;
  /** 步骤摘要（前端折叠步骤里显示，如「找到 3 位」） */
  summary: string;
  injectionSuspected?: boolean;
}

export interface Proposal {
  args: Record<string, unknown>;
  summary: string;
  fields: Array<{ label: string; value: string }>;
  danger: boolean;
}

export interface ExecutionResult {
  message: string;
  link?: string;
  /** draft_evaluation：保存的面评草稿（前端写入本人的面评表单草稿，由本人核对后提交） */
  draft?: { scorecard: Array<{ dimension: string; score: number; comment?: string }>; conclusion: string; comments: string };
}

interface ToolDef {
  name: CopilotToolName;
  kind: 'read' | 'write';
  /** 需全部具备；anyOf 满足其一即可 */
  permissions?: string[];
  anyOf?: string[];
  description: string;
  parameters: ToolSpec['parameters'];
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const TZ = process.env.COPILOT_TIMEZONE || 'Asia/Shanghai';
const fmtTime = (d: Date | string) =>
  new Date(d).toLocaleString('zh-CN', { timeZone: TZ, month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });

const OBJ = (properties: Record<string, unknown>, required: string[] = []): ToolSpec['parameters'] => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

/**
 * Copilot 工具集。两条铁律：
 * 1. 读工具只调用现有业务服务，并传入「当前用户」——权限点、本部门 / 仅被指派范围、联系方式脱敏全部沿用原有实现，
 *    模型拿到的数据和这个人在页面上能看到的一样多，不多一行。
 * 2. 写工具不执行：只生成「待确认操作」（参数已解析、记下乐观锁版本），由用户在界面确认后，
 *    再以确认时的权限重新走一遍业务服务（服务内的范围校验 / 乐观锁 / 终态检查都会再跑一次）。
 */
@Injectable()
export class CopilotToolsService {
  readonly defs: ToolDef[] = [
    {
      name: 'search_candidates',
      kind: 'read',
      permissions: [PERMISSIONS.CANDIDATE_READ],
      description: '按姓名 / 标签 / 技能关键词搜索候选人（仅返回当前用户数据范围内的人，不含联系方式）。stage=screening 表示只看待初筛。',
      parameters: OBJ({
        keyword: { type: 'string', description: '姓名或技能关键词；不填则按最新排序' },
        stage: { type: 'string', enum: ['screening'] },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      }),
    },
    {
      name: 'get_candidate',
      kind: 'read',
      permissions: [PERMISSIONS.CANDIDATE_READ],
      description: '读取一位候选人的档案：简历摘要与技能、各条应聘记录（职位、当前阶段、可选阶段、匹配分）、面试与面评结论、Offer 状态、最近备注。',
      parameters: OBJ({ candidateId: { type: 'string' } }, ['candidateId']),
    },
    {
      name: 'list_jobs',
      kind: 'read',
      permissions: [PERMISSIONS.JOB_READ],
      description: '列出职位及招聘进度（状态、编制、已占用 HC、应聘人数）。',
      parameters: OBJ({
        keyword: { type: 'string' },
        status: { type: 'string', enum: ['OPEN', 'PAUSED', 'DRAFT', 'PENDING_APPROVAL', 'CLOSED'] },
      }),
    },
    {
      name: 'job_pipeline',
      kind: 'read',
      permissions: [PERMISSIONS.CANDIDATE_READ, PERMISSIONS.JOB_READ],
      description: '读取一个职位的招聘看板：每个阶段的人数、停留最久的候选人。',
      parameters: OBJ({ jobId: { type: 'string' } }, ['jobId']),
    },
    {
      name: 'upcoming_interviews',
      kind: 'read',
      permissions: [PERMISSIONS.EVALUATION_READ],
      description: '查询接下来若干天内已排期的面试（面试官只看到自己被指派的）。',
      parameters: OBJ({ days: { type: 'integer', minimum: 1, maximum: 30 } }),
    },
    {
      name: 'offer_status',
      kind: 'read',
      anyOf: [PERMISSIONS.OFFER_INITIATE, PERMISSIONS.OFFER_APPROVE],
      description: '查询 Offer 审批与答复状态，可按候选人姓名过滤（不返回薪资）。',
      parameters: OBJ({ keyword: { type: 'string' } }),
    },
    {
      name: 'funnel_insights',
      kind: 'read',
      permissions: [PERMISSIONS.DASHBOARD_VIEW],
      description: '招聘漏斗：给 jobId 时返回该职位各阶段到达人数与转化率；不给时返回整体概览（在招职位、候选人、待面试、已入职）。',
      parameters: OBJ({ jobId: { type: 'string' } }),
    },
    {
      name: 'my_todos',
      kind: 'read',
      description: '当前用户的待办汇总（待初筛简历、待提交面评、待审批 Offer 等）。',
      parameters: OBJ({}),
    },
    {
      name: 'move_candidate_stage',
      kind: 'write',
      permissions: [PERMISSIONS.APPLICATION_MOVE],
      description: '提议把一条应聘记录推进 / 回退到目标阶段。不会立即执行，会生成确认卡片由用户确认。回退必须给 reason。',
      parameters: OBJ(
        {
          applicationId: { type: 'string' },
          targetStage: { type: 'string', description: '目标阶段名称或 id（取自 get_candidate 返回的 stages）' },
          reason: { type: 'string', description: '回退原因（向后回退时必填）' },
        },
        ['applicationId', 'targetStage'],
      ),
    },
    {
      name: 'schedule_interview',
      kind: 'write',
      permissions: [PERMISSIONS.INTERVIEW_SCHEDULE],
      description: '提议为一条应聘记录安排面试（生成确认卡片，用户确认后才创建）。面试官不填时默认职位的用人经理。',
      parameters: OBJ(
        {
          applicationId: { type: 'string' },
          scheduledAt: { type: 'string', description: 'ISO 8601 时间，必须是将来的时间' },
          durationMins: { type: 'integer', minimum: 15, maximum: 240 },
          interviewerNames: { type: 'array', items: { type: 'string' } },
        },
        ['applicationId', 'scheduledAt'],
      ),
    },
    {
      name: 'add_candidate_note',
      kind: 'write',
      permissions: [PERMISSIONS.CANDIDATE_UPDATE],
      description: '提议给候选人档案加一条备注（进入候选人时间轴；用户确认后才写入）。',
      parameters: OBJ({ candidateId: { type: 'string' }, note: { type: 'string' } }, ['candidateId', 'note']),
    },
    {
      name: 'draft_evaluation',
      kind: 'write',
      permissions: [PERMISSIONS.EVALUATION_SUBMIT],
      description:
        '根据用户口述的面试记录，为某场面试起草结构化面评（评分卡 + 结论 + 评语）。只生成草稿：用户确认后保存为本人的面评草稿，' +
        '仍需本人在面评表单里核对、删除 AI 标记后才能正式提交。interviewId 取自 get_candidate 返回的 interviews。',
      parameters: OBJ(
        {
          interviewId: { type: 'string' },
          notes: { type: 'string', description: '用户提供的面试记录 / 要点（原话）' },
        },
        ['interviewId', 'notes'],
      ),
    },
    {
      name: 'reject_application',
      kind: 'write',
      permissions: [PERMISSIONS.APPLICATION_MOVE],
      description: `提议淘汰一条应聘记录（不可逆，需用户确认）。reason 只能是：${REJECT_REASONS.join('、')}。`,
      parameters: OBJ(
        {
          applicationId: { type: 'string' },
          reason: { type: 'string', enum: [...REJECT_REASONS] },
          note: { type: 'string' },
        },
        ['applicationId', 'reason'],
      ),
    },
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly candidates: CandidatesService,
    private readonly applications: ApplicationsService,
    private readonly jobs: JobsService,
    private readonly interviews: InterviewsService,
    private readonly offers: OffersService,
    private readonly analytics: AnalyticsService,
    private readonly activityLog: ActivityLogService,
  ) {}

  def(name: string): ToolDef | undefined {
    return this.defs.find((d) => d.name === name);
  }

  allowed(def: ToolDef, user: JwtUser): boolean {
    const has = (p: string) => user.permissions.includes(p);
    if (def.permissions && !def.permissions.every(has)) return false;
    if (def.anyOf && !def.anyOf.some(has)) return false;
    return true;
  }

  /** 交给模型的工具声明：只列当前用户有权使用的，模型「看不见」的工具也就不会去调 */
  specsFor(user: JwtUser): ToolSpec[] {
    return this.defs
      .filter((d) => this.allowed(d, user))
      .map((d) => ({ name: d.name, description: d.description, parameters: d.parameters }));
  }

  isWrite(name: string): name is CopilotWriteTool {
    return name in COPILOT_WRITE_TOOLS;
  }

  /** 执行前的统一闸门：未知工具 / 无权限一律拒绝（模型可能幻觉出没给它的工具名） */
  assertCallable(name: string, user: JwtUser): ToolDef {
    const def = this.def(name);
    if (!def) throw new ToolArgError(`未知工具：${name}`);
    if (!this.allowed(def, user)) throw new ForbiddenException('当前账号无权使用该能力');
    return def;
  }

  // ---------------------------------------------------------------- 读工具

  async runRead(name: string, args: Args, user: JwtUser): Promise<ReadResult> {
    this.assertCallable(name, user);
    switch (name as keyof typeof COPILOT_READ_TOOLS) {
      case 'search_candidates':
        return this.searchCandidates(args, user);
      case 'get_candidate':
        return this.getCandidate(args, user);
      case 'list_jobs':
        return this.listJobs(args, user);
      case 'job_pipeline':
        return this.jobPipeline(args, user);
      case 'upcoming_interviews':
        return this.upcomingInterviews(args, user);
      case 'offer_status':
        return this.offerStatus(args, user);
      case 'funnel_insights':
        return this.funnelInsights(args, user);
      case 'my_todos':
        return { data: await this.analytics.todos(user), summary: '已汇总' };
      default:
        throw new ToolArgError(`未知工具：${name}`);
    }
  }

  private async searchCandidates(args: Args, user: JwtUser): Promise<ReadResult> {
    const keyword = str(args, 'keyword', { max: 40, optional: true });
    const stage = oneOf(args, 'stage', ['screening'] as const, true);
    const limit = int(args, 'limit', { min: 1, max: 20, fallback: 8 });
    const page = await this.candidates.list({ page: 1, pageSize: limit, keyword, stage }, user);
    const guard = new UntrustedCollector();
    const items = page.items.map((c) => ({
      id: c.id,
      name: c.name,
      tags: guard.tags(c.tags),
      source: c.source,
      applications: c.applications.map((a) => ({
        applicationId: a.id,
        job: a.job.title,
        jobId: a.job.id,
        stage: a.stage.name,
        status: a.status,
        matchScore: a.matchScore,
      })),
    }));
    return { data: { total: page.total, items }, summary: `找到 ${page.total} 位${page.total > items.length ? `，展示前 ${items.length} 位` : ''}` };
  }

  private async getCandidate(args: Args, user: JwtUser): Promise<ReadResult> {
    const candidateId = str(args, 'candidateId', { max: 64 });
    const c = await this.candidates.findOne(candidateId, user);
    const guard = new UntrustedCollector();
    const jobIds = [...new Set(c.applications.map((a) => a.job.id))];
    const stages = await this.prisma.pipelineStage.findMany({
      where: { jobId: { in: jobIds } },
      orderBy: { order: 'asc' },
      select: { jobId: true, name: true },
    });
    const resume = c.resumes[0];
    const parsed = (resume?.parsed ?? null) as { summary?: string; skills?: string[] } | null;
    const notes = c.timeline
      .filter((t) => t.action === ACTIVITY_ACTIONS.CANDIDATE_NOTE_ADDED)
      .slice(0, 5)
      .map((t) => ({
        at: iso(t.createdAt),
        by: t.actor?.name ?? t.actorName,
        note: guard.wrap('note', (t.payload as { note?: string } | null)?.note, 300),
      }));
    const data = {
      id: c.id,
      name: c.name,
      source: c.source,
      tags: guard.tags(c.tags),
      resume: resume
        ? {
            parseStatus: resume.parseStatus,
            skills: guard.tags(parsed?.skills ?? resume.skills),
            summary: guard.wrap('resume_summary', parsed?.summary ?? null, 600),
            excerpt: parsed?.summary ? null : guard.wrap('resume', resume.rawText, 800),
          }
        : null,
      applications: c.applications.map((a) => ({
        applicationId: a.id,
        jobId: a.job.id,
        job: a.job.title,
        status: a.status,
        stage: a.stage.name,
        stages: stages.filter((s) => s.jobId === a.job.id).map((s) => s.name),
        matchScore: a.matchScore,
        offer: a.offer ? { approvalStatus: a.offer.approvalStatus, decision: a.offer.decision } : null,
        interviews: a.interviews.map((i) => ({
          interviewId: i.id,
          round: i.round,
          status: i.status,
          scheduledAt: iso(i.scheduledAt),
          interviewers: i.interviewers.map((x) => x.user.name),
          evaluations: i.evaluations.map((e) => ({
            interviewer: e.interviewer.name,
            conclusion: e.conclusion,
            comments: guard.wrap('evaluation', e.comments, 300),
          })),
        })),
      })),
      notes,
    };
    return { data, summary: c.name, injectionSuspected: guard.suspected };
  }

  private async listJobs(args: Args, user: JwtUser): Promise<ReadResult> {
    const keyword = str(args, 'keyword', { max: 40, optional: true });
    const status = oneOf(args, 'status', ['OPEN', 'PAUSED', 'DRAFT', 'PENDING_APPROVAL', 'CLOSED'] as const, true);
    const page = await this.jobs.list({ page: 1, pageSize: 20, keyword, status } as never, user);
    const items = page.items.map((j) => ({
      id: j.id,
      title: j.title,
      status: j.status,
      department: j.department?.name ?? null,
      hiringManager: j.hiringManager?.name ?? null,
      headcount: j.headcount,
      hcUsed: j.hcUsed,
      applications: j._count.applications,
    }));
    return { data: { total: page.total, summary: page.summary, items }, summary: `${page.total} 个职位` };
  }

  private async jobPipeline(args: Args, user: JwtUser): Promise<ReadResult> {
    const jobId = str(args, 'jobId', { max: 64 });
    const board = await this.applications.board(jobId, user);
    const now = Date.now();
    const columns = board.columns.map((col) => ({
      stage: col.stage.name,
      count: col.applications.length,
      longestWaiting: [...col.applications]
        .sort((a, b) => new Date(a.stageEnteredAt).getTime() - new Date(b.stageEnteredAt).getTime())
        .slice(0, 5)
        .map((a) => ({
          applicationId: a.id,
          candidateId: a.candidate.id,
          name: a.candidate.name,
          matchScore: a.matchScore,
          daysInStage: Math.floor((now - new Date(a.stageEnteredAt).getTime()) / 86_400_000),
        })),
    }));
    const total = columns.reduce((s, c) => s + c.count, 0);
    return { data: { job: board.job, closedCount: board.closedCount, columns }, summary: `${board.job.title} · 在途 ${total} 人` };
  }

  private async upcomingInterviews(args: Args, user: JwtUser): Promise<ReadResult> {
    const days = int(args, 'days', { min: 1, max: 30, fallback: 7 });
    const now = Date.now();
    const until = now + days * 86_400_000;
    const list = (await this.interviews.list(undefined, user)) as Array<{
      id: string;
      round: number;
      status: string;
      scheduledAt: Date | null;
      durationMins: number | null;
      interviewers: Array<{ user: { name: string } }>;
      application?: { candidate: { id: string; name: string }; job: { title: string } };
    }>;
    const items = list
      .filter((i) => i.status === 'SCHEDULED' && i.scheduledAt && +i.scheduledAt >= now && +i.scheduledAt <= until)
      .sort((a, b) => +a.scheduledAt! - +b.scheduledAt!)
      .map((i) => ({
        interviewId: i.id,
        candidate: i.application?.candidate.name ?? null,
        candidateId: i.application?.candidate.id ?? null,
        job: i.application?.job.title ?? null,
        round: i.round,
        scheduledAt: iso(i.scheduledAt),
        localTime: fmtTime(i.scheduledAt!),
        durationMins: i.durationMins,
        interviewers: i.interviewers.map((x) => x.user.name),
      }));
    return { data: { days, items }, summary: `未来 ${days} 天 ${items.length} 场` };
  }

  private async offerStatus(args: Args, user: JwtUser): Promise<ReadResult> {
    const keyword = str(args, 'keyword', { max: 40, optional: true });
    const list = await this.offers.list(user);
    const items = list
      .filter((o) => !keyword || o.application.candidate.name.includes(keyword))
      .slice(0, 20)
      .map((o) => ({
        offerId: o.id,
        candidate: o.application.candidate.name,
        job: o.application.job.title,
        approvalStatus: o.approvalStatus,
        decision: o.decision,
        expiresAt: iso(o.expiresAt),
      }));
    return { data: { items }, summary: `${items.length} 条 Offer` };
  }

  private async funnelInsights(args: Args, user: JwtUser): Promise<ReadResult> {
    const jobId = str(args, 'jobId', { max: 64, optional: true });
    if (!jobId) {
      return { data: { overview: await this.analytics.overview(user) }, summary: '整体概览' };
    }
    const funnel = await this.analytics.funnel(jobId, user);
    return { data: funnel, summary: `${funnel.job.title} · ${funnel.stages.length} 个阶段` };
  }

  // ---------------------------------------------------------------- 写工具：提议

  async propose(name: CopilotWriteTool, args: Args, user: JwtUser): Promise<Proposal> {
    this.assertCallable(name, user);
    switch (name) {
      case 'move_candidate_stage':
        return this.proposeMove(args, user);
      case 'schedule_interview':
        return this.proposeInterview(args, user);
      case 'add_candidate_note':
        return this.proposeNote(args, user);
      case 'draft_evaluation':
        return this.proposeEvaluationDraft(args, user);
      case 'reject_application':
        return this.proposeReject(args, user);
    }
  }

  /** 应聘记录在不在当前用户范围内：候选人可见（仅被指派 / 本部门）+ 职位在本部门 */
  private async loadVisibleApplication(applicationId: string, user: JwtUser) {
    const app = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        candidate: { select: { id: true, name: true } },
        stage: true,
        job: { include: { stages: { orderBy: { order: 'asc' } } } },
        interviews: { select: { round: true } },
      },
    });
    if (!app) throw new NotFoundException('应聘记录不存在');
    if (!inDepartmentScope(departmentScopeOf(user), app.job.departmentId)) {
      throw new ForbiddenException('该应聘不在您的数据范围内（本部门）');
    }
    await this.candidates.findOne(app.candidateId, user); // 复用候选人行级范围校验（仅被指派 / 本部门）
    return app;
  }

  private async proposeMove(args: Args, user: JwtUser): Promise<Proposal> {
    const applicationId = str(args, 'applicationId', { max: 64 });
    const target = str(args, 'targetStage', { max: 64 });
    const reason = str(args, 'reason', { max: 200, min: 2, optional: true });
    const app = await this.loadVisibleApplication(applicationId, user);
    if (app.status !== 'ACTIVE') throw new BadRequestException('该应聘已不在流程中（已淘汰 / 已入职），不能再流转');
    const stage =
      app.job.stages.find((s) => s.id === target) ??
      app.job.stages.find((s) => s.name === target) ??
      app.job.stages.find((s) => s.name.includes(target) || target.includes(s.name));
    if (!stage) {
      throw new ToolArgError(`职位「${app.job.title}」没有阶段「${target}」，可选：${app.job.stages.map((s) => s.name).join('、')}`);
    }
    if (stage.id === app.stageId) throw new ToolArgError(`候选人已经在「${stage.name}」阶段`);
    const backward = stage.order < app.stage.order;
    if (backward && !reason) throw new ToolArgError('这是回退操作，需要提供 reason（回退原因）');
    return {
      args: { applicationId, stageId: stage.id, reason: reason ?? null, expectedVersion: app.version },
      summary: `将 ${app.candidate.name} 从「${app.stage.name}」${backward ? '回退' : '推进'}到「${stage.name}」`,
      fields: [
        { label: '候选人', value: app.candidate.name },
        { label: '职位', value: app.job.title },
        { label: '当前阶段', value: app.stage.name },
        { label: '目标阶段', value: stage.name },
        ...(reason ? [{ label: '原因', value: reason }] : []),
      ],
      danger: false,
    };
  }

  private async proposeInterview(args: Args, user: JwtUser): Promise<Proposal> {
    const applicationId = str(args, 'applicationId', { max: 64 });
    const at = new Date(str(args, 'scheduledAt', { max: 40 }));
    if (Number.isNaN(+at)) throw new ToolArgError('scheduledAt 不是合法时间（ISO 8601）');
    if (+at < Date.now()) throw new ToolArgError('面试时间必须是将来的时间');
    const durationMins = int(args, 'durationMins', { min: 15, max: 240, fallback: 60 });
    const names = strList(args, 'interviewerNames', { maxItems: 5, maxLength: 30 });
    const app = await this.loadVisibleApplication(applicationId, user);
    if (app.status !== 'ACTIVE') throw new BadRequestException('该应聘已不在流程中，不能安排面试');
    let interviewers: Array<{ id: string; name: string }> = [];
    if (names.length) {
      interviewers = await this.prisma.user.findMany({
        where: { name: { in: names }, status: 'ACTIVE' },
        select: { id: true, name: true },
      });
      const missing = names.filter((n) => !interviewers.some((u) => u.name === n));
      if (missing.length) throw new ToolArgError(`找不到在职成员：${missing.join('、')}`);
    } else if (app.job.hiringManagerId) {
      const manager = await this.prisma.user.findUnique({
        where: { id: app.job.hiringManagerId },
        select: { id: true, name: true, status: true },
      });
      if (manager?.status === 'ACTIVE') interviewers = [{ id: manager.id, name: manager.name }];
    }
    if (!interviewers.length) throw new ToolArgError('需要指定面试官（interviewerNames）');
    const round = Math.max(0, ...app.interviews.map((i) => i.round)) + 1;
    return {
      args: { applicationId, round, scheduledAt: at.toISOString(), durationMins, interviewerIds: interviewers.map((u) => u.id) },
      summary: `为 ${app.candidate.name} 安排第 ${round} 轮面试（${fmtTime(at)}）`,
      fields: [
        { label: '候选人', value: app.candidate.name },
        { label: '职位', value: app.job.title },
        { label: '轮次', value: `第 ${round} 轮` },
        { label: '时间', value: `${fmtTime(at)} · ${durationMins} 分钟` },
        { label: '面试官', value: interviewers.map((u) => u.name).join('、') },
      ],
      danger: false,
    };
  }

  private async proposeNote(args: Args, user: JwtUser): Promise<Proposal> {
    const candidateId = str(args, 'candidateId', { max: 64 });
    const note = str(args, 'note', { max: 500, min: 2 });
    const c = await this.candidates.findOne(candidateId, user);
    return {
      args: { candidateId, note },
      summary: `给 ${c.name} 添加备注`,
      fields: [
        { label: '候选人', value: c.name },
        { label: '备注', value: note },
      ],
      danger: false,
    };
  }

  /** 面评草稿：复用第 1 轮 AI 面评草稿能力（同一权限门 + 注入隔离），草稿内容随卡片展示 */
  private async proposeEvaluationDraft(args: Args, user: JwtUser): Promise<Proposal> {
    const interviewId = str(args, 'interviewId', { max: 64 });
    const notes = str(args, 'notes', { max: 2000, min: 4 });
    const interview = await this.interviews.ensureCanEvaluate(interviewId, user);
    const draft = (await this.interviews.draftEvaluation(interviewId, notes, user)) as {
      scorecard: Array<{ dimension: string; score: number; comment?: string }>;
      conclusion: string;
      comments?: string;
    };
    const conclusion = EVALUATION_CONCLUSION_LABEL[draft.conclusion as keyof typeof EVALUATION_CONCLUSION_LABEL] ?? draft.conclusion;
    return {
      args: {
        interviewId,
        notes,
        draft: { scorecard: draft.scorecard, conclusion: draft.conclusion, comments: draft.comments ?? '' },
      },
      summary: `为 ${interview.application.candidate.name} 第 ${interview.round} 轮面试起草面评`,
      fields: [
        { label: '面试', value: `${interview.application.candidate.name} · ${interview.application.job.title} · 第 ${interview.round} 轮` },
        { label: '评分', value: draft.scorecard.map((s) => `${s.dimension} ${s.score}`).join('，') },
        { label: '结论（草稿）', value: conclusion },
        { label: '说明', value: '确认后仅保存为草稿，需你在面评表单核对后提交' },
      ],
      danger: false,
    };
  }

  private async proposeReject(args: Args, user: JwtUser): Promise<Proposal> {
    const applicationId = str(args, 'applicationId', { max: 64 });
    const reason = oneOf(args, 'reason', REJECT_REASONS)!;
    const note = str(args, 'note', { max: 300, optional: true });
    const app = await this.loadVisibleApplication(applicationId, user);
    if (app.status !== 'ACTIVE') throw new BadRequestException('该应聘已不在流程中');
    return {
      args: { applicationId, reason, note: note ?? null, expectedVersion: app.version },
      summary: `淘汰 ${app.candidate.name}（${app.job.title}）`,
      fields: [
        { label: '候选人', value: app.candidate.name },
        { label: '职位', value: app.job.title },
        { label: '当前阶段', value: app.stage.name },
        { label: '原因', value: reason },
        ...(note ? [{ label: '说明', value: note }] : []),
      ],
      danger: true,
    };
  }

  // ---------------------------------------------------------------- 写工具：确认后执行

  /** 以确认时的身份重新执行：业务服务内的范围 / 终态 / 乐观锁校验全部再跑一次 */
  async execute(name: CopilotWriteTool, args: Args, user: JwtUser): Promise<ExecutionResult> {
    this.assertCallable(name, user);
    switch (name) {
      case 'move_candidate_stage': {
        const moved = await this.applications.moveStage(
          String(args.applicationId),
          {
            stageId: String(args.stageId),
            reason: (args.reason as string | null) ?? undefined,
            expectedVersion: Number(args.expectedVersion),
          },
          user,
        );
        const app = await this.prisma.application.findUnique({
          where: { id: String(args.applicationId) },
          select: { candidateId: true, jobId: true, stage: { select: { name: true } }, candidate: { select: { name: true } } },
        });
        void moved;
        return {
          message: `已将 ${app?.candidate.name ?? '候选人'} 移到「${app?.stage.name ?? ''}」`,
          link: app ? `/candidates/${app.candidateId}` : undefined,
        };
      }
      case 'schedule_interview': {
        const created = (await this.interviews.create(
          {
            applicationId: String(args.applicationId),
            round: Number(args.round),
            scheduledAt: String(args.scheduledAt),
            durationMins: Number(args.durationMins),
            interviewerIds: (args.interviewerIds as string[]) ?? [],
          },
          user,
        )) as { id: string };
        return { message: `面试已创建（${fmtTime(String(args.scheduledAt))}）`, link: `/interviews?focus=${created.id}` };
      }
      case 'add_candidate_note': {
        const candidateId = String(args.candidateId);
        const c = await this.candidates.findOne(candidateId, user);
        await this.activityLog.record(user, ACTIVITY_ACTIONS.CANDIDATE_NOTE_ADDED, 'Candidate', candidateId, {
          note: String(args.note),
          via: 'copilot',
        });
        return { message: `已在 ${c.name} 的时间轴添加备注`, link: `/candidates/${candidateId}` };
      }
      case 'draft_evaluation': {
        const interviewId = String(args.interviewId);
        // 以确认时的权限复核：仍是本场面试官 / 本部门；面试未取消
        const interview = await this.interviews.ensureCanEvaluate(interviewId, user);
        return {
          message: `面评草稿已保存，请打开面评表单核对后提交（${interview.application.candidate.name} 第 ${interview.round} 轮）`,
          link: `/interviews?evaluate=${interviewId}`,
          draft: args.draft as ExecutionResult['draft'],
        };
      }
      case 'reject_application': {
        const id = String(args.applicationId);
        const current = await this.prisma.application.findUnique({ where: { id }, select: { version: true, candidateId: true } });
        if (!current) throw new NotFoundException('应聘记录不存在');
        if (current.version !== Number(args.expectedVersion)) {
          throw new ConflictException('该候选人的状态在提议之后已被修改，请重新确认');
        }
        await this.applications.reject(id, { reason: String(args.reason), note: (args.note as string | null) ?? undefined }, user);
        return { message: `已淘汰（原因：${String(args.reason)}）`, link: `/candidates/${current.candidateId}` };
      }
    }
  }
}

/** 错误 → 给模型 / 用户看的一句话（HttpException 的 message 已是面向用户的中文） */
export function toolErrorMessage(error: unknown): string {
  if (error instanceof ToolArgError) return error.message;
  if (error instanceof HttpException) {
    const res = error.getResponse() as string | { message?: string | string[] };
    const msg = typeof res === 'string' ? res : res.message;
    return Array.isArray(msg) ? msg.join('；') : (msg ?? error.message);
  }
  return '查询失败，请稍后重试';
}
