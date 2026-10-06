import {
  AppstoreOutlined,
  AuditOutlined,
  CommentOutlined,
  DashboardOutlined,
  FundOutlined,
  HomeOutlined,
  IdcardOutlined,
  LogoutOutlined,
  MenuOutlined,
  ProfileOutlined,
  RocketOutlined,
  ScheduleOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { PERMISSIONS, ROLE_LABEL, type RoleCode } from '@hireflow/shared';
import { Avatar, Breadcrumb, Button, Drawer, Dropdown, Layout, Menu, Result, Space, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { authApi } from '../api';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { NotificationBell } from '../components/NotificationBell';
import { useAuthStore } from '../stores/auth';
import { loginUrlFor } from '../utils/redirect';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

const { Header, Sider, Content } = Layout;

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': '数据大盘',
  '/insights': '数据洞察',
  '/jobs': '职位管理',
  '/candidates': '候选人',
  '/pipeline': '招聘看板',
  '/interviews': '面试管理',
  '/offers': '录用管理',
  '/onboarding': '入职管理',
  '/helpdesk': '入职问答',
  '/settings': '系统设置',
};

/** 菜单项与所需权限码（任一命中即可见；不配 perms = 全员可见）——按钮级权限约定 */
const MENU_DEFS: Array<{
  label: string;
  children: Array<{ key: string; icon: React.ReactNode; label: string; perms?: string[] }>;
}> = [
  {
    label: '招聘',
    children: [
      { key: '/dashboard', icon: <DashboardOutlined />, label: '数据大盘', perms: [PERMISSIONS.DASHBOARD_VIEW] },
      { key: '/insights', icon: <FundOutlined />, label: '数据洞察', perms: [PERMISSIONS.DASHBOARD_VIEW] },
      { key: '/jobs', icon: <ProfileOutlined />, label: '职位管理', perms: [PERMISSIONS.JOB_READ] },
      { key: '/candidates', icon: <TeamOutlined />, label: '候选人', perms: [PERMISSIONS.CANDIDATE_READ] },
      { key: '/pipeline', icon: <AppstoreOutlined />, label: '招聘看板', perms: [PERMISSIONS.JOB_READ] },
      {
        key: '/interviews',
        icon: <ScheduleOutlined />,
        label: '面试管理',
        perms: [PERMISSIONS.INTERVIEW_SCHEDULE, PERMISSIONS.EVALUATION_SUBMIT],
      },
    ],
  },
  {
    label: '录用与入职',
    children: [
      {
        key: '/offers',
        icon: <AuditOutlined />,
        label: '录用管理',
        perms: [PERMISSIONS.OFFER_INITIATE, PERMISSIONS.OFFER_APPROVE],
      },
      { key: '/onboarding', icon: <IdcardOutlined />, label: '入职管理', perms: [PERMISSIONS.ONBOARDING_READ] },
      { key: '/helpdesk', icon: <CommentOutlined />, label: '入职问答' },
    ],
  },
  {
    label: '系统',
    children: [
      {
        key: '/settings',
        icon: <SettingOutlined />,
        label: '系统设置',
        perms: [PERMISSIONS.USER_MANAGE, PERMISSIONS.CONFIG_MANAGE],
      },
    ],
  },
];

/** 登录后的首页 = 第一个有权限看的菜单项；面试官落到面试页（可约时段在右栏），IT 落入职管理 */
export function firstVisiblePath(hasPermission: (p: string) => boolean): string {
  // 面试官没有大盘/职位权限，菜单序会落到「候选人」——但他们的主操作是维护可约时段
  if (
    hasPermission(PERMISSIONS.EVALUATION_SUBMIT) &&
    !hasPermission(PERMISSIONS.DASHBOARD_VIEW) &&
    !hasPermission(PERMISSIONS.JOB_READ)
  ) {
    return '/interviews';
  }
  const paths = MENU_DEFS.flatMap((group) => group.children);
  return paths.find((item) => !item.perms || item.perms.some((p) => hasPermission(p)))?.key ?? '/helpdesk';
}

export function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token, user, logout } = useAuthStore();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const setUser = useAuthStore((s) => s.setUser);

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
      MENU_DEFS.map((group) => ({
        type: 'group' as const,
        label: group.label,
        children: group.children
          .filter((item) => !item.perms || item.perms.some((p) => hasPermission(p)))
          .map(({ perms: _perms, ...item }) => item),
      })).filter((group) => group.children.length > 0),
    // user 进依赖：权限刷新后菜单要跟着重算（hasPermission 本身是稳定引用）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasPermission, user?.permissions],
  );

  // 手机宽度：侧边栏收起成汉堡按钮 + 抽屉菜单，内容区才有完整宽度（64px 图标栏在 375 宽下占去 1/6）
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useEffect(() => setMobileMenuOpen(false), [location.pathname]);
  // 标题 hook 必须在下面的 early return 之前
  const titleKey = Object.keys(PAGE_TITLES).find((key) => location.pathname.startsWith(key));
  useDocumentTitle(titleKey ? `${PAGE_TITLES[titleKey]} · ART 智能招聘` : 'ART 智能招聘');

  if (!token) return <Navigate to={loginUrlFor(location.pathname + location.search)} replace />;

  const selectedKey = Object.keys(PAGE_TITLES).find((key) => location.pathname.startsWith(key));
  const menu = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={selectedKey ? [selectedKey] : []}
      items={menuItems}
      onClick={({ key }) => navigate(key)}
    />
  );
  const primaryRole = user?.roles[0] as RoleCode | undefined;

  // 面包屑：首页 / 菜单分组 / 当前页（带页面图标）
  const currentGroup = MENU_DEFS.find((g) => g.children.some((c) => c.key === selectedKey));
  const currentItem = currentGroup?.children.find((c) => c.key === selectedKey);
  // 路由级权限：与菜单显隐同一份定义。直接输 URL 进入无权页面时统一给 403，
  // 不再让各页面自己处理（有的显示空态「去创建」，有的直接崩溃）
  const canViewCurrent = !currentItem?.perms || currentItem.perms.some((p) => hasPermission(p));
  const breadcrumbItems = [
    { title: <HomeOutlined /> },
    ...(currentGroup ? [{ title: currentGroup.label }] : []),
    ...(selectedKey
      ? [
          {
            title: (
              <Space size={6}>
                {currentItem?.icon}
                <Typography.Text strong>{PAGE_TITLES[selectedKey]}</Typography.Text>
              </Space>
            ),
          },
        ]
      : []),
  ];

  return (
    // 外层锁定视口高度：左侧菜单栏固定，右侧主内容区独立滚动
    <Layout className="layout-root">
      <Sider width={220} breakpoint="xl" collapsedWidth={64}>
        <div className="sider-inner">
          <div className="sider-logo">
            <div className="sider-logo-mark">
              <RocketOutlined />
            </div>
            <div className="sider-logo-text">
              <div className="sider-logo-name">ART 智能招聘</div>
              <div className="sider-logo-sub">AI Recruiting</div>
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
            <div className="sider-logo-mark">
              <RocketOutlined />
            </div>
            <div className="sider-logo-text">
              <div className="sider-logo-name">ART 智能招聘</div>
            </div>
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
            <NotificationBell />
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'logout',
                    icon: <LogoutOutlined />,
                    label: '退出登录',
                    onClick: () => {
                      logout();
                      navigate('/login');
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
          </Space>
        </Header>
        {/* 主内容区：唯一滚动容器 */}
        <Content className="layout-content">
          {canViewCurrent ? (
            <Outlet />
          ) : (
            <Result
              status="403"
              title="无权访问"
              subTitle="当前角色没有查看此页面的权限，如需访问请联系管理员"
              extra={
                <Button type="link" onClick={() => navigate(firstVisiblePath(hasPermission), { replace: true })}>
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
