import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PERMISSIONS } from '@hireflow/shared';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, ConfigProvider } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jobsApi } from '../src/api';
import type { Job, JobStage } from '../src/api/types';
import { JobStagesModal } from '../src/pages/jobs/JobStagesModal';
import { useAuthStore } from '../src/stores/auth';

vi.mock('../src/api', () => ({ jobsApi: { getStages: vi.fn(), updateStages: vi.fn() } }));

const stages: JobStage[] = [
  { id: 's1', jobId: 'j1', name: '筛选', order: 0, _count: { applications: 2 } },
  { id: 's2', jobId: 'j1', name: '面试', order: 1, _count: { applications: 0 } },
];
const job = { id: 'j1', title: '工程师' } as Job;
const getStages = vi.mocked(jobsApi.getStages);
const updateStages = vi.mocked(jobsApi.updateStages);

function setup(currentJob = job) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const onClose = vi.fn();
  const view = render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <App>
        <QueryClientProvider client={client}>
          <JobStagesModal job={currentJob} onClose={onClose} />
        </QueryClientProvider>
      </App>
    </ConfigProvider>,
  );
  return { user: userEvent.setup(), onClose, invalidate, ...view };
}

beforeEach(() => {
  vi.clearAllMocks();
  getStages.mockResolvedValue(structuredClone(stages));
  updateStages.mockResolvedValue(structuredClone(stages));
  useAuthStore.setState({
    user: {
      id: 'u1',
      email: 'test@example.test',
      name: '测试',
      roles: [],
      department: null,
      permissions: [PERMISSIONS.JOB_STAGES_MANAGE],
    },
  });
});
afterEach(cleanup);

