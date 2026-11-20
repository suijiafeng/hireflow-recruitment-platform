/**
 * AI Copilot 前后端共用约定：工具名、进度文案、SSE 事件结构、写操作状态。
 * 后端用它注册工具、写 SSE；前端用它渲染「正在查询候选人…」步骤与确认卡片。
 */

export const COPILOT_READ_TOOLS = {
  search_candidates: { running: '正在查询候选人…', done: '已查询候选人' },
  get_candidate: { running: '正在读取候选人档案…', done: '已读取候选人档案' },
  list_jobs: { running: '正在查询职位…', done: '已查询职位' },
  job_pipeline: { running: '正在读取招聘看板…', done: '已读取招聘看板' },
  upcoming_interviews: { running: '正在查询面试安排…', done: '已查询面试安排' },
  offer_status: { running: '正在查询 Offer 状态…', done: '已查询 Offer 状态' },
  funnel_insights: { running: '正在分析招聘漏斗…', done: '已分析招聘漏斗' },
  my_todos: { running: '正在汇总待办…', done: '已汇总待办' },
} as const;

/**
 * 写工具：只做「新建 / 修改」，一律生成确认卡片、由用户确认后执行。
 * 刻意不提供任何删除类工具——删除只能由人在界面里手动操作。
 */
export const COPILOT_WRITE_TOOLS = {
  move_candidate_stage: { running: '正在准备阶段变更…', done: '已生成待确认操作', title: '推进候选人阶段' },
  schedule_interview: { running: '正在准备面试安排…', done: '已生成待确认操作', title: '安排面试' },
  add_candidate_note: { running: '正在准备备注…', done: '已生成待确认操作', title: '添加候选人备注' },
  draft_evaluation: { running: '正在起草面评…', done: '已生成面评草稿', title: '保存面评草稿' },
  reject_application: { running: '正在准备淘汰操作…', done: '已生成待确认操作', title: '淘汰候选人' },
} as const;

export type CopilotReadTool = keyof typeof COPILOT_READ_TOOLS;
export type CopilotWriteTool = keyof typeof COPILOT_WRITE_TOOLS;
export type CopilotToolName = CopilotReadTool | CopilotWriteTool;

export const COPILOT_TOOL_LABELS: Record<string, { running: string; done: string }> = {
  ...COPILOT_READ_TOOLS,
  ...COPILOT_WRITE_TOOLS,
};

export type CopilotActionStatus = 'PENDING' | 'EXECUTING' | 'EXECUTED' | 'REJECTED' | 'FAILED' | 'EXPIRED';

/** 确认卡片（待确认写操作） */
export interface CopilotActionView {
  id: string;
  tool: CopilotWriteTool;
  title: string;
  summary: string;
  /** 卡片上的字段：如 候选人 / 职位 / 当前阶段 / 目标阶段 */
  fields: Array<{ label: string; value: string }>;
  danger: boolean;
  status: CopilotActionStatus;
  error: string | null;
  result: {
    message?: string;
    link?: string;
    /** 面评草稿（draft_evaluation 执行后） */
    draft?: { scorecard: Array<{ dimension: string; score: number; comment?: string }>; conclusion: string; comments: string };
  } | null;
  expiresAt: string;
  messageId: string | null;
}

export interface CopilotToolStep {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  label: string;
  summary?: string;
}

/** SSE 事件（event: 名称，data: JSON） */
export interface CopilotStreamEvents {
  /** 开流：本轮用的引擎（与 AI 来源标注口径一致） */
  meta: { conversationId: string; provider: string; model?: string; mode: 'llm' | 'mock'; degraded: boolean };
  /** 文本增量 */
  text: { delta: string };
  tool_start: CopilotToolStep;
  tool_end: CopilotToolStep;
  action: CopilotActionView;
  /** 本轮结束 */
  done: {
    messageId: string | null;
    aborted: boolean;
    degraded: boolean;
    provider: string;
    model?: string;
    usage: { inputTokens: number; outputTokens: number };
    /** 因迭代 / 超时 / 成本上限提前收尾时的说明 */
    truncated?: string;
    title?: string;
  };
  error: { message: string; code?: string };
}

export type CopilotStreamEventName = keyof CopilotStreamEvents;
