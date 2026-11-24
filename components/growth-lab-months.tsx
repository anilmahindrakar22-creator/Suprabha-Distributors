'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { normalizeGrowthPeriodLabMonths, type GrowthPeriodLabMonthsData } from '@/lib/growth-period-labs-types';
import { normalizeGrowthLabMonths, type GrowthLabMonthRow, type GrowthLabMonthsData } from '@/lib/growth-lab-month-types';
import { formatPaise } from '@/lib/wallet-format';
import { parseGrowthStoppedItems, type GrowthStoppedItem, type GrowthStoppedItems } from '@/lib/growth-stopped-items';

const card = 'min-w-0 space-y-3 rounded-xl border border-sf-line-soft bg-white p-4 lg:p-5';
const muted = 'text-xs text-sf-muted';
const button = 'min-h-9 rounded-lg border border-sf-line px-3 text-xs text-sf-brand';
const rowGrid = 'grid grid-cols-[7rem_repeat(var(--sf-months),minmax(0,1fr))] gap-0.5 sm:grid-cols-[12rem_repeat(var(--sf-months),minmax(0,1fr))]';
type MonthData = Pick<GrowthPeriodLabMonthsData, 'months' | 'rows'>;
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const heatClasses = ['bg-transparent border border-dashed border-sf-line', 'bg-sf-heat-1', 'bg-sf-heat-2', 'bg-sf-heat-3', 'bg-sf-heat-4', 'bg-sf-heat-5'];

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

function isLapsing(row: GrowthLabMonthRow): boolean {
  return row.buyingMonths >= 5 && row.monthsPaise.slice(-3).filter(v => v <= 0).length >= 2;
}

function Pill() {
  return <span className="shrink-0 rounded-full bg-sf-warning-soft text-sf-warning border border-sf-warning-line px-1.5 text-[10px] font-bold leading-4">Lapsing</span>;
}

function HeaderRow({ months }: { months: string[] }) {
  return <div aria-hidden="true" style={{ '--sf-months': months.length } as CSSProperties} className={`${rowGrid} text-[10px] text-sf-muted`}>
    <span />
    {months.map(m => <span key={m} data-month-header className="whitespace-nowrap text-center text-[10px]"><span className="sm:hidden">{monthShort(m).charAt(0)}</span><span className="hidden sm:inline">{monthShort(m)}</span></span>)}
  </div>;
}

function HeatRow({ row, months, showLapsing, filter }: { row: GrowthPeriodLabMonthsData['rows'][number]; months: string[]; showLapsing: boolean; filter?: GrowthLabMonthsData['filter'] }) {
  const best = Math.max(0, ...row.monthsPaise);
  const quiet = showLapsing && (filter === 'lapsing' || isLapsing(row));
  return <div data-lab-row style={{ '--sf-months': months.length } as CSSProperties} className={`${rowGrid} items-center`}>
    <span className="flex min-w-0 items-center gap-1 text-xs">
      <span title={labName(row)} className={`min-w-0 truncate ${quiet ? 'font-bold text-sf-strong' : ''}`}>{labName(row)}</span>
      {quiet && <Pill />}
    </span>
    {row.monthsPaise.map((value, i) => {
      const label = `${labName(row)}, ${monthLong(months[i])}: ${formatPaise(value)}`;
      return <span key={months[i]} title={label} data-heat={heatLevel(value, best)}
        className={`relative h-5 rounded-sm ${value < 0 ? 'bg-transparent shadow-[inset_0_0_0_1px_var(--color-sf-chart-down)]' : heatClasses[heatLevel(value, best)]}`}><span className="sr-only">{label}</span></span>;
    })}
  </div>;
}

function Legend({ showLapsing }: { showLapsing: boolean }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-sf-muted">
    <span className="flex items-center gap-1">
      {heatClasses.map((c, i) => <span key={c} className="flex items-center gap-1">
        {i === 0 && <span>none</span>}
        <span aria-hidden="true" className={`h-3 w-4 rounded-sm ${c}`} />
        {i === 5 && <span>best month</span>}
      </span>)}
    </span>
    {showLapsing && <span className="flex items-center gap-1"><Pill /> bought in most months, then nothing recently</span>}
  </div>;
}

