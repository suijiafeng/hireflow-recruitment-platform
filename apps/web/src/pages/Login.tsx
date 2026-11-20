import { EyeInvisibleOutlined, EyeTwoTone, LockOutlined, MailOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Form, Input } from 'antd';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { lazy, Suspense, useState } from 'react';
import { safeRedirect } from '../utils/redirect';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { authApi } from '../api';
import { extractErrorMessage, LOGOUT_REASON_KEY } from '../api/client';
import { useAuthStore } from '../stores/auth';

/** 卖点：编号 + 发丝分隔行（不用彩色图标方块，色彩留给数据与状态） */
const FEATURES = [
  { no: '01', title: '简历解析', desc: '上传后抽出技能、经历和匹配分，并写明依据' },
  { no: '02', title: '漏斗复盘', desc: '按职位看到达、停留和流失，瓶颈落在哪一段' },
  { no: '03', title: '面试留痕', desc: '排期、面评和录用审批按时间记下，之后能回看' },
];

/**
 * 演示模式（规则见 utils/demo.ts 的 demoFlags）：生产构建默认关闭，只有显式 VITE_DEMO_MODE=true 才展示演示账号。
 * 必须写成内联的 import.meta.env 表达式——构建时被替换成字面量，关闭时演示账号 chunk（含密码）整块被摇掉。
 */
const DEMO_MODE =
  import.meta.env.VITE_DEMO_MODE === 'true' || (import.meta.env.DEV && import.meta.env.VITE_DEMO_MODE !== 'false');
const DemoAccounts = DEMO_MODE ? lazy(() => import('./DemoAccounts')) : null;

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  /** 从受保护页面被带到登录页时，登录后回到原页面 */
  const redirectTo = safeRedirect(searchParams.get('redirect')) ?? '/';
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { token, setAuth } = useAuthStore();
  const [form] = Form.useForm<{ email: string; password: string }>();
  /** 登录失败的提示放在表单里：顶部一闪而过的 toast 离输入框太远，容易错过 */
  const [loginError, setLoginError] = useState<string | null>(null);
  /** 被动登出（改密 / 被管理员重置 / 停用后旧令牌失效）的原因：只显示一次 */
  const [logoutReason] = useState<string | null>(() => {
    try {
      const reason = sessionStorage.getItem(LOGOUT_REASON_KEY);
      sessionStorage.removeItem(LOGOUT_REASON_KEY);
      return reason;
    } catch {
      return null;
    }
  });
  useDocumentTitle('登录 · ART 智能招聘');

  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: (data) => {
      // 切换账号：先清掉上一个账号的查询缓存（个人信息 60s 内不会重拉，通知/列表也会短暂串号），
      // 否则布局层会把旧账号的 profile 写回本地状态，表现为"账号显示错了，刷新才对"
      queryClient.clear();
      setAuth(data.accessToken, data.user);
      message.success(`欢迎回来，${data.user.name}`);
      navigate(redirectTo, { replace: true });
    },
    onError: (error) => setLoginError(extractErrorMessage(error, '登录失败')),
  });

  if (token) return <Navigate to={redirectTo} replace />;

  return (
    <div className="login-bg">
      <div className="login-shell">
        {/* 品牌面板：logo / 主张 / 卖点 / 页脚，四段垂直分布 */}
        <div className="login-brand-side">
          <div className="login-brand-logo">
            <div className="login-brand-logo-mark" aria-hidden="true">
              A
            </div>
            <div className="login-brand-logo-text">
              <h1>ART 智能招聘</h1>
              <p>招聘工作台</p>
            </div>
          </div>

          <div className="login-brand-hero">
            <h2>
              筛选要有依据
              <br />
              决定仍由你做
            </h2>
            <p>简历解析、面试排期、面评和录用审批留在同一条记录里。模型只给建议和依据。</p>

            <div className="login-brand-features">
              {FEATURES.map((f) => (
                <div className="login-brand-feature" key={f.no}>
                  <div className="login-brand-feature-icon">{f.no}</div>
                  <div className="login-brand-feature-text">
                    <h3>{f.title}</h3>
                    <p>{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="login-brand-meta">
            <span>© 2026 ART 智能招聘</span>
            <span>简历 · 面试 · 录用 · 入职</span>
          </div>
        </div>

        {/* 表单面板：不再重复 logo，标题左对齐 */}
        <Card className="login-card" variant="borderless">
          <div className="login-welcome">
            <h2>登录</h2>
            <p>使用公司邮箱登录，权限由管理员分配。</p>
          </div>

          <Form
            form={form}
            layout="vertical"
            requiredMark={false}
            onFinish={(values) => loginMutation.mutate(values)}
            onValuesChange={() => setLoginError(null)}
            initialValues={
              // 只有开发环境预填；生产（即使开了演示模式）一律不预填密码
              import.meta.env.DEV && DEMO_MODE ? { email: 'admin@arthr.local', password: 'Admin@123456' } : undefined
            }
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
                iconRender={(visible) => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
              />
            </Form.Item>
            {loginError ? (
              <Alert type="error" showIcon title={loginError} className="u-mb-16" />
            ) : (
              logoutReason && <Alert type="info" showIcon title={logoutReason} className="u-mb-16" />
            )}
            <Button type="primary" htmlType="submit" block size="large" loading={loginMutation.isPending}>
              登录
            </Button>
          </Form>

          {DemoAccounts && (
            <Suspense fallback={null}>
              <DemoAccounts
                onPick={(email, password) => {
                  form.setFieldsValue({ email, password });
                  setLoginError(null);
                }}
                onLogin={(email, password) => loginMutation.mutate({ email, password })}
              />
            </Suspense>
          )}
        </Card>
      </div>
    </div>
  );
}
