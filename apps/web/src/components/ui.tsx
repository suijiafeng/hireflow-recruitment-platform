import { Card, Statistic, Tooltip } from 'antd';
import { EmptyState } from './EmptyState';
import { aiSourceOf } from '../utils/aiProvider';
import type { ReactNode } from 'react';


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

/** 空态占位块：固定最小高度垂直居中，面板无数据时不塌陷（统一走 EmptyState） */
export function EmptyBlock({
  description,
  minHeight = 160,
  children,
}: {
  description: ReactNode;
  minHeight?: number;
  children?: ReactNode;
}) {
  return <EmptyState size="sm" minHeight={minHeight} description={description} action={children} />;
}

/**
 * 分数口径标记：规则引擎（未接大模型或本次降级）打的分和大模型不是一个口径，
 * 列表 / 看板只显示一个数字时必须标出来，否则排序会误导人。
 */
export function RuleScoreMark({ source }: { source?: string | null }) {
  if (source !== 'rule') return null;
  return (
    <Tooltip title="规则引擎估算（未接大模型或本次调用降级），可在候选人详情里「用 AI 重算」">
      <span className="hf-source-mark">规则</span>
    </Tooltip>
  );
}

/**
 * AI 产出来源徽标：「AI · 模型名 / 缓存 / 规则」，悬停看完整来源。
 * 全站 AI 结果（匹配依据、简历摘要、面评草稿、入职问答、Copilot）统一用它，
 * 用户一眼能分清「大模型给的」和「规则估算的」。
 */
export function AiSourceBadge({
  meta,
  note,
  fallback = false,
}: {
  meta?: Parameters<typeof aiSourceOf>[0];
  note?: string;
  /** 早期数据没有记录来源时仍标出「AI」，而不是不标 */
  fallback?: boolean;
}) {
  const src = aiSourceOf(meta) ?? (fallback ? { kind: 'cache' as const, label: 'AI', detail: 'AI 生成（早期数据，未记录模型）' } : null);
  if (!src) return null;
  return (
    <Tooltip title={[src.detail, note].filter(Boolean).join('；')}>
      <span className={`hf-ai-badge hf-ai-badge--${src.kind}`}>{src.label}</span>
    </Tooltip>
  );
}
