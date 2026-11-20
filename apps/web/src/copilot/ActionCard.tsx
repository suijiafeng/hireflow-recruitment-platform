import { ExclamationCircleFilled, ThunderboltOutlined } from '@ant-design/icons';
import type { CopilotActionView } from '@hireflow/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from 'antd';
import axios from 'axios';
import { useNavigate } from 'react-router';
import { extractErrorMessage } from '../api/client';
import { copilotApi } from './api';

const STATUS_TEXT: Record<CopilotActionView['status'], string> = {
  PENDING: '待确认',
  EXECUTING: '执行中',
  EXECUTED: '已执行',
  REJECTED: '已取消',
  FAILED: '执行失败',
  EXPIRED: '已过期',
};

/** 面评草稿写进面评表单的本机草稿（与 EvaluationModal 同一个 key），打开表单即自动恢复 */
function saveEvaluationDraft(action: CopilotActionView) {
  const draft = action.result?.draft;
  const interviewId = action.result?.link ? new URLSearchParams(action.result.link.split('?')[1] ?? '').get('evaluate') : null;
  if (!draft || !interviewId) return;
  const scores = Object.fromEntries(draft.scorecard.map((s) => [s.dimension, s.score]));
  try {
    localStorage.setItem(
      `hf-eval-draft:${interviewId}`,
      JSON.stringify({ notes: '', values: { scores, conclusion: draft.conclusion, comments: draft.comments } }),
    );
  } catch {
    /* 存储不可用时用户仍可在表单里手填 */
  }
}

interface Props {
  action: CopilotActionView;
  onChange: (a: CopilotActionView) => void;
  notify: { success: (m: string) => void; error: (m: string) => void };
  onNavigate?: () => void;
}

/**
 * 写操作确认卡片：Copilot 只「提议」，这里由人确认。
 * 按钮约定与全站弹窗一致：取消在左、主操作在右；淘汰等不可逆操作用红色危险按钮。
 */
export function ActionCard({ action, onChange, notify, onNavigate }: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const fail = (error: unknown, fallback: string) => {
    const message = extractErrorMessage(error, fallback);
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    onChange({ ...action, status: status === 410 ? 'EXPIRED' : 'FAILED', error: message });
    notify.error(message);
  };
  const confirm = useMutation({
    mutationFn: () => copilotApi.confirm(action.id),
    onSuccess: (next) => {
      onChange(next);
      if (next.tool === 'draft_evaluation') saveEvaluationDraft(next);
      notify.success(next.result?.message ?? '已执行');
      // 业务数据变了：看板、候选人、面试列表都要刷新
      void queryClient.invalidateQueries({ predicate: (q) => !String(q.queryKey[0]).startsWith('copilot') });
    },
    onError: (error) => fail(error, '执行失败'),
  });
  const reject = useMutation({
    mutationFn: () => copilotApi.reject(action.id),
    onSuccess: (next) => onChange(next),
    onError: (error) => fail(error, '操作失败'),
  });
  const pending = action.status === 'PENDING';
  const busy = confirm.isPending || reject.isPending;

  return (
    <div className={`cp-action${action.danger ? ' cp-action--danger' : ''} cp-action--${action.status.toLowerCase()}`} role="group" aria-label={action.title}>
      <div className="cp-action-head">
        {action.danger ? <ExclamationCircleFilled className="cp-action-icon" /> : <ThunderboltOutlined className="cp-action-icon" />}
        <span className="cp-action-title">{action.title}</span>
        <span className={`cp-action-status cp-action-status--${action.status.toLowerCase()}`}>{STATUS_TEXT[action.status]}</span>
      </div>
      <div className="cp-action-summary">{action.summary}</div>
      {action.fields.length > 0 && (
        <dl className="cp-action-fields">
          {action.fields.map((f) => (
            <div key={f.label} className="cp-action-field">
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {pending && (
        <div className="cp-action-foot">
          <span className="cp-action-hint">{action.danger ? '此操作不可撤销，请确认' : '确认后才会执行'}</span>
          <Button size="small" disabled={busy} loading={reject.isPending} onClick={() => reject.mutate()}>
            取消
          </Button>
          <Button size="small" type="primary" danger={action.danger} loading={confirm.isPending} disabled={busy} onClick={() => confirm.mutate()}>
            {action.danger ? '确认淘汰' : '确认执行'}
          </Button>
        </div>
      )}
      {action.status === 'EXECUTED' && (
        <div className="cp-action-result">
          <span>{action.result?.message ?? '已执行'}</span>
          {action.result?.link && (
            <Button
              size="small"
              type="link"
              onClick={() => {
                navigate(action.result!.link!);
                onNavigate?.();
              }}
            >
              {action.tool === 'draft_evaluation' ? '打开面评表单' : '查看'}
            </Button>
          )}
        </div>
      )}
      {action.status === 'FAILED' && action.error && <div className="cp-action-error">{action.error}</div>}
      {action.status === 'EXPIRED' && <div className="cp-action-error">已超过有效期，可以让 Copilot 重新生成</div>}
    </div>
  );
}
