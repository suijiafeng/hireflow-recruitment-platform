import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, ConfigProvider } from 'antd';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { portalApi } from '../src/api';
import type { InterviewPortalView } from '../src/api/types';
import { InterviewPortalPage } from '../src/pages/portal/InterviewPortalPage';

vi.mock('../src/api', () => ({ portalApi: { interviewView: vi.fn(), interviewPick: vi.fn() } }));

const available: InterviewPortalView = {
  company: '测试公司', candidateName: '候选人', jobTitle: '工程师', round: 1,
  durationMins: 60, status: 'SCHEDULED', scheduledAt: null,
  slots: [
    { id: 'same-primary-slot', startAt: '2040-01-01T02:00:00.000Z', endAt: '2040-01-01T03:00:00.000Z' },
    { id: 'same-primary-slot', startAt: '2040-01-01T04:00:00.000Z', endAt: '2040-01-01T05:00:00.000Z' },
  ],
};
let client: QueryClient;
let router: ReturnType<typeof createMemoryRouter>;

function setup() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  router = createMemoryRouter([{ path: '/portal/interviews/:token', Component: InterviewPortalPage }], {
    initialEntries: ['/portal/interviews/test-token'],
  });
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <App><QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider></App>
    </ConfigProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(portalApi.interviewView).mockResolvedValue(structuredClone(available));
  vi.mocked(portalApi.interviewPick).mockResolvedValue({ ...available, scheduledAt: available.slots[1].startAt, slots: [] });
});
afterEach(() => {
  cleanup();
  router.dispose();
  client.clear();
});

describe('面试共同空闲选时', () => {
  it('同主档的多个交集独立选择，提交所选交集的起点', async () => {
    const user = setup();
    await screen.findByText('选一个方便的面试时间');
    const options = screen.getAllByRole('button').filter((element) => element.classList.contains('hf-opt'));
    expect(options).toHaveLength(2);
    await user.click(options[1]);
    expect(options[1].classList.contains('hf-opt--on')).toBe(true);
    expect(options[0].classList.contains('hf-opt--on')).toBe(false);
    await user.click(screen.getByRole('button', { name: '确认这个时间' }));
    await user.click(await screen.findByRole('button', { name: '确认时间' }));
    await waitFor(() => expect(portalApi.interviewPick).toHaveBeenCalledWith(
      'test-token', 'same-primary-slot', available.slots[1].startAt,
    ));
    await screen.findByText('面试时间已确认');
  });

  it('应聘或面试已结束时不提供选时操作', async () => {
    vi.mocked(portalApi.interviewView).mockResolvedValue({ ...available, closed: true, slots: [] });
    setup();
    await screen.findByText('面试选时已结束');
    expect(screen.queryByRole('button', { name: '确认这个时间' })).toBeNull();
    expect(portalApi.interviewPick).not.toHaveBeenCalled();
  });
});
