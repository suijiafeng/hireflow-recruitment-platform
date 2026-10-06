import type { AuthUser } from '../stores/auth';
import { http } from './client';
import type {
  AnalyticsOverview,
  ApplicationCreateResult,
  CreateRoleInput,
  InsightsRange,
  InviteUserInput,
  NotificationItem,
  BatchResult,
  BoardCard,
  BoardData,
  CompareData,
  Candidate,
  CandidateDetail,
  CompanyDoc,
  Department,
  DepartmentItem,
  EvaluationDraft,
  FunnelData,
  ActivityItem,
  HelpdeskAnswer,
  InsightsData,
  Interview,
  InterviewerSlot,
  InterviewPortalView,
  JdDraft,
  Job,
  Offer,
  OfferPortalView,
  Onboarding,
  OnboardingPortalView,
  Paginated,
  PermissionDef,
  PrescreenView,
  Resume,
  RetentionHint,
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
};

export const jobsApi = {
  list: (params: { page?: number; pageSize?: number; keyword?: string; status?: string }) =>
    http.get<Paginated<Job>>('/jobs', { params }).then((r) => r.data),
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
    http.post<TalentPoolScanResult>(`/jobs/${jobId}/talent-pool/scan`).then((r) => r.data),
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
  score: (id: string) => http.post<BoardCard>(`/applications/${id}/score`).then((r) => r.data),
  compare: (ids: string[]) =>
    http.post<CompareData>('/applications/compare', { ids }).then((r) => r.data),
  prescreenLink: (id: string) =>
    http.post<{ token: string }>(`/applications/${id}/prescreen-link`).then((r) => r.data),
};

export const resumesApi = {
  parse: (id: string) => http.post<Resume>(`/resumes/${id}/parse`).then((r) => r.data),
  fileUrl: (id: string) => http.get<{ url: string }>(`/resumes/${id}/file-url`).then((r) => r.data),
};

export const aiApi = {
  generateJd: (data: { title: string; departmentName?: string; keywords?: string }) =>
    http.post<JdDraft>('/ai/generate-jd', data).then((r) => r.data),
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
  approve: (id: string, note?: string) =>
    http.post<Offer>(`/offers/${id}/approve`, { note }).then((r) => r.data),
  reject: (id: string, note?: string) =>
    http.post<Offer>(`/offers/${id}/reject`, { note }).then((r) => r.data),
  resubmit: (
    id: string,
    data: { salaryBase: number; bonusMonths?: number; startDate: string; grade?: string; note?: string },
  ) => http.post<Offer>(`/offers/${id}/resubmit`, data).then((r) => r.data),
  send: (id: string) => http.post<Offer>(`/offers/${id}/send`).then((r) => r.data),
  extend: (id: string) => http.post<Offer>(`/offers/${id}/extend`).then((r) => r.data),
  /** rotate=true 重新生成链接，旧链接立即失效 */
  portalLink: (id: string, rotate = false) =>
    http.post<{ token: string }>(`/offers/${id}/portal-link`, { rotate }).then((r) => r.data),
  respond: (id: string, decision: 'ACCEPTED' | 'DECLINED', reason?: string) =>
    http.post<Offer>(`/offers/${id}/respond`, { decision, reason }).then((r) => r.data),
  retention: (id: string) => http.post<RetentionHint>(`/offers/${id}/retention`).then((r) => r.data),
};

