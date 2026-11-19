import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PERMISSIONS } from '@hireflow/shared';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { App, ConfigProvider } from 'antd';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { departmentsApi, jobsApi } from '../src/api';
import type { Job } from '../src/api/types';
import { JobsPage } from '../src/pages/jobs/JobsPage';
import { useAuthStore } from '../src/stores/auth';

vi.mock('../src/api', () => ({
  jobsApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  departmentsApi: { list: vi.fn() },
  usersApi: { list: vi.fn() },
  aiApi: { generateJd: vi.fn() },
}));

const pageJob = {
  id: 'new',
  title: '新职位',
  headcount: 1,
  status: 'OPEN',
  department: { id: 'd1', name: '技术部' },
  hiringManager: null,
  createdAt: '2026-11-19T00:00:00.000Z',
  hcUsed: 0,
  _count: { applications: 0 },
} as Job;

function setup(entry = '/jobs') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/jobs', element: <JobsPage /> }], {
    initialEntries: [entry],
  });
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <App>
        <QueryClientProvider client={client}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </App>
    </ConfigProvider>,
  );
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(departmentsApi.list).mockResolvedValue([]);
  vi.mocked(jobsApi.list).mockResolvedValue({
    total: 25,
    page: 1,
    pageSize: 20,
    items: [pageJob],
    summary: { open: 14, pendingApproval: 2, headcount: 49, hcUsed: 6, inFlow: 80 },
  });
  useAuthStore.setState({
    user: {
      id: 'u1',
      email: 'hr@arthr.local',
      name: 'HR',
      roles: ['HR'],
      department: null,
      permissions: [PERMISSIONS.JOB_READ],
    },
  });
});

afterEach(cleanup);

describe('职位列表统计口径', () => {
  it('招聘中和 HC 总量取全部职位汇总，而不是当前页', async () => {
    setup();
    expect(await screen.findByText('14')).toBeTruthy();
    expect(screen.getByText('49')).toBeTruthy();
    expect(screen.getByText('80')).toBeTruthy();
    // 页脚与顶部用同一套汇总。当前页那条职位 HC 是 1，加总错了会变成 1 而不是 49
    expect(screen.getByText(/全部\s*25\s*个职位/)).toBeTruthy();
    expect(screen.getByText((_, node) => node?.textContent?.replace(/\s+/g, '') === 'HC已用6/49')).toBeTruthy();
  });

  it('状态和部门筛选交给接口，并在翻页时带上', async () => {
    setup('/jobs?status=OPEN&dept=d1&page=2&q=工程师');
    await waitFor(() => expect(jobsApi.list).toHaveBeenCalled());
    expect(jobsApi.list).toHaveBeenCalledWith({
      page: 2,
      pageSize: 20,
      keyword: '工程师',
      status: 'OPEN',
      departmentId: 'd1',
    });
  });
});
