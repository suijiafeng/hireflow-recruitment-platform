import { ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Select, Spin } from 'antd';
import dayjs from 'dayjs';
import { analyticsApi, departmentsApi } from '../../api';
import type { InsightsRange } from '../../api/types';
import {
  ChartTip,
  DumbbellChart,
  GroupedBarChart,
  LollipopChart,
  NestedBarChart,
  ORDINAL,
  SERIES,
} from '../../components/charts';
import { QueryErrorResult } from '../../components/QueryErrorResult';
import { downloadCsv } from '../../utils/csv';
import { useUrlState } from '../../hooks/useUrlState';
import { pressable } from '../../utils/pressable';

const CHANNEL_STAGES = ['投递', '进面', 'Offer', '入职'];
const RANGES: Array<{ key: InsightsRange; label: string }> = [
  { key: '30d', label: '近 30 天' },
  { key: 'quarter', label: '本季度' },
  { key: 'year', label: '今年' },
  { key: 'all', label: '全部' },
];

/**
 * 数据洞察：8 张统计卡 + 4 张图表卡（共 12 张）压成一条 KPI 带 + 2×2 图表面板。
 * 口径不变：全部基于 Application 状态机事件与 ActivityLog 回放，非快照。
 */
export function InsightsPage() {
  const [range, setRange] = useUrlState<InsightsRange>('range', 'quarter');
  const [deptParam, setDeptParam] = useUrlState<string>('dept', '');
  const deptId = deptParam || undefined;
  const setDeptId = (v?: string) => setDeptParam(v ?? '');

  // range/deptId 必须进 queryKey，否则切筛选命中同一份缓存，页面看起来「切了没反应」
  const query = useQuery({
    queryKey: ['insights', range, deptId ?? ''],
    queryFn: () => analyticsApi.insights({ range, deptId }),
  });
  const overviewQuery = useQuery({ queryKey: ['analytics-overview'], queryFn: analyticsApi.overview });
  const departmentsQuery = useQuery({ queryKey: ['departments'], queryFn: departmentsApi.list });
  const data = query.data;
  const overview = overviewQuery.data;
  const loading = query.isLoading || overviewQuery.isLoading;

  const baseline = data?.overallPassRate ?? null;

  /** KPI 带：规模 4 项 + 效率质量 4 项，一行 8 格 */
  const kpis = [
    {
      label: '招聘中职位',
      value: overview?.openJobs ?? '—',
      unit: '个',
      note: overview?.pausedJobs ? `另有 ${overview.pausedJobs} 个满编暂停` : '',
    },
    { label: '候选人总数', value: overview?.candidates ?? '—', unit: '人', note: '' },
    { label: '待进行面试', value: overview?.upcomingInterviews ?? '—', unit: '场', note: '' },
    { label: '已入职', value: overview?.hired ?? '—', unit: '人', note: '' },
    {
      label: '招聘周期 TTH',
      value: data?.tth.medianDays ?? '—',
      unit: '天',
      note: data?.tth.hiredCount ? `中位 · ${data.tth.hiredCount} 人样本` : '',
    },
    {
      label: 'Offer 接受率',
      value: data?.offer.acceptRate != null ? `${data.offer.acceptRate}%` : '—',
      unit: '',
      note: data?.offer.sent ? `${data.offer.accepted} / ${data.offer.sent}` : '',
    },
    {
      label: '毁约率',
      value: data?.offer.renegeRate != null ? `${data.offer.renegeRate}%` : '—',
      unit: '',
      note: `${data?.offer.renegeCount ?? 0} 人`,
    },
    {
      label: '面评通过率',
      value: baseline != null ? `${baseline}%` : '—',
      unit: '',
      note: '全局基线',
    },
  ];

  const channels = data?.channels ?? [];
  const interviewers = data?.interviewers ?? [];
  const stageStay = data?.stageStay ?? [];
  const byJob = data?.tth.byJob ?? [];

  /**
   * 导出报表：把四张图各自的明细拼成一份长表（分区 + 指标 + 值）。
   * 一定要带上口径行——脱离 range/deptId 的数字没法复核，隔天就成了孤儿数据。
   * 无样本的格子导出 '—' 而不是 0，与页面显示保持一致，不制造假数字。
   */
  const exportReport = () => {
    if (!data) return;
    const s = data.scope;
    const rangeLabel = RANGES.find((r) => r.key === s.range)?.label ?? s.range;
    const deptLabel = departmentsQuery.data?.find((d) => d.id === s.deptId)?.name ?? '全部部门';
    const n = (v: number | null | undefined) => (v == null ? '—' : v);

    const rows: Array<Array<unknown>> = [
      ['口径', '时间范围', rangeLabel, '', ''],
      ['口径', '部门', deptLabel, '', ''],
      ['口径', '同期群样本', `${s.applications} 份应聘`, '', ''],
      ['口径', '起算时间', s.since ? dayjs(s.since).format('YYYY-MM-DD') : '不限', '', ''],
      ['口径', '导出时间', dayjs().format('YYYY-MM-DD HH:mm'), '', ''],
      ['总览', 'TTH 中位（天）', n(data.tth.medianDays), `${data.tth.hiredCount} 人样本`, ''],
      ['总览', 'Offer 接受率(%)', n(data.offer.acceptRate), `${data.offer.accepted}/${data.offer.sent}`, ''],
      ['总览', '毁约率(%)', n(data.offer.renegeRate), `${data.offer.renegeCount} 人`, ''],
      ['总览', '面评通过率基线(%)', n(data.overallPassRate), '', ''],
      ...data.channels.map((c) => [
        '渠道效能',
        c.source,
        c.applied,
        `进面 ${c.interviewed} · Offer ${c.offered} · 入职 ${c.hired}`,
        `入职率 ${n(c.hireRate)}%`,
      ]),
      ...data.interviewers.map((i) => [
        '面试官效能',
        i.name,
        `${i.evaluations} 份面评`,
        `通过率 ${n(i.passRate)}%`,
        `24h 及时率 ${n(i.onTimeRate)}%`,
      ]),
      ...data.stageStay.map((st) => [
        '阶段停留',
        st.stage,
        `${st.samples} 样本`,
        `P50 ${n(st.p50Days)} 天`,
        `P90 ${n(st.p90Days)} 天`,
      ]),
      ...byJob.map((j) => ['TTH 按职位', j.jobTitle, n(j.medianDays), `${j.hired} 人样本`, '']),
    ];

    downloadCsv(
      `数据洞察_${rangeLabel}_${deptLabel}_${dayjs().format('YYYYMMDD')}`,
      ['分区', '项目', '值', '明细', '补充'],
      rows,
    );
  };

  return (
    <div className="hf-page">
      {/* 控制栏：时间范围 + 部门 + 口径说明 + 导出 */}
      <div className="hf-bar">
        <div className="hf-bar-left">
          <div className="hf-seg">
            {RANGES.map((r) => (
              <span key={r.key} className={range === r.key ? 'hf-seg--on' : undefined} {...pressable(() => setRange(r.key))}>
                {r.label}
              </span>
            ))}
          </div>
          <Select
            className="w-140"
            placeholder="全部部门"
            allowClear
            value={deptId}
            onChange={setDeptId}
            options={departmentsQuery.data?.map((d) => ({ value: d.id, label: d.name }))}
          />
          <span className="hf-muted">
            口径：按应聘创建时间划同期群，基于状态机事件回放
            {data && <> · 样本 <b className="hf-td--num">{data.scope.applications}</b> 份应聘</>}
          </span>
        </div>
        <div className="hf-bar-right">
          <Button icon={<ReloadOutlined />} onClick={() => void query.refetch()} loading={query.isFetching}>
            刷新
          </Button>
          <Button type="primary" disabled={!data} onClick={exportReport}>
            导出报表
          </Button>
        </div>
      </div>

      <div className="hf-body">
        {query.isError ? (
          <QueryErrorResult error={query.error} onRetry={() => void query.refetch()} />
        ) : query.isPending ? (
          <div className="hf-state-block">
            <Spin />
          </div>
        ) : (
        <>
        <div className="hf-kpis">
          {kpis.map((k) => (
            <div className="hf-kpi" key={k.label}>
              <div className="hf-kpi-label">{k.label}</div>
              <div className="hf-kpi-val">
                <span className="hf-kpi-num">{k.value}</span>
                <span className="hf-kpi-unit">{k.unit}</span>
              </div>
              {k.note && <div className="hf-kpi-note">{k.note}</div>}
            </div>
          ))}
        </div>

        {loading ? (
          <div className="hf-state-block">
            <Spin />
          </div>
        ) : (
          <div className="hf-charts">
            <div className="hf-panel">
              <div className="hf-panel-head">
                <span className="hf-panel-title">渠道效能</span>
              </div>
              <div className="hf-chart-body">
                <NestedBarChart
                  data={channels.map((c) => ({
                    label: c.source,
                    values: [c.applied, c.interviewed, c.offered, c.hired],
                    meta: `入职 ${c.hireRate != null ? `${c.hireRate}%` : '—'}`,
                    tip: (
                      <ChartTip
                        title={c.source}
                        rows={[
                          { color: ORDINAL[0], value: c.applied, label: '投递' },
                          { color: ORDINAL[1], value: c.interviewed, label: '进面' },
                          { color: ORDINAL[2], value: c.offered, label: 'Offer' },
                          { color: ORDINAL[3], value: c.hired, label: '入职' },
                        ]}
                      />
                    ),
                  }))}
                  stages={CHANNEL_STAGES}
                  colors={ORDINAL}
                  emptyText="暂无投递数据，录入候选人后自动统计"
                />
              </div>
            </div>

            <div className="hf-panel">
              <div className="hf-panel-head">
                <span className="hf-panel-title">面试官效能</span>
              </div>
              <div className="hf-chart-body">
                <GroupedBarChart
                  data={interviewers.map((i) => {
                    const dev = i.passRate != null && baseline != null ? i.passRate - baseline : null;
                    return {
                      label: i.name,
                      values: { pass: i.passRate, onTime: i.onTimeRate },
                      note: (
                        <span className={dev != null && Math.abs(dev) >= 15 ? 'u-warning-text' : undefined}>
                          {dev == null ? '—' : `${dev > 0 ? '+' : ''}${dev}`}
                        </span>
                      ),
                      tip: (
                        <ChartTip
                          title={i.name}
                          rows={[
                            { color: SERIES.ink, value: i.passRate ?? '—', label: '通过率 %' },
                            { color: SERIES.mist, value: i.onTimeRate ?? '—', label: '24h 及时率 %' },
                            { value: i.evaluations, label: '份面评' },
                          ]}
                        />
                      ),
                    };
                  })}
                  series={[
                    { key: 'pass', label: '通过率', color: SERIES.ink },
                    { key: 'onTime', label: '24h 及时率', color: SERIES.mist },
                  ]}
                  unit="%"
                  max={100}
                  refValue={baseline}
                  refLabel="基线"
                  emptyText="暂无已提交的面评"
                />
              </div>
            </div>

            <div className="hf-panel">
              <div className="hf-panel-head">
                <span className="hf-panel-title">阶段停留时长</span>
              </div>
              <div className="hf-chart-body">
                <DumbbellChart
                  data={stageStay.map((s) => ({
                    label: s.stage,
                    low: s.p50Days,
                    high: s.p90Days,
                    meta: `${s.samples} 样本`,
                    tip: (
                      <ChartTip
                        title={s.stage}
                        rows={[
                          { color: '#A1A1AA', value: s.p50Days ?? '—', label: 'P50 天' },
                          { color: '#18181B', value: s.p90Days ?? '—', label: 'P90 天' },
                          { value: s.samples, label: '样本' },
                        ]}
                      />
                    ),
                  }))}
                  unit=" 天"
                  rangeLabels={['P50 中位', 'P90 长尾']}
                  emptyText="暂无阶段流转记录"
                />
              </div>
            </div>

            <div className="hf-panel">
              <div className="hf-panel-head">
                <span className="hf-panel-title">TTH 按职位</span>
                <span className="hf-panel-note">投递创建到入职闭环的中位天数。满 40 天标为偏慢。</span>
              </div>
              <div className="hf-chart-body">
                <LollipopChart
                  data={byJob.map((j) => ({
                    label: j.jobTitle,
                    value: j.medianDays,
                    meta: `${j.hired} 人样本`,
                    color: j.medianDays != null && j.medianDays >= 40 ? '#B45309' : SERIES.ink,
                    tip: (
                      <ChartTip
                        title={j.jobTitle}
                        rows={[
                          { value: j.medianDays ?? '—', label: '中位天' },
                          { value: j.hired, label: '人样本' },
                        ]}
                      />
                    ),
                  }))}
                  unit=" 天"
                  emptyText="暂无入职闭环样本"
                />
              </div>
            </div>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}
