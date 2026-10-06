import type { ApplicationStatus, JobStatus } from '@hireflow/shared';

export interface Paginated<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
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
  createdAt: string;
}

export interface CandidateApplicationBrief {
  id: string;
  job: { id: string; title: string };
  stage: { id: string; name: string };
  status: ApplicationStatus;
  /** 候选人库列表用它显示匹配分；接口一直有返回，之前类型漏了 */
  matchScore?: number | null;
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
  skills: string[];
  rawText: string | null;
  parsed: { summary?: string } | null;
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
  matchReport?: MatchReport | null;
  /** 终态应聘的淘汰原因码；接口一直有返回，之前类型漏了 */
  rejectReason?: string | null;
  offer?: { id: string; approvalStatus: string; decision: string | null } | null;
  prescreen?: PrescreenAnswers | null;
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
}

export interface MatchReport {
  score: number;
  hits: string[];
  misses: string[];
  highlights: string;
  risks: string;
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
  position: number;
  createdAt: string;
  stageId: string;
  stageEnteredAt: string;
  version: number;
  prescreen?: PrescreenAnswers | null;
  candidate: { id: string; name: string; tags: string[]; source: string | null };
}

/** 候选人在预筛门户填的三问 + 规则核验出的不符项 */
export interface PrescreenAnswers {
  expectedSalary: number;
  availableDate: string;
  travelOk: boolean;
  note: string | null;
  flags: string[];
  submittedAt: string;
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
  approvalStatus: string;
  approvalNote: string | null;
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

export interface RetentionHint {
  probability: number;
  factors: string[];
  aiMeta: AiMeta;
}

export interface ChecklistItem {
  key: string;
  label: string;
  owner: 'HR' | 'IT' | 'NEW_HIRE';
  done: boolean;
  doneAt: string | null;
}

export interface OnboardingDocument {
  type: string;
  label: string;
  fields: Record<string, string>;
  addedAt: string;
  ocrProvider: string;
  fileName?: string | null;
  fileUrl?: string | null; // 原件预签名预览链接（10 分钟有效）
  needsReview?: boolean; // 未识别出字段：待人工核对（低置信度阻断）
  redacted?: boolean; // 当前角色无权查看证件字段（如 IT），fields 被服务端清空
}

export interface Contract {
  id: string;
  templateName: string | null;
  variables: Record<string, unknown> | null;
  signStatus: string;
  evidenceNo: string | null;
}

export interface Onboarding {
  id: string;
  status: string;
  checklist: ChecklistItem[];
  documents: OnboardingDocument[] | null;
  contract: Contract | null;
  progress: { done: number; total: number };
  createdAt: string;
  application: {
    id: string;
    candidate: { id: string; name: string; phone: string | null; email: string | null };
    job: { id: string; title: string; department: { name: string } };
  };
}

/** 候选人免登录 Offer 门户视图（/portal/offer/:token） */
export interface OfferPortalView {
  company: string;
  candidateName: string;
  jobTitle: string;
  department: string;
  status: string;
  decision: string | null;
  decisionReason: string | null;
  respondedAt: string | null;
  declineReasons: readonly string[];
  /** 对接 HR（门户里「联系 HR」用） */
  hrContact: { name: string; email: string } | null;
  /** 议价/重提中：老链接不展示已撤回的薪资方案 */
  preparing: boolean;
  salary?: OfferSalary | null;
  grade?: string | null;
  startDate?: string | null;
  sentAt?: string | null;
  expiresAt?: string | null;
  extendedOnce?: boolean;
  onboardingPortalToken?: string | null;
}

/** 新员工免登录入职门户视图（/portal/onboarding/:token） */
export interface OnboardingPortalView {
  company: string;
  candidateName: string;
  jobTitle: string;
  department: string;
  status: string;
  checklist: ChecklistItem[];
  documents: Array<{
    type: string;
    label: string;
    fields: Record<string, string>;
    addedAt: string;
    needsReview?: boolean;
    fileUrl?: string | null;
  }>;
  contract: {
    templateName: string | null;
    signStatus: string;
    variables: Record<string, unknown> | null;
    evidenceNo: string | null;
  } | null;
  progress: { done: number; total: number };
}

export interface HelpdeskAnswer {
  answer: string;
  sources: Array<{ id: string; title: string }>;
  aiMeta: AiMeta;
}

export interface TodoSummary {
  newResumes: number | null;
  myPendingEvaluations: number;
  pendingOffers: number | null;
  rejectedOffers: number | null;
  offersDue: number | null;
  onboardingInProgress: number | null;
  docsNeedReview: number | null;
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

export interface InterviewPortalView {
  company: string;
  candidateName: string;
  jobTitle: string;
  round: number;
  durationMins: number;
  scheduledAt: string | null;
  status: string;
  slots: Array<{ id: string; startAt: string; endAt: string }>;
}

export interface PrescreenView {
  company: string;
  candidateName: string;
  jobTitle: string;
  prescreen: PrescreenAnswers | null;
  /** 应聘已终结（淘汰 / 撤回 / 入职），问卷不再开放 */
  closed?: boolean;
}

/** 候选人对比（2-4 人并排 + AI 综合意见） */
export interface CompareData {
  jobTitle: string;
  candidates: Array<{
    applicationId: string;
    name: string;
    matchScore: number | null;
    tags: string[];
    highlights: string | null;
    risks: string | null;
    evaluations: Array<{ conclusion: string | null; avgScore: number | null; comments: string | null }>;
  }>;
  ai: {
    summary: string;
    ranking: Array<{ name: string; rank: number; rationale: string }>;
    risks: string;
  };
  aiMeta: AiMeta;
}

export interface BoardColumn {
  stage: { id: string; name: string; order: number };
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
  dataScope?: 'ALL' | 'DEPARTMENT' | 'OWN' | 'ASSIGNED';
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
  recommendations: TalentPoolRecommendation[];
}

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
