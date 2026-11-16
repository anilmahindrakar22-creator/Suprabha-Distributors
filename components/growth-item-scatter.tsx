'use client';

import type { GrowthMarginItemRow } from '@/lib/growth-margin-types';
import { niceTicks } from '@/lib/chart-ticks';
import { chartTipText, useChartTip } from './growth-chart-tip';

const card = 'min-w-0 space-y-3 rounded-xl border border-sf-line-soft bg-white p-4 lg:p-5';
const muted = 'text-xs text-sf-muted';
const lakhText = (paise: number) => `₹${(paise / 1e7).toFixed(1)} L`;

export function GrowthItemScatter({ rows, thresholdPct, averagePct, onOpen }: { rows: GrowthMarginItemRow[]; thresholdPct: number; averagePct: number | null; onOpen: (itemKey: string) => void }) {
  const { tipProps, tip, containerProps } = useChartTip();
  const points = rows.filter(r => r.marginPct !== null);
  if (points.length < 3) return null;
  const shown = (m: number) => Math.min(80, Math.max(-20, m));
  const margins = points.map(r => shown(r.marginPct as number));
  const references = averagePct === null ? [thresholdPct] : [thresholdPct, averagePct];
  const maxSalesLakh = Math.max(...points.map(r => r.salesPaise / 1e7)) || 1;
  const xTicks = niceTicks(0, maxSalesLakh * 1.1);
  const xMax = xTicks.hi || 1;
  const yMinRaw = Math.min(...margins, ...references.map(shown)), yMaxRaw = Math.max(...margins, ...references.map(shown));
  const yTicks = niceTicks(yMinRaw, yMaxRaw);
  const yMin = yTicks.lo, yMax = yTicks.hi;
  const top = 12, bottom = 180;
  const px = (sales: number) => 10 + Math.max(0, sales / 1e7) / xMax * 86;
  const py = (margin: number) => bottom - (margin - yMin) / (yMax - yMin) * (bottom - top);
  const labels = [...points].filter(row => row.belowCost || (row.marginPct as number) < thresholdPct).sort((a, b) => b.salesPaise - a.salesPaise).slice(0, 5);
  const labelKeys = new Set(labels.map(row => row.itemKey));
  return <section className={card} aria-labelledby="growth-item-scatter-title" data-item-scatter>
    <h2 id="growth-item-scatter-title" className="text-base font-bold">Top items: sales against margin</h2>
    <p className={muted}>Top {rows.length} consumable items by sales · 12 months{rows.some(r => r.marginPct === null) ? ` · ${rows.filter(r => r.marginPct === null).length} without cost` : ''}</p>
    <div {...containerProps}>
      <svg className="block h-[220px] w-full overflow-visible" role="group" aria-label="Items: sales against margin">
        {yTicks.ticks.map(v => <g key={`y${v}`}><line x1="10%" x2="97%" y1={py(v)} y2={py(v)} stroke="var(--color-sf-chart-grid)" /><text x="8%" y={py(v) + 3} textAnchor="end" className="fill-sf-muted text-[10px]">{v}%</text></g>)}
        {xTicks.ticks.map(v => <text key={`x${v}`} x={`${px(v * 1e7)}%`} y="198" textAnchor="middle" className="fill-sf-muted text-[10px]">{v}</text>)}
        <line x1="10%" x2="97%" y1={bottom} y2={bottom} stroke="var(--color-sf-chart-axis)" />
        <g><line x1="10%" x2="97%" y1={py(shown(thresholdPct))} y2={py(shown(thresholdPct))} stroke="var(--color-sf-chart-axis)" strokeDasharray="4 3" /><text data-item-threshold x="10%" y={py(shown(thresholdPct)) - 4} textAnchor="start" className="fill-sf-label text-[10px]">Low margin {thresholdPct}%</text></g>
        {averagePct !== null && <g><line x1="10%" x2="97%" y1={py(shown(averagePct))} y2={py(shown(averagePct))} stroke="var(--color-sf-chart-axis)" strokeDasharray="4 3" /><text data-item-average x="97%" y={py(shown(averagePct)) - 4} textAnchor="end" className="fill-sf-label text-[10px]">Average {averagePct.toFixed(1)}%</text></g>}
        {points.map(row => {
          const margin = row.marginPct as number, state = row.belowCost || margin < 0 ? 'below cost' : margin < thresholdPct ? 'low margin' : 'healthy margin';
          const dot = state === 'below cost' ? 'below-cost' : state === 'low margin' ? 'low' : 'ok';
          const name = row.name?.trim() || 'Unnamed item', x = px(row.salesPaise);
          const label = `${name}: sales ${lakhText(row.salesPaise)}, margin ${margin.toFixed(1)}%, ${state}`;
          const shortName = name.length > 18 ? `${name.slice(0, 18)}…` : name;
          const clamped = margin < -20 || margin > 80;
          const showLabel = labelKeys.has(row.itemKey) || clamped;
          const directLabel = clamped ? `${shortName} (${margin < 0 ? '−' : ''}${Math.abs(Math.round(margin))}%)` : shortName;
          return <g key={row.itemKey} role="button" tabIndex={0} aria-label={label} data-item-dot={dot} data-item-clamped={clamped ? '' : undefined} {...tipProps(chartTipText(label))} className="cursor-pointer focus-visible:outline-2 focus-visible:outline-sf-ink" onClick={() => onOpen(row.itemKey)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(row.itemKey); } }}>
            <circle cx={`${x}%`} cy={py(shown(margin))} r="18" fill="transparent" />
            <circle cx={`${x}%`} cy={py(shown(margin))} r="6" fill={`var(--color-sf-chart-${dot === 'ok' ? 1 : dot === 'low' ? 2 : 'down'})`} stroke={clamped ? 'var(--color-sf-chart-axis)' : 'white'} strokeWidth="2" />
            {showLabel && <text data-item-direct-label={clamped ? '' : undefined} x={`${x}%`} dx={x > 70 ? -10 : 10} y={py(shown(margin)) + 3} textAnchor={x > 70 ? 'end' : 'start'} className="fill-sf-label text-[10px]">{directLabel}</text>}
          </g>;
        })}
      </svg>
      <div className="flex flex-wrap gap-3 text-xs text-sf-muted">
        <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-sf-chart-1" />Healthy margin</span>
        <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-sf-chart-2" />Low margin</span>
        <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-sf-chart-down" />Below cost</span>
        <span>Sales (₹ L) →, margin ↑</span>
      </div>
      <p className={muted}>Right and low = biggest items to reprice or renegotiate with the principal. Tap a dot to see each lab&apos;s price.</p>
      {tip}
    </div>
  </section>;
}
