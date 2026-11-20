import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  COPILOT_TOOL_LABELS,
  COPILOT_WRITE_TOOLS,
  PERMISSIONS,
  type CopilotActionView,
  type CopilotStreamEvents,
} from '@hireflow/shared';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { maskContactsInText } from '../../common/mask';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingTable } from '../ai/pricing';
import { CandidatesService } from '../candidates/candidates.service';
import { JobsService } from '../jobs/jobs.service';
import { readCopilotLimits, type CopilotLimits } from './copilot.config';
import { buildSystemPrompt, type CopilotContextInfo } from './prompts';
import { createCopilotProvider } from './providers/factory';
import { MockCopilotProvider } from './providers/mock.provider';
import type { ChatMessage, CopilotProvider, ToolCall } from './providers/types';
import { CopilotRateLimiter } from './rate-limit';
import type { CopilotSink } from './sse';
import { CopilotToolsService, toolErrorMessage } from './tools/copilot-tools.service';
import { serializeForModel } from './tools/tool-output';

type ContextType = 'candidate' | 'job';

export interface TurnTicket {
  conversationId: string;
  user: JwtUser;
  content: string;
  context: { type: ContextType; id: string } | null;
}

interface StoredToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

interface ActionRow {
  id: string;
  tool: string;
  summary: string;
  preview: unknown;
  danger: boolean;
  status: string;
  error: string | null;
  result: unknown;
  expiresAt: Date;
  messageId: string | null;
}

const STATUS_NOTE: Record<string, string> = {
  PENDING: '仍在等待用户确认，尚未执行',
  EXECUTING: '正在执行',
  EXECUTED: '用户已确认，已执行成功',
  REJECTED: '用户已取消，未执行',
  FAILED: '用户确认后执行失败',
  EXPIRED: '已过期未执行',
};

/** 按角色给的推荐问题（只推荐这个人有权限的事） */
function suggestionsFor(user: JwtUser): string[] {
  const has = (p: string) => user.permissions.includes(p);
  const list: string[] = [];
  if (has(PERMISSIONS.EVALUATION_READ)) list.push('未来一周我有哪些面试？');
  if (has(PERMISSIONS.CANDIDATE_READ)) list.push('帮我找一下熟悉 React 的候选人');
  if (has(PERMISSIONS.DASHBOARD_VIEW)) list.push('当前招聘漏斗哪个环节转化最低？');
  if (has(PERMISSIONS.OFFER_INITIATE) || has(PERMISSIONS.OFFER_READ)) list.push('有哪些 Offer 还没有答复？');
  if (has(PERMISSIONS.JOB_READ)) list.push('现在有哪些在招职位？');
  list.push('我今天有哪些待办？');
  return list.slice(0, 4);
}

/**
 * Copilot 主流程（一轮 = 用户一句话）：
 *   持久化提问 → 组装 system prompt（角色 / 数据范围 / 页面上下文）+ 历史 → 循环：模型流式输出 →
 *   读工具当场以当前用户身份执行 / 写工具只生成待确认操作 → 结果回填给模型 → … → 收尾记账。
 * 上限：迭代次数、工具调用次数、单轮超时、单轮成本、每日 token 预算、每分钟次数、同时一条流。
 */