function Heatmap({ data, showLapsing, filter }: { data: MonthData; showLapsing: boolean; filter?: GrowthLabMonthsData['filter'] }) {
  return <div className="space-y-0.5">
    <HeaderRow months={data.months} />
    {data.rows.map(row => <HeatRow key={row.labKey} row={row} months={data.months} showLapsing={showLapsing} filter={filter} />)}
  </div>;
}

function MonthTable({ data }: { data: MonthData; showLapsing: boolean }) {
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

type Props = { onOpenCustomer?: (customerId: string) => void; period?: { param: string; label: string } };

function stoppedItemLabel(item: GrowthStoppedItem) {
  const quantity = Math.round(item.usualMonthlyQuantity * 1000) / 1000;
  const last = item.lastRatePaise === null ? '' : `, last ${formatPaise(item.lastRatePaise)} on ${new Date(`${item.lastBilledOn}T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })}`;
  return `${item.itemName} (usually ${quantity}${item.unit === null ? '' : ` ${item.unit}`}/month${last})`;
}

function CallList({ data, onOpenCustomer }: Props & { data: GrowthLabMonthsData }) {
  const [stopped, setStopped] = useState<{ data: GrowthLabMonthsData; items: GrowthStoppedItems } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const keys = data.rows.slice(0, 8).map(row => row.labKey);
    if (keys.length) {
      void fetch('/api/growth/stopped-items?' + keys.map(k => 'lab=' + encodeURIComponent(k)).join('&'), { cache: 'no-store', signal: controller.signal }).then(async response => {
        if (!response.ok) return;
        const items = parseGrowthStoppedItems(await response.json());
        if (!controller.signal.aborted) setStopped({ data, items });
      }).catch(() => { /* Advisory details can be omitted when unavailable. */ });
    }
    return () => controller.abort();
  }, [data]);
  return <ol aria-label="Call list" className="space-y-2">
    {data.rows.slice(0, 8).map(row => <li key={row.labKey} className="min-w-0 space-y-1.5 rounded-lg border border-sf-line p-3 text-xs">
      <p className="break-words"><strong>{labName(row)}</strong>{row.town && <span> · {row.town}</span>}</p>
      <div className="sm:flex sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-x-2 gap-y-1.5 text-sf-muted">
          {row.lastPurchaseOn && <span>Last bought {Number(row.lastPurchaseOn.slice(8, 10))} {monthShort(row.lastPurchaseOn.slice(0, 7))}</span>}
          {data.filter === 'declining' ? <span>Last 90 days {formatPaise(row.lastNinetyPaise!)} vs {formatPaise(row.previousNinetyPaise!)} before (−{row.previousNinetyPaise! > 0 ? Math.round((1 - row.lastNinetyPaise! / row.previousNinetyPaise!) * 100) : 0}%)</span> : <>
            {row.lastPurchaseOn && row.usualMonthlyPaise !== undefined && <span aria-hidden="true">·</span>}
            {row.usualMonthlyPaise !== undefined && <span>Usually {formatPaise(Math.round(row.usualMonthlyPaise / 100000) * 100)}k/month</span>}
            {!!row.monthsMissed && <><span aria-hidden="true">·</span><span>Missed {row.monthsMissed} {row.monthsMissed === 1 ? 'month' : 'months'}</span></>}
          </>}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5 sm:mt-0 sm:shrink-0 sm:pl-3">
          {row.phone && <a className={`${button} inline-flex items-center`} href={`tel:${row.phone}`}>Call</a>}
          {row.customerId && <button type="button" className={button} disabled={!onOpenCustomer} onClick={() => onOpenCustomer?.(row.customerId!)}>Open customer</button>}
        </div>
      </div>
      {stopped?.data === data && stopped.items.labs.find(lab => lab.labKey === row.labKey)?.items.length ? <p className="break-words text-sf-muted">Stopped buying: {stopped.items.labs.find(lab => lab.labKey === row.labKey)!.items.map(stoppedItemLabel).join('; ')}</p> : null}
    </li>)}
  </ol>;
}

function LabMonthsBody({ data, onOpenCustomer, period }: Props & { data: GrowthLabMonthsData | GrowthPeriodLabMonthsData }) {
  const [table, setTable] = useState(false);
  const filter = 'filter' in data ? data.filter : 'top';
  const showLapsing = !period;
  return <>
    {'filter' in data && filter !== 'top' && (data.rows.length ? <CallList data={data} onOpenCustomer={onOpenCustomer} /> : <p className={muted}>{filter === 'declining' ? 'No labs buying less right now.' : 'No lapsing core labs right now.'}</p>)}
    <div className="flex justify-end">
      <button type="button" className={button} aria-pressed={table} onClick={() => setTable(v => !v)}>{table ? 'View as chart' : 'View as table'}</button>
    </div>
    {table ? <MonthTable data={data} showLapsing={showLapsing} /> : <Heatmap data={data} showLapsing={showLapsing} filter={filter} />}
    <Legend showLapsing={showLapsing} />
      <p className={muted}>{period ? `${data.totalLabs} ${data.totalLabs === 1 ? 'lab' : 'labs'} bought in ${period.label}; showing the top ${data.rows.length}. Includes instrument and bulk sales.` : filter === 'lapsing'
      ? `Lapsing = bought in 5+ of 12 months, nothing for 30+ days, and either 60+ days since the last purchase or 2 of the last 3 months missed.`
      : filter === 'declining' ? 'Buying less = consumables in the last 90 days at least 30% and ₹10,000 below the 90 days before. Instruments not counted.'
      : `${data.totalLabs} labs bought in these 12 months; showing the top ${data.rows.length}. Lapsing = bought in 5+ months and missed 2 of the last 3 months.`}</p>
    {filter !== 'top' && data.totalLabs > data.rows.length && <p className={muted}>Showing {data.rows.length} of {data.totalLabs} {filter === 'declining' ? 'labs buying less' : 'lapsing labs'}.</p>}
  </>;
}

function useLabMonthsData(filter: GrowthLabMonthsData['filter'], period?: string) {
  const [data, setData] = useState<GrowthLabMonthsData | GrowthPeriodLabMonthsData | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const url = period ? `/api/growth/lab-months?period=${period}` : `/api/growth/lab-months${filter === 'top' ? '' : `?filter=${filter}`}`;
    void fetch(url, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const raw: unknown = response.ok ? await response.json() : null;
      const next = period ? normalizeGrowthPeriodLabMonths(raw) : normalizeGrowthLabMonths(raw, filter);
      if (!next) throw new Error('Lab months are unavailable');
      if (!controller.signal.aborted) setData(next);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [revision, filter, period]);
  return { data, error, retry: () => { setError(false); setRevision(n => n + 1); } };
}

export function GrowthLabMonths({ onOpenCustomer, period, initialFilter = 'top' }: Props & { initialFilter?: 'top' | 'lapsing' | 'declining' } = {}) {
  const [filter, setFilter] = useState<GrowthLabMonthsData['filter']>(initialFilter);
  const top = useLabMonthsData('top', period?.param);
  const lapsing = useLabMonthsData('lapsing');
  const declining = useLabMonthsData('declining');
  const { data, error, retry } = filter === 'top' ? top : filter === 'lapsing' ? lapsing : declining;
  const lapsingCount = lapsing.data?.totalLabs;
  const decliningCount = declining.data?.totalLabs;
  return <section className={card} aria-labelledby="growth-lab-months-title">
    <h2 id="growth-lab-months-title" className="text-base font-bold">Who is buying, month by month</h2>
    <div className="flex flex-wrap gap-2">
      {(['top', 'lapsing', 'declining'] as const).map(value => <button key={value} type="button" className={`${button} ${filter === value ? 'bg-sf-brand text-white border-sf-brand' : ''}`} aria-pressed={filter === value} onClick={() => {
        setFilter(value);
      }}>{value === 'top' ? 'Top labs' : value === 'lapsing' ? `Lapsing core labs${lapsingCount === undefined ? '' : ` (${lapsingCount})`}` : `Buying less${decliningCount === undefined ? '' : ` (${decliningCount})`}`}</button>)}
    </div>
    <p className={muted}>{period && filter !== 'top' ? 'As of today · ' : ''}{filter === 'top' ? `Top ${data?.rows.length ?? 20} ${data?.rows.length === 1 ? 'lab' : 'labs'} by sales · ` : ''}{period && filter === 'top' ? period.label : '12 months'} · darker = more of that lab&apos;s usual monthly business</p>
    {error ? <div role="alert" className="text-xs">Lab months are unavailable. <button type="button" className={button} onClick={retry}>Retry</button></div>
      : !data ? <output className="block animate-pulse rounded bg-sf-soft-0 p-4 text-xs">Loading labs…</output>
      : <LabMonthsBody key={filter} data={data} period={filter === 'top' ? period : undefined} onOpenCustomer={onOpenCustomer} />}
  </section>;
}
