import type { ComponentType } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { firstVisiblePath } from './layouts/nav';
import { useAuthStore } from './stores/auth';

function RouteFallback() {
  return (
    <div className="loading-center loading-center--lg" role="status">
      加载中…
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

/** 首页按权限落到第一个可见菜单（面试官/IT 无数据大盘权限，不能硬跳 /dashboard） */
function HomeRedirect() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  return <Navigate to={firstVisiblePath(hasPermission)} replace />;
}

export const router = createBrowserRouter([
  {
    hydrateFallbackElement: <RouteFallback />,
    children: [
      { path: '/login', lazy: lazyPage(() => import('./pages/Login'), 'LoginPage') },
      // 候选人/新员工免登录门户（链接即凭证，不走 MainLayout 鉴权）
      { path: '/portal/offer/:token', lazy: lazyPage(() => import('./pages/portal/OfferPortalPage'), 'OfferPortalPage') },
      {
        path: '/portal/onboarding/:token',
        lazy: lazyPage(() => import('./pages/portal/OnboardingPortalPage'), 'OnboardingPortalPage'),
      },
      {
        path: '/portal/interview/:token',
        lazy: lazyPage(() => import('./pages/portal/InterviewPortalPage'), 'InterviewPortalPage'),
      },
      {
        path: '/portal/prescreen/:token',
        lazy: lazyPage(() => import('./pages/portal/PrescreenPortalPage'), 'PrescreenPortalPage'),
      },
      {
        path: '/',
        lazy: lazyPage(() => import('./layouts/MainLayout'), 'MainLayout'),
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
          { path: 'helpdesk', lazy: lazyPage(() => import('./pages/helpdesk/HelpdeskPage'), 'HelpdeskPage') },
          { path: 'settings', lazy: lazyPage(() => import('./pages/settings/SettingsPage'), 'SettingsPage') },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
