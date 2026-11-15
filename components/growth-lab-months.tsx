'use client';

import { useEffect, useState } from 'react';
import { normalizeGrowthLabMonths, type GrowthLabMonthRow, type GrowthLabMonthsData } from '@/lib/growth-lab-month-types';
import { formatPaise } from '@/lib/wallet-format';

const card = 'min-w-0 space-y-3 rounded-xl border border-sf-line-soft bg-white p-4 lg:p-5';
const muted = 'text-xs text-sf-muted';
const button = 'min-h-9 rounded-lg border border-sf-line px-3 text-xs text-sf-brand';
const rowGrid = 'grid grid-cols-[7rem_repeat(12,minmax(0,1fr))] gap-0.5 sm:grid-cols-[12rem_repeat(12,minmax(0,1fr))]';
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const heatClasses = ['bg-sf-heat-0', 'bg-sf-heat-1', 'bg-sf-heat-2', 'bg-sf-heat-3', 'bg-sf-heat-4', 'bg-sf-heat-5'];

const labName = (row: GrowthLabMonthRow) => row.name ?? '(unlinked ledger)';
const monthShort =(key: string) => monthNames[Number(key.slice(5, 7)) - 1] ?? key;
const monthLong = (key: string) => `${monthShort(key)} ${key.slice(0, 4)}`;

function heatLevel(value: number, best: number): number {
  if (value <= 0 || best <= 0) return 0;
  const share = value / best;
  if (share > 0.8) return 5;
  if (share > 0.6) return 4;
  if (share > 0.4) return 3;
  if (share > 0.2) return 2;
  return 1;
}

function goneQuiet(months: number[]): boolean {
  const early = months.slice(0, 9).filter(v => v > 0).length;
  return early >= 6 && !(months[10] > 0) && !(months[11] > 0);
}

function Pill() {
  return <span className="shrink-0 rounded-full bg-sf-chart-2 px-1.5 text-[10px] font-bold leading-4 text-white">Gone quiet</span>;
}

function HeaderRow({ months }: { months: string[] }) {
  return <div aria-hidden="true" className={`${rowGrid} text-[10px] text-sf-muted`}>
    <span />
    {months.map((m, i) => <span key={m} className={`text-center ${i % 2 === 1 ? 'max-[400px]:invisible' : ''}`}>{monthShort(m)}</span>)}
  </div>;
}

function HeatRow({ row, months }: { row: GrowthLabMonthRow; months: string[] }) {
  const best = Math.max(0, ...row.monthsPaise);
  const quiet = goneQuiet(row.monthsPaise);
  return <div data-lab-row className={`${rowGrid} items-center`}>
    <span className="flex min-w-0 items-center gap-1 text-xs">
      <span title={labName(row)} className={`min-w-0 truncate ${quiet ? 'font-bold text-sf-strong' : ''}`}>{labName(row)}</span>
      {quiet && <Pill />}
    </span>
    {row.monthsPaise.map((value, i) => {
      const label = `${labName(row)}, ${monthLong(months[i])}: ${formatPaise(value)}`;
      return <span key={months[i]} title={label} data-heat={heatLevel(value, best)}
        className={`relative h-5 rounded-sm ${heatClasses[heatLevel(value, best)]} ${value < 0 ? 'shadow-[inset_0_0_0_1px_var(--color-sf-chart-down)]' : ''}`}><span className="sr-only">{label}</span></span>;
    })}
  </div>;
}

function Legend() {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-sf-muted">
    <span className="flex items-center gap-1">
      {heatClasses.map((c, i) => <span key={c} className="flex items-center gap-1">
        {i === 0 && <span>none</span>}
        <span aria-hidden="true" className={`h-3 w-4 rounded-sm border border-sf-line-soft ${c}`} />
        {i === 5 && <span>best month</span>}
      </span>)}
    </span>
    <span className="flex items-center gap-1"><Pill /> bought in most months, then nothing recently</span>
  </div>;
}

function Heatmap({ data }: { data: GrowthLabMonthsData }) {
  return <div className="space-y-0.5">
    <HeaderRow months={data.months} />
    {data.rows.map(row => <HeatRow key={row.labKey} row={row} months={data.months} />)}
  </div>;
}

function MonthTable({ data }: { data: GrowthLabMonthsData }) {
  return <div className="overflow-x-auto">
    <table className="w-full min-w-[44rem] text-xs tabular-nums">
      <thead>
        <tr className="border-b border-sf-line text-sf-muted">
          <th scope="col" className="py-1 pr-2 text-left font-normal">Lab</th>
          {data.months.map(m => <th key={m} scope="col" className="px-1 py-1 text-right font-normal">{monthShort(m)} ₹k</th>)}
          <th scope="col" className="py-1 pl-2 text-right font-normal">Total</th>
        </tr>
      </thead>
      <tbody>
        {data.rows.map(row => <tr key={row.labKey} className="border-t border-sf-line-soft">
          <th scope="row" className="max-w-[12rem] truncate py-1 pr-2 text-left font-normal" title={labName(row)}>{labName(row)}</th>
          {row.monthsPaise.map((v, i) => <td key={data.months[i]} className="px-1 py-1 text-right">{Math.round(v / 100000)}</td>)}
          <td className="py-1 pl-2 text-right font-bold">{formatPaise(row.totalPaise)}</td>
        </tr>)}
      </tbody>
    </table>
  </div>;
}

function LabMonthsBody({ data }: { data: GrowthLabMonthsData }) {
  const [table, setTable] = useState(false);
  return <>
    <div className="flex justify-end">
      <button type="button" className={button} aria-pressed={table} onClick={() => setTable(v => !v)}>{table ? 'View as chart' : 'View as table'}</button>
    </div>
    {table ? <MonthTable data={data} /> : <Heatmap data={data} />}
    <Legend />
    <p className={muted}>{data.totalLabs} labs bought in these 12 months; showing the top {data.rows.length}. Gone quiet = bought in 6+ of the first 9 months, nothing in the last 2.</p>
  </>;
}

export function GrowthLabMonths() {
  const [data, setData] = useState<GrowthLabMonthsData | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/growth/lab-months', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const next = response.ok ? normalizeGrowthLabMonths(await response.json()) : null;
      if (!next) throw new Error('Lab months are unavailable');
      if (!controller.signal.aborted) setData(next);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [revision]);
  return <section className={card} aria-labelledby="growth-lab-months-title">
    <h2 id="growth-lab-months-title" className="text-base font-bold">Who is buying, month by month</h2>
    <p className={muted}>Top {data?.rows.length ?? 20} labs by sales · 12 months · darker = more of that lab&apos;s usual monthly business</p>
    {error ? <div role="alert" className="text-xs">Lab months are unavailable. <button type="button" className={button} onClick={() => { setError(false); setRevision(n => n + 1); }}>Retry</button></div>
      : !data ? <output className="block animate-pulse rounded bg-sf-soft-0 p-4 text-xs">Loading labs…</output>
      : <LabMonthsBody data={data} />}
  </section>;
}
