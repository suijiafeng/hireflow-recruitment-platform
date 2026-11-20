import {
  AuditOutlined,
  FileSearchOutlined,
  LockOutlined,
  MailOutlined,
  ProjectOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Button, Checkbox, Form, Input } from 'antd';
import axios from 'axios';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { lazy, Suspense, useEffect, useState } from 'react';
import { safeRedirect } from '../utils/redirect';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { authApi } from '../api';
import { extractErrorMessage, LOGOUT_REASON_KEY } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { LoginDecor } from './LoginDecor';
import '../styles/login.css';

/**
 * 演示模式（规则见 utils/demo.ts 的 demoFlags）：生产构建默认关闭，只有显式 VITE_DEMO_MODE=true 才展示演示账号。
 * 必须写成内联的 import.meta.env 表达式——构建时被替换成字面量，关闭时演示账号 chunk（含密码）整块被摇掉。
 */
const DEMO_MODE =
  import.meta.env.VITE_DEMO_MODE === 'true' || (import.meta.env.DEV && import.meta.env.VITE_DEMO_MODE !== 'false');
const DemoAccounts = DEMO_MODE ? lazy(() => import('./DemoAccounts')) : null;

/** 「记住邮箱」：只存邮箱，不存密码 */
export const REMEMBER_EMAIL_KEY = 'hireflow-remember-email';

/** 登录页提示统一走顶部 toast（antd message），同 key 只保留一条；时长与设计稿一致 */
export const LOGIN_TOAST = {
  /** 被动登出原因（改密 / 重置 / 停用 / 退出所有设备后旧会话失效） */
  logout: { key: 'login-logout-reason', duration: 4 },
  /** 429 限流：toast 5s，按钮倒计时到 0 才恢复 */
  throttled: { key: 'login-error', duration: 5 },
  /** 密码错误等其他失败 */
  failed: { key: 'login-error', duration: 3 },
} as const;

function readRememberedEmail(): string | null {
  try {
    return localStorage.getItem(REMEMBER_EMAIL_KEY);
  } catch {
    return null;
  }
}

function writeRememberedEmail(email: string | null) {
  try {
    if (email) localStorage.setItem(REMEMBER_EMAIL_KEY, email);
    else localStorage.removeItem(REMEMBER_EMAIL_KEY);
  } catch {
    /* 隐私模式等不可写时忽略 */
  }
}

/** 429 的等待秒数：优先响应体 retryAfter，其次 Retry-After 头，兜底 30s */
export function retryAfterSeconds(error: unknown): number | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 429) return null;
  const body = (error.response.data as { retryAfter?: unknown } | undefined)?.retryAfter;
  const header = Number(error.response.headers?.['retry-after']);
  const seconds = typeof body === 'number' ? body : Number.isFinite(header) && header > 0 ? header : 30;
  return Math.max(1, Math.ceil(seconds));
}

