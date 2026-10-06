import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { router } from './router';
import { buildTheme } from './theme';
import './styles/global.css';
import './styles/app.css';
import './styles/charts.css';

dayjs.locale('zh-cn');

/**
 * 关闭 antd 动画的三种场景：
 * 1. webdriver 自动化（rc-motion 离场动画事件不触发，Modal 会卡在 leave-start）
 * 2. 系统「减少动态效果」偏好（无障碍）
 * 3. 开发用手动开关 localStorage['arthr:no-motion']='1'（内嵌浏览器面板 rAF 节流时用）
 */
const disableMotion =
  navigator.webdriver ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
  localStorage.getItem('arthr:no-motion') === '1';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* 点遮罩不关闭弹窗：误触会丢掉已填内容；关闭走取消 / Esc / 右上角，由 FormModal 做未保存确认 */}
    <ConfigProvider locale={zhCN} theme={buildTheme(disableMotion)} modal={{ mask: { closable: false } }}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
