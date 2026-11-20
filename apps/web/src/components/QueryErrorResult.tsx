import { Button } from 'antd';
import type { AxiosError } from 'axios';
import { extractErrorMessage } from '../api/client';
import { EmptyState } from './EmptyState';

/**
 * 列表查询错误态：无权限直访 URL 时给出明确提示，而不是一张空表。
 * 403 显示「无权访问」，其余显示错误信息。onRetry 给出重试，避免失败被看成「没有数据」。
 * 视觉统一走 EmptyState（不用 antd Result 的卡通插画）。
 */
export function QueryErrorResult({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const status = (error as AxiosError)?.response?.status;
  const action = onRetry ? (
    <Button type="primary" onClick={onRetry}>
      重试
    </Button>
  ) : undefined;
  if (status === 403) {
    return (
      <EmptyState
        size="lg"
        tone="forbidden"
        title="无权访问"
        description={extractErrorMessage(error, '当前角色没有查看此页面的权限，如需访问请联系管理员')}
        action={action}
      />
    );
  }
  return <EmptyState size="lg" tone="warn" title="加载失败" description={extractErrorMessage(error, '请稍后重试')} action={action} />;
}
