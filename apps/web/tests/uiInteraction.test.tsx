import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PERMISSIONS } from '@hireflow/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { App, Button, ConfigProvider } from 'antd';
import { AxiosError, AxiosHeaders } from 'axios';
import dayjs from 'dayjs';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { interviewsApi } from '../src/api';
import type { Interview, Job } from '../src/api/types';
import { EmptyState } from '../src/components/EmptyState';
import { QueryErrorResult } from '../src/components/QueryErrorResult';
import { splitRowActions, type RowAction } from '../src/components/RowActions';
import { DESTRUCTIVE_OK, withDialogDefaults } from '../src/hooks/useAppDialogs';
import { InterviewsPage } from '../src/pages/interviews/InterviewsPage';
import { useAuthStore } from '../src/stores/auth';
import { aiSourceOf } from '../src/utils/aiProvider';
import { hcProgress, pickDefaultJobId } from '../src/utils/jobs';

vi.mock('../src/components/CandidateDetailDrawer', () => ({ CandidateDetailDrawer: () => null }));
vi.mock('../src/api', () => ({
  interviewsApi: { list: vi.fn(), mySlots: vi.fn(), schedule: vi.fn(), selfScheduleLink: vi.fn(), addSlot: vi.fn(), removeSlot: vi.fn() },
  aiApi: { status: vi.fn() },
}));

afterEach(cleanup);

describe('确认框统一默认值', () => {
  it('右上角 ×、垂直居中、取消文案', () => {
    const c = withDialogDefaults({ title: '续期该 Offer？' });
    expect(c.closable).toBe(true);
    expect(c.centered).toBe(true);
    expect(c.cancelText).toBe('取消');
    expect(c.okButtonProps?.danger).toBeUndefined();
  });

  it('危险操作自动标红，默认焦点落在「取消」', () => {
    const c = withDialogDefaults({ title: '删除候选人？', okText: '删除' });
    expect(c.okButtonProps?.danger).toBe(true);
    expect(c.focusable).toEqual({ autoFocusButton: 'cancel' });
    for (const t of ['确认淘汰', '停用', '确认驳回', '放弃并关闭', '清空']) expect(DESTRUCTIVE_OK.test(t)).toBe(true);
    expect(DESTRUCTIVE_OK.test('保存')).toBe(false);
  });

  it('调用方显式传入的值优先', () => {
    const c = withDialogDefaults({ title: 'x', closable: false, cancelText: '继续编辑' });
    expect(c.closable).toBe(false);
    expect(c.cancelText).toBe('继续编辑');
  });
});

describe('表格行操作排布', () => {
  const a = (key: string, extra: Partial<RowAction> = {}): RowAction => ({ key, label: key, onClick: () => {}, ...extra });

  it('危险操作不平铺，排到「···」最后并用分隔线隔开', () => {
    // 职位页之前的顺序：编辑、招聘流程、删除、唤醒、评分卡 —— 「删除」成了菜单第一项
    const { inline, overflow, dangerFrom } = splitRowActions(
      [a('edit'), a('stages'), a('delete', { danger: true }), a('pool'), a('scorecard')],
      2,
    );
    expect(inline.map((x) => x.key)).toEqual(['edit', 'stages']);
    expect(overflow.map((x) => x.key)).toEqual(['pool', 'scorecard', 'delete']);
    expect(dangerFrom).toBe(2);
  });

  it('危险操作即使排在前面也不会占平铺位', () => {
    const { inline, overflow } = splitRowActions([a('delete', { danger: true }), a('detail'), a('edit')], 2);
    expect(inline.map((x) => x.key)).toEqual(['detail', 'edit']);
    expect(overflow.map((x) => x.key)).toEqual(['delete']);
  });

  it('pinned 的危险操作（审批「驳回」）保留平铺', () => {
    const { inline, overflow, dangerFrom } = splitRowActions([a('approve'), a('reject', { danger: true, pinned: true }), a('ret')], 2);
    expect(inline.map((x) => x.key)).toEqual(['approve', 'reject']);
    expect(overflow.map((x) => x.key)).toEqual(['ret']);
    expect(dangerFrom).toBe(-1);
  });
});

