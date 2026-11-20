import type { AuthUser } from '../stores/auth';
import { AI_BATCH_TIMEOUT_MS, aiRequest, http } from './client';
import type {
  AiMeta,
  AiStatus,
  AiUsage,
  ScoreResult,
  AnalyticsOverview,
  ApplicationCreateResult,
  CreateRoleInput,
  InsightsRange,
  InviteUserInput,
  NotificationItem,
  BatchResult,
  BoardCard,
  BoardData,
  Candidate,
  CandidateDetail,
  CompanyDoc,
  Department,
  DepartmentItem,
  EvaluationDraft,
  FunnelData,
  ActivityItem,
  InsightsData,
  Interview,
  InterviewerSlot,
  JdDraft,
  Job,
  JobListSummary,
  JobStage,
  JobStageInput,
  Offer,
  Onboarding,
  Paginated,
  PortalView,
  HelpdeskAnswer,
  PermissionDef,
  Resume,
  Role,
  TalentPoolScanResult,
  TodoSummary,
  TrendData,
  UserItem,
} from './types';

export const authApi = {
  login: (data: { email: string; password: string }) =>
    http.post<{ accessToken: string; user: AuthUser }>('/auth/login', data).then((r) => r.data),
  /** 接口的 roles 是 {code,name,dataScope}[]，这里压平成与登录返回一致的 AuthUser */
  profile: () =>
    http
      .get<Omit<AuthUser, 'roles'> & { roles: Array<{ code: string }> }>('/auth/profile')
      .then((r): AuthUser => ({ ...r.data, roles: r.data.roles.map((role) => role.code) })),
  /** 修改自己的密码：其他设备上的登录立即失效，返回当前会话的新令牌 */
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    http.post<{ accessToken: string }>('/auth/password', data).then((r) => r.data),
  /** 退出其他所有设备：返回当前会话的新令牌 */
  revokeSessions: () => http.post<{ accessToken: string }>('/auth/sessions/revoke').then((r) => r.data),
};

export const jobsApi = {
  getStages: (id: string, signal?: AbortSignal) =>
    http.get<JobStage[]>(`/jobs/${id}/stages`, { signal }).then((r) => r.data),
  updateStages: (id: string, stages: JobStageInput[]) =>
    http.put<JobStage[]>(`/jobs/${id}/stages`, { stages }).then((r) => r.data),
  list: (params: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    status?: string;
    departmentId?: string;
  }) => http.get<Paginated<Job> & { summary: JobListSummary }>('/jobs', { params }).then((r) => r.data),
  create: (data: {
    title: string;
    departmentId: string;
    hiringManagerId?: string;
    description?: string;
    headcount?: number;
  }) => http.post<Job>('/jobs', data).then((r) => r.data),
  update: (
    id: string,
    data: Partial<{
      title: string;
      departmentId: string;
      hiringManagerId: string;
      description: string;
      requirement: string;
      headcount: number;
      status: string;
      scorecardTemplate: Array<{ dimension: string; weight: number }>;
    }>,
  ) => http.patch<Job>(`/jobs/${id}`, data).then((r) => r.data),
  remove: (id: string) => http.delete<{ ok: true }>(`/jobs/${id}`).then((r) => r.data),
  talentPoolScan: (jobId: string) =>
    http.post<TalentPoolScanResult>(`/jobs/${jobId}/talent-pool/scan`, undefined, { timeout: AI_BATCH_TIMEOUT_MS }).then((r) => r.data),
  talentPoolActivate: (jobId: string, candidateId: string) =>
    http.post<ApplicationCreateResult>(`/jobs/${jobId}/talent-pool/activate`, { candidateId }).then((r) => r.data),
};

