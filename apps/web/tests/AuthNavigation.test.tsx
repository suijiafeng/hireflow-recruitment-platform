import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PERMISSIONS } from '@hireflow/shared';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, ConfigProvider } from 'antd';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../src/api';
import { MainLayout } from '../src/layouts/MainLayout';
import { LoginPage } from '../src/pages/Login';
import { useAuthStore, type AuthUser } from '../src/stores/auth';

vi.mock('../src/api', () => ({ authApi: { profile: vi.fn(), login: vi.fn() } }));
vi.mock('../src/components/NotificationBell', () => ({ NotificationBell: () => null }));

let router: ReturnType<typeof createBrowserRouter> | undefined;
let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/jobs');
  useAuthStore.getState().logout();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  router?.dispose();
  client.clear();
});

function setup(role: string, loginLazy?: () => Promise<{ Component: typeof LoginPage }>) {
  const profile: AuthUser = {
    id: role,
    name: `测试${role}`,
    email: `${role}@example.test`,
    roles: [role],
    department: null,
    permissions: [PERMISSIONS.JOB_READ, PERMISSIONS.CANDIDATE_READ],
  };
  vi.mocked(authApi.profile).mockResolvedValue(profile);
  useAuthStore.getState().setAuth('test-token', profile);
  router = createBrowserRouter([
    { path: '/login', ...(loginLazy ? { lazy: loginLazy } : { Component: LoginPage }) },
    {
      path: '/',
      Component: MainLayout,
      children: [
        { path: 'jobs', element: <p>职位数据</p> },
        { path: 'candidates', element: <p>候选人数据</p> },
      ],
    },
  ]);
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

describe('退出后的浏览器历史', () => {
  it.each(['HR', 'ADMIN'])('%s 退出时登录页懒加载未完成，立即后退也应恢复登录页', async (role) => {
    let resolveLogin!: () => void;
    const loginReady = new Promise<{ Component: typeof LoginPage }>((done) => {
      resolveLogin = () => done({ Component: LoginPage });
    });
    const user = setup(role, () => loginReady);
    await act(async () => router!.navigate('/jobs', { replace: true }));
    await screen.findByText('职位数据');
    await act(async () => router!.navigate('/candidates'));
    await screen.findByText('候选人数据');

    await user.hover(screen.getByText(`测试${role}`));
    await user.click(await screen.findByText('退出登录'));
    await waitFor(() => expect(router!.state.navigation.location?.pathname).toBe('/login'));
    expect(useAuthStore.getState().token).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('正在返回登录页');
    // 登录模块未完成时地址仍是 /candidates，此用例覆盖该加载窗口被 POP 中断的情况。
    expect(window.location.pathname).toBe('/candidates');

    // 浏览器 POP 会中断尚未完成的登录跳转；同一个 MainLayout 仍挂载在旧的受保护历史页。
    await act(async () => window.history.back());
    await waitFor(() => expect(router!.state.location.pathname).toBe('/jobs'));
    await act(async () => {
      resolveLogin();
      await loginReady;
    });

    await waitFor(() => expect(router!.state.location.pathname).toBe('/login'));
    await screen.findByRole('button', { name: /登\s*录/ });
    expect(screen.queryByText('职位数据')).toBeNull();
    expect(screen.queryByText('候选人数据')).toBeNull();
  });

  it.each(['HR', 'ADMIN'])('%s 退出后后退到受保护页面仍显示登录页', async (role) => {
    const user = setup(role);
    await act(async () => router!.navigate('/jobs', { replace: true }));
    await screen.findByText('职位数据');
    await act(async () => router!.navigate('/candidates'));
    await screen.findByText('候选人数据');
    client.setQueryData(['private-data'], { secret: 'previous user' });

    await user.hover(screen.getByText(`测试${role}`));
    await user.click(await screen.findByText('退出登录'));
    await waitFor(() => expect(router!.state.location.pathname).toBe('/login'));
    await screen.findByRole('button', { name: /登\s*录/ });
    expect(useAuthStore.getState().token).toBeNull();
    expect(client.getQueryData(['private-data'])).toBeUndefined();

    await act(async () => window.history.back());
    await waitFor(() => expect(router!.state.location.search).toBe('?redirect=%2Fjobs'));
    await screen.findByRole('button', { name: /登\s*录/ });
    expect(screen.queryByText('职位数据')).toBeNull();
    expect(screen.queryByText('候选人数据')).toBeNull();
  });
});
