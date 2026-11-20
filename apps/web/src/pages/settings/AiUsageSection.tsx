import { ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Select, Table } from 'antd';
import type { TableProps } from 'antd';
import { aiApi } from '../../api';
import type { AiUsage, AiUsageSummary } from '../../api/types';
import { QueryErrorResult } from '../../components/QueryErrorResult';
import { useUrlState } from '../../hooks/useUrlState';

const CAPABILITY_LABEL: Record<string, string> = {
  parseResume: '简历解析',
  scoreMatch: '匹配评分',
  compareCandidates: '候选人对比',
  draftEvaluation: '面评草稿',
  generateJd: '生成 JD',
  funnelInsight: '漏斗诊断',
  answerQuestion: '入职问答',
  predictRetention: '留存预测',
};

const pct = (v: number) => `${(v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0)}%`;
const tokens = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString());
const usd = (s: Pick<AiUsageSummary, 'costUsd' | 'unpricedCalls' | 'calls'>) =>
  s.costUsd == null ? (s.calls ? '未定价' : '—') : `$${s.costUsd < 0.01 ? s.costUsd.toFixed(4) : s.costUsd.toFixed(2)}`;
const ms = (v: number | null) => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`);

type Row = AiUsage['byCapability'][number];

/** AI 用量：调用次数、token、估算成本、P95 耗时、缓存命中率、降级率（数据来自 AiCallLog） */
export function AiUsageSection() {
  const [daysParam, setDays] = useUrlState<string>('days', '7');
  const days = Number(daysParam) || 7;
  const usage = useQuery({ queryKey: ['ai-usage', days], queryFn: () => aiApi.usage(days) });
  const data = usage.data;
  const status = data?.status;

  const columns: TableProps<Row>['columns'] = [
    { title: '能力', dataIndex: 'capability', width: 140, render: (c: string) => CAPABILITY_LABEL[c] ?? c },
    { title: '调用', dataIndex: 'calls', width: 80, align: 'right' },
    {
      title: 'Token（入 / 出）',
      key: 'tokens',
      width: 160,
      align: 'right',
      render: (_, r) => `${tokens(r.inputTokens)} / ${tokens(r.outputTokens)}`,
    },
    { title: '估算成本', key: 'cost', width: 110, align: 'right', render: (_, r) => usd(r) },
    { title: 'P95 耗时', dataIndex: 'p95LatencyMs', width: 100, align: 'right', render: ms },
    { title: '缓存命中', dataIndex: 'cacheHitRate', width: 100, align: 'right', render: pct },
    {
      title: '降级率',
      dataIndex: 'degradeRate',
      width: 90,
      align: 'right',
      render: (v: number) => <span className={v > 0.1 ? 'hf-state--warn' : undefined}>{pct(v)}</span>,
    },
  ];

  if (usage.isError) return <QueryErrorResult error={usage.error} onRetry={() => void usage.refetch()} />;

  const total = data?.total;
  const kpis = total
    ? [
        { label: 'AI 调用', value: total.calls.toLocaleString(), note: `最近 ${days} 天` },
        {
          label: 'Token',
          value: tokens(total.inputTokens + total.outputTokens),
          note: `输入 ${tokens(total.inputTokens)} · 输出 ${tokens(total.outputTokens)}`,
        },
        { label: '估算成本', value: usd(total), note: total.unpricedCalls ? `${total.unpricedCalls} 次未定价` : '按公开单价估算' },
        { label: 'P95 耗时', value: ms(total.p95LatencyMs), note: '不含缓存命中' },
        { label: '缓存命中率', value: pct(total.cacheHitRate), note: '命中即不花 token' },
        { label: '降级率', value: pct(total.degradeRate), note: '超时 / 出错改用规则引擎' },
      ]
    : [];

  return (
    <>
      <div className="hf-section-head">
        <div className="u-flex-gap-12 u-flex-baseline">
          <span className="hf-section-title">AI 用量</span>
          {status && (
            <span className="hf-muted">
              {status.mode === 'mock'
                ? '当前未接大模型，使用规则引擎'
                : `${status.provider} · ${status.models?.smart}${
                    status.models && status.models.fast !== status.models.smart ? ` / ${status.models.fast}` : ''
                  } · 截止 ${status.deadlineMs / 1000}s · 并发 ${status.maxConcurrency}`}
            </span>
          )}
        </div>
        <div className="hf-bar-right">
          <Select
            value={String(days)}
            onChange={(v: string) => setDays(v)}
            className="hf-select-days"
            options={[
              { value: '1', label: '最近 1 天' },
              { value: '7', label: '最近 7 天' },
              { value: '30', label: '最近 30 天' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void usage.refetch()} loading={usage.isFetching}>
            刷新
          </Button>
        </div>
      </div>

      {kpis.length > 0 && (
        <div className="hf-kpis u-mb-16">
          {kpis.map((k) => (
            <div className="hf-kpi" key={k.label}>
              <div className="hf-kpi-label">{k.label}</div>
              <div className="hf-kpi-val">
                <span className="hf-kpi-num">{k.value}</span>
              </div>
              <div className="hf-kpi-note">{k.note}</div>
            </div>
          ))}
        </div>
      )}

      <div className="hf-atable">
        <Table<Row>
          columns={columns}
          dataSource={data?.byCapability ?? []}
          rowKey="capability"
          loading={usage.isLoading}
          pagination={false}
          locale={{ emptyText: '这段时间还没有 AI 调用' }}
          scroll={{ x: 780 }}
        />
        <div className="hf-panel-foot">
          <span className="hf-faint">
            成本为估算值（按模型公开单价，可用 AI_PRICING_JSON 覆盖），以供应商账单为准 · 提示词版本 {status?.promptVersion ?? '—'}
          </span>
        </div>
      </div>
    </>
  );
}
