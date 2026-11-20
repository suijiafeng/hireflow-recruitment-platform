import type { ApplicationStatus, JobStatus, OfferStatus, StageKind } from '@hireflow/shared';

export interface Paginated<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

/** 职位列表顶部的口径：范围内全部职位，不随分页或状态页签缩小 */
export interface JobListSummary {
  open: number;
  draft: number;
  headcount: number;
  hcUsed: number;
  inFlow: number;
}

export interface Department {
  id: string;
  name: string;
}

/** GET /departments 的完整行（设置页部门管理用） */
export interface DepartmentItem extends Department {
  parentId: string | null;
  _count: { users: number; jobs: number; children: number };
}

export interface CompanyDoc {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UserBrief {
  id: string;
  name: string;
  email?: string;
}

/** GET /users 的完整行（设置页成员管理用；选择器场景只取 id/name/email） */
export interface UserItem extends UserBrief {
  email: string;
  status: string;
  department: { id: string; name: string } | null;
  roles: Array<{ role: { code: string; name: string } }>;
  createdAt: string;
}

export interface ScorecardDimension {
  dimension: string;
  weight: number;
}

export interface Job {
  id: string;
  title: string;
  description?: string | null;
  requirement?: string | null;
  headcount: number;
  status: JobStatus;
  department: Department;
  hiringManager: UserBrief | null;
  scorecardTemplate?: ScorecardDimension[] | null;
  _count?: { applications: number };
  /** 已入职 + 已接受 Offer 的在途人数 */
  hcUsed?: number;
  createdAt: string;
}

export interface JobStage {
  id: string;
  jobId: string;
  name: string;
  kind: StageKind;
  order: number;
  _count: { applications: number };
}

/** 顺序由数组位置决定；新增阶段不传 id。 */
export interface JobStageInput {
  id?: string;
  name: string;
}

/** 看板卡片上的面试轮次标签（最近一轮） */
export interface InterviewTag {
  round: number;
  state: 'unscheduled' | 'scheduled' | 'awaiting_evaluation' | 'evaluated';
  scheduledAt: string | null;
  submitted: number;
  total: number;
}

export interface CandidateApplicationBrief {
  id: string;
  job: { id: string; title: string };
  stage: { id: string; name: string; kind?: StageKind };
  status: ApplicationStatus;
  /** 候选人库列表用它显示匹配分；接口一直有返回，之前类型漏了 */
  matchScore?: number | null;
  matchSource?: MatchSource | null;
}

export interface Candidate {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  tags: string[];
  applications?: CandidateApplicationBrief[];
  _count?: { resumes: number };
  createdAt: string;
}

/** 候选人列表筛选（列表与导出共用；与后端 CandidateFilterDto 对应） */
export interface CandidateFilters {
  keyword?: string;
  stage?: 'screening';
  jobId?: string;
  stageKind?: StageKind;
  status?: ApplicationStatus | 'NONE';
  source?: string;
  minScore?: number;
  createdFrom?: string;
  createdTo?: string;
}

export interface IntakeResult {
  candidate: { id: string; name: string };
  created: boolean;
  matchedBy: 'email' | 'phone' | null;
  backfilled: string[];
  resumeId: string;
  parsed: boolean;
  skills: string[];
  application: { id: string; revived: boolean } | null;
  score: number | null;
  warnings: string[];
}

export interface Evaluation {
  id: string;
  interviewer: UserBrief;
  conclusion: string | null;
  comments: string | null;
  scorecard: Array<{ dimension: string; score: number; comment?: string }> | null;
  submittedAt: string | null;
}

export interface Interview {
  id: string;
  round: number;
  scheduledAt: string | null;
  durationMins: number | null;
  meetingUrl: string | null;
  status: string;
  interviewers: Array<{ user: UserBrief }>;
  evaluations: Evaluation[];
  application?: {
    id: string;
    candidate: { id: string; name: string };
    job: { id: string; title: string; scorecardTemplate?: ScorecardDimension[] | null };
    stage: { name: string };
  };
}

export interface Resume {
  id: string;
  fileName: string | null;
  fileKey: string | null;
  parseStatus: string;
  /** 最近一次进入 PARSING 的时间；超过 2 分钟仍是 PARSING 视为中断，可重试 */
  parseStartedAt?: string | null;
  skills: string[];
  rawText: string | null;
  parsed: { summary?: string; injectionSuspected?: boolean; aiMeta?: AiMeta } | null;
  createdAt: string;
}

export interface ActivityItem {
  id: string;
  action: string;
  actorName: string | null;
  actor: { id: string; name: string } | null;
  payload: Record<string, unknown> | null;
  entityType?: string;
  entityId?: string;
  createdAt: string;
}

export interface PermissionDef {
  id: string;
  code: string;
  name: string;
  group: string;
}

export interface Role {
  id: string;
  code: string;
  name: string;
  dataScope: string;
  permissions: Array<{ permission: PermissionDef }>;
  _count: { users: number };
}

export interface DetailApplication {
  id: string;
  /** 注意：详情接口的 job 只带 id/title/scorecardTemplate，不含 department */
  job: { id: string; title: string; scorecardTemplate?: ScorecardDimension[] | null };
  stage: { id: string; name: string };
  status: ApplicationStatus;
  matchScore: number | null;
  /** 分数口径：ai = 大模型；rule = 规则引擎（未配模型或降级）；旧数据为空 */
  matchSource?: MatchSource | null;
  matchReport?: MatchReport | null;
  /** 终态应聘的淘汰原因码；接口一直有返回，之前类型漏了 */
  rejectReason?: string | null;
  offer?: { id: string; status: OfferStatus; decision: string | null } | null;
  interviews: Interview[];
}

export interface CandidateDetail extends Candidate {
  resumes: Resume[];
  applications: (CandidateApplicationBrief & DetailApplication)[];
  timeline: ActivityItem[];
}

export interface AiMeta {
  provider: string;
  degraded: boolean;
  cached?: boolean;
}

export type MatchSource = 'ai' | 'rule';

export interface AiStatus {
  provider: string;
  mode: 'llm' | 'mock';
  label: string;
  models: { smart: string; fast: string } | null;
  promptVersion: string;
  timeoutMs: number;
  deadlineMs: number;
  maxConcurrency: number;
}

export interface AiUsageSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  unpricedCalls: number;
  p95LatencyMs: number | null;
  cacheHitRate: number;
  degradeRate: number;
}

