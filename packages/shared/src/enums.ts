/**
 * 与 apps/api/prisma/schema.prisma 中的枚举保持一致。
 * 修改任一侧时必须同步另一侧（schema 是数据库事实来源，这里是前后端代码共用镜像）。
 */

export enum RoleCode {
  ADMIN = 'ADMIN',
  HR = 'HR',
  HIRING_MANAGER = 'HIRING_MANAGER',
  INTERVIEWER = 'INTERVIEWER',
}

export enum DataScope {
  ALL = 'ALL',
  DEPARTMENT = 'DEPARTMENT',
  ASSIGNED = 'ASSIGNED',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

export enum JobStatus {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  PAUSED = 'PAUSED',
  CLOSED = 'CLOSED',
}

export enum ApplicationStatus {
  ACTIVE = 'ACTIVE',
  REJECTED = 'REJECTED',
  WITHDRAWN = 'WITHDRAWN',
  HIRED = 'HIRED',
}

export enum ResumeParseStatus {
  PENDING = 'PENDING',
  PARSING = 'PARSING',
  DONE = 'DONE',
  FAILED = 'FAILED',
}

export enum InterviewStatus {
  SCHEDULED = 'SCHEDULED',
  COMPLETED = 'COMPLETED',
  CANCELED = 'CANCELED',
}

export enum EvaluationConclusion {
  STRONG_YES = 'STRONG_YES',
  YES = 'YES',
  NO = 'NO',
  STRONG_NO = 'STRONG_NO',
}

/** 阶段类型：自动流转按类型定位阶段，阶段可以改名 */
export enum StageKind {
  SCREENING = 'SCREENING',
  INTERVIEW = 'INTERVIEW',
  OFFER = 'OFFER',
  ONBOARDING = 'ONBOARDING',
  CUSTOM = 'CUSTOM',
}

/** Offer 由 HR 直接发出，不经审批；候选人答复记在 OfferDecision */
export enum OfferStatus {
  /** 迁移前未发出的 Offer，HR 确认后发送 */
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  /** 到期未答复自动失效，可续期一次回到 SENT */
  EXPIRED = 'EXPIRED',
}

export enum OfferDecision {
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
}

export enum OnboardingStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

export enum ContractSignStatus {
  PENDING = 'PENDING',
  SIGNED = 'SIGNED',
}

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  [JobStatus.DRAFT]: '草稿',
  [JobStatus.OPEN]: '招聘中',
  [JobStatus.PAUSED]: '已暂停',
  [JobStatus.CLOSED]: '已关闭',
};

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  [ApplicationStatus.ACTIVE]: '流程中',
  [ApplicationStatus.REJECTED]: '已淘汰',
  [ApplicationStatus.WITHDRAWN]: '已撤回',
  [ApplicationStatus.HIRED]: '已入职',
};

export const EVALUATION_CONCLUSION_LABEL: Record<EvaluationConclusion, string> = {
  [EvaluationConclusion.STRONG_YES]: '强烈推荐',
  [EvaluationConclusion.YES]: '推荐',
  [EvaluationConclusion.NO]: '不推荐',
  [EvaluationConclusion.STRONG_NO]: '强烈不推荐',
};

export const INTERVIEW_STATUS_LABEL: Record<InterviewStatus, string> = {
  [InterviewStatus.SCHEDULED]: '已安排',
  [InterviewStatus.COMPLETED]: '已完成',
  [InterviewStatus.CANCELED]: '已取消',
};

export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  [OfferStatus.DRAFT]: '待发送',
  [OfferStatus.SENT]: '已发送',
  [OfferStatus.EXPIRED]: '已失效',
};

/** 四个系统阶段的默认名（可以改名，不能删除）；CUSTOM 是职位自己加的阶段 */
export const STAGE_KIND_LABEL: Record<StageKind, string> = {
  [StageKind.SCREENING]: '筛选',
  [StageKind.INTERVIEW]: '面试',
  [StageKind.OFFER]: '录用',
  [StageKind.ONBOARDING]: '入职',
  [StageKind.CUSTOM]: '自定义',
};

export const OFFER_DECISION_LABEL: Record<OfferDecision, string> = {
  [OfferDecision.ACCEPTED]: '已接受',
  [OfferDecision.DECLINED]: '已拒绝',
};

export const ONBOARDING_STATUS_LABEL: Record<OnboardingStatus, string> = {
  [OnboardingStatus.NOT_STARTED]: '未开始',
  [OnboardingStatus.IN_PROGRESS]: '进行中',
  [OnboardingStatus.COMPLETED]: '已完成',
};

export const CONTRACT_SIGN_STATUS_LABEL: Record<ContractSignStatus, string> = {
  [ContractSignStatus.PENDING]: '待确认',
  [ContractSignStatus.SIGNED]: '已确认',
};

export const ROLE_LABEL: Record<RoleCode, string> = {
  [RoleCode.ADMIN]: '系统管理员',
  [RoleCode.HR]: 'HR / 招聘专员',
  [RoleCode.HIRING_MANAGER]: '用人经理',
  [RoleCode.INTERVIEWER]: '面试官',
};