describe('统一空状态', () => {
  it('图标 + 一句话 + 主操作', () => {
    render(<EmptyState title="暂无简历" description="导入后 AI 会解析" action={<Button>导入简历</Button>} />);
    expect(screen.getByText('暂无简历')).toBeTruthy();
    expect(screen.getByText('导入后 AI 会解析')).toBeTruthy();
    expect(screen.getByRole('button', { name: '导入简历' })).toBeTruthy();
  });

  it('403 不再用 antd Result 的卡通插画', () => {
    const err = new AxiosError('x', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 403,
      statusText: '',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: { message: '无权访问该部门' },
    });
    const { container } = render(<QueryErrorResult error={err} />);
    expect(screen.getByText('无权访问')).toBeTruthy();
    expect(container.querySelector('.ant-result')).toBeNull();
    expect(container.querySelector('.hf-empty--forbidden')).toBeTruthy();
  });
});

describe('大盘 / 看板默认职位', () => {
  const job = (id: string, status: Job['status'], n: number) => ({ id, status, _count: { applications: n } }) as Job;

  it('招聘中里流程人数最多的那个，而不是列表第一个有人的', () => {
    expect(pickDefaultJobId([job('pm', 'OPEN', 2), job('be', 'OPEN', 12), job('paused', 'PAUSED', 30)])).toBe('be');
  });

  it('没有招聘中的职位有人时退回人数最多的，再退回第一个招聘中', () => {
    expect(pickDefaultJobId([job('a', 'OPEN', 0), job('b', 'PAUSED', 3)])).toBe('b');
    expect(pickDefaultJobId([job('a', 'CLOSED', 0), job('b', 'OPEN', 0)])).toBe('b');
    expect(pickDefaultJobId([])).toBeUndefined();
  });
});

describe('HC 进度', () => {
  it('超编标红并给出超出人数', () => {
    expect(hcProgress(11, 1)).toMatchObject({ over: 10, pct: 100, color: '#DC2626' });
    expect(hcProgress(1, 1)).toMatchObject({ over: 0, pct: 100, color: '#059669' });
    expect(hcProgress(0, 3).over).toBe(0);
  });
});

describe('AI 来源徽标口径', () => {
  it('AI · 模型 / 缓存 / 规则', () => {
    expect(aiSourceOf({ provider: 'deepseek:deepseek-chat', degraded: false })).toMatchObject({ kind: 'ai', label: 'AI · deepseek-chat' });
    expect(aiSourceOf({ provider: 'anthropic:claude-opus-4-8·缓存', degraded: false, cached: true })?.kind).toBe('cache');
    expect(aiSourceOf({ provider: 'mock', degraded: false })?.label).toBe('规则');
    expect(aiSourceOf({ provider: 'anthropic:x', degraded: true })?.kind).toBe('rule');
    expect(aiSourceOf(undefined)).toBeNull();
  });
});

describe('面试管理默认「待进行」', () => {
  const iv = (id: string, name: string, at: string | null, status: Interview['status'] = 'SCHEDULED'): Interview => ({
    id,
    round: 1,
    scheduledAt: at,
    durationMins: 60,
    meetingUrl: null,
    status,
    interviewers: [{ user: { id: 'u2', name: '钱文' } }],
    evaluations: [],
    application: { id: `app-${id}`, candidate: { id: `c-${id}`, name }, job: { id: 'j1', title: '后端工程师' }, stage: { name: '一面' } },
  });

  beforeEach(() => {
    vi.mocked(interviewsApi.list).mockResolvedValue([
      iv('old', '七月历史', dayjs().subtract(120, 'day').toISOString(), 'COMPLETED'),
      iv('todo', '待安排的人', null),
      iv('soon', '明天的人', dayjs().add(1, 'day').hour(10).toISOString()),
    ]);
    vi.mocked(interviewsApi.mySlots).mockResolvedValue([]);
    useAuthStore.setState({
      user: {
        id: 'hr',
        email: 'hr@hireflow.local',
        name: '何欣',
        roles: ['HR'],
        department: null,
        permissions: [PERMISSIONS.INTERVIEW_SCHEDULE, PERMISSIONS.EVALUATION_SUBMIT],
      },
    });
  });

  it('不带 tab 参数打开时只列出即将进行的面试，历史与待安排不在首屏', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter([{ path: '/interviews', element: <InterviewsPage /> }], { initialEntries: ['/interviews'] });
    render(
      <ConfigProvider theme={{ token: { motion: false } }}>
        <App>
          <QueryClientProvider client={client}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </App>
      </ConfigProvider>,
    );
    expect(await screen.findByText('明天的人')).toBeTruthy();
    expect(screen.queryByText('七月历史')).toBeNull();
    expect(screen.queryByText('待安排的人')).toBeNull();
    expect(screen.getByText('待进行').className).toContain('hf-seg--on');
  });
});
