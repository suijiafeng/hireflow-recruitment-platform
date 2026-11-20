import {
  CloseOutlined,
  AppstoreOutlined,
  AuditOutlined,
  DashboardOutlined,
  DisconnectOutlined,
  HomeOutlined,
  KeyOutlined,
  LogoutOutlined,
  MenuOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { ROLE_LABEL, type RoleCode } from '@hireflow/shared';
import { App, Avatar, Breadcrumb, Button, Drawer, Dropdown, Layout, Menu, Space, Tabs, Tag, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { authApi } from '../api';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import { NotificationBell } from '../components/NotificationBell';
import { CopilotLauncher } from '../copilot/CopilotLauncher';
import { useAuthStore } from '../stores/auth';
import { loginUrlFor } from '../utils/redirect';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { EmptyState } from '../components/EmptyState';
import { firstVisiblePath, locate, NAV_ITEMS, sectionVisible, visibleSections } from './nav';

const { Header, Sider, Content } = Layout;

export const BRAND = 'HireFlow 招聘';

const MENU_ICONS: Record<string, ReactNode> = {
  board: <AppstoreOutlined />,
  candidates: <TeamOutlined />,
  hire: <AuditOutlined />,
  data: <DashboardOutlined />,
  settings: <SettingOutlined />,
};

export function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token, user, logout } = useAuthStore();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const setUser = useAuthStore((s) => s.setUser);
  const setAuth = useAuthStore((s) => s.setAuth);
  const queryClient = useQueryClient();
  /** 主动点「退出登录」时置位：此时跳登录页不能带 redirect，否则下一个账号会被带回上一个账号的页面 */
  const explicitLogout = useRef(false);

  // 服务端每次请求都按库里的当前角色鉴权；这里同步刷新本地缓存的权限，
  // 否则管理员降权 / 加权后，菜单和按钮要等重新登录才变（回到窗口时也会刷新一次）
  const profileQuery = useQuery({
    queryKey: ['auth-profile'],
    queryFn: authApi.profile,
    enabled: Boolean(token),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (profileQuery.data) setUser(profileQuery.data);
  }, [profileQuery.data, setUser]);

  const menuItems = useMemo(
    () =>
      NAV_ITEMS.filter((item) => visibleSections(item, hasPermission).length > 0).map((item) => ({
        key: item.key,
        label: item.label,
        icon: MENU_ICONS[item.key],
      })),
    // user 进依赖：权限刷新后菜单要跟着重算（hasPermission 本身是稳定引用）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasPermission, user?.permissions],
  );
  const { message, modal } = App.useApp();
  const current = locate(location.pathname);

  // 手机宽度：侧边栏收起成汉堡按钮 + 抽屉菜单，内容区才有完整宽度（64px 图标栏在 375 宽下占去 1/6）
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useEffect(() => setMobileMenuOpen(false), [location.pathname]);
  // 标题 hook 必须在下面的 early return 之前
  useDocumentTitle(current ? `${current.section.label} · ${BRAND}` : BRAND);

  // 会话过期（401 清 token）才带 redirect 回跳；主动退出直接去登录页，让下一个账号落到自己的默认菜单
  if (!token) {
    return (
      <div className="loading-center loading-center--lg" role="status">
        正在返回登录页…
        {/* 后退可打断尚未提交的跳转；历史位置变化时重新挂载，避免相同目标的 Navigate 不再执行。 */}
        <Navigate
          key={location.key}
          to={explicitLogout.current ? '/login' : loginUrlFor(location.pathname + location.search)}
          replace
        />
      </div>
    );
  }

  const menu = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={current ? [current.item.key] : []}
      items={menuItems}
      onClick={({ key }) => {
        const item = NAV_ITEMS.find((i) => i.key === key);
        const target = item && visibleSections(item, hasPermission)[0];
        if (target) navigate(target.key);
      }}
    />
  );
  const primaryRole = user?.roles[0] as RoleCode | undefined;

  // 路由级权限：与菜单显隐同一份定义。直接输 URL 进入无权页面时统一给 403，
  // 不再让各页面自己处理（有的显示空态「去创建」，有的直接崩溃）
  const canViewCurrent = !current || sectionVisible(current.section, hasPermission);
  const tabs = current ? visibleSections(current.item, hasPermission) : [];
  const breadcrumbItems = [
    { title: <HomeOutlined /> },
    ...(current
      ? [
          {
            title: (
              <Space size={6}>
                {MENU_ICONS[current.item.key]}
                <Typography.Text strong>{current.item.label}</Typography.Text>
              </Space>
            ),
          },
        ]
      : []),
  ];

  const revokeOtherSessions = () =>
    modal.confirm({
      title: '退出其他设备？',
      content: '其它浏览器和设备上的登录会立即失效，当前页面保持登录。',
      okText: '退出其他设备',
      cancelText: '取消',
      onOk: async () => {
        const { accessToken } = await authApi.revokeSessions();
        if (user) setAuth(accessToken, user);
        message.success('其他设备已退出登录');
      },
    });

  return (
    // 外层锁定视口高度：左侧菜单栏固定，右侧主内容区独立滚动
    <Layout className="layout-root">
      <Sider width={220} breakpoint="xl" collapsedWidth={64}>
        <div className="sider-inner">
          <div className="sider-logo">
            <div className="sider-logo-mark" aria-hidden="true">
              H
            </div>
            <div className="sider-logo-text">
              <div className="sider-logo-name">{BRAND}</div>
              <div className="sider-logo-sub">招聘工作台</div>
            </div>
          </div>
          <div className="sider-menu-scroll">{menu}</div>
        </div>
      </Sider>
      <Drawer
        className="mobile-menu"
        placement="left"
        size={260}
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        closable={false}
        styles={{ body: { padding: 0 } }}
      >
        <div className="sider-inner">
          <div className="sider-logo">
            <div className="sider-logo-mark" aria-hidden="true">
              H
            </div>
            <div className="sider-logo-text">
              <div className="sider-logo-name">{BRAND}</div>
            </div>
            {/* 和全站弹层一致：关闭在右上角；点遮罩、Esc 同样可关 */}
            <Button
              className="mobile-menu-close"
              type="text"
              icon={<CloseOutlined />}
              aria-label="关闭菜单"
              onClick={() => setMobileMenuOpen(false)}
            />
          </div>
          <div className="sider-menu-scroll">{menu}</div>
        </div>
      </Drawer>
      <Layout className="layout-main">
        <Header className="layout-header">
          <Button
            className="mobile-menu-btn"
            type="text"
            icon={<MenuOutlined />}
            aria-label="打开菜单"
            onClick={() => setMobileMenuOpen(true)}
          />
          <Breadcrumb items={breadcrumbItems} />
          <Space>
            <CopilotLauncher />
            <NotificationBell />
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'password',
                    icon: <KeyOutlined />,
                    label: '修改密码',
                    onClick: () => setPasswordOpen(true),
                  },
                  {
                    key: 'revoke',
                    icon: <DisconnectOutlined />,
                    label: '退出其他设备',
                    onClick: revokeOtherSessions,
                  },
                  { type: 'divider' },
                  {
                    key: 'logout',
                    icon: <LogoutOutlined />,
                    label: '退出登录',
                    onClick: () => {
                      explicitLogout.current = true;
                      // token 清空后上面的 Navigate 会接管跳转，这里不再手动 navigate（避免两次跳转打架）
                      logout();
                      // 退出即清缓存：下一个登录的账号不能看到上一个账号的任何数据
                      queryClient.clear();
                    },
                  },
                ],
              }}
            >
              <Space size={8} className="header-user">
                <Avatar size="small" className="header-avatar" icon={<UserOutlined />} />
                <Typography.Text>{user?.name}</Typography.Text>
                {primaryRole && ROLE_LABEL[primaryRole] && (
                  <Tag className="u-mr-0">
                    {ROLE_LABEL[primaryRole]}
                  </Tag>
                )}
              </Space>
            </Dropdown>
            <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
          </Space>
        </Header>
        {/* 主内容区：唯一滚动容器 */}
        <Content className="layout-content">
          {tabs.length > 1 && canViewCurrent && (
            <Tabs
              className="section-tabs"
              activeKey={current?.section.key}
              items={tabs.map((t) => ({ key: t.key, label: t.label }))}
              onChange={(key) => navigate(key)}
            />
          )}
          {canViewCurrent ? (
            <Outlet />
          ) : (
            <EmptyState
              size="lg"
              tone="forbidden"
              title="无权访问"
              description="当前角色没有查看此页面的权限，如需访问请联系管理员"
              action={
                <Button type="primary" onClick={() => navigate(firstVisiblePath(hasPermission), { replace: true })}>
                  返回我的首页
                </Button>
              }
            />
          )}
        </Content>
      </Layout>
    </Layout>
  );
}
