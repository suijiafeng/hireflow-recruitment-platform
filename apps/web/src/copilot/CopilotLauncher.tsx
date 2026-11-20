import { RobotOutlined } from '@ant-design/icons';
import { Button, Tooltip } from 'antd';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useCopilotUi } from './store';

// 侧栏（含 Markdown 渲染）第一次打开时才加载，不进首屏包
const CopilotPanel = lazy(() => import('./CopilotPanel').then((m) => ({ default: m.CopilotPanel })));

/** 页头入口：所有页面可用；Ctrl/⌘ + J 快捷键开关 */
export function CopilotLauncher() {
  const { open, toggle } = useCopilotUi();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
  return (
    <>
      <Tooltip title="招聘 Copilot（Ctrl/⌘ + J）">
        <Button className="header-copilot" icon={<RobotOutlined />} aria-label="打开招聘 Copilot" aria-expanded={open} onClick={toggle}>
          <span className="header-copilot-label">Copilot</span>
        </Button>
      </Tooltip>
      {mounted && (
        <Suspense fallback={null}>
          <CopilotPanel />
        </Suspense>
      )}
    </>
  );
}
