import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, ConfigProvider } from 'antd';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { candidatesApi } from '../src/api';
import type { ActivityItem, IntakeResult } from '../src/api/types';
import { ActivityTimeline, describe as describeItem } from '../src/components/ActivityTimeline';
import { ResumeIntakeModal } from '../src/components/ResumeIntakeModal';

vi.mock('../src/api', () => ({
  candidatesApi: { intake: vi.fn() },
  jobsApi: {
    list: vi.fn().mockResolvedValue({
      items: [{ id: 'job-1', title: 'Java 后端工程师', department: { id: 'd1', name: '研发部' } }],
      total: 1,
      page: 1,
      pageSize: 100,
      summary: {},
    }),
  },
}));

const wrap = (node: ReactNode) =>
  render(
    <ConfigProvider>
      <App>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>
      </App>
    </ConfigProvider>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const item = (action: string, payload: Record<string, unknown> = {}, actorName = '何欣'): ActivityItem => ({
  id: `${action}-${Math.random()}`,
  action,
  actorName,
  actor: { id: 'u1', name: actorName },
  payload,
  createdAt: '2026-11-20T02:00:00.000Z',
});

describe('候选人时间轴', () => {
  const items = [
    item('application.scored', { job: 'Java 后端工程师', score: 82, source: 'ai' }),
    item('resume.parsed', { skills: ['Java', 'Spring'] }),
    item('copilot.action_executed', { summary: '把林知远推进到「面试」' }),
    item('resume.intake', { fileName: 'lin.docx', job: 'Java 后端工程师', created: false, matchedBy: 'phone' }),
    item('application.stage_changed', { from: '筛选', to: '面试', auto: true }, '系统'),
  ];

  it('AI 与 Copilot 动作带标记，可只看 AI', async () => {
    wrap(<ActivityTimeline items={items} />);
    expect(screen.getAllByTestId('timeline-item')).toHaveLength(5);
    expect(screen.getAllByText('AI')).toHaveLength(2);
    expect(screen.getByText('Copilot')).toBeTruthy();
    expect(screen.getByText('自动')).toBeTruthy();
    await userEvent.click(screen.getByText('AI 3'));
    expect(screen.getAllByTestId('timeline-item')).toHaveLength(3);
    await userEvent.click(screen.getByText('人工 2'));
    expect(screen.getAllByTestId('timeline-item')).toHaveLength(2);
  });

  it('每类动作给出可读的补充说明', () => {
    expect(describeItem(items[0])).toBe('Java 后端工程师 匹配分 82');
    expect(describeItem(items[1])).toBe('识别技能：Java、Spring');
    expect(describeItem(items[3])).toBe('lin.docx · 投递「Java 后端工程师」· 按手机号合并到原档案');
    expect(describeItem(items[4])).toBe('筛选 → 面试');
    expect(describeItem(item('evaluation.drafted', { round: 2, conclusion: 'YES' }))).toMatch(/第 2 轮 · 建议「推荐」/);
  });

  it('没有记录时显示空状态', () => {
    wrap(<ActivityTimeline items={[]} />);
    expect(screen.getByText('暂无操作记录')).toBeTruthy();
  });
});

describe('上传简历自动建档', () => {
  it('选职位、逐份处理，展示新建 / 合并 / 失败结果', async () => {
    const ok: IntakeResult = {
      candidate: { id: 'c1', name: '林知远' },
      created: true,
      matchedBy: null,
      backfilled: [],
      resumeId: 'r1',
      parsed: true,
      skills: ['Java', 'Spring'],
      application: { id: 'a1', revived: false },
      score: 82,
      warnings: [],
    };
    const intake = vi.mocked(candidatesApi.intake);
    intake
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce({ ...ok, candidate: { id: 'c2', name: '周可欣' }, created: false, matchedBy: 'email', score: null, warnings: ['该候选人已在此职位流程中'] })
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 400, data: { message: '简历里没有识别到邮箱或手机号' } } });
    const onOpen = vi.fn();
    wrap(<ResumeIntakeModal open onClose={() => {}} onOpenCandidate={onOpen} defaultJobId="job-1" />);

    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const files = ['a.docx', 'b.pdf', 'c.txt'].map((n) => new File(['x'.repeat(30)], n));
    fireEvent.change(input, { target: { files } });
    const start = await screen.findByRole('button', { name: /开始处理（3 份）/ });
    await waitFor(() => expect(screen.getByText('Java 后端工程师（研发部）')).toBeTruthy());
    await userEvent.click(start);

    await screen.findByText('林知远');
    await screen.findByText(/没有识别到邮箱或手机号/);
    expect(intake).toHaveBeenCalledTimes(3);
    expect(intake.mock.calls[0][1]).toEqual({ jobId: 'job-1', source: undefined });
    expect(screen.getByText('新建档案')).toBeTruthy();
    expect(screen.getByText('按邮箱合并')).toBeTruthy();
    expect(screen.getByText('匹配分 82')).toBeTruthy();
    expect(screen.getByText('该候选人已在此职位流程中')).toBeTruthy();
    await userEvent.click(screen.getByText('林知远'));
    expect(onOpen).toHaveBeenCalledWith('c1');
  });

  it('不支持的格式在选择时就拦下', async () => {
    wrap(<ResumeIntakeModal open onClose={() => {}} onOpenCandidate={() => {}} defaultJobId="job-1" />);
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'photo.png', { type: 'image/png' })] } });
    expect((await screen.findAllByText(/「photo.png」格式不支持/)).length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: /开始处理/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
