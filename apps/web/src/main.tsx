import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { router } from './router';
import { EmptyState } from './components/EmptyState';
import { buildTheme } from './theme';
import './styles/global.css';
import './styles/app.css';
import './styles/charts.css';

dayjs.locale('zh-cn');

/**
 * 关闭 antd 动画的三种场景：
 * 1. webdriver 自动化（rc-motion 离场动画事件不触发，Modal 会卡在 leave-start）
 * 2. 系统「减少动态效果」偏好（无障碍）
 * 3. 开发用手动开关 localStorage['hireflow:no-motion']='1'（内嵌浏览器面板 rAF 节流时用）
 */
const disableMotion =
  navigator.webdriver ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
  localStorage.getItem('hireflow:no-motion') === '1';

/** 全局空态：表格用统一的 EmptyState；下拉、级联等只给一行小字，不撑高下拉面板 */
function renderEmpty(componentName?: string) {
  if (componentName === 'Table' || componentName === 'List') return <EmptyState size="sm" description="暂无数据" />;
  return <div className="hf-empty-inline">无匹配选项</div>;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* 点遮罩不关闭弹窗：误触会丢掉已填内容；关闭走取消 / Esc / 右上角，由 FormModal 做未保存确认 */}
    {/* 弹层约定：Modal 点遮罩不关、Esc / 右上角 × 关；Drawer（只读查看）点遮罩、Esc、× 都可关。
        表格 / 下拉的空态统一走 EmptyState，不用 antd 默认插画 */}
    <ConfigProvider
      locale={zhCN}
      theme={buildTheme(disableMotion)}
      modal={{ mask: { closable: false } }}
      renderEmpty={renderEmpty}
    >
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