describe('职位招聘流程编辑器', () => {
  it('加载阶段；添加、改名、排序、删除后只提交服务端字段，保留已有 ID', async () => {
    const { user, onClose, invalidate } = setup();
    await screen.findByDisplayValue('筛选');
    await user.clear(screen.getByLabelText('阶段 2 名称'));
    await user.type(screen.getByLabelText('阶段 2 名称'), '技术面试');
    await user.click(screen.getByRole('button', { name: '上移阶段 2' }));
    expect((screen.getByLabelText('阶段 1 名称') as HTMLInputElement).value).toBe('技术面试');
    await user.click(screen.getByRole('button', { name: '添加阶段' }));
    expect((screen.getByRole('button', { name: '保存流程' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.type(screen.getByLabelText('阶段 3 名称'), '  终面  ');
    await user.click(screen.getByRole('button', { name: '保存流程' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(updateStages).toHaveBeenCalledWith('j1', [
      { id: 's2', name: '技术面试' },
      { id: 's1', name: '筛选' },
      { name: '终面' },
    ]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['board', 'j1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['funnel', 'j1'] });
  });

  it('禁止删除有应聘记录的阶段，允许删除空阶段', async () => {
    const { user } = setup();
    await screen.findByDisplayValue('筛选');
    expect((screen.getByRole('button', { name: '删除阶段 1' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: '删除阶段 2' }));
    expect(screen.queryByDisplayValue('面试')).toBeNull();
    expect((screen.getByRole('button', { name: '删除阶段 1' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: '保存流程' }));
    await waitFor(() =>
      expect(updateStages).toHaveBeenCalledWith('j1', [{ id: 's1', name: '筛选' }]),
    );
  });

  it('即使没有应聘记录，也不能删除最后一个阶段', async () => {
    getStages.mockResolvedValue([{ ...stages[1], order: 0 }]);
    setup();
    await screen.findByDisplayValue('面试');
    expect((screen.getByRole('button', { name: '删除阶段 1' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByTitle('至少保留一个阶段')).toBeTruthy();
  });

  it('空白名称不可保存；未保存关闭需要确认', async () => {
    const { user, onClose } = setup();
    await screen.findByDisplayValue('面试');
    await user.clear(screen.getByLabelText('阶段 2 名称'));
    await user.type(screen.getByLabelText('阶段 2 名称'), '   ');
    expect((screen.getByRole('button', { name: '保存流程' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: /取\s*消/ }));
    await screen.findAllByText('放弃未保存的内容？');
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(updateStages).not.toHaveBeenCalled();
  });

  it('保存中阻止重复提交、编辑和关闭', async () => {
    let resolve!: (value: JobStage[]) => void;
    updateStages.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { user, onClose } = setup();
    await screen.findByDisplayValue('面试');
    await user.type(screen.getByLabelText('阶段 2 名称'), '修改');
    await user.dblClick(screen.getByRole('button', { name: '保存流程' }));
    expect(updateStages).toHaveBeenCalledOnce();
    expect((screen.getByLabelText('阶段 2 名称') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /取\s*消/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => resolve(stages));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it.each(['待删除的阶段中仍有候选人', 'Network Error'])(
    '保存失败（%s）保留草稿，重新读取确认后才可继续保存',
    async (reason) => {
      updateStages.mockRejectedValue({
        isAxiosError: true,
        response: { data: { message: reason } },
      });
      const { user, onClose, invalidate } = setup();
      await screen.findByDisplayValue('面试');
      await user.click(screen.getByRole('button', { name: '添加阶段' }));
      await user.type(screen.getByLabelText('阶段 3 名称'), '终面');
      await user.click(screen.getByRole('button', { name: '保存流程' }));
      await screen.findByText(new RegExp(reason));
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByDisplayValue('终面')).toBeTruthy();
      expect((screen.getByRole('button', { name: '保存流程' }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['board', 'j1'] }));
      // 模拟 PUT 实际已提交但返回丢失：GET 返回服务端生成的新增阶段 ID。
      getStages.mockResolvedValue([
        ...stages,
        { id: 's3', jobId: 'j1', name: '终面', order: 2, _count: { applications: 0 } },
      ]);
      await user.click(screen.getByRole('button', { name: '重新读取服务端流程' }));
      await user.click(await screen.findByRole('button', { name: '丢弃草稿并读取' }));
      await waitFor(() => expect(getStages).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect((screen.getByLabelText('阶段 3 名称') as HTMLInputElement).disabled).toBe(false),
      );
      await user.type(screen.getByLabelText('阶段 3 名称'), '确认');
      updateStages.mockResolvedValue(stages);
      await user.click(screen.getByRole('button', { name: '保存流程' }));
      await waitFor(() =>
        expect(updateStages).toHaveBeenLastCalledWith('j1', [
          { id: 's1', name: '筛选' },
          { id: 's2', name: '面试' },
          { id: 's3', name: '终面确认' },
        ]),
      );
    },
  );

  it('读取失败可重试，不允许提交空列表', async () => {
    getStages.mockRejectedValueOnce(new Error('offline'));
    const { user } = setup();
    await screen.findByText('读取招聘流程失败，请重试');
    expect((screen.getByRole('button', { name: '保存流程' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: '重新读取服务端流程' }));
    await screen.findByDisplayValue('面试');
    expect(updateStages).not.toHaveBeenCalled();
  });

  it('权限被收回后禁用编辑和保存', async () => {
    const { user } = setup();
    await screen.findByDisplayValue('面试');
    await user.type(screen.getByLabelText('阶段 2 名称'), '修改');
    act(() => useAuthStore.setState((state) => ({ user: { ...state.user!, permissions: [] } })));
    expect(screen.getByText('当前账号已无配置招聘流程权限')).toBeTruthy();
    expect((screen.getByRole('button', { name: '保存流程' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('切换职位时卸载旧请求，旧响应不会污染新职位', async () => {
    let finish!: (value: JobStage[]) => void;
    getStages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = setup();
    const signal = getStages.mock.calls[0][1]!;
    first.unmount();
    expect(signal.aborted).toBe(true);
    setup({ ...job, id: 'j2' });
    await screen.findByDisplayValue('面试');
    await act(async () => finish([{ ...stages[0], name: '旧响应' }]));
    expect(screen.queryByDisplayValue('旧响应')).toBeNull();
    expect(
      within(screen.getByRole('list', { name: '招聘阶段列表' })).getAllByRole('listitem'),
    ).toHaveLength(2);
  });
});
