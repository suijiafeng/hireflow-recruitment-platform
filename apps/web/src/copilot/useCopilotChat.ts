import type { CopilotActionView } from '@hireflow/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { copilotApi, CopilotHttpError, streamMessage, type ResolvedContext } from './api';
import { addAction, appendText, turnsFromMessages, upsertStep, type AssistantTurn, type Turn } from './turns';

interface Options {
  /** 出错时提示（toast） */
  onError: (message: string) => void;
  /** 当前页面上下文（已解析、在数据范围内） */
  context: ResolvedContext | null;
}

let localSeq = 0;
const localId = (p: string) => `${p}-${Date.now()}-${++localSeq}`;

/** 一个会话的状态：轮次、待确认操作、流式发送 / 停止 */
export function useCopilotChat({ onError, context }: Options) {
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [actions, setActions] = useState<Record<string, CopilotActionView>>({});
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => () => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setConversationId(null);
    setTurns([]);
    setActions({});
  }, []);

  const load = useCallback(async (id: string) => {
    abortRef.current?.abort();
    setLoading(true);
    try {
      const detail = await copilotApi.detail(id);
      setConversationId(id);
      setTurns(turnsFromMessages(detail.messages, detail.actions));
      setActions(Object.fromEntries(detail.actions.map((a) => [a.id, a])));
    } catch {
      onErrorRef.current('会话加载失败，可能已被删除');
      setConversationId(null);
      setTurns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const patchAssistant = (id: string, fn: (t: AssistantTurn) => AssistantTurn) =>
    setTurns((all) => all.map((t) => (t.id === id && t.role === 'assistant' ? fn(t) : t)));

  const send = useCallback(
    async (content: string) => {
      const text = content.trim();
      if (!text || abortRef.current) return;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStreaming(true);
      const assistantId = localId('a');
      setTurns((all) => [
        ...all,
        { id: localId('u'), role: 'user', content: text },
        { id: assistantId, role: 'assistant', blocks: [], status: 'streaming' },
      ]);
      try {
        let id = conversationId;
        if (!id) {
          const created = await copilotApi.create(context ? { contextType: context.type, contextId: context.id } : {});
          id = created.id;
          setConversationId(id);
        }
        await streamMessage(
          id,
          { content: text, ...(context ? { contextType: context.type, contextId: context.id } : {}) },
          (event, data) => {
            switch (event) {
              case 'meta': {
                const d = data as { provider: string; model?: string; degraded: boolean };
                patchAssistant(assistantId, (t) => ({ ...t, provider: d.provider, model: d.model, degraded: d.degraded }));
                break;
              }
              case 'text':
                patchAssistant(assistantId, (t) => ({ ...t, blocks: appendText(t.blocks, (data as { delta: string }).delta) }));
                break;
              case 'tool_start':
              case 'tool_end':
                patchAssistant(assistantId, (t) => ({ ...t, blocks: upsertStep(t.blocks, data as never) }));
                break;
              case 'action': {
                const a = data as CopilotActionView;
                setActions((m) => ({ ...m, [a.id]: a }));
                patchAssistant(assistantId, (t) => ({ ...t, blocks: addAction(t.blocks, a.id) }));
                break;
              }
              case 'error': {
                const d = data as { message: string };
                patchAssistant(assistantId, (t) => ({ ...t, status: 'error', error: d.message }));
                onErrorRef.current(d.message);
                break;
              }
              case 'done': {
                const d = data as { aborted: boolean; degraded: boolean; provider: string; model?: string; truncated?: string; title?: string };
                patchAssistant(assistantId, (t) => ({
                  ...t,
                  status: t.status === 'error' ? 'error' : d.aborted ? 'aborted' : 'done',
                  provider: d.provider,
                  model: d.model ?? t.model,
                  degraded: d.degraded,
                }));
                if (d.title) void queryClient.invalidateQueries({ queryKey: ['copilot-conversations'] });
                break;
              }
            }
          },
          ctrl.signal,
        );
        patchAssistant(assistantId, (t) => (t.status === 'streaming' ? { ...t, status: 'done' } : t));
      } catch (error) {
        if (ctrl.signal.aborted) {
          patchAssistant(assistantId, (t) => ({ ...t, status: 'aborted' }));
        } else {
          const message = error instanceof CopilotHttpError ? error.message : '网络异常，回复中断';
          patchAssistant(assistantId, (t) => ({ ...t, status: 'error', error: message }));
          onErrorRef.current(message);
        }
      } finally {
        abortRef.current = null;
        setStreaming(false);
        void queryClient.invalidateQueries({ queryKey: ['copilot-conversations'] });
      }
    },
    [conversationId, context, queryClient],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const updateAction = useCallback((a: CopilotActionView) => setActions((m) => ({ ...m, [a.id]: a })), []);

  return { conversationId, turns, actions, streaming, loading, send, stop, reset, load, updateAction };
}