export const boardApi = {
  get: (jobId: string) => http.get<BoardData>(`/jobs/${jobId}/board`).then((r) => r.data),
  moveCard: (
    applicationId: string,
    data: { stageId: string; reason?: string; expectedVersion?: number },
  ) => http.patch<BoardCard>(`/applications/${applicationId}/stage`, data).then((r) => r.data),
  reject: (applicationId: string, data: { reason: string; note?: string }) =>
    http.post<BoardCard>(`/applications/${applicationId}/reject`, data).then((r) => r.data),
  batchReject: (data: { ids: string[]; reason: string; note?: string }) =>
    http.post<BatchResult>('/applications/batch/reject', data).then((r) => r.data),
  batchMove: (data: { ids: string[]; stageId: string; reason?: string }) =>
    http.post<BatchResult>('/applications/batch/move', data).then((r) => r.data),
};

export const candidatesApi = {
  list: (params: { page?: number; pageSize?: number; keyword?: string; stage?: 'screening' }) =>
    http.get<Paginated<Candidate>>('/candidates', { params }).then((r) => r.data),
  create: (data: { name: string; email?: string; phone?: string; source?: string; tags?: string[] }) =>
    http.post<Candidate>('/candidates', data).then((r) => r.data),
  update: (
    id: string,
    data: Partial<{ name: string; email: string; phone: string; source: string; tags: string[] }>,
  ) => http.patch<Candidate>(`/candidates/${id}`, data).then((r) => r.data),
  remove: (id: string) => http.delete<{ ok: true }>(`/candidates/${id}`).then((r) => r.data),
  get: (id: string) => http.get<CandidateDetail>(`/candidates/${id}`).then((r) => r.data),
  addResume: (id: string, data: { rawText: string; fileName?: string }) =>
    http.post<Resume>(`/candidates/${id}/resumes`, data).then((r) => r.data),
  addResumeFile: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return http
      .post<Resume & { textExtracted: boolean }>(`/candidates/${id}/resumes/file`, form)
      .then((r) => r.data);
  },
};

export const applicationsApi = {
  create: (data: { candidateId: string; jobId: string }) =>
    http.post<ApplicationCreateResult>('/applications', data).then((r) => r.data),
  score: (id: string) => http.post<ScoreResult>(`/applications/${id}/score`, undefined, aiRequest).then((r) => r.data),
  /**
   * 候选人页链接：选面试时间、答复 Offer、填写入职信息共用一个链接。
   * rotate=true 重新生成，旧链接立即失效；有效期内再取会顺延。
   */
  portalLink: (id: string, rotate = false) =>
    http.post<{ token: string; expiresAt: string }>(`/applications/${id}/portal-link`, { rotate }).then((r) => r.data),
};

export const resumesApi = {
  parse: (id: string) => http.post<Resume & { aiMeta?: AiMeta }>(`/resumes/${id}/parse`, undefined, aiRequest).then((r) => r.data),
  fileUrl: (id: string) => http.get<{ url: string }>(`/resumes/${id}/file-url`).then((r) => r.data),
};

export const aiApi = {
  /** 当前 AI 引擎（供应商 / 模型），任何登录用户可读 */
  status: () => http.get<AiStatus>('/ai/status').then((r) => r.data),
  /** 用量面板（需要系统配置权限） */
  usage: (days = 7) => http.get<AiUsage>('/ai/usage', { params: { days } }).then((r) => r.data),
  generateJd: (data: { title: string; departmentName?: string; keywords?: string }) =>
    http.post<JdDraft>('/ai/generate-jd', data, aiRequest).then((r) => r.data),
};

export const offersApi = {
  list: () => http.get<Offer[]>('/offers').then((r) => r.data),
  create: (data: {
    applicationId: string;
    salaryBase: number;
    bonusMonths?: number;
    startDate: string;
    grade?: string;
    note?: string;
  }) => http.post<Offer>('/offers', data).then((r) => r.data),
  send: (id: string) => http.post<Offer>(`/offers/${id}/send`).then((r) => r.data),
  extend: (id: string) => http.post<Offer>(`/offers/${id}/extend`).then((r) => r.data),
  respond: (id: string, decision: 'ACCEPTED' | 'DECLINED', reason?: string) =>
    http.post<Offer>(`/offers/${id}/respond`, { decision, reason }).then((r) => r.data),
};

