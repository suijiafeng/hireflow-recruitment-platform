import { InboxOutlined, LockOutlined, WarningOutlined } from '@ant-design/icons';
import type { CSSProperties, ReactNode } from 'react';

export type EmptyStateProps = {
  /** 一句话标题：说清「这里为什么是空的」 */
  title?: ReactNode;
  /** 补充说明：下一步能做什么 */
  description?: ReactNode;
  /** 主操作（可选）：空状态最好给一条出路 */
  action?: ReactNode;
  /** 图标，默认收件箱；tone=warn/forbidden 时有默认图标 */
  icon?: ReactNode;
  tone?: 'neutral' | 'warn' | 'forbidden';
  /** sm：卡片/列表内；md：面板；lg：整页（403、错误页） */
  size?: 'sm' | 'md' | 'lg';
  /** 最小高度（px），面板无数据时不塌陷 */
  minHeight?: number;
  className?: string;
};

const TONE_ICON = {
  neutral: <InboxOutlined />,
  warn: <WarningOutlined />,
  forbidden: <LockOutlined />,
} as const;

/**
 * 全站统一空状态：图标 + 一句话 + 主操作。
 * 不用插画（antd Result 的 403 卡通、Empty 的默认图），和全站极简风格保持一致；
 * 列表空、面板空、无权访问、加载失败都走这一个组件，视觉和文案结构一致。
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  tone = 'neutral',
  size = 'md',
  minHeight,
  className,
}: EmptyStateProps) {
  const cls = ['hf-empty', `hf-empty--${size}`, tone !== 'neutral' ? `hf-empty--${tone}` : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={cls}
      role={tone === 'neutral' ? undefined : 'status'}
      style={minHeight ? ({ '--mh': `${minHeight}px` } as CSSProperties) : undefined}
    >
      <span className="hf-empty-icon" aria-hidden="true">
        {icon ?? TONE_ICON[tone]}
      </span>
      {title && <div className="hf-empty-title">{title}</div>}
      {description && <div className="hf-empty-desc">{description}</div>}
      {action && <div className="hf-empty-actions">{action}</div>}
    </div>
  );
}
