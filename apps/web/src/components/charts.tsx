import { Tooltip } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { EmptyBlock } from './ui';

/**
 * 图表：SVG + 水平虚线网格 / 底轴刻度，不用 div 色条冒充。
 * 系列色用原来的品牌蓝和青色。
 * 悬停走 Tooltip；空数据走 EmptyBlock。
 */

/** 分类两系列：品牌蓝 + 青色，和改版前的图表色板一致 */
export const SERIES = { ink: '#2563EB', mist: '#06B6D4' } as const;
/** 有序四级阶梯（浅→深）：投递 → 进面 → Offer → 入职 */
export const ORDINAL = ['#93C5FD', '#60A5FA', '#2563EB', '#1E40AF'] as const;
/** 哑铃两档 */
export const DUMBBELL = { p50: '#60A5FA', p90: '#1E40AF' } as const;
/** 基线刻度不占用系列色 */
const REF_INK = 'rgba(15, 23, 42, 0.45)';

const cssVars = (v: Record<string, string | number>) => v as CSSProperties;

const TIP_TRIGGER: Array<'hover' | 'focus'> = ['hover', 'focus'];

export function ChartTip({
  title,
  rows,
}: {
  title: ReactNode;
  rows: Array<{ color?: string; value: ReactNode; label: ReactNode }>;
}) {
  return (
    <div className="chart-tip">
      <div className="chart-tip-title">{title}</div>
      {rows.map((r, i) => (
        <div key={i} className="chart-tip-row">
          {r.color && <span className="chart-tip-key" style={cssVars({ '--c': r.color })} />}
          <span className="chart-tip-value">{r.value}</span>
          <span className="chart-tip-label">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

function Legend({ items, mark }: { items: Array<{ label: string; color: string }>; mark: 'rect' | 'line' | 'dot' }) {
  const markClass = { rect: 'chart-swatch', line: 'chart-linekey', dot: 'chart-dotkey' }[mark];
  return (
    <div className="chart-legend">
      {items.map((it) => (
        <span key={it.label} className="chart-legend-item">
          <span className={markClass} style={cssVars({ '--c': it.color })} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function RowsWrap({ count, maxVisible, children }: { count: number; maxVisible: number; children: ReactNode }) {
  const scroll = count > maxVisible;
  return <div className={scroll ? 'chart-rows chart-rows--scroll' : 'chart-rows'}>{children}</div>;
}

function ScrollCaption({ count, maxVisible }: { count: number; maxVisible: number }) {
  if (count <= maxVisible) return null;
  return <div className="chart-caption">共 {count} 项 · 滚动查看全部</div>;
}

/** 底轴：0 / 中点 / 上限，12px 等宽浅灰。刻度跟绘图区对齐，不跟左侧类目对齐。 */
function Axis({ max, unit = '', variant = 'pad' }: { max: number; unit?: string; variant?: 'pad' | 'group' }) {
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  return (
    <div className={variant === 'group' ? 'chart-axis chart-axis--group' : 'chart-axis'} aria-hidden="true">
      <span className="chart-row-label" />
      <span className="chart-axis-scale">
        <span>0{unit}</span>
        <span>
          {fmt(max / 2)}
          {unit}
        </span>
        <span>
          {fmt(max)}
          {unit}
        </span>
      </span>
      {variant === 'group' ? (
        <>
          <span className="chart-axis-vals" />
          <span className="chart-axis-note" />
        </>
      ) : (
        <>
          <span className="chart-axis-value" />
          <span className="chart-axis-meta" />
        </>
      )}
    </div>
  );
}

/** 水平条：拉伸只作用于矩形，描边用 non-scaling-stroke，避免圆点被拉成椭圆 */
function HBars({
  layers,
}: {
  layers: Array<{ widthPct: number; color: string; y: number; h: number }>;
}) {
  return (
    <svg className="chart-svg" viewBox="0 0 100 16" preserveAspectRatio="none" aria-hidden="true">
      <line className="chart-svg-base" x1="0" x2="100" y1="15.5" y2="15.5" />
      {[25, 50, 75].map((x) => (
        <line key={x} className="chart-svg-grid" x1={x} x2={x} y1="0" y2="16" />
      ))}
      {layers.map((layer, i) => (
        <rect
          key={i}
          x="0"
          y={layer.y}
          width={Math.max(0, Math.min(100, layer.widthPct))}
          height={layer.h}
          fill={layer.color}
        />
      ))}
    </svg>
  );
}

/** 棒棒糖图（名义类目比较：针杆 + 端点，零值仍可见） */
export function LollipopChart({
  data,
  unit = '',
  color = SERIES.ink,
  maxVisible = 8,
  emptyText = '暂无数据',
}: {
  data: Array<{ label: string; value: number | null; meta?: string; tip?: ReactNode; color?: string }>;
  unit?: string;
  color?: string;
  maxVisible?: number;
  emptyText?: string;
}) {
  if (data.length === 0) return <EmptyBlock minHeight={200} description={emptyText} />;
  const numeric = data.map((d) => d.value).filter((v): v is number => v != null);
  const max = Math.max(...numeric, 1) * 1.08;
  return (
    <div className="chart">
      <RowsWrap count={data.length} maxVisible={maxVisible}>
        {data.map((r) => {
          const pct = r.value == null ? 0 : (r.value / max) * 100;
          const mark = r.color ?? color;
          return (
            <Tooltip key={r.label} title={r.tip} trigger={TIP_TRIGGER}>
              <div className="chart-row" tabIndex={0}>
                <span className="chart-row-label">{r.label}</span>
                <div className="chart-row-plot">
                  <div className="chart-lolli">
                    <svg className="chart-svg" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
                      <line className="chart-svg-base" x1="0" x2="100" y1="10" y2="10" />
                      {r.value != null && (
                        <line
                          x1="0"
                          x2={pct}
                          y1="10"
                          y2="10"
                          stroke={mark}
                          strokeWidth="1.75"
                          vectorEffect="non-scaling-stroke"
                        />
                      )}
                    </svg>
                    {r.value != null && (
                      <svg className="chart-mark" style={cssVars({ left: `${pct}%` })} viewBox="0 0 12 12" aria-hidden="true">
                        <circle cx="6" cy="6" r="4" fill={mark} />
                      </svg>
                    )}
                  </div>
                </div>
                <span className="chart-row-value">
                  {r.value ?? '—'}
                  {r.value != null ? unit : ''}
                </span>
                <span className="chart-row-meta">{r.meta ?? ''}</span>
              </div>
            </Tooltip>
          );
        })}
      </RowsWrap>
      <Axis max={max} unit={unit} />
      <ScrollCaption count={data.length} maxVisible={maxVisible} />
    </div>
  );
}

/** 嵌套条形图（有序阶段子集：外层最浅、逐层收窄加深） */
export function NestedBarChart({
  data,
  stages,
  colors = ORDINAL,
  maxVisible = 6,
  emptyText = '暂无数据',
}: {
  data: Array<{ label: string; values: number[]; meta?: string; tip?: ReactNode }>;
  stages: string[];
  colors?: readonly string[];
  maxVisible?: number;
  emptyText?: string;
}) {
  if (data.length === 0) return <EmptyBlock minHeight={200} description={emptyText} />;
  const max = Math.max(...data.map((d) => d.values[0] ?? 0), 1);
  return (
    <div className="chart">
      <Legend items={stages.map((s, i) => ({ label: s, color: colors[i] }))} mark="rect" />
      <RowsWrap count={data.length} maxVisible={maxVisible}>
        {data.map((d) => (
          <Tooltip key={d.label} title={d.tip} trigger={TIP_TRIGGER}>
            <div className="chart-row" tabIndex={0}>
              <span className="chart-row-label">{d.label}</span>
              <div className="chart-row-plot">
                <HBars
                  layers={d.values.map((v, i) => ({
                    widthPct: (v / max) * 100,
                    color: colors[i],
                    y: 2 + i * 1.5,
                    h: Math.max(4, 12 - i * 2.5),
                  }))}
                />
              </div>
              <span className="chart-row-value">{d.values[0]}</span>
              <span className="chart-row-meta">{d.meta ?? ''}</span>
            </div>
          </Tooltip>
        ))}
      </RowsWrap>
      <Axis max={max} />
      <ScrollCaption count={data.length} maxVisible={maxVisible} />
    </div>
  );
}

/** 分组条形图（每行多系列同轴对比 + 可选基线刻度） */
export function GroupedBarChart({
  data,
  series,
  unit = '',
  max: fixedMax,
  refValue,
  refLabel,
  maxVisible = 5,
  emptyText = '暂无数据',
}: {
  data: Array<{ label: string; values: Record<string, number | null>; tip?: ReactNode; note?: ReactNode }>;
  series: Array<{ key: string; label: string; color: string }>;
  unit?: string;
  max?: number;
  refValue?: number | null;
  refLabel?: string;
  maxVisible?: number;
  emptyText?: string;
}) {
  if (data.length === 0) return <EmptyBlock minHeight={200} description={emptyText} />;
  const max =
    fixedMax ??
    Math.max(...data.flatMap((d) => series.map((s) => d.values[s.key] ?? 0)), refValue ?? 0, 1);
  const X = (v: number | null) => (Math.max(v ?? 0, 0) / max) * 100;
  return (
    <div className="chart">
      <Legend
        items={[
          ...series.map((s) => ({ label: s.label, color: s.color })),
          ...(refValue != null && refLabel ? [{ label: `${refLabel} ${refValue}${unit}`, color: REF_INK }] : []),
        ]}
        mark="rect"
      />
      <RowsWrap count={data.length} maxVisible={maxVisible}>
        {data.map((d) => (
          <Tooltip key={d.label} title={d.tip} trigger={TIP_TRIGGER}>
            <div className="chart-row chart-row--group" tabIndex={0}>
              <span className="chart-row-label">{d.label}</span>
              <div className="chart-group-track">
                <svg className="chart-svg chart-svg--group" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
                  <line className="chart-svg-base" x1="0" x2="100" y1="19.5" y2="19.5" />
                  {series.map((s, i) => (
                    <rect
                      key={s.key}
                      x="0"
                      y={2 + i * 9}
                      width={X(d.values[s.key])}
                      height="7"
                      fill={s.color}
                    />
                  ))}
                  {refValue != null && (
                    <line
                      className="chart-svg-ref"
                      x1={X(refValue)}
                      x2={X(refValue)}
                      y1="0"
                      y2="20"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </svg>
              </div>
              <div className="chart-group-vals">
                {series.map((s) => (
                  <span key={s.key}>
                    {d.values[s.key] ?? '—'}
                    {d.values[s.key] != null ? unit : ''}
                  </span>
                ))}
              </div>
              {d.note != null && <span className="chart-row-note">{d.note}</span>}
            </div>
          </Tooltip>
        ))}
      </RowsWrap>
      <Axis max={max} unit={unit} variant="group" />
      <ScrollCaption count={data.length} maxVisible={maxVisible} />
    </div>
  );
}

/** 哑铃图（每项的区间两档：P50 浅点 → P90 深点） */
export function DumbbellChart({
  data,
  unit = '',
  rangeLabels = ['P50', 'P90'],
  maxVisible = 6,
  emptyText = '暂无数据',
}: {
  data: Array<{ label: string; low: number | null; high: number | null; tip?: ReactNode; meta?: string }>;
  unit?: string;
  rangeLabels?: [string, string];
  maxVisible?: number;
  emptyText?: string;
}) {
  if (data.length === 0) return <EmptyBlock minHeight={200} description={emptyText} />;
  const highs = data.map((d) => d.high).filter((v): v is number => v != null);
  const max = Math.max(...highs, 1) * 1.08;
  return (
    <div className="chart">
      <Legend
        items={[
          { label: rangeLabels[0], color: DUMBBELL.p50 },
          { label: rangeLabels[1], color: DUMBBELL.p90 },
        ]}
        mark="dot"
      />
      <RowsWrap count={data.length} maxVisible={maxVisible}>
        {data.map((r) => {
          const has = r.low != null && r.high != null;
          const x1 = ((r.low ?? 0) / max) * 100;
          const x2 = ((r.high ?? 0) / max) * 100;
          return (
            <Tooltip key={r.label} title={r.tip} trigger={TIP_TRIGGER}>
              <div className="chart-row" tabIndex={0}>
                <span className="chart-row-label">{r.label}</span>
                <div className="chart-row-plot">
                  <div className="chart-lolli">
                    <svg className="chart-svg" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
                      <line className="chart-svg-base" x1="0" x2="100" y1="10" y2="10" />
                      {has && (
                        <line
                          x1={x1}
                          x2={x2}
                          y1="10"
                          y2="10"
                          stroke="#BFDBFE"
                          strokeWidth="2"
                          vectorEffect="non-scaling-stroke"
                        />
                      )}
                    </svg>
                    {has && (
                      <>
                        <svg className="chart-mark" style={cssVars({ left: `${x1}%` })} viewBox="0 0 12 12" aria-hidden="true">
                          <circle cx="6" cy="6" r="3.5" fill={DUMBBELL.p50} />
                        </svg>
                        <svg className="chart-mark" style={cssVars({ left: `${x2}%` })} viewBox="0 0 12 12" aria-hidden="true">
                          <circle cx="6" cy="6" r="4" fill={DUMBBELL.p90} />
                        </svg>
                      </>
                    )}
                  </div>
                </div>
                <span className="chart-row-value">{has ? `${r.low} / ${r.high}${unit}` : '—'}</span>
                <span className="chart-row-meta">{r.meta ?? ''}</span>
              </div>
            </Tooltip>
          );
        })}
      </RowsWrap>
      <Axis max={max} unit={unit} />
      <ScrollCaption count={data.length} maxVisible={maxVisible} />
    </div>
  );
}

const niceCeil = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
};

const trimNum = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** 趋势折线图：只留水平虚线网格，折线 1.75px，无面积填充 */
export function TrendChart({
  data,
  series,
  emptyText = '暂无趋势数据',
}: {
  data: Array<{ x: string; values: Record<string, number> }>;
  series: Array<{ key: string; label: string; color: string }>;
  emptyText?: string;
}) {
  if (data.length === 0) return <EmptyBlock minHeight={200} description={emptyText} />;
  const rawMax = Math.max(...data.flatMap((d) => series.map((s) => d.values[s.key] ?? 0)));
  const max = niceCeil(rawMax);
  const X = (i: number) => (data.length === 1 ? 50 : (i / (data.length - 1)) * 100);
  const Y = (v: number) => 100 - (v / max) * 100;
  const last = data[data.length - 1];
  const endYs = series.map((s) => Y(last.values[s.key] ?? 0));
  const endLabelsCollide = endYs.length > 1 && Math.abs(endYs[0] - endYs[1]) < 12;
  const colWidth = 100 / data.length;

  return (
    <div className="chart">
      <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} mark="line" />
      <div className="trend-grid">
        <div className="trend-y">
          <span>{trimNum(max)}</span>
          <span>{trimNum(max / 2)}</span>
          <span>0</span>
        </div>
        <div className="trend-plot">
          <svg className="trend-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {[0, 50, 100].map((y) => (
              <line key={y} className="trend-gridline" x1="0" x2="100" y1={y} y2={y} />
            ))}
            {series.map((s) => (
              <polyline
                key={s.key}
                className="trend-line"
                style={cssVars({ '--c': s.color })}
                points={data.map((d, i) => `${X(i)},${Y(d.values[s.key] ?? 0)}`).join(' ')}
              />
            ))}
          </svg>
          {data.map((d, i) => (
            <Tooltip
              key={d.x}
              trigger={TIP_TRIGGER}
              title={
                <ChartTip
                  title={`${d.x} 周`}
                  rows={series.map((s) => ({
                    color: s.color,
                    value: d.values[s.key] ?? 0,
                    label: s.label,
                  }))}
                />
              }
            >
              <div
                className="trend-col"
                tabIndex={0}
                style={cssVars({ '--l': `${X(i) - colWidth / 2}%`, '--wd': `${colWidth}%` })}
              >
                {series.map((s) => (
                  <span
                    key={s.key}
                    className="trend-dot"
                    style={cssVars({ '--c': s.color, '--y': `${Y(d.values[s.key] ?? 0)}%` })}
                  />
                ))}
              </div>
            </Tooltip>
          ))}
          {!endLabelsCollide &&
            series.map((s, si) => (
              <span key={s.key} className="trend-endlabel" style={cssVars({ '--y': `${endYs[si]}%` })}>
                {last.values[s.key] ?? 0}
              </span>
            ))}
        </div>
        <div className="trend-x">
          {data.map((d) => (
            <span key={d.x}>{d.x}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
