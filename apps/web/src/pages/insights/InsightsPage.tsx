import { ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Select, Spin } from 'antd';
import type { CSSProperties } from 'react';
import dayjs from 'dayjs';
import { analyticsApi, departmentsApi } from '../../api';
import type { InsightsRange } from '../../api/types';
import { SERIES } from '../../components/charts';
import { EmptyBlock } from '../../components/ui';
import { downloadCsv } from '../../utils/csv';
import { useUrlState } from '../../hooks/useUrlState';
import { pressable } from '../../utils/pressable';

const cssVars = (v: Record<string, string | number>) => v as CSSProperties;

/** 渠道漏斗的有序阶梯：投递 → 进面 → Offer → 入职 */
const CHANNEL_SHADES = ['#93C5FD', '#60A5FA', '#2563EB', '#1E40AF'];
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
      value: `${data?.offer.renegeRate ?? 0}%`,
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
  const chMax = Math.max(...channels.map((c) => c.applied), 1);
  const interviewers = data?.interviewers ?? [];
  const stageStay = data?.stageStay ?? [];
  /* p50/p90/medianDays 在无样本时为 null（设计稿按非空写的）。
     null 不能当 0 画——那会让「暂无样本」读成「0 天」，是在报假数字。
     取极值时先滤掉 null，渲染时该行改显 —。 */
  const ssMax = Math.max(...stageStay.map((s) => s.p90Days ?? 0), 1);
  const byJob = data?.tth.byJob ?? [];
  const tthMax = Math.max(...byJob.map((j) => j.medianDays ?? 0), 1);

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
            {/* 渠道效能：嵌套条，外浅内深 */}
            <div className="hf-panel">
              <div className="hf-panel-head">
                <span className="hf-panel-title">渠道效能</span>
                <span className="hf-legend">
                  {CHANNEL_STAGES.map((s, i) => (
                    <span key={s}>
                      <i style={cssVars({ background: CHANNEL_SHADES[i] })} />
                      {s}
                    </span>
                  ))}
                </span>
              </div>
              <div className="hf-chart-body">
                {channels.length === 0 ? (
                  <EmptyBlock minHeight={160} description="暂无投递数据，录入候选人后自动统计" />
                ) : (
                  channels.map((c) => (
                    <div
                      className="hf-chart-row"
                      key={c.source}
                      title={`${c.source}：${c.applied} → ${c.interviewed} → ${c.offered} → ${c.hired}`}
                    >
                      <span className="hf-chart-label w-84">{c.source}</span>
                      <span className="hf-nest">
                        {[c.applied, c.interviewed, c.offered, c.hired].map((v, i) => (
                          <span
                            key={i}
                            className="hf-nest-bar"
                            style={cssVars({
                              '--w': `${(v / chMax) * 100}%`,
                              '--c': CHANNEL_SHADES[i],
                              top: `${i * 3 + 1}px`,
                              height: `${22 - i * 6}px`,
                            })}
                          />
                        ))}
                      </span>
                      <span className="hf-chart-val w-120 hf-faint">
                        {c.applied} → {c.interviewed} → {c.offered} → {c.hired}
                      </span>
                      <span className="hf-chart-val w-80 hf-progress-num">
                        入职 {c.hireRate != null ? `${c.hireRate}%` : '—'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 面试官效能：两系列 + 全局基线竖刻度 */}
            <div className="hf-panel">
              <div className="hf-panel-head">
                <span className="hf-panel-title">面试官效能</span>
                <span className="hf-legend">
                  <span>
                    <i style={cssVars({ background: SERIES.blue, height: 3 })} />
                    通过率
                  </span>
                  <span>
                    <i style={cssVars({ background: SERIES.aqua, height: 3 })} />
                    24h 及时率
                  </span>
                  {baseline != null && <span>基线 {baseline}%</span>}
                </span>
              </div>
              <div className="hf-chart-body">
                {interviewers.length === 0 ? (
                  <EmptyBlock minHeight={160} description="暂无已提交的面评" />
                ) : (
                  interviewers.map((i) => {
                    const dev = i.passRate != null && baseline != null ? i.passRate - baseline : null;
                    return (
                      <div className="hf-chart-row" key={i.name} title={`${i.name}：${i.evaluations} 份面评`}>
                        <span className="hf-chart-label w-72">{i.name}</span>
                        <span className="hf-group-plot">
                          <span className="hf-gbar" style={cssVars({ '--w': `${i.passRate ?? 0}%`, '--c': SERIES.blue })} />
                          <span
                            className="hf-gbar"
                            style={cssVars({ '--w': `${i.onTimeRate ?? 0}%`, '--c': SERIES.aqua })}
                          />
                          {baseline != null && <span className="hf-ref" style={cssVars({ left: `${baseline}%` })} />}
                        </span>
                        <span className="hf-chart-val w-84 hf-secondary hf-td--num">
                          {i.passRate ?? '—'}% / {i.onTimeRate ?? '—'}%
                        </span>
                        <span
                          className={
                            dev != null && Math.abs(dev) >= 15
                              ? 'hf-chart-val w-48 hf-state--warn'
                              : 'hf-chart-val w-48 hf-muted'
                          }
                        >
                          {dev == null ? '—' : `${dev > 0 ? '+' : ''}${dev}`}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* 阶段停留：P50 → P90 哑铃 */}
            <div className="hf-panel">
              <div className="hf-panel-head">
                <span className="hf-panel-title">阶段停留时长</span>
                <span className="hf-legend">
                  <span>
                    <i className="dot" style={cssVars({ background: '#60A5FA' })} />
                    P50 中位
                  </span>
                  <span>
                    <i className="dot" style={cssVars({ background: '#1E40AF' })} />
                    P90 长尾
                  </span>
                </span>
              </div>
              <div className="hf-chart-body">
                {stageStay.length === 0 ? (
                  <EmptyBlock minHeight={160} description="暂无阶段流转记录" />
                ) : (
                  stageStay.map((s) => {
                    const has = s.p50Days != null && s.p90Days != null;
                    return (
                      <div className="hf-chart-row" key={s.stage} title={`${s.stage}：${s.samples} 样本`}>
                        <span className="hf-chart-label w-84">{s.stage}</span>
                        <span className="hf-dumbbell">
                          <span className="hf-dumbbell-axis" />
                          {has && (
                            <>
                              <span
                                className="hf-dumbbell-link"
                                style={cssVars({
                                  left: `${(s.p50Days! / ssMax) * 100}%`,
                                  width: `${((s.p90Days! - s.p50Days!) / ssMax) * 100}%`,
                                })}
                              />
                              <span
                                className="hf-dumbbell-dot"
                                style={cssVars({ left: `${(s.p50Days! / ssMax) * 100}%`, background: '#60A5FA' })}
                              />
                              <span
                                className="hf-dumbbell-dot"
                                style={cssVars({ left: `${(s.p90Days! / ssMax) * 100}%`, background: '#1E40AF' })}
                              />
                            </>
                          )}
                        </span>
                        <span className="hf-chart-val w-100 hf-progress-num">
                          {has ? `${s.p50Days} → ${s.p90Days} 天` : '—'}
                        </span>
                        <span className="hf-chart-val w-88 hf-faint hf-td--num">{s.samples} 样本</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* TTH 按职位：棒棒糖 */}
            <div className="hf-panel">
              <div className="hf-panel-head">
                <span className="hf-panel-title">TTH 按职位</span>
                <span className="hf-panel-note">投递创建 → 入职闭环的中位天数</span>
              </div>
              <div className="hf-chart-body">
                {byJob.length === 0 ? (
                  <EmptyBlock minHeight={160} description="暂无入职闭环样本" />
                ) : (
                  byJob.map((j) => (
                    <div className="hf-chart-row" key={j.jobTitle} title={`${j.jobTitle}：${j.hired} 人样本`}>
                      <span className="hf-chart-label w-148 hf-ellipsis">{j.jobTitle}</span>
                      <span className="hf-lolli">
                        <span className="hf-dumbbell-axis" />
                        {j.medianDays != null && (
                          <>
                            <span
                              className="hf-lolli-stem"
                              style={cssVars({ '--w': `${(j.medianDays / tthMax) * 100}%` })}
                            />
                            <span
                              className="hf-dumbbell-dot"
                              style={cssVars({
                                left: `${(j.medianDays / tthMax) * 100}%`,
                                background: j.medianDays >= 40 ? '#B45309' : '#2563EB',
                              })}
                            />
                          </>
                        )}
                      </span>
                      <span className="hf-chart-val w-64 hf-progress-num">
                        {j.medianDays != null ? `${j.medianDays} 天` : '—'}
                      </span>
                      <span className="hf-chart-val w-80 hf-faint hf-td--num">{j.hired} 人样本</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
