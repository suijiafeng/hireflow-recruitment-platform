import { Card, Empty, Statistic } from 'antd';
import type { CSSProperties, ReactNode } from 'react';

/** 数据驱动的尺寸经 CSS 变量传入，静态样式见 styles/app.css */
const cssVars = (v: Record<string, string | number>) => v as CSSProperties;

/** 图标徽章：中性灰底灰图标（装饰性颜色零容忍，色彩留给数据与状态） */
export function IconBadge({ icon, size = 'sm' }: { icon: ReactNode; size?: 'sm' | 'lg' }) {
  const classNames = ['icon-badge', size === 'lg' ? 'icon-badge--lg' : ''].filter(Boolean).join(' ');
  return <span className={classNames}>{icon}</span>;
}

/** 卡片标题：墨色小图标 + 文本（色彩留给数据与状态，标题不抢视线） */
export function CardTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="card-title">
      <span className="card-title-icon">{icon}</span>
      <span>{children}</span>
    </span>
  );
}

/** 指标卡（大盘/洞察共用）：中性徽章 + 数值，固定 body 高度保证同行等高 */
export function StatCard({
  title,
  value,
  icon,
  loading = false,
  suffix,
  extra,
}: {
  title: ReactNode;
  value: number | string;
  icon: ReactNode;
  loading?: boolean;
  suffix?: ReactNode;
  /** 数值下方的补充说明（如「另有 N 个满编暂停」），避免"招聘中 0"看起来像坏数据 */
  extra?: string;
}) {
  return (
    <Card classNames={{ body: 'stat-card-body' }}>
      <div className="stat-card-inner">
        <IconBadge icon={icon} size="lg" />
        <div className="stat-card-main">
          <Statistic title={title} value={value} loading={loading} suffix={suffix} />
          {extra && <div className="stat-card-extra">{extra}</div>}
        </div>
      </div>
    </Card>
  );
}

/** 空态占位块：固定最小高度垂直居中，面板无数据时不塌陷 */
export function EmptyBlock({
  description,
  minHeight = 160,
  children,
}: {
  description: ReactNode;
  minHeight?: number;
  children?: ReactNode;
}) {
  return (
    <div className="empty-block" style={cssVars({ '--mh': `${minHeight}px` })}>
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description}>
        {children}
      </Empty>
    </div>
  );
}