/** 候选人页（免登录，链接即凭证，不带 JWT） */
export const portalApi = {
  view: (token: string) => http.get<PortalView>(`/portal/${token}`).then((r) => r.data),
  pick: (token: string, interviewId: string, slotId: string, startAt?: string) =>
    http.post<PortalView>(`/portal/${token}/interviews/${interviewId}/pick`, { slotId, startAt }).then((r) => r.data),
  respond: (token: string, decision: 'ACCEPTED' | 'DECLINED', reason?: string) =>
    http.post<PortalView>(`/portal/${token}/offer/respond`, { decision, reason }).then((r) => r.data),
  saveInfo: (token: string, info: Record<string, string>) =>
    http.put<PortalView>(`/portal/${token}/onboarding/info`, info).then((r) => r.data),
  sign: (token: string, signerName: string) =>
    http.post<PortalView>(`/portal/${token}/onboarding/contract/sign`, { signerName }).then((r) => r.data),
  ask: (token: string, question: string) =>
    http.post<HelpdeskAnswer>(`/portal/${token}/onboarding/ask`, { question }, aiRequest).then((r) => r.data),
};

export const notificationsApi = {
  list: () =>
    http
      .get<{ items: NotificationItem[]; unread: number }>('/notifications')
      .then((r) => r.data),
  markRead: (id: string) =>
    http
      .patch<{ items: NotificationItem[]; unread: number }>(`/notifications/${id}/read`)
      .then((r) => r.data),
  markAllRead: () =>
    http
      .patch<{ items: NotificationItem[]; unread: number }>('/notifications/read-all')
      .then((r) => r.data),
};

export const onboardingApi = {
  list: () => http.get<Onboarding[]>('/onboardings').then((r) => r.data),
  get: (id: string) => http.get<Onboarding>(`/onboardings/${id}`).then((r) => r.data),
  complete: (id: string, note?: string) =>
    http.post<Onboarding>(`/onboardings/${id}/complete`, { note }).then((r) => r.data),
};

export const analyticsApi = {
  overview: () => http.get<AnalyticsOverview>('/analytics/overview').then((r) => r.data),
  todos: () => http.get<TodoSummary>('/analytics/todos').then((r) => r.data),
  funnel: (jobId: string) => http.get<FunnelData>(`/analytics/funnel/${jobId}`).then((r) => r.data),
  trend: () => http.get<TrendData>('/analytics/trend').then((r) => r.data),
  /** range/deptId 按「应聘创建时间」划同期群；五组指标共用同一口径，响应 scope 回显实际生效范围 */
  insights: (params?: { range?: InsightsRange; deptId?: string }) =>
    http.get<InsightsData>('/analytics/insights', { params }).then((r) => r.data),
};

export const interviewsApi = {
  list: (applicationId?: string) =>
    http
      .get<Interview[]>('/interviews', { params: applicationId ? { applicationId } : undefined })
      .then((r) => r.data),
  create: (data: {
    applicationId: string;
    round: number;
    scheduledAt?: string;
    durationMins?: number;
    meetingUrl?: string;
    interviewerIds: string[];
  }) => http.post<Interview>('/interviews', data).then((r) => r.data),
  submitEvaluation: (
    interviewId: string,
    data: {
      scorecard: Array<{ dimension: string; score: number; comment?: string }>;
      conclusion: string;
      comments?: string;
    },
  ) => http.post(`/interviews/${interviewId}/evaluations`, data).then((r) => r.data),
  draftEvaluation: (interviewId: string, notes: string) =>
    http
      .post<EvaluationDraft>(`/interviews/${interviewId}/evaluation-draft`, { notes }, aiRequest)
      .then((r) => r.data),
  cancel: (interviewId: string) =>
    http.post<Interview>(`/interviews/${interviewId}/cancel`).then((r) => r.data),
  /** HR 直接敲定/改期，不走候选人自助选时 */
  schedule: (
    interviewId: string,
    data: { scheduledAt: string; durationMins?: number; ignoreConflict?: boolean },
  ) => http.post<Interview>(`/interviews/${interviewId}/schedule`, data).then((r) => r.data),
  /** rotate=true 重新生成链接，旧链接立即失效；链接 7 天有效，有效期内重发会顺延 */
  selfScheduleLink: (interviewId: string, rotate = false) =>
    http.post<{ token: string }>(`/interviews/${interviewId}/self-schedule-link`, { rotate }).then((r) => r.data),
  mySlots: () => http.get<InterviewerSlot[]>('/interviewer-slots/mine').then((r) => r.data),
  addSlot: (startAt: string, endAt: string) =>
    http.post<InterviewerSlot>('/interviewer-slots', { startAt, endAt }).then((r) => r.data),
  removeSlot: (id: string) => http.delete(`/interviewer-slots/${id}`).then((r) => r.data),
};

