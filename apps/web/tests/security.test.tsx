import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { AxiosError, AxiosHeaders } from 'axios';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, LOGOUT_REASON_KEY } from '../src/api/client';
import { ChangePasswordModal, PASSWORD_RULE } from '../src/components/ChangePasswordModal';
import { PortalLinkError, portalErrorKind } from '../src/pages/portal/PortalLinkError';
import { useAuthStore } from '../src/stores/auth';
import { demoFlags } from '../src/utils/demo';

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  useAuthStore.setState({ token: null, user: null });
});

const httpError = (status: number, data: unknown = {}) =>
  new AxiosError('x', String(status), undefined, undefined, {
    status,
    statusText: '',
    data,
    headers: {},
    config: { headers: new AxiosHeaders() },
  });

describe('演示模式开关（登录页测试账号 / 预填密码）', () => {
  it('生产构建默认不展示演示账号、不预填', () => {
    expect(demoFlags({ DEV: false })).toEqual({ showAccounts: false, prefillPassword: false });
  });
  it('生产构建只有显式 VITE_DEMO_MODE=true 才展示，且仍不预填密码', () => {
    expect(demoFlags({ DEV: false, VITE_DEMO_MODE: 'true' })).toEqual({ showAccounts: true, prefillPassword: false });
    expect(demoFlags({ DEV: false, VITE_DEMO_MODE: '1' }).showAccounts).toBe(false);
  });
  it('开发环境默认展示并预填，VITE_DEMO_MODE=false 可关闭', () => {
    expect(demoFlags({ DEV: true })).toEqual({ showAccounts: true, prefillPassword: true });
    expect(demoFlags({ DEV: true, VITE_DEMO_MODE: 'false' })).toEqual({ showAccounts: false, prefillPassword: false });
  });
  it('演示密码只写在按需加载的 DemoAccounts 模块里，Login 主模块只在 DEV 分支内出现', () => {
    const login = readFileSync(resolve(__dirname, '../src/pages/Login.tsx'), 'utf8');
    expect(login).toMatch(/import\.meta\.env\.DEV && DEMO_MODE \? \{ email: 'admin@hireflow\.local', password: 'Admin@123456' \}/);
    expect(login.match(/Admin@123456/g)).toHaveLength(1);
    expect(login).toContain("lazy(() => import('./DemoAccounts'))");
  });
});

describe('门户链接错误页', () => {
  it('410 → 已过期，404 → 无效，其他 → 可重试', () => {
    expect(portalErrorKind(httpError(410, { code: 'PORTAL_EXPIRED' }))).toBe('expired');
    expect(portalErrorKind(httpError(404))).toBe('invalid');
    expect(portalErrorKind(httpError(500))).toBe('network');
    expect(portalErrorKind(new Error('offline'))).toBe('network');
  });

  const renderError = (error: unknown, onRetry?: () => void) =>
    render(
      <App>
        <PortalLinkError error={error} onRetry={onRetry} />
      </App>,
    );

  it('过期页：说明原因与下一步，不展示后端技术文案、不给「重试」', () => {
    renderError(httpError(410, { message: 'PORTAL_EXPIRED raw' }), vi.fn());
    expect(screen.getAllByText('链接已过期').length).toBeGreaterThan(0);
    expect(screen.getByText(/请联系 HR 重新发送/)).toBeTruthy();
    expect(screen.queryByText('PORTAL_EXPIRED raw')).toBeNull();
    expect(screen.queryByRole('button', { name: /重试/ })).toBeNull();
  });

  it('网络错误页给「重试」按钮', () => {
    const onRetry = vi.fn();
    renderError(httpError(502, { message: '网关错误' }), onRetry);
    fireEvent.click(screen.getByRole('button', { name: /重试/ }));
    expect(onRetry).toHaveBeenCalled();
    expect(screen.getByText('网关错误')).toBeTruthy();
  });
});

describe('令牌被吊销后的被动登出', () => {
  // 停在 /login：拦截器不再做整页跳转（jsdom 不支持导航）
  beforeEach(() => window.history.pushState({}, '', '/login'));
  it('已登录时收到 401：清空登录态，并把原因留给登录页显示', async () => {
    useAuthStore.setState({ token: 'old', user: { id: 'u', email: 'a@b.c', name: 'A', roles: [], permissions: [], department: null } });
    const reject = (http.interceptors.response as unknown as { handlers: Array<{ rejected: (e: unknown) => Promise<unknown> }> })
      .handlers[0].rejected;
    await expect(reject(httpError(401, { message: '登录已失效（密码已修改或已在其他地方退出），请重新登录' }))).rejects.toBeTruthy();
    expect(useAuthStore.getState().token).toBeNull();
    expect(sessionStorage.getItem(LOGOUT_REASON_KEY)).toContain('密码已修改');
  });

  it('未登录时的 401（如登录密码错误）不写原因', async () => {
    const reject = (http.interceptors.response as unknown as { handlers: Array<{ rejected: (e: unknown) => Promise<unknown> }> })
      .handlers[0].rejected;
    await expect(reject(httpError(401, { message: '邮箱或密码错误' }))).rejects.toBeTruthy();
    expect(sessionStorage.getItem(LOGOUT_REASON_KEY)).toBeNull();
  });
});

describe('修改密码', () => {
  it('前端规则与后端一致：8–72 位且含字母和数字', () => {
    expect(PASSWORD_RULE.test('abc12345')).toBe(true);
    expect(PASSWORD_RULE.test('abcdefgh')).toBe(false);
    expect(PASSWORD_RULE.test('12345678')).toBe(false);
    expect(PASSWORD_RULE.test('a1')).toBe(false);
  });

  it('两次输入不一致时不提交', async () => {
    const post = vi.spyOn(http, 'post');
    const client = new QueryClient();
    const router = createMemoryRouter([
      { path: '/', element: <ChangePasswordModal open onClose={() => {}} /> },
    ]);
    render(
      <QueryClientProvider client={client}>
        <App>
          <RouterProvider router={router} />
        </App>
      </QueryClientProvider>,
    );
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type=password]');
    fireEvent.change(inputs[0], { target: { value: 'Old12345' } });
    fireEvent.change(inputs[1], { target: { value: 'New12345' } });
    fireEvent.change(inputs[2], { target: { value: 'New12346' } });
    fireEvent.click(screen.getByRole('button', { name: /确认修改/ }));
    await waitFor(() => expect(screen.getByText('两次输入不一致')).toBeTruthy());
    expect(post).not.toHaveBeenCalled();
  });
});
