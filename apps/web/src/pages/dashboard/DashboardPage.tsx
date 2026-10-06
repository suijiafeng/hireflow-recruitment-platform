import { ReloadOutlined, RobotOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { App, Button, Card, Select, Spin, Tooltip, Typography } from 'antd';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import dayjs from 'dayjs';
import { analyticsApi, jobsApi } from '../../api';
import { extractErrorMessage } from '../../api/client';
import type { FunnelStage } from '../../api/types';
import { ChartTip, SERIES, TrendChart } from '../../components/charts';
import { EmptyBlock } from '../../components/ui';
import { downloadCsv } from '../../utils/csv';
import { pickDefaultJobId } from '../../utils/jobs';
import { useUrlState } from '../../hooks/useUrlState';
import { pressable } from '../../utils/pressable';

const cssVars = (v: Record<string, string | number>) => v as CSSProperties;

/** 有序阶梯：阶段越靠后颜色越深（位置编码次序，深浅编码进度） */
const FUNNEL_SHADES = ['#93C5FD', '#7DB1FB', '#60A5FA', '#3B82F6', '#2563EB', '#1E40AF'];

/**
 * 漏斗阶段行：条长 = 累计到达，条内深色段 = 当前停留；
 * 阶段之间插一行流失说明（人数 + 流失率），瓶颈在哪一段可直接读出。
 */
function FunnelStageRow({
  stage,
  prev,
  max,
  shade,
}: {
  stage: FunnelStage;
  prev: FunnelStage | null;
  max: number;
  shade: string;
}) {
  const widthPct = max > 0 ? (stage.reached / max) * 100 : 0;
  const stayPct = stage.reached > 0 ? Math.round((stage.current / stage.reached) * 100) : 0;
  const conversionText = stage.conversion != null ? `${Math.round(stage.conversion * 100)}%` : '—';
  const lowConversion = stage.conversion != null && stage.conversion < 0.55;
  // 还停在上一阶段的人是在途，不是流失：只拿「已有结果」的人算流失
  const decided = prev ? prev.reached - prev.current : 0;
  const drop = prev ? Math.max(0, decided - stage.reached) : 0;
  const dropRate = decided > 0 ? Math.round((drop / decided) * 100) : 0;

  return (
    <div className="funnel-stage">
      <Tooltip
        trigger={['hover', 'focus']}
        title={
          <ChartTip
            title={stage.name}
            rows={[
              { value: stage.reached, label: '累计到达' },
              { value: stage.current, label: '当前停留' },
              ...(stage.conversion != null ? [{ value: conversionText, label: '相对上一阶段转化' }] : []),
            ]}
          />
        }
      >
        <div className="funnel-row" tabIndex={0}>
          <span className="funnel-label">{stage.name}</span>
          <div className="funnel-track">
            <div className="funnel-bar" style={cssVars({ '--w': `${widthPct}%`, '--c': shade })}>
              <span className="funnel-bar-stay" style={cssVars({ '--sw': `${stayPct}%` })} />
            </div>
          </div>
          <span className="funnel-num">{stage.reached}</span>
          <span className="funnel-num funnel-num--soft">{stage.current}</span>
          <span className={lowConversion ? 'funnel-rate funnel-rate--low' : 'funnel-rate'}>{conversionText}</span>
        </div>
      </Tooltip>
      {drop > 0 && (
        <div className="funnel-drop">
          <span className="funnel-drop-tick" />
          <span>流失 {drop} 人</span>
          <span className={dropRate >= 45 ? 'funnel-drop-rate funnel-drop-rate--high' : 'funnel-drop-rate'}>
            -{dropRate}%
          </span>
        </div>
      )}
    </div>
  );
}

/** 每个待办都落到「已按该口径筛好」的列表：点 12 就该看到这 12 条，而不是某个职位的看板 */
const TODO_META = [
  { key: 'newResumes' as const, label: '待处理新简历', link: '/candidates?stage=screening' },
  { key: 'myPendingEvaluations' as const, label: '我的待提交面评', link: '/interviews?tab=mine' },
  { key: 'pendingOffers' as const, label: '待审批 Offer', link: '/offers?tab=approve' },
  { key: 'rejectedOffers' as const, label: '被驳回待重提', link: '/offers' },
  { key: 'offersDue' as const, label: 'Offer 到期待处理', link: '/offers?tab=reply' },
  { key: 'onboardingInProgress' as const, label: '进行中入职单', link: '/onboarding' },
  { key: 'docsNeedReview' as const, label: '材料待人工核对', link: '/onboarding?tab=review' },
];

/** 待办：单行清单（数字在前、标签在后），替代原来占两行的 7 张磁贴 */
function TodoStrip() {
  const navigate = useNavigate();
  const todosQuery = useQuery({ queryKey: ['todos'], queryFn: analyticsApi.todos });
  const data = todosQuery.data;
  const visible = TODO_META.filter((meta) => data?.[meta.key] !== null);
  if (visible.length === 0 && !todosQuery.isLoading) return null;
  return (
    <div className="todo-strip">
      <span className="todo-strip-title">待办</span>
      <div className="todo-strip-items">
        {visible.map((meta) => {
          const count = data?.[meta.key] ?? 0;
          return (
            <div className="todo-strip-item" key={meta.key} {...pressable(() => navigate(meta.link))}>
              <span className={count > 0 ? 'todo-strip-count todo-strip-count--hot' : 'todo-strip-count'}>
                {todosQuery.isLoading ? '…' : count}
              </span>
              <span className="todo-strip-label">{meta.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { message } = App.useApp();
  const [jobParam, setJobParam] = useUrlState<string>('job', '');
  const jobId = jobParam || undefined;
  const setJobId = (v?: string) => setJobParam(v ?? '');
  const [insight, setInsight] = useState<{ text: string; provider: string; at: string } | null>(null);

  const jobsQuery = useQuery({
    queryKey: ['jobs', 'options'],
    queryFn: () => jobsApi.list({ page: 1, pageSize: 100 }),
  });

  useEffect(() => {
    if (jobId) return;
    const preferred = pickDefaultJobId(jobsQuery.data?.items);
    if (preferred) setJobParam(preferred);
  }, [jobId, jobsQuery.data, setJobParam]);

  // 全局口径的 KPI 取这里；漏斗与「本职位在流程」才是选中职位的口径（同一个 queryKey，与洞察页共享缓存）
  const overviewQuery = useQuery({ queryKey: ['analytics-overview'], queryFn: analyticsApi.overview });

  const funnelQuery = useQuery({
    queryKey: ['funnel', jobId],
    queryFn: () => analyticsApi.funnel(jobId!),
    enabled: Boolean(jobId),
  });
  const trendQuery = useQuery({ queryKey: ['trend'], queryFn: analyticsApi.trend });
  const todosQuery = useQuery({ queryKey: ['todos'], queryFn: analyticsApi.todos });

  const insightMutation = useMutation({
    mutationFn: () => analyticsApi.insight(jobId!),
    onSuccess: (data) => setInsight({ text: data.insight, provider: data.aiMeta.provider, at: dayjs().format('HH:mm') }),
    onError: (error) => message.error(extractErrorMessage(error, '诊断失败')),
  });

  const stages = funnelQuery.data?.stages ?? [];
  const maxReached = Math.max(...stages.map((s) => s.reached), 1);
  const points = trendQuery.data?.points ?? [];

  /**
   * KPI 条：前两项曾经都是错的口径——
   * 「在招职位」拿的是职位列表 total（含 DRAFT/PAUSED/CLOSED），改用 overview.openJobs；
   * 「在流程候选人」求和的是选中职位的漏斗，是单职位口径，标签补上「本职位」讲清楚范围。
   */
  // 「待处理待办」曾经只取了新简历一项，和标签不符；改为待办条里所有可见项之和
  const todoTotal = Object.values(todosQuery.data ?? {}).reduce<number>((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
  // scope：同一排指标口径不同（全部职位 vs 当前选中职位），在标签下注明，避免把两种数字放在一起比
  const kpis = [
    { label: '在招职位', scope: '全部职位', value: overviewQuery.data?.openJobs ?? 0, unit: '个' },
    { label: '在流程', scope: '当前职位', value: stages.reduce((sum, s) => sum + s.current, 0), unit: '人' },
    { label: '本周新增投递', scope: '全部职位', value: points[points.length - 1]?.applied ?? 0, unit: '份' },
    { label: '本月入职', scope: '全部职位', value: points.slice(-4).reduce((sum, p) => sum + p.hired, 0), unit: '人' },
    { label: '待处理待办', scope: '我的', value: todoTotal, unit: '项' },
  ];

  const jobOptions = jobsQuery.data?.items.map((j) => ({
    value: j.id,
    label: `${j.title}（${j.department.name}）`,
  }));

  /**
   * 导出大盘报表：KPI + 选中职位的漏斗 + 近 8 周趋势。
   * 漏斗是「按职位」的，所以文件名与口径行都要带上职位名——
   * 否则几份导出摞在一起就分不清哪份是哪个职位的了。
   */
  const exportReport = () => {
    const funnel = funnelQuery.data;
    if (!funnel) return;
    const jobLabel = funnel.job.title;
    const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
    const rows: Array<Array<unknown>> = [
      ['口径', '职位', jobLabel, ''],
      ['口径', '导出时间', dayjs().format('YYYY-MM-DD HH:mm'), ''],
      ...kpis.map((k) => ['KPI', k.label, k.value, k.unit]),
      ...stages.map((s) => [
        '招聘漏斗',
        s.name,
        `累计到达 ${s.reached}`,
        `当前停留 ${s.current} · 转化 ${pct(s.conversion)}`,
      ]),
      ...points.map((p) => ['投递趋势', p.week, `新增投递 ${p.applied}`, `入职闭环 ${p.hired}`]),
    ];
    downloadCsv(`数据大盘_${jobLabel}_${dayjs().format('YYYYMMDD')}`, ['分区', '项目', '值', '明细'], rows);
    message.success(`已导出「${jobLabel}」的大盘报表`);
  };

  return (
    <div className="dashboard-page">
      {/* 控制栏取代蓝色欢迎横幅：职位上下文 + 时间范围 + 导出 */}
      <div className="dashboard-bar">
        <div className="dashboard-bar-left">
          <Select
            className="w-260"
            placeholder="选择职位"
            loading={jobsQuery.isLoading}
            value={jobId}
            onChange={(v) => {
              setJobId(v);
              setInsight(null);
            }}
            options={jobOptions}
          />
          <span className="dashboard-updated">数据截至 {dayjs().format('MM-DD HH:mm')} · 每 10 分钟刷新</span>
        </div>
        <span className="u-flex-gap-8">
          <Button icon={<ReloadOutlined />} onClick={() => void funnelQuery.refetch()} loading={funnelQuery.isFetching}>
            刷新
          </Button>
          <Button type="primary" disabled={!funnelQuery.data} onClick={exportReport}>
            导出报表
          </Button>
        </span>
      </div>

      <div className="dashboard-body">
        {/* KPI 条：一行 5 项，等分描边分隔，不做 5 张卡片 */}
        <div className="kpi-strip">
          {kpis.map((k) => (
            <div className="kpi-cell" key={k.label}>
              <div className="kpi-label">
                {k.label}
                <span className="kpi-scope">{k.scope}</span>
              </div>
              <div className="kpi-value">
                <span className="kpi-num">{k.value}</span>
                <span className="kpi-unit">{k.unit}</span>
              </div>
            </div>
          ))}
        </div>

        <TodoStrip />

        <div className="dashboard-cols">
          <Card className="panel panel--funnel" variant="borderless">
            <div className="panel-head">
              <span className="panel-title">招聘漏斗</span>
              <span className="panel-note">条长 = 累计到达 · 深色段 = 当前停留</span>
            </div>
            <div className="panel-body">
              {funnelQuery.isLoading ? (
                <div className="loading-center">
                  <Spin />
                </div>
              ) : stages.length > 0 ? (
                <>
                  <div className="funnel-colhead">
                    <span className="funnel-colhead-plot">到达 / 停留</span>
                    <span>到达</span>
                    <span>停留</span>
                    <span>转化</span>
                  </div>
                  {stages.map((stage, i) => (
                    <FunnelStageRow
                      key={stage.id}
                      stage={stage}
                      prev={i > 0 ? stages[i - 1] : null}
                      max={maxReached}
                      shade={FUNNEL_SHADES[Math.min(i, FUNNEL_SHADES.length - 1)]}
                    />
                  ))}
                </>
              ) : (
                <EmptyBlock minHeight={220} description="暂无职位数据，创建职位后这里将展示招聘漏斗" />
              )}
            </div>
          </Card>

          <div className="dashboard-side">
            <Card className="panel panel--trend" variant="borderless" loading={trendQuery.isLoading}>
              <div className="panel-head">
                <span className="panel-title">投递与入职趋势</span>
              </div>
              <div className="panel-body panel-body--chart">
                <TrendChart
                  data={points.map((p) => ({ x: p.week, values: { applied: p.applied, hired: p.hired } }))}
                  series={[
                    { key: 'applied', label: '新增投递', color: SERIES.blue },
                    { key: 'hired', label: '入职闭环', color: SERIES.aqua },
                  ]}
                />
              </div>
            </Card>

            <Card className="panel panel--ai" variant="borderless">
              <div className="panel-head">
                <span className="panel-title">
                  <RobotOutlined className="panel-title-icon" />
                  AI 健康度诊断
                </span>
                <span className="panel-head-right">
                  {insight && (
                    <span className="panel-note">
                      {insight.provider === 'mock' ? '规则引擎' : insight.provider} · {insight.at}
                    </span>
                  )}
                  <Button
                    size="small"
                    loading={insightMutation.isPending}
                    disabled={!jobId}
                    onClick={() => insightMutation.mutate()}
                  >
                    {insight ? '重新生成' : '生成诊断'}
                  </Button>
                </span>
              </div>
              <div className="panel-body">
                {insight ? (
                  <>
                    <div className="ai-insight-text">{insight.text}</div>
                    <Typography.Text type="secondary" className="ai-insight-meta">
                      AI 仅给出依据与建议，决定权在用人经理。
                    </Typography.Text>
                  </>
                ) : (
                  <EmptyBlock minHeight={140} description="选择职位后点击「生成诊断」，AI 将基于漏斗数据输出瓶颈与建议" />
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