export const departmentsApi = {
  list: () => http.get<DepartmentItem[]>('/departments').then((r) => r.data),
  create: (data: { name: string; parentId?: string }) =>
    http.post<Department>('/departments', data).then((r) => r.data),
  update: (id: string, data: { name: string }) =>
    http.patch<Department>(`/departments/${id}`, data).then((r) => r.data),
  remove: (id: string) => http.delete<void>(`/departments/${id}`).then((r) => r.data),
};

export const companyDocsApi = {
  list: () => http.get<CompanyDoc[]>('/company-docs').then((r) => r.data),
  create: (data: { title: string; content: string; tags?: string[] }) =>
    http.post<CompanyDoc>('/company-docs', data).then((r) => r.data),
  update: (id: string, data: Partial<{ title: string; content: string; tags: string[] }>) =>
    http.patch<CompanyDoc>(`/company-docs/${id}`, data).then((r) => r.data),
  remove: (id: string) => http.delete<void>(`/company-docs/${id}`).then((r) => r.data),
};

export const usersApi = {
  list: (role?: string) =>
    http.get<UserItem[]>('/users', { params: role ? { role } : undefined }).then((r) => r.data),
  updateRoles: (userId: string, roleCodes: string[]) =>
    http.patch<UserItem>(`/users/${userId}/roles`, { roleCodes }).then((r) => r.data),
  /** 停用 / 启用；停用时返回其仍负责的在招职位，提示管理员换用人经理 */
  setStatus: (userId: string, status: 'ACTIVE' | 'DISABLED') =>
    http
      .patch<UserItem & { openJobs: Array<{ id: string; title: string }> }>(`/users/${userId}/status`, { status })
      .then((r) => r.data),
  /** 重置成员密码：temporaryPassword 仅此一次返回；该成员所有已登录会话立即失效 */
  resetPassword: (userId: string) =>
    http.post<{ temporaryPassword: string }>(`/users/${userId}/reset-password`).then((r) => r.data),
  /** 邀请内部成员；initialPassword 仅此一次返回，页面须提示管理员立即转交 */
  invite: (data: InviteUserInput) =>
    http.post<{ user: UserItem; initialPassword: string }>('/users', data).then((r) => r.data),
};

export const rbacApi = {
  roles: () => http.get<Role[]>('/roles').then((r) => r.data),
  permissions: () => http.get<PermissionDef[]>('/permissions').then((r) => r.data),
  updateRolePermissions: (roleId: string, codes: string[]) =>
    http.patch<Role>(`/roles/${roleId}/permissions`, { codes }).then((r) => r.data),
  createRole: (data: CreateRoleInput) => http.post<Role>('/roles', data).then((r) => r.data),
};

export const auditApi = {
  recent: (page: number, pageSize = 20, actions?: string[]) =>
    http
      .get<Paginated<ActivityItem>>('/activities/recent', {
        params: { page, pageSize, ...(actions?.length ? { actions: actions.join(',') } : {}) },
      })
      .then((r) => r.data),
};
