'use client';

import type { GrowthMarginDetail } from '@/lib/growth-margin-types';
import { formatPaise } from '@/lib/wallet-format';
import { chartTipText, useChartTip } from './growth-chart-tip';

type ItemDetail = Extract<GrowthMarginDetail, { kind: 'item' }>;
const money = (n: number | null) => n === null ? '—' : formatPaise(n);
const jitter = [-8, 0, 8];
const wholeRupees = (paise: number) => `₹${Math.floor(paise / 100 + 0.5).toLocaleString('en-IN')}`;

export function PriceStrip({ data, onPick, marks = [], highlightCustomerId }: {
  data: ItemDetail;
  onPick?: (index: number) => void;
  marks?: { label: string; pricePaise: number }[];
  highlightCustomerId?: string | null;
}) {
  const { tipProps, tip, containerProps } = useChartTip();
  const typical = data.typicalPricePaise;
  const dots = data.rows.map((row, index) => ({ row, index })).filter(({ row }) => row.unitPricePaise > 0 && !row.packDifference);
  if (typical === null || typical <= 0 || dots.length < 3) return null;
  const visibleMarks = marks.slice(0, 2);
  const prices = dots.map(({ row }) => row.unitPricePaise);
  const markPrices = visibleMarks.map(mark => mark.pricePaise);
  const lo = Math.min(...prices, typical * 0.6, ...markPrices), hi = Math.max(...prices, typical * 1.2, ...markPrices);
  const px = (price: number) => 4 + (price - lo) / (hi - lo) * 92;
  return <div className="mt-3"><div data-price-strip {...containerProps}>
    <svg className="block h-[72px] w-full overflow-visible" role="group" aria-label={`Price per unit by lab against typical ${money(typical)}, band ${money(typical * 0.9)} to ${money(typical * 1.1)}`}>
      <rect x={`${px(typical * 0.9)}%`} width={`${px(typical * 1.1) - px(typical * 0.9)}%`} y="16" height="38" fill="var(--color-sf-chart-grid)" />
      <line x1="4%" x2="96%" y1="58" y2="58" stroke="var(--color-sf-chart-axis)" />
      <line x1={`${px(typical * 0.9)}%`} x2={`${px(typical * 0.9)}%`} y1="54" y2="62" stroke="var(--color-sf-chart-axis)" />
      <line x1={`${px(typical * 1.1)}%`} x2={`${px(typical * 1.1)}%`} y1="54" y2="62" stroke="var(--color-sf-chart-axis)" />
      <line x1={`${px(typical)}%`} x2={`${px(typical)}%`} y1="12" y2="58" stroke="var(--color-sf-chart-axis)" strokeWidth="2" />
      <text x={`${px(typical)}%`} y="8" textAnchor="middle" className="fill-sf-label text-[10px]">Typical {wholeRupees(typical)}</text>
      <text x={`${px(typical * 0.9)}%`} y="70" textAnchor="middle" className="fill-sf-label text-[10px]">Lower {wholeRupees(typical * 0.9)}</text>
      <text x={`${px(typical * 1.1)}%`} y="70" textAnchor="middle" className="fill-sf-label text-[10px]">Upper {wholeRupees(typical * 1.1)}</text>
      {visibleMarks.map(mark => <line key={mark.label} x1={`${px(mark.pricePaise)}%`} x2={`${px(mark.pricePaise)}%`} y1="12" y2="58" stroke={mark.label === 'Target' ? 'var(--color-sf-chart-axis)' : 'var(--color-sf-brand)'} strokeWidth={mark.label === 'Target' ? 1.5 : 2} strokeDasharray={mark.label === 'Target' ? '3 2' : undefined}>
        <title>{mark.label} {wholeRupees(mark.pricePaise)}</title>
      </line>)}
      {dots.map(({ row, index }, i) => {
        const under = row.unitPricePaise < typical * 0.9, share = Math.round(row.unitPricePaise / typical * 100);
        const highlighted = highlightCustomerId != null && row.customerId === highlightCustomerId;
        const label = `${row.name ?? 'Unlinked lab'}: ${money(row.unitPricePaise)}, ${share}% of typical${highlighted ? ' (this lab)' : ''}`;
        return <g key={index} role="button" tabIndex={0} aria-label={label} data-price-dot={under ? 'under' : 'ok'} {...tipProps(chartTipText(label))} className="cursor-pointer focus-visible:outline-2 focus-visible:outline-sf-ink" onClick={() => onPick?.(index)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick?.(index); } }}>
          <circle cx={`${px(row.unitPricePaise)}%`} cy={36 + jitter[i % 3]} r="18" fill="transparent" />
          <circle cx={`${px(row.unitPricePaise)}%`} cy={36 + jitter[i % 3]} r={highlighted ? 7 : '5'} fill={under ? 'var(--color-sf-chart-2)' : 'var(--color-sf-chart-3)'} stroke={highlighted ? 'var(--color-sf-strong)' : under ? 'var(--color-sf-chart-down)' : undefined} strokeWidth={highlighted || under ? 2 : undefined} />
        </g>;
      })}
    </svg>
    {visibleMarks.length > 0 ? <div className="mb-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-sf-strong">{visibleMarks.map(mark => <span key={mark.label} className="inline-flex items-center gap-1"><svg aria-hidden="true" className="h-3.5 w-3.5 overflow-visible" viewBox="0 0 14 14"><line x1="0" x2="14" y1="7" y2="7" stroke={mark.label === 'Target' ? 'var(--color-sf-chart-axis)' : 'var(--color-sf-brand)'} strokeWidth={mark.label === 'Target' ? 1.5 : 2} strokeDasharray={mark.label === 'Target' ? '3 2' : undefined} /></svg>{mark.label} {wholeRupees(mark.pricePaise)}</span>)}</div> : null}
    <p className="text-xs text-sf-muted">Showing {dots.length} of {data.total} labs · band {wholeRupees(typical * 0.9)}–{wholeRupees(typical * 1.1)} (90–110% of typical) · orange = below the band</p>
    {tip}
  </div></div>;
}
