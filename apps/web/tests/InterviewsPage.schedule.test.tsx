import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PERMISSIONS } from '@hireflow/shared';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, ConfigProvider } from 'antd';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { interviewsApi } from '../src/api';
import type { Interview } from '../src/api/types';
import { InterviewsPage } from '../src/pages/interviews/InterviewsPage';
import { useAuthStore } from '../src/stores/auth';

vi.mock('../src/components/CandidateDetailDrawer', () => ({ CandidateDetailDrawer: () => null }));

vi.mock('../src/api', () => ({
  interviewsApi: {
    list: vi.fn(),
    mySlots: vi.fn(),
    schedule: vi.fn(),
    selfScheduleLink: vi.fn(),
    addSlot: vi.fn(),
    removeSlot: vi.fn(),
  },
}));

const pending: Interview = {
  id: 'iv-pending',
  round: 1,
  scheduledAt: null,
  durationMins: 60,
  meetingUrl: null,
  status: 'SCHEDULED',
  interviewers: [{ user: { id: 'u2', name: '钱文' } }],
  evaluations: [],
  application: {
    id: 'app-1',
    candidate: { id: 'c1', name: '龚浩然' },
    job: { id: 'j1', title: '解决方案架构师' },
    stage: { name: '一面' },
  },
};

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/interviews', element: <InterviewsPage /> }], {
    initialEntries: ['/interviews?tab=pending'],
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
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(interviewsApi.list).mockResolvedValue([pending]);
  vi.mocked(interviewsApi.mySlots).mockResolvedValue([]);
  useAuthStore.setState({
    user: {
      id: 'hr',
      email: 'hr@hireflow.local',
      name: '何欣',
      roles: ['HR'],
      department: null,
      permissions: [PERMISSIONS.INTERVIEW_SCHEDULE, PERMISSIONS.EVALUATION_SUBMIT, PERMISSIONS.EVALUATION_READ],
    },
  });
});

afterEach(cleanup);

describe('待安排面试', () => {
  it('点击「安排」打开填写时间的弹窗', async () => {
    const user = setup();
    expect(await screen.findByText('龚浩然')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '安排' }));
    expect(await screen.findByRole('dialog', { name: '填写面试时间' })).toBeTruthy();
    expect(screen.getByLabelText('面试时间')).toBeTruthy();
  });
});
