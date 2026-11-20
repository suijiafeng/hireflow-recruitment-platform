import { StageKind } from './enums';

/**
 * 新建职位时的默认阶段：四个系统阶段，自动流转按 kind 定位，名字可以改。
 * 多轮面试不再拆成「一面 / 二面」两列，轮次显示在卡片上。
 */
export const DEFAULT_PIPELINE_STAGES = [
  { name: '筛选', kind: StageKind.SCREENING },
  { name: '面试', kind: StageKind.INTERVIEW },
  { name: '录用', kind: StageKind.OFFER },
  { name: '入职', kind: StageKind.ONBOARDING },
] as const;

/** 系统阶段的固定先后顺序（自定义阶段可以插在它们之间） */
export const SYSTEM_STAGE_KINDS = [StageKind.SCREENING, StageKind.INTERVIEW, StageKind.OFFER, StageKind.ONBOARDING] as const;

/** 简化前的阶段名 → 阶段类型：旧的流转日志（payload.to / from 只有阶段名）按这个归并到新的四个阶段 */
export const LEGACY_STAGE_KIND: Record<string, StageKind> = {
  简历初筛: StageKind.SCREENING,
  一面: StageKind.INTERVIEW,
  二面: StageKind.INTERVIEW,
  Offer: StageKind.OFFER,
  待入职: StageKind.ONBOARDING,
  已入职: StageKind.ONBOARDING,
};

/** 面试轮次的中文叫法：1 → 一面 */
export function roundLabel(round: number): string {
  const n = ['', '一', '二', '三', '四', '五', '六'][round];
  return n ? `${n}面` : `第 ${round} 轮`;
}

/** ActivityLog.action 取值约定：<实体>.<动作> */
export const ACTIVITY_ACTIONS = {
  JOB_CREATED: 'job.created',
  JOB_UPDATED: 'job.updated',
  JOB_DELETED: 'job.deleted',
  STAGES_UPDATED: 'job.stages_updated',
  TALENT_POOL_SCANNED: 'job.talent_pool_scanned',
  TALENT_POOL_ACTIVATED: 'application.talent_pool_activated',
  CANDIDATE_CREATED: 'candidate.created',
  CANDIDATE_UPDATED: 'candidate.updated',
  CANDIDATE_DELETED: 'candidate.deleted',
  RESUME_ADDED: 'resume.added',
  RESUME_PARSED: 'resume.parsed',
  RESUME_INTAKE: 'resume.intake',
  CANDIDATES_EXPORTED: 'candidate.exported',
  APPLICATION_CREATED: 'application.created',
  APPLICATION_REAPPLIED: 'application.reapplied',
  APPLICATION_REACTIVATED: 'application.reactivated',
  APPLICATION_SCORED: 'application.scored',
  APPLICATION_STAGE_CHANGED: 'application.stage_changed',
  INTERVIEW_SCHEDULED: 'interview.scheduled',
  INTERVIEW_SELF_SCHEDULED: 'interview.self_scheduled',
  INTERVIEW_CANCELED: 'interview.canceled',
  EVALUATION_SUBMITTED: 'evaluation.submitted',
  EVALUATION_DRAFTED: 'evaluation.drafted',
  OFFER_INITIATED: 'offer.initiated',
  OFFER_SENT: 'offer.sent',
  OFFER_RESPONDED: 'offer.responded',
  OFFER_EXTENDED: 'offer.extended',
  OFFER_EXPIRED: 'offer.expired',
  PORTAL_LINK_ROTATED: 'portal.link_rotated',
  PORTAL_LINK_REVOKED: 'portal.link_revoked',
  APPLICATION_WITHDRAWN: 'application.withdrawn',
  CANDIDATES_COMPARED: 'application.candidates_compared',
  ONBOARDING_CREATED: 'onboarding.created',
  ONBOARDING_COMPLETED: 'onboarding.completed',
  ONBOARDING_INFO_SUBMITTED: 'onboarding.info_submitted',
  CONTRACT_CREATED: 'contract.created',
  CONTRACT_SIGNED: 'contract.signed',
  WEBHOOK_FIRED: 'webhook.fired',
  APPLICATION_REJECTED: 'application.rejected',
  APPLICATION_STAGE_REVERTED: 'application.stage_reverted',
  ROLE_CREATED: 'role.created',
  ROLE_PERMISSIONS_UPDATED: 'role.permissions_updated',
  USER_INVITED: 'user.invited',
  USER_ROLES_UPDATED: 'user.roles_updated',
  USER_STATUS_UPDATED: 'user.status_updated',
  USER_PASSWORD_CHANGED: 'user.password_changed',
  USER_PASSWORD_RESET: 'user.password_reset',
  USER_SESSIONS_REVOKED: 'user.sessions_revoked',
  DEPARTMENT_CREATED: 'department.created',
  DEPARTMENT_UPDATED: 'department.updated',
  DEPARTMENT_DELETED: 'department.deleted',
  CANDIDATE_NOTE_ADDED: 'candidate.note_added',
  COPILOT_ACTION_EXECUTED: 'copilot.action_executed',
  COPILOT_ACTION_REJECTED: 'copilot.action_rejected',
  COPILOT_ACTION_FAILED: 'copilot.action_failed',
} as const;

/** 新员工在候选人页填写的入职信息字段（证件号、卡号对 HR 以外的角色只显示尾号） */
export const ONBOARDING_INFO_FIELDS = [
  { key: 'idNumber', label: '身份证号', sensitive: true },
  { key: 'bankName', label: '开户银行', sensitive: false },
  { key: 'bankAccount', label: '工资卡号', sensitive: true },
  { key: 'address', label: '现居住地址', sensitive: true },
  { key: 'emergencyContact', label: '紧急联系人', sensitive: false },
  { key: 'emergencyPhone', label: '紧急联系人电话', sensitive: true },
] as const;

export type OnboardingInfoKey = (typeof ONBOARDING_INFO_FIELDS)[number]['key'];

/** Offer 答复有效期（工作日）：到期失效、可续期一次 */
export const OFFER_VALID_BUSINESS_DAYS = 5;

/** 候选人拒绝 Offer 原因码（原因码强制） */
export const OFFER_DECLINE_REASONS = [
  '薪资不符合预期',
  '接受了其他机会',
  '职业规划调整',
  '工作地点/通勤',
  '家庭原因',
  '其他',
] as const;

/** 全局默认评分卡模板：评分卡按岗位模板配置；Job.scorecardTemplate 为空时使用 */
export const DEFAULT_SCORECARD_TEMPLATE = [
  { dimension: '技术能力', weight: 40 },
  { dimension: '工程素养', weight: 30 },
  { dimension: '沟通协作', weight: 30 },
] as const;

/** 阶段停留 SLA（天）：超过 warn 标黄、超过 danger 标红 */
export const STAGE_STAY_SLA = { warnDays: 3, dangerDays: 7 } as const;

/** 淘汰/撤回原因码（原因码强制，供漏斗分析与人才库回流） */
export const REJECT_REASONS = [
  '技能不符',
  '经验不足',
  '薪资不匹配',
  '文化适配度低',
  '沟通表达欠佳',
  '稳定性存疑',
  '候选人失联',
  '接受了其他机会',
  '岗位关闭',
  '其他',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[keyof typeof ACTIVITY_ACTIONS];

/** AI 面评草稿在评语开头的标记：提醒面试官修改；正式提交时不允许原样保留 */
export const AI_DRAFT_MARKER = '【AI 草稿·请修改确认】';
