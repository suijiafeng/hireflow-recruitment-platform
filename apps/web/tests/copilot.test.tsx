import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CopilotActionView } from '@hireflow/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from 'antd';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  copilotApi: {
    status: vi.fn(),
    context: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    detail: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    confirm: vi.fn(),
    reject: vi.fn(),
  },
  streamMessage: vi.fn(),
}));
vi.mock('../src/copilot/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/copilot/api')>();
  return { ...actual, copilotApi: api.copilotApi, streamMessage: api.streamMessage };
});

import { readSse } from '../src/copilot/api';
import { ActionCard } from '../src/copilot/ActionCard';
import { CopilotPanel } from '../src/copilot/CopilotPanel';
import { contextFromLocation, useCopilotUi } from '../src/copilot/store';
import { turnsFromMessages } from '../src/copilot/turns';

const wrap = (ui: ReactNode, path = '/dashboard') => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '*', element: ui }], { initialEntries: [path] });
  return render(
    <QueryClientProvider client={client}>
      <App>
        <RouterProvider router={router} />
      </App>
    </QueryClientProvider>,
  );
};

const action = (over: Partial<CopilotActionView> = {}): CopilotActionView => ({
  id: 'act1',
  tool: 'move_candidate_stage',
  title: '推进候选人阶段',
  summary: '把 张伟 从「一面」移到「二面」',
  fields: [
    { label: '候选人', value: '张伟' },
    { label: '目标阶段', value: '二面' },
  ],
  danger: false,
  status: 'PENDING',
  error: null,
  result: null,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  messageId: 'm1',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.copilotApi.status.mockResolvedValue({
    provider: 'mock',
    model: 'rules',
    mode: 'mock',
    tools: ['search_candidates', 'move_candidate_stage'],
    suggestions: ['未来一周我有哪些面试？', '帮我找一下熟悉 React 的候选人'],
    limits: { ratePerMinute: 12, maxInputChars: 2000 },
  });
  api.copilotApi.list.mockResolvedValue([]);
  api.copilotApi.create.mockResolvedValue({ id: 'conv1', title: null });
  api.copilotApi.context.mockResolvedValue(null);
  useCopilotUi.setState({ open: true, pinned: null, draft: null });
});
afterEach(cleanup);

describe('SSE 解析与上下文推断', () => {
  it('按空行分帧、跨 chunk 拼接，忽略心跳注释', async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(': open\n\nevent: text\ndata: {"del'));
        c.enqueue(enc.encode('ta":"你好"}\n\n: ping\n\nevent: done\ndata: {"aborted":false}\n\n'));
        c.close();
      },
    });
    const seen: Array<[string, unknown]> = [];
    await readSse(body, (e, d) => seen.push([e, d]));
    expect(seen).toEqual([
      ['text', { delta: '你好' }],
      ['done', { aborted: false }],
    ]);
  });

  it('候选人抽屉 / 看板职位自动成为上下文', () => {
    expect(contextFromLocation('/candidates', '?candidate=c1')).toEqual({ type: 'candidate', id: 'c1' });
    expect(contextFromLocation('/pipeline', '?jobId=j1')).toEqual({ type: 'job', id: 'j1' });
    expect(contextFromLocation('/jobs', '?jobId=j1')).toBeNull();
  });

  it('历史消息还原：工具消息合并为步骤，写操作挂上确认卡片', () => {
    const turns = turnsFromMessages(
      [
        { id: 'u1', role: 'user', content: '推进张伟', toolName: null, toolCallId: null, meta: null, createdAt: '' },
        { id: 'a1', role: 'assistant', content: '', toolName: null, toolCallId: null, meta: { provider: 'mock' }, createdAt: '' },
        { id: 't1', role: 'tool', content: '', toolName: 'search_candidates', toolCallId: 'c1', meta: { label: '已查询候选人', summary: '找到 1 位', ok: true }, createdAt: '' },
        { id: 't2', role: 'tool', content: '', toolName: 'move_candidate_stage', toolCallId: 'c2', meta: { label: '已生成待确认操作', ok: true, actionId: 'act1' }, createdAt: '' },
        { id: 'a2', role: 'assistant', content: '请确认', toolName: null, toolCallId: null, meta: { aborted: true }, createdAt: '' },
      ],
      [],
    );
    expect(turns).toHaveLength(2);
    const a = turns[1] as Extract<(typeof turns)[number], { role: 'assistant' }>;
    expect(a.blocks.map((b) => b.kind)).toEqual(['steps', 'action', 'text']);
    expect(a.status).toBe('aborted');
  });
});

