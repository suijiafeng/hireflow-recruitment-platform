/** 新建职位时的默认 Pipeline 阶段（可在职位维度自定义） */
export const DEFAULT_PIPELINE_STAGES = [
  '简历初筛',
  '一面',
  '二面',
  'Offer',
  '待入职',
  '已入职',
] as const;

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
  APPLICATION_CREATED: 'application.created',
  APPLICATION_REAPPLIED: 'application.reapplied',
  APPLICATION_REACTIVATED: 'application.reactivated',
  APPLICATION_SCORED: 'application.scored',
  APPLICATION_STAGE_CHANGED: 'application.stage_changed',
  INTERVIEW_SCHEDULED: 'interview.scheduled',
  INTERVIEW_SELF_SCHEDULED: 'interview.self_scheduled',
  INTERVIEW_CANCELED: 'interview.canceled',
  EVALUATION_SUBMITTED: 'evaluation.submitted',
  OFFER_INITIATED: 'offer.initiated',
  OFFER_APPROVED: 'offer.approved',
  OFFER_REJECTED: 'offer.rejected',
  OFFER_SENT: 'offer.sent',
  OFFER_RESPONDED: 'offer.responded',
  OFFER_RESUBMITTED: 'offer.resubmitted',
  OFFER_EXTENDED: 'offer.extended',
  OFFER_EXPIRED: 'offer.expired',
  PORTAL_LINK_ROTATED: 'portal.link_rotated',
  APPLICATION_WITHDRAWN: 'application.withdrawn',
  CANDIDATES_COMPARED: 'application.candidates_compared',
  PRESCREEN_SENT: 'application.prescreen_sent',
  PRESCREEN_SUBMITTED: 'application.prescreen_submitted',
  ONBOARDING_CREATED: 'onboarding.created',
  ONBOARDING_ITEM_DONE: 'onboarding.item_done',
  ONBOARDING_COMPLETED: 'onboarding.completed',
  DOCUMENT_ADDED: 'onboarding.document_added',
  CONTRACT_CREATED: 'contract.created',
  CONTRACT_SENT: 'contract.sent',
  CONTRACT_SIGNED: 'contract.signed',
  WEBHOOK_FIRED: 'webhook.fired',
  APPLICATION_REJECTED: 'application.rejected',
  APPLICATION_STAGE_REVERTED: 'application.stage_reverted',
  ROLE_CREATED: 'role.created',
  ROLE_PERMISSIONS_UPDATED: 'role.permissions_updated',
  USER_INVITED: 'user.invited',
  USER_ROLES_UPDATED: 'user.roles_updated',
  USER_STATUS_UPDATED: 'user.status_updated',
  DEPARTMENT_CREATED: 'department.created',
  DEPARTMENT_UPDATED: 'department.updated',
  DEPARTMENT_DELETED: 'department.deleted',
} as const;

/** 入职三方待办清单默认模板，owner: HR / IT / NEW_HIRE */
export const DEFAULT_ONBOARDING_CHECKLIST = [
  { key: 'hr_profile', label: '建立员工档案', owner: 'HR' },
  { key: 'hr_workspace', label: '安排工位与门禁', owner: 'HR' },
  { key: 'it_computer', label: '准备电脑设备', owner: 'IT' },
  { key: 'it_email', label: '开通企业邮箱', owner: 'IT' },
  { key: 'it_im', label: '开通内部 IM 账号', owner: 'IT' },
  { key: 'nh_id_card', label: '上传身份证', owner: 'NEW_HIRE' },
  { key: 'nh_bank_card', label: '上传银行卡', owner: 'NEW_HIRE' },
  { key: 'nh_diploma', label: '上传学历证书', owner: 'NEW_HIRE' },
  { key: 'nh_contract', label: '签署劳动合同', owner: 'NEW_HIRE' },
] as const;

/** 入职材料类型 → 自动勾选的清单项 */
export const DOCUMENT_TYPE_META = {
  ID_CARD: { label: '身份证', checklistKey: 'nh_id_card' },
  BANK_CARD: { label: '银行卡', checklistKey: 'nh_bank_card' },
  DIPLOMA: { label: '学历证书', checklistKey: 'nh_diploma' },
} as const;

export type DocumentType = keyof typeof DOCUMENT_TYPE_META;

/** OCR 识别字段的中文名（识别结果对新员工和 HR 展示，不能直接露英文键） */
export const DOCUMENT_FIELD_LABEL: Record<string, string> = {
  name: '姓名',
  idNumber: '身份证号',
  address: '住址',
  birth: '出生日期',
  cardNumber: '卡号',
  bank: '开户银行',
  school: '毕业院校',
  degree: '学历',
  major: '专业',
  graduation: '毕业年份',
};

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

/** 阶段停留 SLA（天）：超过 warn 标黄、超过 danger 标红（后续做成可配置） */
/** 全局默认评分卡模板：评分卡按岗位模板配置；Job.scorecardTemplate 为空时使用 */
export const DEFAULT_SCORECARD_TEMPLATE = [
  { dimension: '技术能力', weight: 40 },
  { dimension: '工程素养', weight: 30 },
  { dimension: '沟通协作', weight: 30 },
] as const;

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
