import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { AxiosError, AxiosHeaders } from 'axios';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../src/api';
import { LOGOUT_REASON_KEY } from '../src/api/client';
import { LOGIN_TOAST, LoginPage, REMEMBER_EMAIL_KEY, retryAfterSeconds } from '../src/pages/Login';
import { useAuthStore } from '../src/stores/auth';

const httpError = (status: number, data: unknown = {}, headers: Record<string, string> = {}) =>
  new AxiosError('x', String(status), undefined, undefined, {
    status,
    statusText: '',
    data,
    headers,
    config: { headers: new AxiosHeaders() },
  });

const USER = { id: 'u1', email: 'hr@arthr.local', name: '王招聘', roles: [], permissions: [], department: null };

function renderLogin() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/login', Component: LoginPage },
      { path: '/', element: <div>工作台首页</div> },
    ],
    { initialEntries: ['/login'] },
  );
  render(
    <QueryClientProvider client={client}>
      <App>
        <RouterProvider router={router} />
      </App>
    </QueryClientProvider>,
  );
  return router;
}

const emailInput = () => screen.getByPlaceholderText('you@company.com') as HTMLInputElement;
const passwordInput = () => screen.getByPlaceholderText('请输入密码') as HTMLInputElement;
const submit = () => screen.getByRole('button', { name: /登\s*录|秒后可重试/ });

async function fillAndSubmit(email = 'hr@arthr.local', password = 'Wrong123') {
  fireEvent.change(emailInput(), { target: { value: email } });
  fireEvent.change(passwordInput(), { target: { value: password } });
  fireEvent.click(submit());
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
  useAuthStore.setState({ token: null, user: null });
});

describe('登录页 toast', () => {
  it('时长与设计稿一致：会话失效 4s、429 5s、其他失败 3s；429 与密码错误共用一个 key 互相替换', () => {
    expect(LOGIN_TOAST.logout.duration).toBe(4);
    expect(LOGIN_TOAST.throttled.duration).toBe(5);
    expect(LOGIN_TOAST.failed.duration).toBe(3);
    expect(LOGIN_TOAST.throttled.key).toBe(LOGIN_TOAST.failed.key);
  });

  it('被动登出原因：进入登录页弹 info toast，读一次即清除，表单内不再有横幅', async () => {
    sessionStorage.setItem(LOGOUT_REASON_KEY, '登录已失效（密码已修改或已在其他地方退出），请重新登录');
    renderLogin();
    expect(await screen.findByText(/密码已修改或已在其他地方退出/)).toBeTruthy();
    expect(document.querySelector('.ant-message-notice .anticon-info-circle')).toBeTruthy();
    expect(document.querySelector('.login-card .ant-alert')).toBeNull();
    expect(sessionStorage.getItem(LOGOUT_REASON_KEY)).toBeNull();
  });

  it('密码错误：弹 error toast「邮箱或密码错误」，按钮仍可用', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue(httpError(401, { message: '邮箱或密码错误' }));
    renderLogin();
    await fillAndSubmit();
    expect(await screen.findByText('邮箱或密码错误')).toBeTruthy();
    expect(document.querySelector('.ant-message-notice .anticon-close-circle')).toBeTruthy();
    expect(document.querySelector('.login-card .ant-alert')).toBeNull();
    expect((submit() as HTMLButtonElement).disabled).toBe(false);
  });

  it('429：弹 error toast，按钮禁用并倒计时，到 0 恢复且期间不再提交', async () => {
    const login = vi
      .spyOn(authApi, 'login')
      .mockRejectedValue(httpError(429, { message: '尝试过于频繁，请 3 秒后再试', retryAfter: 3 }));
    renderLogin();
    await fillAndSubmit();
    expect(await screen.findByText('尝试过于频繁，请 3 秒后再试')).toBeTruthy();
    await waitFor(() => expect(submit().textContent).toContain('3 秒后可重试'));
    expect((submit() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(document.querySelector('form')!);
    expect(login).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(submit().textContent).toContain('2 秒后可重试'), { timeout: 2000 });
    await waitFor(() => expect((submit() as HTMLButtonElement).disabled).toBe(false), { timeout: 4000 });
    expect(submit().textContent?.replace(/\s/g, '')).toBe('登录');
  });

  it('retryAfterSeconds：响应体优先，其次 Retry-After 头，非 429 返回 null', () => {
    expect(retryAfterSeconds(httpError(429, { retryAfter: 12.2 }))).toBe(13);
    expect(retryAfterSeconds(httpError(429, {}, { 'retry-after': '8' }))).toBe(8);
    expect(retryAfterSeconds(httpError(429, {}))).toBe(30);
    expect(retryAfterSeconds(httpError(401, { retryAfter: 5 }))).toBeNull();
  });
});

describe('记住邮箱', () => {
  it('勾选（默认）登录成功后保存邮箱，下次打开自动填入；从不保存密码', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({ accessToken: 't', user: USER } as never);
    const router = renderLogin();
    await fillAndSubmit('manager@arthr.local', 'Secret123');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(localStorage.getItem(REMEMBER_EMAIL_KEY)).toBe('manager@arthr.local');
    expect(JSON.stringify(localStorage)).not.toContain('Secret123');

    cleanup();
    useAuthStore.setState({ token: null, user: null });
    renderLogin();
    expect(emailInput().value).toBe('manager@arthr.local');
  });

  it('取消勾选后登录：清除已记住的邮箱', async () => {
    localStorage.setItem(REMEMBER_EMAIL_KEY, 'old@arthr.local');
    vi.spyOn(authApi, 'login').mockResolvedValue({ accessToken: 't', user: USER } as never);
    renderLogin();
    expect(emailInput().value).toBe('old@arthr.local');
    fireEvent.click(screen.getByRole('checkbox', { name: '记住邮箱' }));
    await fillAndSubmit('hr@arthr.local', 'Secret123');
    await waitFor(() => expect(localStorage.getItem(REMEMBER_EMAIL_KEY)).toBeNull());
  });
});

describe('显示 / 隐藏密码', () => {
  it('点眼睛切换明文', () => {
    renderLogin();
    expect(passwordInput().type).toBe('password');
    fireEvent.click(document.querySelector('.ant-input-password-icon')!);
    expect(passwordInput().type).toBe('text');
  });
});

describe('演示账号入口', () => {
  it('演示模式（测试环境 = DEV）下默认折叠，展开后点一行填入表单', async () => {
    renderLogin();
    const toggle = await screen.findByRole('button', { name: /演示账号/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('interviewer@arthr.local')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByText('interviewer@arthr.local'));
    await waitFor(() => expect(emailInput().value).toBe('interviewer@arthr.local'));
  });

  it('VITE_DEMO_MODE=false 时不渲染演示账号入口', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    vi.resetModules();
    try {
      const { LoginPage: Fresh } = await import('../src/pages/Login');
      const { App: FreshApp } = await import('antd');
      const client = new QueryClient();
      const router = createMemoryRouter([{ path: '/login', Component: Fresh }], { initialEntries: ['/login'] });
      render(
        <QueryClientProvider client={client}>
          <FreshApp>
            <RouterProvider router={router} />
          </FreshApp>
        </QueryClientProvider>,
      );
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(screen.getByText('ART 智能招聘')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /演示账号/ })).toBeNull();
      expect(emailInput().value).toBe('');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
