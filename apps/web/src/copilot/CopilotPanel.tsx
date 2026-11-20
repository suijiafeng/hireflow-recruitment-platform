import {
  ArrowUpOutlined,
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  HistoryOutlined,
  LinkOutlined,
  PlusOutlined,
  RobotOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Drawer, Grid, Input, Popconfirm, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useLocation } from 'react-router';
import { extractErrorMessage } from '../api/client';
import { EmptyState } from '../components/EmptyState';
import { AiSourceBadge } from '../components/ui';
import { useAppDialogs } from '../hooks/useAppDialogs';
import { ActionCard } from './ActionCard';
import { copilotApi, type ConversationSummary } from './api';
import { Markdown } from './Markdown';
import { contextFromLocation, useCopilotUi } from './store';
import { ToolSteps } from './ToolSteps';
import { sourceMeta, type AssistantTurn } from './turns';
import { useCopilotChat } from './useCopilotChat';
import '../styles/copilot.css';

const CONTEXT_PROMPTS = {
  candidate: ['总结一下这位候选人', '这位候选人的面评怎么样？'],
  job: ['这个职位的看板进展如何？', '这个职位的漏斗哪一环转化最低？'],
} as const;

/** 全站 Copilot 侧栏（页头按钮打开）：对话、流式回答、工具步骤、写操作确认卡片 */
export function CopilotPanel() {
  const { open, pinned, close, consumeDraft } = useCopilotUi();
  const screens = Grid.useBreakpoint();
  const isMobile = screens.md === false;
  const location = useLocation();
  const { message } = useAppDialogs();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [input, setInput] = useState('');
  const [detached, setDetached] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const ref = pinned ?? contextFromLocation(location.pathname, location.search);
  const contextQuery = useQuery({
    queryKey: ['copilot-context', ref?.type, ref?.id],
    queryFn: () => copilotApi.context(ref!.type, ref!.id),
    enabled: open && Boolean(ref),
    staleTime: 60_000,
  });
  const context = !detached && ref ? (contextQuery.data ?? null) : null;

  const status = useQuery({ queryKey: ['copilot-status'], queryFn: copilotApi.status, enabled: open, staleTime: 5 * 60_000 });
  const conversations = useQuery({ queryKey: ['copilot-conversations'], queryFn: copilotApi.list, enabled: open });

  const chat = useCopilotChat({ context, onError: (m) => message.error({ content: m, key: 'copilot-error' }) });

  // 换了页面上下文（打开另一位候选人）且当前会话已有内容：开一个新会话，避免把两个人的问题混在一起
  const lastRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const key = ref ? `${ref.type}:${ref.id}` : null;
    if (key && lastRef.current && key !== lastRef.current && chat.turns.length && !chat.streaming) chat.reset();
    if (key) setDetached(false);
    lastRef.current = key ?? lastRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ref?.type, ref?.id]);

  useEffect(() => {
    if (!open) return;
    const draft = consumeDraft();
    if (draft) setInput(draft);
    setTimeout(() => inputRef.current?.focus(), 120);
  }, [open, consumeDraft]);

  // 新内容到达时滚到底（用户上翻查看时不打扰）
  const pinnedBottom = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (el && pinnedBottom.current) el.scrollTop = el.scrollHeight;
  }, [chat.turns, chat.actions]);

  const submit = (text = input) => {
    if (!text.trim() || chat.streaming) return;
    pinnedBottom.current = true;
    setInput('');
    void chat.send(text);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => copilotApi.rename(id, title),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['copilot-conversations'] }),
    onError: (e) => message.error(extractErrorMessage(e, '重命名失败')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => copilotApi.remove(id),
    onSuccess: (_, id) => {
      if (id === chat.conversationId) chat.reset();
      message.success('会话已删除');
      void queryClient.invalidateQueries({ queryKey: ['copilot-conversations'] });
    },
    onError: (e) => message.error(extractErrorMessage(e, '删除失败')),
  });

  const suggestions = useMemo(() => {
    const base = status.data?.suggestions ?? [];
    return context ? [...CONTEXT_PROMPTS[context.type], ...base].slice(0, 4) : base;
  }, [status.data, context]);

  const engine = status.data ? sourceMeta(status.data.mode === 'mock' ? 'mock' : status.data.provider, status.data.model) : undefined;
  const noTools = status.data && status.data.tools.filter((t) => t !== 'my_todos').length === 0;

  return (
    <Drawer
      className="cp-drawer"
      placement="right"
      size={isMobile ? '100%' : 460}
      open={open}
      onClose={close}
      mask={isMobile}
      zIndex={1040}
      closable={false}
      title={null}
      destroyOnHidden={false}
      styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
      aria-label="招聘 Copilot"
    >
      <div className="cp-header">
        <span className="cp-logo">
          <RobotOutlined />
        </span>
        <div className="cp-header-title">
          <span>招聘 Copilot</span>
          {engine && <AiSourceBadge meta={engine} note="回答仅供参考，写操作需你确认后执行" />}
        </div>
        <span className="u-flex-1" />
        <Tooltip title="历史会话">
          <Button
            type="text"
            size="small"
            aria-label="历史会话"
            className={view === 'history' ? 'is-active' : undefined}
            icon={<HistoryOutlined />}
            onClick={() => setView((v) => (v === 'history' ? 'chat' : 'history'))}
          />
        </Tooltip>
        <Tooltip title="新对话">
          <Button
            type="text"
            size="small"
            aria-label="新对话"
            icon={<PlusOutlined />}
            disabled={chat.streaming}
            onClick={() => {
              chat.reset();
              setView('chat');
              inputRef.current?.focus();
            }}
          />
        </Tooltip>
        <Button type="text" size="small" aria-label="关闭" className="cp-close" icon={<CloseOutlined />} onClick={close} />
      </div>

      {view === 'history' ? (
        <HistoryList
          items={conversations.data ?? []}
          loading={conversations.isLoading}
          activeId={chat.conversationId}
          onOpen={(id) => {
            void chat.load(id);
            setView('chat');
          }}
          onRename={(id, title) => rename.mutate({ id, title })}
          onDelete={(id) => remove.mutate(id)}
        />
      ) : (
        <>
          {context && (
            <div className="cp-context">
              <LinkOutlined />
              <span>
                已关联{context.type === 'candidate' ? '候选人' : '职位'}：<b>{context.label}</b>
              </span>
              <span className="u-flex-1" />
              <Button type="text" size="small" aria-label="取消关联" icon={<CloseOutlined />} onClick={() => setDetached(true)} />
            </div>
          )}
          <div
            className="cp-messages"
            ref={listRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              pinnedBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
          >
            {chat.loading ? (
              <div className="cp-loading" role="status">
                加载中…
              </div>
            ) : chat.turns.length === 0 ? (
              <div className="cp-empty">
                <EmptyState
                  size="sm"
                  icon={<RobotOutlined />}
                  title={noTools ? '当前账号没有可查询的招聘数据' : '有什么可以帮你？'}
                  description={
                    noTools
                      ? '你的角色没有候选人 / 职位相关权限，如需使用请联系管理员。'
                      : '我能查询候选人、看板、面试和 Offer，也能帮你起草推进、排面试、写备注和面评草稿——每个写操作都要你确认后才会执行。'
                  }
                />
                {!noTools && (
                  <div className="cp-suggestions">
                    {suggestions.map((s) => (
                      <button key={s} type="button" className="cp-suggestion" onClick={() => submit(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              chat.turns.map((turn) =>
                turn.role === 'user' ? (
                  <div key={turn.id} className="cp-turn cp-turn--user">
                    <div className="cp-bubble">{turn.content}</div>
                  </div>
                ) : (
                  <AssistantBlock
                    key={turn.id}
                    turn={turn}
                    actions={chat.actions}
                    onAction={chat.updateAction}
                    notify={{ success: (m) => message.success(m), error: (m) => message.error(m) }}
                    onNavigate={isMobile ? close : undefined}
                  />
                ),
              )
            )}
          </div>
          <div className="cp-composer">
            <Input.TextArea
              ref={(node) => {
                inputRef.current = node?.resizableTextArea?.textArea ?? null;
              }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={context ? `问问关于「${context.label}」的问题…` : '问我招聘相关的问题，Enter 发送，Shift+Enter 换行'}
              autoSize={{ minRows: 1, maxRows: 5 }}
              maxLength={status.data?.limits.maxInputChars ?? 2000}
              aria-label="输入问题"
            />
            {chat.streaming ? (
              <Button className="cp-send" danger icon={<StopOutlined />} onClick={chat.stop} aria-label="停止生成">
                停止
              </Button>
            ) : (
              <Button className="cp-send" type="primary" icon={<ArrowUpOutlined />} disabled={!input.trim()} onClick={() => submit()} aria-label="发送">
                发送
              </Button>
            )}
          </div>
          <div className="cp-footnote">AI 生成内容仅供参考；数据范围与你的账号权限一致，写操作需确认后执行</div>
        </>
      )}
    </Drawer>
  );
}

function AssistantBlock({
  turn,
  actions,
  onAction,
  notify,
  onNavigate,
}: {
  turn: AssistantTurn;
  actions: Record<string, import('@hireflow/shared').CopilotActionView>;
  onAction: (a: import('@hireflow/shared').CopilotActionView) => void;
  notify: { success: (m: string) => void; error: (m: string) => void };
  onNavigate?: () => void;
}) {
  const empty = turn.blocks.length === 0;
  return (
    <div className="cp-turn cp-turn--assistant" aria-busy={turn.status === 'streaming'}>
      {empty && turn.status === 'streaming' && (
        <div className="cp-thinking" role="status">
          <span />
          <span />
          <span />
          思考中
        </div>
      )}
      {/* 确认卡片统一放在本轮回答末尾（回答里说「请在下方卡片确认」） */}
      {[...turn.blocks.filter((b) => b.kind !== 'action'), ...turn.blocks.filter((b) => b.kind === 'action')].map((b, i, ordered) => {
        if (b.kind === 'steps') return <ToolSteps key={`s${i}`} steps={b.steps} />;
        if (b.kind === 'text') {
          const last = !ordered.slice(i + 1).some((x) => x.kind === 'text');
          return (
            <div key={`t${i}`} className={last && turn.status === 'streaming' ? 'cp-text is-streaming' : 'cp-text'}>
              <Markdown text={b.text} />
            </div>
          );
        }
        const action = actions[b.actionId];
        return action ? <ActionCard key={b.actionId} action={action} onChange={onAction} notify={notify} onNavigate={onNavigate} /> : null;
      })}
      {turn.status === 'aborted' && <div className="cp-note">已停止生成</div>}
      {turn.status === 'error' && <div className="cp-note cp-note--error">{turn.error ?? '回复失败'}</div>}
      {turn.status !== 'streaming' && turn.provider && (
        <div className="cp-turn-meta">
          <AiSourceBadge meta={sourceMeta(turn.provider, turn.model, turn.degraded)} />
        </div>
      )}
    </div>
  );
}

function HistoryList({
  items,
  loading,
  activeId,
  onOpen,
  onRename,
  onDelete,
}: {
  items: ConversationSummary[];
  loading: boolean;
  activeId: string | null;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  if (loading) {
    return (
      <div className="cp-loading" role="status">
        加载中…
      </div>
    );
  }
  if (!items.length) {
    return <EmptyState size="sm" icon={<HistoryOutlined />} title="还没有会话" description="提出第一个问题后，会话会保存在这里。" />;
  }
  const commit = (id: string) => {
    if (title.trim()) onRename(id, title.trim());
    setEditing(null);
  };
  return (
    <ul className="cp-history" aria-label="历史会话">
      {items.map((c) => (
        <li key={c.id} className={c.id === activeId ? 'cp-history-item is-active' : 'cp-history-item'}>
          {editing === c.id ? (
            <>
              <Input
                size="small"
                autoFocus
                value={title}
                maxLength={60}
                onChange={(e) => setTitle(e.target.value)}
                onPressEnter={() => commit(c.id)}
                onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                aria-label="会话名称"
              />
              <Button size="small" type="text" aria-label="保存名称" icon={<CheckOutlined />} onClick={() => commit(c.id)} />
              <Button size="small" type="text" aria-label="取消重命名" icon={<CloseOutlined />} onClick={() => setEditing(null)} />
            </>
          ) : (
            <>
              <button type="button" className="cp-history-main" onClick={() => onOpen(c.id)}>
                <span className="cp-history-title">{c.title || '新对话'}</span>
                <span className="cp-history-time">{dayjs(c.updatedAt).format('MM-DD HH:mm')}</span>
              </button>
              <Tooltip title="重命名">
                <Button
                  size="small"
                  type="text"
                  aria-label="重命名"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setEditing(c.id);
                    setTitle(c.title ?? '');
                  }}
                />
              </Tooltip>
              <Popconfirm
                title="删除这个会话？"
                description="会话中的消息和未确认的操作会一并删除。"
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => onDelete(c.id)}
              >
                <Button size="small" type="text" aria-label="删除会话" icon={<DeleteOutlined />} />
              </Popconfirm>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