export interface AiUsage {
  days: number;
  since: string;
  status: AiStatus;
  total: AiUsageSummary;
  byCapability: Array<AiUsageSummary & { capability: string }>;
}

export interface MatchReport {
  score: number;
  hits: string[];
  misses: string[];
  highlights: string;
  risks: string;
  /** 经过原文核对的命中证据 */
  evidence?: Array<{ requirement: string; quote: string }>;
  injectionSuspected?: boolean;
  aiMeta?: AiMeta;
}

export interface JdDraft {
  description: string;
  requirement: string;
  aiMeta: AiMeta;
}

export interface EvaluationDraft {
  scorecard: Array<{ dimension: string; score: number; comment: string }>;
  conclusion: string;
  comments: string;
  aiMeta: AiMeta;
}

export interface FunnelStage {
  id: string;
  name: string;
  current: number;
  reached: number;
  conversion: number | null;
}

export interface FunnelData {
  job: { id: string; title: string };
  stages: FunnelStage[];
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface AnalyticsOverview {
  openJobs: number;
  pausedJobs: number;
  candidates: number;
  upcomingInterviews: number;
  hired: number;
}

export interface BoardCard {
  id: string;
  status: ApplicationStatus;
  matchScore: number | null;
  matchSource?: MatchSource | null;
  position: number;
  createdAt: string;
  stageId: string;
  stageEnteredAt: string;
  version: number;
  interview?: InterviewTag | null;
  candidate: { id: string; name: string; tags: string[]; source: string | null };
}

/**
 * 加入职位流程的结果：revived=true 表示复活了该候选人此前被淘汰/撤回的应聘记录
 * （唯一键 candidateId+jobId 决定了不可能新建第二条），前端据此换一句提示。
 */
export interface ApplicationCreateResult extends BoardCard {
  revived: boolean;
}

export interface OfferSalary {
  base: number;
  bonusMonths: number;
  note?: string | null;
}

export interface Offer {
  id: string;
  salary: OfferSalary | null;
  grade: string | null;
  /** 预计入职日期 YYYY-MM-DD（老数据可能为空） */
  startDate: string | null;
  status: OfferStatus;
  decision: string | null;
  decisionReason: string | null;
  sentAt: string | null;
  expiresAt: string | null;
  extendedOnce: boolean;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
  application: {
    id: string;
    stageId: string;
    candidate: { id: string; name: string; tags: string[] };
    job: { id: string; title: string; department: { name: string } };
  };
}

export interface Contract {
  id: string;
  templateName: string | null;
  variables: Record<string, unknown> | null;
  signStatus: 'PENDING' | 'SIGNED';
  signedAt: string | null;
  signerName: string | null;
}

export type OnboardingInfo = Record<string, string>;

export interface Onboarding {
  id: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  info: OnboardingInfo | null;
  infoSubmittedAt: string | null;
  completedAt: string | null;
  contract: Contract | null;
  createdAt: string;
  application: {
    id: string;
    status: ApplicationStatus;
    candidate: { id: string; name: string; phone: string | null; email: string | null };
    job: { id: string; title: string; department: { name: string } };
  };
  /** 预计入职日期 YYYY-MM-DD */
  startDate?: string | null;
  /** 无 onboarding:manage 时证件号等只给尾号 */
  infoMasked?: boolean;
  ready?: boolean;
}

export interface PortalSlot {
  id: string;
  startAt: string;
  endAt: string;
}

/** 候选人页（/portal/:token）：一条应聘一个链接 */
export interface PortalView {
  company: string;
  candidateName: string;
  jobTitle: string;
  department: string;
  status: ApplicationStatus;
  expiresAt: string | null;
  hrContact: { name: string; email: string } | null;
  step: 'interview' | 'offer' | 'onboarding' | 'hired' | 'closed';
  interviews: Array<{
    id: string;
    round: number;
    roundLabel: string;
    durationMins: number;
    scheduledAt: string | null;
    meetingUrl: string | null;
    location: string | null;
    status: string;
    interviewers: string[];
    slots: PortalSlot[];
  }>;
  offer:
    | ({
        status: OfferStatus;
        decision: string | null;
        decisionReason: string | null;
        respondedAt: string | null;
        declineReasons: readonly string[];
      } & (
        | { preparing: true }
        | {
            preparing: false;
            salary: OfferSalary | null;
            grade: string | null;
            startDate: string | null;
            sentAt: string | null;
            expiresAt: string | null;
            extendedOnce: boolean;
          }
      ))
    | null;
  onboarding: {
    status: 'IN_PROGRESS' | 'COMPLETED';
    fields: ReadonlyArray<{ key: string; label: string; sensitive: boolean }>;
    info: OnboardingInfo | null;
    infoSubmittedAt: string | null;
    contract: {
      templateName: string | null;
      signStatus: 'PENDING' | 'SIGNED';
      variables: Record<string, unknown> | null;
      signedAt: string | null;
      signerName: string | null;
    } | null;
    completedAt: string | null;
  } | null;
}

export interface HelpdeskAnswer {
  answer: string;
  sources: Array<{ id: string; title: string }>;
  aiMeta: AiMeta;
}

export interface TodoSummary {
  newResumes: number | null;
  myPendingEvaluations: number;
  offersDue: number | null;
  onboardingInProgress: number | null;
  onboardingReady: number | null;
}

/** 面试官可约时段（自助选时） */
export interface InterviewerSlot {
  id: string;
  startAt: string;
  endAt: string;
  bookedBy: string | null;
  /** 被预约时的可读说明「候选人 · 职位」；bookedBy 本身是面试 ID，不可直接展示 */
  bookedLabel: string | null;
  /** 预约方候选人，供面试官点进详情 */
  bookedCandidateId: string | null;
  bookedRound: number | null;
}

export interface BoardColumn {
  stage: { id: string; name: string; kind: StageKind; order: number };
  applications: BoardCard[];
}

/** 近 N 周投递/入职趋势（大盘折线图） */
export interface TrendData {
  weeks: number;
  start: string;
  points: Array<{ week: string; applied: number; hired: number }>;
}

/** 数据洞察报表 */
/** 洞察筛选：与后端 QueryInsightsDto 保持一致 */
export type InsightsRange = '30d' | 'quarter' | 'year' | 'all';

export interface CreateRoleInput {
  code: string;
  name: string;
  dataScope?: 'ALL' | 'DEPARTMENT' | 'ASSIGNED';
  permissions?: string[];
}

export interface InviteUserInput {
  email: string;
  name: string;
  departmentId?: string;
  roleCodes: string[];
}

export interface InsightsData {
  /** 后端回显的实际生效口径与样本量 */
  scope: {
    range: InsightsRange;
    deptId: string | null;
    since: string | null;
    applications: number;
  };
  tth: {
    medianDays: number | null;
    hiredCount: number;
    byJob: Array<{ jobTitle: string; medianDays: number | null; hired: number }>;
  };
  offer: {
    sent: number;
    accepted: number;
    acceptRate: number | null;
    renegeCount: number;
    renegeRate: number | null;
  };
  channels: Array<{
    source: string;
    applied: number;
    interviewed: number;
    offered: number;
    accepted: number;
    hired: number;
    interviewRate: number | null;
    hireRate: number | null;
  }>;
  interviewers: Array<{
    name: string;
    evaluations: number;
    onTimeRate: number | null;
    passRate: number | null;
    passRateDeviation: number | null;
  }>;
  overallPassRate: number | null;
  stageStay: Array<{ stage: string; samples: number; p50Days: number | null; p90Days: number | null }>;
}

/** 人才库唤醒推荐（历史候选人 × 新职位 AI 重新打分） */
export interface TalentPoolRecommendation {
  candidate: { id: string; name: string; tags: string[]; source: string | null };
  score: number;
  hits: string[];
  highlights: string;
  aiMeta: AiMeta;
  /** false = 降级到规则引擎的分数，口径不同，排在大模型结果之后、不参与排序 */
  ranked?: boolean;
  lastApplication: {
    jobTitle: string;
    status: string;
    rejectReason: string | null;
    updatedAt: string;
  } | null;
}

export interface TalentPoolScanResult {
  job: { id: string; title: string };
  scanned: number;
  /** 粗排后实际交给大模型精排的人数 */
  aiScored?: number;
  /** 超出时间预算未评估的人数 */
  skipped?: number;
  degraded?: number;
  recommendations: TalentPoolRecommendation[];
}

/** 单人评分结果；degradedKept = 本次降级，保留了原来的大模型分数 */
export type ScoreResult = BoardCard & { matchReport?: MatchReport | null; aiMeta: AiMeta; degradedKept?: boolean };

/** 批量操作结果（部分失败不回滚，错误报告模式） */
export interface BatchResult {
  total: number;
  succeeded: number;
  failed: Array<{ id: string; candidate: string | null; error: string }>;
}

export interface BoardData {
  job: { id: string; title: string; status: JobStatus };
  /** 已淘汰/撤回的应聘数（不进看板列，仅用于区分空态文案） */
  closedCount: number;
  columns: BoardColumn[];
}