@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);
  readonly limits: CopilotLimits;
  /** 测试可替换 */
  provider: CopilotProvider;
  fallback: CopilotProvider;
  private readonly pricing: PricingTable;
  readonly rateLimiter: CopilotRateLimiter;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tools: CopilotToolsService,
    private readonly candidates: CandidatesService,
    private readonly jobs: JobsService,
  ) {
    this.limits = readCopilotLimits(config);
    this.provider = createCopilotProvider(config, this.limits.timeoutMs);
    const delay = Number(config.get<string>('COPILOT_MOCK_DELAY_MS') ?? 16);
    this.fallback = new MockCopilotProvider(Number.isFinite(delay) && delay >= 0 ? delay : 16);
    this.pricing = new PricingTable(config.get<string>('AI_PRICING_JSON'));
    this.rateLimiter = new CopilotRateLimiter(this.limits.ratePerMinute);
    this.logger.log(`Copilot 引擎：${this.provider.kind}（${this.provider.model}）`);
  }

  status(user: JwtUser) {
    return {
      provider: this.provider.kind,
      model: this.provider.model,
      mode: this.provider.mode,
      tools: this.tools.specsFor(user).map((t) => t.name),
      suggestions: suggestionsFor(user),
      limits: { ratePerMinute: this.limits.ratePerMinute, maxInputChars: this.limits.maxInputChars },
    };
  }

  // ------------------------------------------------------------------ 会话 CRUD（仅本人）

  async listConversations(user: JwtUser) {
    return this.prisma.copilotConversation.findMany({
      where: { userId: user.sub },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, title: true, contextType: true, contextId: true, createdAt: true, updatedAt: true },
    });
  }

  async createConversation(user: JwtUser, dto: { title?: string; contextType?: ContextType; contextId?: string }) {
    const context = dto.contextType && dto.contextId ? await this.resolveContext(dto.contextType, dto.contextId, user) : null;
    return this.prisma.copilotConversation.create({
      data: {
        userId: user.sub,
        title: dto.title?.trim().slice(0, 60) || null,
        contextType: context?.type ?? null,
        contextId: context?.id ?? null,
      },
      select: { id: true, title: true, contextType: true, contextId: true, createdAt: true, updatedAt: true },
    });
  }

  private async own(id: string, user: JwtUser) {
    const conv = await this.prisma.copilotConversation.findUnique({ where: { id } });
    // 别人的会话一律 404，不泄露存在与否
    if (!conv || conv.userId !== user.sub) throw new NotFoundException('会话不存在');
    return conv;
  }

  async renameConversation(id: string, title: string, user: JwtUser) {
    await this.own(id, user);
    return this.prisma.copilotConversation.update({
      where: { id },
      data: { title: title.trim().slice(0, 60) },
      select: { id: true, title: true, contextType: true, contextId: true, createdAt: true, updatedAt: true },
    });
  }

  async deleteConversation(id: string, user: JwtUser) {
    await this.own(id, user);
    await this.prisma.copilotConversation.delete({ where: { id } });
    return { ok: true };
  }

  async getConversation(id: string, user: JwtUser) {
    const conv = await this.own(id, user);
    const [messages, actions] = await Promise.all([
      this.prisma.copilotMessage.findMany({ where: { conversationId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      this.prisma.copilotAction.findMany({ where: { conversationId: id }, orderBy: { createdAt: 'asc' } }),
    ]);
    const context = conv.contextType && conv.contextId ? await this.resolveContext(conv.contextType as ContextType, conv.contextId, user) : null;
    return {
      id: conv.id,
      title: conv.title,
      contextType: conv.contextType,
      contextId: conv.contextId,
      context,
      // 工具原始结果只给模型看；前端只拿步骤标签和摘要
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.role === 'tool' ? '' : m.content,
        toolName: m.toolName,
        toolCallId: m.toolCallId,
        meta: m.meta,
        createdAt: m.createdAt,
      })),
      actions: actions.map((a) => this.actionView(a)),
    };
  }

  actionView(a: ActionRow): CopilotActionView {
    const expired = a.status === 'PENDING' && a.expiresAt.getTime() < Date.now();
    const preview = (a.preview ?? {}) as { fields?: CopilotActionView['fields'] };
    return {
      id: a.id,
      tool: a.tool as CopilotActionView['tool'],
      title: COPILOT_WRITE_TOOLS[a.tool as keyof typeof COPILOT_WRITE_TOOLS]?.title ?? a.tool,
      summary: a.summary,
      fields: preview.fields ?? [],
      danger: a.danger,
      status: expired ? 'EXPIRED' : (a.status as CopilotActionView['status']),
      error: a.error,
      result: (a.result ?? null) as CopilotActionView['result'],
      expiresAt: a.expiresAt.toISOString(),
      messageId: a.messageId,
    };
  }

  /** 页面上下文必须是这个人看得到的；看不到就当没有（不报错，也不泄露名字） */
  async resolveContext(type: ContextType, id: string, user: JwtUser): Promise<CopilotContextInfo | null> {
    try {
      if (type === 'candidate') {
        if (!user.permissions.includes(PERMISSIONS.CANDIDATE_READ)) return null;
        const c = await this.candidates.findOne(id, user);
        return { type, id, label: c.name };
      }
      if (type === 'job') {
        if (!user.permissions.includes(PERMISSIONS.JOB_READ)) return null;
        const j = await this.jobs.findOne(id, user);
        return { type, id, label: j.title };
      }
    } catch {
      return null;
    }
    return null;
  }

  // ------------------------------------------------------------------ 一轮对话

  /** 开流前的检查（都在写 SSE 头之前，失败时还能返回正常的 4xx JSON） */
  async prepareTurn(
    conversationId: string,
    user: JwtUser,
    dto: { content: string; contextType?: ContextType; contextId?: string },
  ): Promise<TurnTicket> {
    const conv = await this.own(conversationId, user);
    const content = dto.content.trim().slice(0, this.limits.maxInputChars);
    if (!content) throw new HttpException('请输入问题', HttpStatus.BAD_REQUEST);

    const wait = this.rateLimiter.take(user.sub);
    if (wait) throw new HttpException(`提问太频繁，请 ${wait} 秒后再试`, HttpStatus.TOO_MANY_REQUESTS);

    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const used = await this.prisma.aiCallLog.aggregate({
      where: { userId: user.sub, capability: 'copilot', createdAt: { gte: since } },
      _sum: { inputTokens: true, outputTokens: true },
    });
    const tokens = (used._sum.inputTokens ?? 0) + (used._sum.outputTokens ?? 0);
    if (tokens >= this.limits.dailyTokenBudget) {
      throw new HttpException('今日 Copilot 用量已达上限，请明天再试', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!this.rateLimiter.acquire(user.sub)) {
      throw new HttpException('上一条回复还在生成中，请先停止或等待完成', HttpStatus.CONFLICT);
    }

    const type = dto.contextType ?? (conv.contextType as ContextType | null) ?? null;
    const id = dto.contextId ?? conv.contextId ?? null;
    return { conversationId, user, content, context: type && id ? { type, id } : null };
  }

  release(ticket: TurnTicket) {
    this.rateLimiter.release(ticket.user.sub);
  }

  async runTurn(ticket: TurnTicket, sink: CopilotSink, clientSignal: AbortSignal): Promise<void> {
    const { user, conversationId } = ticket;
    const started = Date.now();
    const conv = await this.prisma.copilotConversation.findUniqueOrThrow({ where: { id: conversationId } });

    const context = ticket.context ? await this.resolveContext(ticket.context.type, ticket.context.id, user) : null;
    let title: string | undefined;
    if (!conv.title) title = ticket.content.replace(/\s+/g, ' ').slice(0, 24);
    await this.prisma.copilotConversation.update({
      where: { id: conversationId },
      data: {
        ...(title ? { title } : {}),
        ...(context ? { contextType: context.type, contextId: context.id } : {}),
      },
    });
    await this.prisma.copilotMessage.create({
      data: { conversationId, role: 'user', content: ticket.content, meta: context ? ({ context } as never) : undefined },
    });

    const history = await this.loadHistory(conversationId);
    const system = buildSystemPrompt(user, context);
    const tools = this.tools.specsFor(user);

    // 超时与客户端断开合并成一个信号
    const timeout = AbortSignal.timeout(this.limits.timeoutMs);
    const signal = AbortSignal.any([clientSignal, timeout]);

    let provider = this.provider;
    let degraded = false;
    let model: string | undefined = provider.model;
    const usage = { inputTokens: 0, outputTokens: 0 };
    let toolCallsUsed = 0;
    let truncated: string | undefined;
    let aborted = false;
    let error: string | undefined;
    let lastMessageId: string | null = null;

    sink.send('meta', { conversationId, provider: provider.kind, model: provider.model, mode: provider.mode, degraded });

    let iteration = 0;
    while (iteration < this.limits.maxIterations) {
      iteration++;
      let text = '';
      const calls: ToolCall[] = [];
      let emitted = false;
      let interrupted = false;
      try {
        for await (const ev of provider.stream({ system, messages: history, tools, maxTokens: this.limits.maxOutputTokens, signal })) {
          if (ev.type === 'text') {
            text += ev.delta;
            emitted = true;
            sink.send('text', { delta: ev.delta });
          } else if (ev.type === 'tool_call') {
            calls.push(ev.call);
            emitted = true;
          } else if (ev.type === 'usage') {
            usage.inputTokens += ev.inputTokens;
            usage.outputTokens += ev.outputTokens;
            model = ev.model || model;
          }
        }
      } catch (e) {
        interrupted = true;
        if (clientSignal.aborted) {
          aborted = true;
        } else if (timeout.aborted) {
          truncated = '回复超时，已停止生成';
        } else if (provider.mode === 'llm' && !emitted && iteration === 1) {
          // 模型不可用且还没输出任何东西：降级到规则引擎，体验不断
          this.logger.warn(`Copilot 模型调用失败，降级到规则引擎：${e instanceof Error ? e.message : e}`);
          error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
          provider = this.fallback;
          degraded = true;
          sink.send('meta', { conversationId, provider: provider.kind, model: provider.model, mode: provider.mode, degraded });
          iteration = 0;
          continue;
        } else {
          error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
          sink.send('error', { message: 'AI 服务暂时不可用，请稍后重试', code: 'provider_error' });
        }
      }

      // 中断时只保存已生成的文字，没执行的工具调用丢弃
      const keptCalls = interrupted ? [] : calls;
      if (text || keptCalls.length) {
        const saved = await this.prisma.copilotMessage.create({
          data: {
            conversationId,
            role: 'assistant',
            content: text,
            toolCalls: keptCalls.length ? (keptCalls as never) : undefined,
            meta: { provider: provider.kind, model, ...(aborted ? { aborted: true } : {}), ...(degraded ? { degraded: true } : {}) },
          },
        });
        lastMessageId = saved.id;
        history.push({ role: 'assistant', content: text, toolCalls: keptCalls.length ? keptCalls : undefined });
      }
      if (interrupted || !keptCalls.length) break;

      for (const call of keptCalls) {
        if (signal.aborted) break;
        const result = await this.runTool(call, user, conversationId, sink, toolCallsUsed >= this.limits.maxToolCalls);
        toolCallsUsed++;
        history.push({ role: 'tool', toolCallId: call.id, name: call.name, content: result });
      }
      if (signal.aborted) {
        if (clientSignal.aborted) aborted = true;
        else truncated = '回复超时，已停止生成';
        break;
      }

      const cost = provider.mode === 'mock' ? 0 : (this.pricing.estimateUsd(model, usage.inputTokens, usage.outputTokens) ?? 0);
      if (cost > this.limits.turnMaxCostUsd) {
        truncated = '本轮已达到成本上限，已停止继续查询';
        break;
      }
      if (toolCallsUsed >= this.limits.maxToolCalls && iteration >= this.limits.maxIterations) break;
      if (iteration >= this.limits.maxIterations) {
        truncated = '已达到本轮查询步数上限，以上为已获取的信息';
        break;
      }
    }

    if (truncated && !aborted) sink.send('text', { delta: `\n\n_（${truncated}）_` });

    const latencyMs = Date.now() - started;
    const costUsd = provider.mode === 'mock' ? 0 : this.pricing.estimateUsd(model, usage.inputTokens, usage.outputTokens);
    await this.prisma.aiCallLog
      .create({
        data: {
          capability: 'copilot',
          provider: provider.kind,
          model: model ?? null,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd,
          latencyMs,
          degraded,
          error: error?.slice(0, 300) ?? (aborted ? 'aborted' : (truncated ?? null)),
          userId: user.sub,
        },
      })
      .catch((e: unknown) => this.logger.debug(`AiCallLog 写入失败：${e instanceof Error ? e.message : e}`));
    await this.prisma.copilotConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });

    sink.send('done', { messageId: lastMessageId, aborted, degraded, provider: provider.kind, model, usage, truncated, title });
  }

  /** 执行一次工具调用，返回回填给模型的内容（已脱敏 / 装箱 / 截断） */
  private async runTool(call: ToolCall, user: JwtUser, conversationId: string, sink: CopilotSink, overLimit: boolean): Promise<string> {
    const labels = COPILOT_TOOL_LABELS[call.name] ?? { running: '正在处理…', done: '已完成' };
    const step = { id: call.id, name: call.name, label: labels.running };
    sink.send('tool_start', { ...step, status: 'running' });

    const persist = (content: string, meta: Record<string, unknown>) =>
      this.prisma.copilotMessage.create({
        data: { conversationId, role: 'tool', content, toolCallId: call.id, toolName: call.name, meta: meta as never },
      });

    const fail = async (message: string) => {
      const content = serializeForModel({ ok: false, error: message });
      await persist(content, { label: labels.running.replace(/…$/, ''), summary: message, ok: false });
      sink.send('tool_end', { ...step, status: 'error', label: labels.running.replace(/…$/, ''), summary: message });
      return content;
    };

    if (overLimit) return fail('本轮工具调用次数已达上限，请基于已有信息回答');

    try {
      if (this.tools.isWrite(call.name)) {
        const proposal = await this.tools.propose(call.name, call.args, user);
        const action = await this.prisma.copilotAction.create({
          data: {
            conversationId,
            userId: user.sub,
            toolCallId: call.id,
            tool: call.name,
            args: proposal.args as never,
            summary: proposal.summary,
            preview: { fields: proposal.fields } as never,
            danger: proposal.danger,
            expiresAt: new Date(Date.now() + this.limits.actionTtlMs),
          },
        });
        const content = serializeForModel({
          ok: true,
          data: {
            actionId: action.id,
            status: 'PENDING_CONFIRMATION',
            summary: proposal.summary,
            note: '操作尚未执行：已生成确认卡片，必须由用户在界面上点击确认后才会执行。',
          },
        });
        const msg = await persist(content, { label: labels.done, summary: proposal.summary, ok: true, actionId: action.id });
        const updated = await this.prisma.copilotAction.update({ where: { id: action.id }, data: { messageId: msg.id } });
        sink.send('action', this.actionView(updated));
        sink.send('tool_end', { ...step, status: 'done', label: labels.done, summary: proposal.summary });
        return content;
      }
      const res = await this.tools.runRead(call.name, call.args, user);
      const content = serializeForModel({ ok: true, data: res.data, injectionSuspected: res.injectionSuspected });
      await persist(content, { label: labels.done, summary: res.summary, ok: true, ...(res.injectionSuspected ? { injection: true } : {}) });
      sink.send('tool_end', { ...step, status: 'done', label: labels.done, summary: res.summary });
      return content;
    } catch (e) {
      return fail(toolErrorMessage(e));
    }
  }

  /**
   * 历史 → 模型消息：取最近 N 条，从一条用户消息开始；
   * 没有对应结果的工具调用剔除（被中断的轮次），写操作结果附上「当前状态」，模型才知道用户确认 / 取消了没有。
   */
  private async loadHistory(conversationId: string): Promise<ChatMessage[]> {
    const rows = (
      await this.prisma.copilotMessage.findMany({
        where: { conversationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: this.limits.historyLimit,
      })
    ).reverse();
    const firstUser = rows.findIndex((m) => m.role === 'user');
    const recent = firstUser >= 0 ? rows.slice(firstUser) : [];
    const actionIds = recent
      .map((m) => (m.meta as { actionId?: string } | null)?.actionId)
      .filter((x): x is string => Boolean(x));
    const actions = actionIds.length
      ? await this.prisma.copilotAction.findMany({ where: { id: { in: actionIds } }, select: { id: true, status: true, expiresAt: true } })
      : [];
    const statusOf = new Map(actions.map((a) => [a.id, a.status === 'PENDING' && a.expiresAt < new Date() ? 'EXPIRED' : a.status]));
    const answered = new Set(recent.filter((m) => m.role === 'tool').map((m) => m.toolCallId));

    const out: ChatMessage[] = [];
    for (const m of recent) {
      if (m.role === 'user') out.push({ role: 'user', content: maskContactsInText(m.content) });
      else if (m.role === 'assistant') {
        const calls = ((m.toolCalls as StoredToolCall[] | null) ?? []).filter((c) => answered.has(c.id));
        if (!m.content && !calls.length) continue;
        out.push({ role: 'assistant', content: m.content, toolCalls: calls.length ? calls : undefined });
      } else if (m.role === 'tool' && m.toolCallId && m.toolName) {
        const prev = out[out.length - 1];
        const owned = out.some((o) => o.role === 'assistant' && o.toolCalls?.some((c) => c.id === m.toolCallId));
        if (!owned || !prev) continue;
        const actionId = (m.meta as { actionId?: string } | null)?.actionId;
        const status = actionId ? statusOf.get(actionId) : undefined;
        const content = status ? `${m.content}\n（系统备注：该操作当前状态——${STATUS_NOTE[status] ?? status}）` : m.content;
        out.push({ role: 'tool', toolCallId: m.toolCallId, name: m.toolName, content });
      }
    }
    return out;
  }
}

export type { CopilotStreamEvents };