/** 候选人/新员工免登录门户（链接即凭证，不带 JWT） */
export const portalApi = {
  offerView: (token: string) =>
    http.get<OfferPortalView>(`/portal/offers/${token}`).then((r) => r.data),
  offerRespond: (token: string, decision: 'ACCEPTED' | 'DECLINED', reason?: string) =>
    http.post<OfferPortalView>(`/portal/offers/${token}/respond`, { decision, reason }).then((r) => r.data),
  onboardingView: (token: string) =>
    http.get<OnboardingPortalView>(`/portal/onboardings/${token}`).then((r) => r.data),
  onboardingAddDocument: (token: string, data: { type: string; rawText: string }) =>
    http.post<OnboardingPortalView>(`/portal/onboardings/${token}/documents`, data).then((r) => r.data),
  onboardingAddDocumentFile: (token: string, data: { type: string; rawText?: string; file?: File }) => {
    const form = new FormData();
    form.append('type', data.type);
    if (data.rawText) form.append('rawText', data.rawText);
    if (data.file) form.append('file', data.file);
    return http
      .post<OnboardingPortalView>(`/portal/onboardings/${token}/documents/file`, form)
      .then((r) => r.data);
  },
  onboardingSignContract: (token: string) =>
    http.post<OnboardingPortalView>(`/portal/onboardings/${token}/contract/sign`).then((r) => r.data),
  interviewView: (token: string) =>
    http.get<InterviewPortalView>(`/portal/interviews/${token}`).then((r) => r.data),
  interviewPick: (token: string, slotId: string) =>
    http.post<InterviewPortalView>(`/portal/interviews/${token}/pick`, { slotId }).then((r) => r.data),
  prescreenView: (token: string) =>
    http.get<PrescreenView>(`/portal/prescreen/${token}`).then((r) => r.data),
  prescreenSubmit: (
    token: string,
    data: { expectedSalary: number; availableDate: string; travelOk: boolean; note?: string },
  ) => http.post<PrescreenView>(`/portal/prescreen/${token}`, data).then((r) => r.data),
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
  toggle: (id: string, key: string, done: boolean) =>
    http.patch<Onboarding>(`/onboardings/${id}/checklist/${key}`, { done }).then((r) => r.data),
  addDocument: (id: string, data: { type: string; rawText: string }) =>
    http.post<Onboarding>(`/onboardings/${id}/documents`, data).then((r) => r.data),
  addDocumentFile: (id: string, data: { type: string; rawText?: string; file?: File }) => {
    const form = new FormData();
    form.append('type', data.type);
    if (data.rawText) form.append('rawText', data.rawText);
    if (data.file) form.append('file', data.file);
    return http.post<Onboarding>(`/onboardings/${id}/documents/file`, form).then((r) => r.data);
  },
  createContract: (id: string) =>
    http.post<Onboarding>(`/onboardings/${id}/contract`).then((r) => r.data),
  sendContract: (contractId: string) =>
    http.post<Onboarding>(`/contracts/${contractId}/send`).then((r) => r.data),
  signContract: (contractId: string) =>
    http.post<Onboarding>(`/contracts/${contractId}/sign`).then((r) => r.data),
  /** rotate=true 重新生成链接，旧链接立即失效 */
  portalLink: (id: string, rotate = false) =>
    http.post<{ token: string }>(`/onboardings/${id}/portal-link`, { rotate }).then((r) => r.data),
};

export const helpdeskApi = {
  ask: (question: string) => http.post<HelpdeskAnswer>('/helpdesk/ask', { question }).then((r) => r.data),
  docs: () =>
    http
      .get<Array<{ id: string; title: string; tags: string[] }>>('/helpdesk/docs')
      .then((r) => r.data),
};

export const analyticsApi = {
  overview: () => http.get<AnalyticsOverview>('/analytics/overview').then((r) => r.data),
  todos: () => http.get<TodoSummary>('/analytics/todos').then((r) => r.data),
  funnel: (jobId: string) => http.get<FunnelData>(`/analytics/funnel/${jobId}`).then((r) => r.data),
  insight: (jobId: string) =>
    http.post<{ insight: string; aiMeta: { provider: string } }>(`/analytics/insight/${jobId}`).then((r) => r.data),
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
      .post<EvaluationDraft>(`/interviews/${interviewId}/evaluation-draft`, { notes })
      .then((r) => r.data),
  cancel: (interviewId: string) =>
    http.post<Interview>(`/interviews/${interviewId}/cancel`).then((r) => r.data),
  /** HR 直接敲定/改期，不走候选人自助选时 */
  schedule: (
    interviewId: string,
    data: { scheduledAt: string; durationMins?: number; ignoreConflict?: boolean },
  ) => http.post<Interview>(`/interviews/${interviewId}/schedule`, data).then((r) => r.data),
  selfScheduleLink: (interviewId: string) =>
    http.post<{ token: string }>(`/interviews/${interviewId}/self-schedule-link`).then((r) => r.data),
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
  recent: (page: number, pageSize = 20) =>
    http
      .get<Paginated<ActivityItem>>('/activities/recent', { params: { page, pageSize } })
      .then((r) => r.data),
};
