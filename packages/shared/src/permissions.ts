import { DataScope, RoleCode } from './enums';

/** 功能点权限码：后端 @RequirePermissions 与前端按钮显隐共用这一份定义 */
export const PERMISSIONS = {
  JOB_CREATE: 'job:create',
  JOB_READ: 'job:read',
  JOB_UPDATE: 'job:update',
  JOB_DELETE: 'job:delete',
  JOB_STAGES_MANAGE: 'job:stages:manage',

  CANDIDATE_CREATE: 'candidate:create',
  CANDIDATE_READ: 'candidate:read',
  CANDIDATE_UPDATE: 'candidate:update',
  CANDIDATE_DELETE: 'candidate:delete',

  APPLICATION_CREATE: 'application:create',
  APPLICATION_MOVE: 'application:move',

  INTERVIEW_SCHEDULE: 'interview:schedule',
  EVALUATION_SUBMIT: 'evaluation:submit',
  EVALUATION_READ: 'evaluation:read',

  OFFER_INITIATE: 'offer:initiate',
  OFFER_READ: 'offer:read',
  SALARY_VIEW: 'salary:view',

  ONBOARDING_READ: 'onboarding:read',
  ONBOARDING_MANAGE: 'onboarding:manage',

  DASHBOARD_VIEW: 'dashboard:view',
  USER_MANAGE: 'user:manage',
  CONFIG_MANAGE: 'config:manage',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_DEFS: Array<{ code: PermissionCode; name: string; group: string }> = [
  { code: PERMISSIONS.JOB_CREATE, name: '创建职位', group: '职位' },
  { code: PERMISSIONS.JOB_READ, name: '查看职位', group: '职位' },
  { code: PERMISSIONS.JOB_UPDATE, name: '编辑职位', group: '职位' },
  { code: PERMISSIONS.JOB_DELETE, name: '删除职位', group: '职位' },
  { code: PERMISSIONS.JOB_STAGES_MANAGE, name: '配置招聘流程', group: '职位' },
  { code: PERMISSIONS.CANDIDATE_CREATE, name: '新增候选人', group: '候选人' },
  { code: PERMISSIONS.CANDIDATE_READ, name: '查看候选人', group: '候选人' },
  { code: PERMISSIONS.CANDIDATE_UPDATE, name: '编辑候选人', group: '候选人' },
  { code: PERMISSIONS.CANDIDATE_DELETE, name: '删除候选人', group: '候选人' },
  { code: PERMISSIONS.APPLICATION_CREATE, name: '创建应聘记录', group: '流转' },
  { code: PERMISSIONS.APPLICATION_MOVE, name: '移动 Pipeline 卡片', group: '流转' },
  { code: PERMISSIONS.INTERVIEW_SCHEDULE, name: '安排面试', group: '面试' },
  { code: PERMISSIONS.EVALUATION_SUBMIT, name: '提交面试评价', group: '面试' },
  { code: PERMISSIONS.EVALUATION_READ, name: '查看面试评价', group: '面试' },
  { code: PERMISSIONS.OFFER_INITIATE, name: '发起 Offer', group: 'Offer' },
  { code: PERMISSIONS.OFFER_READ, name: '查看 Offer', group: 'Offer' },
  { code: PERMISSIONS.SALARY_VIEW, name: '查看薪资字段', group: 'Offer' },
  { code: PERMISSIONS.ONBOARDING_READ, name: '查看入职单', group: '入职' },
  { code: PERMISSIONS.ONBOARDING_MANAGE, name: '管理入职（信息核对 / 确认入职）', group: '入职' },
  { code: PERMISSIONS.DASHBOARD_VIEW, name: '查看数据大盘', group: '全局' },
  { code: PERMISSIONS.USER_MANAGE, name: '用户管理', group: '系统' },
  { code: PERMISSIONS.CONFIG_MANAGE, name: '系统配置', group: '系统' },
];

/**
 * 各角色默认权限映射。
 * 权限矩阵中的「受限」项：数据范围收紧由 Role.dataScope 承担，功能点先按可用授予。
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<
  RoleCode,
  { name: string; dataScope: DataScope; permissions: PermissionCode[] }
> = {
  [RoleCode.ADMIN]: {
    name: '系统管理员',
    dataScope: DataScope.ALL,
    permissions: PERMISSION_DEFS.map((p) => p.code),
  },
  [RoleCode.HR]: {
    name: 'HR / 招聘专员',
    dataScope: DataScope.ALL,
    permissions: [
      PERMISSIONS.JOB_CREATE,
      PERMISSIONS.JOB_READ,
      PERMISSIONS.JOB_UPDATE,
      PERMISSIONS.JOB_DELETE,
      PERMISSIONS.JOB_STAGES_MANAGE,
      PERMISSIONS.CANDIDATE_CREATE,
      PERMISSIONS.CANDIDATE_READ,
      PERMISSIONS.CANDIDATE_UPDATE,
      PERMISSIONS.CANDIDATE_DELETE,
      PERMISSIONS.APPLICATION_CREATE,
      PERMISSIONS.APPLICATION_MOVE,
      PERMISSIONS.INTERVIEW_SCHEDULE,
      PERMISSIONS.EVALUATION_SUBMIT,
      PERMISSIONS.EVALUATION_READ,
      PERMISSIONS.OFFER_INITIATE,
      PERMISSIONS.SALARY_VIEW,
      PERMISSIONS.ONBOARDING_READ,
      PERMISSIONS.ONBOARDING_MANAGE,
      PERMISSIONS.DASHBOARD_VIEW,
    ],
  },
  [RoleCode.HIRING_MANAGER]: {
    name: '用人经理',
    dataScope: DataScope.DEPARTMENT,
    permissions: [
      PERMISSIONS.JOB_READ,
      PERMISSIONS.CANDIDATE_READ,
      PERMISSIONS.APPLICATION_MOVE,
      PERMISSIONS.EVALUATION_SUBMIT,
      PERMISSIONS.EVALUATION_READ,
      PERMISSIONS.OFFER_READ,
      PERMISSIONS.SALARY_VIEW,
      PERMISSIONS.ONBOARDING_READ,
      PERMISSIONS.DASHBOARD_VIEW,
    ],
  },
  [RoleCode.INTERVIEWER]: {
    name: '面试官',
    dataScope: DataScope.ASSIGNED,
    // evaluation:read 用于「我的面试」列表；行级范围（仅被指派）在查询层收紧
    permissions: [PERMISSIONS.CANDIDATE_READ, PERMISSIONS.EVALUATION_READ, PERMISSIONS.EVALUATION_SUBMIT],
  },
};