const FEATURES = [
  { icon: <ProjectOutlined />, text: '流水线看板' },
  { icon: <FileSearchOutlined />, text: 'AI 简历解析与匹配' },
  { icon: <AuditOutlined />, text: '细粒度权限' },
];

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  /** 从受保护页面被带到登录页时，登录后回到原页面 */
  const redirectTo = safeRedirect(searchParams.get('redirect')) ?? '/';
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { token, setAuth } = useAuthStore();
  const [form] = Form.useForm<{ email: string; password: string }>();
  const [rememberedEmail] = useState(readRememberedEmail);
  const [remember, setRemember] = useState(true);
  /** 429 倒计时（秒）：按钮禁用并显示「N 秒后可重试」 */
  const [retryIn, setRetryIn] = useState(0);
  useDocumentTitle('登录 · ART 智能招聘');

  // 被动登出原因：读一次就清掉，以 info toast 告知（StrictMode 下第二次读到的是空，不会重复弹）
  useEffect(() => {
    let reason: string | null = null;
    try {
      reason = sessionStorage.getItem(LOGOUT_REASON_KEY);
      sessionStorage.removeItem(LOGOUT_REASON_KEY);
    } catch {
      /* 不可读时忽略 */
    }
    if (reason) message.open({ ...LOGIN_TOAST.logout, type: 'info', content: reason });
  }, [message]);

  useEffect(() => {
    if (retryIn <= 0) return;
    const timer = window.setTimeout(() => setRetryIn((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [retryIn]);

  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: (data, variables) => {
      writeRememberedEmail(remember ? variables.email : null);
      // 切换账号：先清掉上一个账号的查询缓存（个人信息 60s 内不会重拉，通知/列表也会短暂串号），
      // 否则布局层会把旧账号的 profile 写回本地状态，表现为"账号显示错了，刷新才对"
      queryClient.clear();
      message.destroy(LOGIN_TOAST.failed.key);
      setAuth(data.accessToken, data.user);
      message.success(`欢迎回来，${data.user.name}`);
      navigate(redirectTo, { replace: true });
    },
    onError: (error) => {
      const content = extractErrorMessage(error, '登录失败');
      const wait = retryAfterSeconds(error);
      if (wait) {
        setRetryIn(wait);
        message.open({ ...LOGIN_TOAST.throttled, type: 'error', content });
      } else {
        message.open({ ...LOGIN_TOAST.failed, type: 'error', content });
      }
    },
  });

  if (token) return <Navigate to={redirectTo} replace />;

  const throttled = retryIn > 0;
  const login = (values: { email: string; password: string }) => {
    if (!throttled) loginMutation.mutate(values);
  };

  return (
    <div className="login-page">
      <LoginDecor />

      <main className="login-main">
        <section className="login-card" aria-labelledby="login-title">
          <header className="login-head">
            <div className="login-logo" aria-hidden="true">
              A
            </div>
            <h1 id="login-title">ART 智能招聘</h1>
            <p>
              每一位候选人，都在<em>同一条流水线</em>上
            </p>
          </header>

          <Form
            form={form}
            layout="vertical"
            requiredMark={false}
            onFinish={login}
            initialValues={{
              // 只有开发环境预填；生产（即使开了演示模式）一律不预填密码
              ...(import.meta.env.DEV && DEMO_MODE ? { email: 'admin@arthr.local', password: 'Admin@123456' } : {}),
              ...(rememberedEmail ? { email: rememberedEmail } : {}),
            }}
          >
            <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email', message: '请输入正确的邮箱' }]}>
              <Input prefix={<MailOutlined />} placeholder="you@company.com" size="large" autoComplete="username" autoFocus />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, min: 6, message: '密码至少 6 位' }]}>
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="请输入密码"
                size="large"
                autoComplete="current-password"
              />
            </Form.Item>
            <div className="login-row">
              <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)}>
                记住邮箱
              </Checkbox>
              <span title="系统暂无邮件通道，由管理员在「成员管理」重置密码">忘记密码？请联系管理员</span>
            </div>
            <Button
              className="login-submit"
              type="primary"
              htmlType="submit"
              block
              size="large"
              loading={loginMutation.isPending}
              disabled={throttled}
            >
              {throttled ? `${retryIn} 秒后可重试` : '登录'}
            </Button>
          </Form>

          {DemoAccounts && (
            <Suspense fallback={null}>
              <DemoAccounts
                onPick={(email, password) => form.setFieldsValue({ email, password })}
                onLogin={(email, password) => login({ email, password })}
              />
            </Suspense>
          )}
        </section>

        <div className="login-chips">
          {FEATURES.map((f) => (
            <span key={f.text}>
              {f.icon}
              {f.text}
            </span>
          ))}
        </div>
      </main>

      <footer className="login-foot">
        <span>© 2026 ART 智能招聘</span>
        <span>简历 · 面试 · 录用 · 入职</span>
      </footer>
    </div>
  );
}
