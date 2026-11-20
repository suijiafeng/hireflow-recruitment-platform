import type { ComponentType } from 'react';
import { Button } from 'antd';
import { EmptyState } from './components/EmptyState';
import { createBrowserRouter, isRouteErrorResponse, Navigate, useRouteError } from 'react-router';
import { firstVisiblePath } from './layouts/nav';
import { useAuthStore } from './stores/auth';

function RouteFallback() {
  return (
    <div className="loading-center loading-center--lg" role="status">
      加载中…
    </div>
  );
}

/** 懒加载 chunk 失败（发版后旧页面、网络中断）和其它路由异常，都不要落到英文默认页。 */
function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i.test(message);
}

function RouteErrorPage() {
  const error = useRouteError();
  const chunk = isChunkLoadError(error);
  const status = isRouteErrorResponse(error) ? error.status : 0;
  return (
    <div className="route-error">
      <EmptyState
        size="lg"
        tone="warn"
        title={chunk ? '页面没有加载出来' : '页面出现问题'}
        description={
          chunk
            ? '页面资源加载失败。刷新即可继续；如果系统刚更新过，刷新会拿到最新页面。'
            : status
              ? `请求没有完成（${status}）。可以刷新页面，或先回到首页。`
              : '这里暂时打不开。可以刷新页面，或先回到首页。'
        }
        action={
          <>
            <Button onClick={() => window.location.assign('/')}>返回首页</Button>
            <Button type="primary" onClick={() => window.location.reload()}>
              刷新页面
            </Button>
          </>
        }
      />
    </div>
  );
}

/** 路由级懒加载：匹配到的页面（及其独占依赖）打成独立 chunk，不进首屏包。 */
function lazyPage<T>(load: () => Promise<T>, name: keyof T) {
  return async () => {
    const mod = await load();
    return { Component: mod[name] as ComponentType };
  };
}

/** 首页按权限落到第一个可见页签（面试官没有看板权限，不能硬跳 /pipeline） */
function HomeRedirect() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  return <Navigate to={firstVisiblePath(hasPermission)} replace />;
}

export const router = createBrowserRouter([
  {
    hydrateFallbackElement: <RouteFallback />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: '/login', lazy: lazyPage(() => import('./pages/Login'), 'LoginPage') },
      // 候选人页：免登录，链接即凭证，不走 MainLayout 鉴权
      { path: '/portal/:token', lazy: lazyPage(() => import('./pages/portal/PortalPage'), 'PortalPage') },
      // 旧版分开的四个门户地址已下线：给出「链接无效」，不跳到登录页
      { path: '/portal/*', lazy: lazyPage(() => import('./pages/portal/PortalLinkError'), 'RetiredPortalLink') },
      {
        path: '/',
        lazy: lazyPage(() => import('./layouts/MainLayout'), 'MainLayout'),
        children: [
          {
            // 子页面 chunk 失败时错误画在主布局里，侧栏还在；布局本身失败才落到根上的整页错误
            errorElement: <RouteErrorPage />,
            children: [
              { index: true, element: <HomeRedirect /> },
              { path: 'dashboard', lazy: lazyPage(() => import('./pages/dashboard/DashboardPage'), 'DashboardPage') },
              { path: 'insights', lazy: lazyPage(() => import('./pages/insights/InsightsPage'), 'InsightsPage') },
              { path: 'jobs', lazy: lazyPage(() => import('./pages/jobs/JobsPage'), 'JobsPage') },
              { path: 'candidates', lazy: lazyPage(() => import('./pages/candidates/CandidatesPage'), 'CandidatesPage') },
              { path: 'pipeline', lazy: lazyPage(() => import('./pages/pipeline/PipelinePage'), 'PipelinePage') },
              { path: 'interviews', lazy: lazyPage(() => import('./pages/interviews/InterviewsPage'), 'InterviewsPage') },
              { path: 'offers', lazy: lazyPage(() => import('./pages/offers/OffersPage'), 'OffersPage') },
              { path: 'onboarding', lazy: lazyPage(() => import('./pages/onboarding/OnboardingPage'), 'OnboardingPage') },
              { path: 'settings', lazy: lazyPage(() => import('./pages/settings/SettingsPage'), 'SettingsPage') },
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
