import type { CopilotActionView, CopilotToolStep } from '@hireflow/shared';
import type { StoredMessage } from './api';

export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'steps'; steps: CopilotToolStep[] }
  | { kind: 'action'; actionId: string };

export interface UserTurn {
  id: string;
  role: 'user';
  content: string;
}

export interface AssistantTurn {
  id: string;
  role: 'assistant';
  blocks: Block[];
  status: 'streaming' | 'done' | 'aborted' | 'error';
  provider?: string;
  model?: string;
  degraded?: boolean;
  error?: string;
  notice?: string;
}

export type Turn = UserTurn | AssistantTurn;

export function appendText(blocks: Block[], delta: string): Block[] {
  const last = blocks[blocks.length - 1];
  if (last?.kind === 'text') return [...blocks.slice(0, -1), { kind: 'text', text: last.text + delta }];
  return [...blocks, { kind: 'text', text: delta }];
}

export function upsertStep(blocks: Block[], step: CopilotToolStep): Block[] {
  const at = blocks.findIndex((b) => b.kind === 'steps' && b.steps.some((s) => s.id === step.id));
  if (at >= 0) {
    const b = blocks[at] as Extract<Block, { kind: 'steps' }>;
    const next = { kind: 'steps' as const, steps: b.steps.map((s) => (s.id === step.id ? step : s)) };
    return [...blocks.slice(0, at), next, ...blocks.slice(at + 1)];
  }
  const last = blocks[blocks.length - 1];
  if (last?.kind === 'steps') return [...blocks.slice(0, -1), { kind: 'steps', steps: [...last.steps, step] }];
  return [...blocks, { kind: 'steps', steps: [step] }];
}

export function addAction(blocks: Block[], actionId: string): Block[] {
  return blocks.some((b) => b.kind === 'action' && b.actionId === actionId) ? blocks : [...blocks, { kind: 'action', actionId }];
}

/** 已保存的消息 → 对话轮次：用户消息一轮，其后连续的模型 / 工具消息合并成一轮回答 */
export function turnsFromMessages(messages: StoredMessage[], actions: CopilotActionView[]): Turn[] {
  const turns: Turn[] = [];
  const actionByMessage = new Map(actions.filter((a) => a.messageId).map((a) => [a.messageId!, a.id]));
  let current: AssistantTurn | null = null;
  for (const m of messages) {
    if (m.role === 'user') {
      current = null;
      turns.push({ id: m.id, role: 'user', content: m.content });
      continue;
    }
    if (!current) {
      current = { id: `a-${m.id}`, role: 'assistant', blocks: [], status: 'done' };
      turns.push(current);
    }
    const meta = (m.meta ?? {}) as Record<string, unknown>;
    if (m.role === 'assistant') {
      if (m.content) current.blocks = appendText(current.blocks, m.content);
      if (meta.aborted) current.status = 'aborted';
      if (meta.provider) current.provider = String(meta.provider);
      if (meta.model) current.model = String(meta.model);
      if (meta.degraded) current.degraded = true;
    } else {
      current.blocks = upsertStep(current.blocks, {
        id: m.toolCallId ?? m.id,
        name: m.toolName ?? '',
        status: meta.ok === false ? 'error' : 'done',
        label: String(meta.label ?? m.toolName ?? ''),
        summary: meta.summary ? String(meta.summary) : undefined,
      });
      const actionId = (meta.actionId as string | undefined) ?? actionByMessage.get(m.id);
      if (actionId) current.blocks = addAction(current.blocks, actionId);
    }
  }
  return turns;
}

/** 与全站 AI 来源徽标同口径的 meta */
export function sourceMeta(provider?: string, model?: string, degraded?: boolean) {
  if (!provider) return undefined;
  if (provider === 'mock') return { provider: 'mock', degraded };
  return { provider: model ? `${provider}:${model}` : provider, degraded };
}
