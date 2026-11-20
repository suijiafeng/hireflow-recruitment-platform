import { CheckCircleFilled, CloseCircleFilled, DownOutlined, LoadingOutlined } from '@ant-design/icons';
import type { CopilotToolStep } from '@hireflow/shared';
import { useState } from 'react';

/** 工具步骤：默认折叠成一行（进行中显示当前步骤），点开看每一步的摘要 */
export function ToolSteps({ steps }: { steps: CopilotToolStep[] }) {
  const [open, setOpen] = useState(false);
  const running = steps.find((s) => s.status === 'running');
  const failed = steps.filter((s) => s.status === 'error').length;
  const headline = running ? running.label : `已完成 ${steps.length} 个步骤${failed ? `（${failed} 个未成功）` : ''}`;
  return (
    <div className={`cp-steps${open ? ' is-open' : ''}`}>
      <button type="button" className="cp-steps-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {running ? <LoadingOutlined className="cp-steps-icon" /> : <CheckCircleFilled className="cp-steps-icon is-done" />}
        <span className="cp-steps-title">{headline}</span>
        <DownOutlined className="cp-steps-caret" />
      </button>
      {open && (
        <ol className="cp-steps-list">
          {steps.map((s) => (
            <li key={s.id} className={`cp-step cp-step--${s.status}`}>
              {s.status === 'running' ? (
                <LoadingOutlined />
              ) : s.status === 'error' ? (
                <CloseCircleFilled />
              ) : (
                <CheckCircleFilled />
              )}
              <span className="cp-step-label">{s.label}</span>
              {s.summary && <span className="cp-step-summary">{s.summary}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