describe('Copilot 侧栏', () => {
  it('空状态给出推荐问题；点击后流式渲染文本、折叠的工具步骤和确认卡片', async () => {
    let emit: (e: string, d: unknown) => void = () => {};
    let finish: () => void = () => {};
    api.streamMessage.mockImplementation((_id, _body, onEvent) => {
      emit = onEvent;
      return new Promise<void>((r) => (finish = r));
    });
    wrap(<CopilotPanel />);
    const chip = await screen.findByRole('button', { name: '未来一周我有哪些面试？' });
    fireEvent.click(chip);
    await waitFor(() => expect(api.streamMessage).toHaveBeenCalled());
    expect(api.streamMessage.mock.calls[0][0]).toBe('conv1');
    expect(api.streamMessage.mock.calls[0][1]).toMatchObject({ content: '未来一周我有哪些面试？' });
    expect(screen.getByText('思考中')).toBeTruthy();

    act(() => {
      emit('meta', { conversationId: 'conv1', provider: 'mock', mode: 'mock', degraded: false });
      emit('tool_start', { id: 't1', name: 'upcoming_interviews', status: 'running', label: '正在查询面试安排…' });
    });
    expect(screen.getByText('正在查询面试安排…')).toBeTruthy();
    act(() => {
      emit('tool_end', { id: 't1', name: 'upcoming_interviews', status: 'done', label: '已查询面试安排', summary: '未来 7 天 2 场' });
      emit('text', { delta: '未来 7 天有 **2** 场' });
      emit('text', { delta: '面试' });
      emit('action', action());
    });
    expect(screen.getByText('已完成 1 个步骤')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /已完成 1 个步骤/ }));
    expect(screen.getByText('未来 7 天 2 场')).toBeTruthy();
    expect(screen.getByText('2').tagName).toBe('STRONG'); // Markdown 渲染
    expect(screen.getByRole('group', { name: '推进候选人阶段' })).toBeTruthy();
    // 生成中：发送按钮变成停止
    expect(screen.getByRole('button', { name: '停止生成' })).toBeTruthy();
    await act(async () => {
      emit('done', { messageId: 'x', aborted: false, degraded: false, provider: 'mock', usage: { inputTokens: 1, outputTokens: 1 } });
      finish();
    });
    expect(await screen.findByRole('button', { name: '发送' })).toBeTruthy();
    expect(screen.getAllByText('规则').length).toBeGreaterThan(0); // 与全站一致的来源标注
  });

  it('点「停止」中止请求，保留已生成内容并标注已停止', async () => {
    let signal: AbortSignal | undefined;
    let emit: (e: string, d: unknown) => void = () => {};
    api.streamMessage.mockImplementation((_id, _body, onEvent, s: AbortSignal) => {
      signal = s;
      emit = onEvent;
      return new Promise<void>((_, reject) => s.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    });
    wrap(<CopilotPanel />);
    const input = await screen.findByRole('textbox', { name: '输入问题' });
    fireEvent.change(input, { target: { value: '帮我总结一下' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.streamMessage).toHaveBeenCalled());
    act(() => emit('text', { delta: '这位候选人' }));
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
    expect(signal?.aborted).toBe(true);
    expect(await screen.findByText('已停止生成')).toBeTruthy();
    expect(screen.getByText('这位候选人')).toBeTruthy();
    expect(screen.getByRole('button', { name: '发送' })).toBeTruthy();
  });

  it('发送失败（如限流 429）用 toast 提示', async () => {
    const { CopilotHttpError } = await import('../src/copilot/api');
    api.streamMessage.mockRejectedValue(new CopilotHttpError('提问太频繁，请 30 秒后再试', 429));
    wrap(<CopilotPanel />);
    const input = await screen.findByRole('textbox', { name: '输入问题' });
    fireEvent.change(input, { target: { value: '你好' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect((await screen.findAllByText('提问太频繁，请 30 秒后再试')).length).toBeGreaterThan(0);
  });

  it('关闭按钮在右上角，点击关闭侧栏', async () => {
    wrap(<CopilotPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '关闭' }));
    expect(useCopilotUi.getState().open).toBe(false);
  });
});

describe('确认卡片', () => {
  const notify = { success: vi.fn(), error: vi.fn() };

  it('取消在左、确认在右；确认后显示执行结果', async () => {
    const onChange = vi.fn();
    api.copilotApi.confirm.mockResolvedValue(action({ status: 'EXECUTED', result: { message: '已将 张伟 移到「二面」', link: '/candidates?candidate=c1' } }));
    const { rerender } = wrap(<ActionCard action={action()} onChange={onChange} notify={notify} />);
    const card = await screen.findByRole('group', { name: '推进候选人阶段' });
    const buttons = within(card).getAllByRole('button');
    expect(buttons.map((b) => b.textContent?.replace(/\s/g, ''))).toEqual(['取消', '确认执行']);
    fireEvent.click(within(card).getByRole('button', { name: '确认执行' }));
    await waitFor(() => expect(api.copilotApi.confirm).toHaveBeenCalledWith('act1'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'EXECUTED' })));
    expect(notify.success).toHaveBeenCalledWith('已将 张伟 移到「二面」');
    void rerender;
  });

  it('淘汰是危险操作：红色按钮「确认淘汰」；执行失败（权限 / 冲突）显示原因', async () => {
    const onChange = vi.fn();
    const { AxiosError, AxiosHeaders } = await import('axios');
    api.copilotApi.confirm.mockRejectedValue(
      new AxiosError('x', 'ERR', undefined, undefined, {
        status: 409, statusText: '', headers: {}, config: { headers: new AxiosHeaders() },
        data: { message: '该候选人的状态在提议之后已被修改，请重新确认' },
      }),
    );
    wrap(<ActionCard action={action({ tool: 'reject_application', title: '淘汰候选人', danger: true })} onChange={onChange} notify={notify} />);
    const btn = await screen.findByRole('button', { name: '确认淘汰' });
    expect(btn.className).toContain('ant-btn-dangerous');
    fireEvent.click(btn);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED', error: '该候选人的状态在提议之后已被修改，请重新确认' })),
    );
    expect(notify.error).toHaveBeenCalled();
  });

  it('面评草稿确认后写入面评表单的本机草稿，可直接打开表单核对', async () => {
    const onChange = vi.fn();
    api.copilotApi.confirm.mockResolvedValue(
      action({
        tool: 'draft_evaluation',
        title: '保存面评草稿',
        status: 'EXECUTED',
        result: {
          message: '面评草稿已保存',
          link: '/interviews?evaluate=iv1',
          draft: { scorecard: [{ dimension: '技术能力', score: 4 }], conclusion: 'YES', comments: '【AI 草稿·请修改确认】基础扎实' },
        },
      }),
    );
    wrap(<ActionCard action={action({ tool: 'draft_evaluation', title: '保存面评草稿' })} onChange={onChange} notify={notify} />);
    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }));
    await waitFor(() => expect(localStorage.getItem('hf-eval-draft:iv1')).toBeTruthy());
    expect(JSON.parse(localStorage.getItem('hf-eval-draft:iv1')!).values).toMatchObject({ scores: { 技术能力: 4 }, conclusion: 'YES' });
  });

  it('已执行 / 已取消的卡片不再显示确认按钮', async () => {
    wrap(<ActionCard action={action({ status: 'REJECTED' })} onChange={vi.fn()} notify={notify} />);
    expect(await screen.findByText('已取消')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认执行' })).toBeNull();
  });
});
