'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { formatGrowthPeriodParam, normalizeGrowthPeriod, parseGrowthPeriodParam, type GrowthPeriodData, type GrowthPeriodSelection } from '@/lib/growth-period-types';
import { BridgeChart, Table, card, lakh, rupees, months, changeLabel } from './growth-page';

type Selection = GrowthPeriodSelection | 'rolling12';
type ComparisonKey = 'last_year' | 'previous';
type Check = GrowthPeriodData['current']['check'];
type Quarter = 1 | 2 | 3 | 4;
const quarters: Quarter[] = [1, 2, 3, 4];
const muted = 'text-xs text-sf-muted';

export function todayIst() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function currentFinancialYear(today: string) {
  return Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0);
}
export function quarterDisabled(fy: number, quarter: Quarter, today: string) {
  const start = `${fy + (quarter === 4 ? 1 : 0)}-${String(quarter === 4 ? 1 : quarter * 3 + 1).padStart(2, '0')}-01`;
  return start > today;
}
export function changeFinancialYear(value: Selection, fy: number, today: string): Selection {
  if (value === 'rolling12') return value;
  return value.kind === 'quarter' && !quarterDisabled(fy, value.quarter, today) ? { ...value, fy } : { kind: 'fy', fy };
}
export function periodChangeLabel(state: Check['state'], previous: number | null, current: number | null) {
  return state === 'no_history' || state === 'differs' ? '—' : changeLabel(previous, current);
}
function differingMonths(check: Check) {
  return check.months.filter(m => m.state === 'differs').map(m => new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })).join(', ');
}
function comparisonNote(check: Check, label: string) {
  return check.state === 'no_history' ? `No sales history for ${label} yet.` : check.state === 'differs' ? `Differs from Tally in ${differingMonths(check)}. Change hidden.` : check.state === 'unconfirmed' ? 'Not yet confirmed against Tally.' : '';
}

export function GrowthPeriodPicker({ value, today, onChange }: { value: Selection; today: string; onChange: (value: Selection) => void }) {
  const currentFY = currentFinancialYear(today), fy = value === 'rolling12' ? currentFY : value.fy;
  const chip = (label: string, next: Selection, pressed: boolean, disabled = false) => <button key={label} type="button" disabled={disabled} aria-pressed={pressed} onClick={() => onChange(next)} className={`min-h-11 shrink-0 rounded-md border px-3 text-sm disabled:opacity-40 ${pressed ? 'border-sf-line bg-sf-accent-soft font-bold text-sf-brand' : 'border-sf-line text-sf-muted'}`}>{label}</button>;
  {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- This labelled picker group contains a select and independent period buttons. */}
  return <div role="group" aria-label="Growth period" className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center">
    <select aria-label="Financial year" className="min-h-11 max-w-full rounded-md border border-sf-line px-2 text-sm" value={fy} disabled={value === 'rolling12'} onChange={event => onChange(changeFinancialYear(value, Number(event.target.value), today))}>{[currentFY, currentFY - 1, currentFY - 2].map(year => <option key={year} value={year}>FY {year}-{String(year + 1).slice(-2)}</option>)}</select>
    <div className="flex min-w-0 flex-nowrap gap-1 overflow-x-auto pb-1">
      {chip(fy === currentFY ? 'FY to date' : 'Full year', { kind: 'fy', fy }, value !== 'rolling12' && value.kind === 'fy')}
      {quarters.map(quarter => chip(`Q${quarter}`, { kind: 'quarter', fy, quarter }, value !== 'rolling12' && value.kind === 'quarter' && value.quarter === quarter, quarterDisabled(fy, quarter, today)))}
      <button key="rolling12" type="button" aria-label="Last 12 months" aria-pressed={value === 'rolling12'} onClick={() => onChange('rolling12')} className={`min-h-11 shrink-0 rounded-md border px-3 text-sm ${value === 'rolling12' ? 'border-sf-line bg-sf-accent-soft font-bold text-sf-brand' : 'border-sf-line text-sf-muted'}`}>12 months</button>
    </div>
  </div>;
}

export function useGrowthPeriodSelection(): [Selection, (value: Selection) => void] {
  const [value, setValue] = useState<Selection>('rolling12');
  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler -- Read the browser URL after mount, preserving the rolling server render.
    setValue(parseGrowthPeriodParam(new URL(window.location.href).searchParams.get('growthPeriod')) ?? 'rolling12');
  }, []);
  const choose = (next: Selection) => {
    const url = new URL(window.location.href);
    if (next === 'rolling12') url.searchParams.delete('growthPeriod');
    else url.searchParams.set('growthPeriod', formatGrowthPeriodParam(next));
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    setValue(next);
  };
  return [value, choose];
}

export function useGrowthPeriodData(selection: Selection) {
  const key = formatGrowthPeriodParam(selection);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; revision: number; data: GrowthPeriodData | null; error: string; loading: boolean } | null>(null);
  useEffect(() => {
    if (key === 'rolling12') return;
    const controller = new AbortController();
    // oxlint-disable-next-line react/react-compiler -- Clear a previous visit to this selection while its fresh request is in flight.
    setResult({ key, revision, data: null, error: '', loading: true });
    void fetch(`/api/growth?period=${key}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (response.status === 403) throw new Error('Growth is for management only.');
      if (!response.ok) throw new Error();
      const data = normalizeGrowthPeriod(await response.json());
      if (!data) throw new Error();
      if (!controller.signal.aborted) setResult({ key, revision, data, error: '', loading: false });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({ key, revision, data: null, error: error instanceof Error && error.message === 'Growth is for management only.' ? error.message : 'This period could not load. Try again.', loading: false });
    });
    return () => controller.abort();
  }, [key, revision]);
  const state = key === 'rolling12' ? { data: null, error: '', loading: false } : result?.key === key && result.revision === revision ? result : { data: null, error: '', loading: true };
  return { ...state, retry: () => setRevision(n => n + 1) };
}

export function GrowthPeriodRevenue({ data, comparisonKey, onComparisonChange }: { data: GrowthPeriodData; comparisonKey: ComparisonKey; onComparisonChange: (key: ComparisonKey) => void }) {
  const comparison = data.comparisons.find(c => c.key === comparisonKey) ?? data.comparisons[0];
  const current = data.current.tree, previous = comparison.tree;
  const measures: [string, number | null, number | null, (n: number) => string][] = [
    ['Revenue', current.revenuePaise, previous?.revenuePaise ?? null, lakh],
    ['Repeat sales', current.repeatPaise, previous?.repeatPaise ?? null, lakh],
    ['Labs buying', current.labsBuying, previous?.labsBuying ?? null, String],
    ['Buying months per lab', months(current), previous ? months(previous) : null, n => n.toFixed(1)],
    ['₹ per buying month', current.perBuyingMonthPaise, previous?.perBuyingMonthPaise ?? null, rupees],
    ['Instrument & bulk', current.bulkPaise, previous?.bulkPaise ?? null, lakh],
  ];
  const note = comparisonNote(comparison.check, comparison.label);
  return <section className={card} aria-labelledby="revenue-title"><h2 id="revenue-title" className="text-base font-bold">Where revenue comes from</h2><p className={muted}>{data.current.label} · all sales</p>
    {['unconfirmed', 'differs'].includes(data.current.check.state) && <p className={muted}>{data.current.check.state === 'differs' ? `This period differs from Tally in ${differingMonths(data.current.check)}.` : 'This period is not yet confirmed against Tally.'}</p>}
    {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Segmented buttons implement the radio group's roving focus and arrow keys. */}
    {data.comparisons.length === 2 && <div role="radiogroup" aria-label="Compare with" className="flex min-w-0 gap-1 rounded-lg border border-sf-line p-1">{data.comparisons.map((c, index) => <button key={c.key} type="button" role="radio" aria-checked={c.key === comparison.key} tabIndex={c.key === comparison.key ? 0 : -1} className={`min-h-11 min-w-0 flex-1 rounded-md px-2 text-xs ${c.key === comparison.key ? 'bg-sf-accent-soft font-bold text-sf-brand' : 'text-sf-muted'}`} onClick={() => onComparisonChange(c.key)} onKeyDown={event => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const next = data.comparisons[1 - index];
      onComparisonChange(next.key);
      const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button');
      buttons?.[1 - index].focus();
    }}>vs {c.label}</button>)}</div>}
    <Table caption="Revenue comparison" headings={['Measure', data.current.label, comparison.label, 'Change']} rows={measures.map(([label, now, before, format]): ReactNode[] => [label, now === null ? '—' : format(now), comparison.check.state === 'no_history' || before === null ? '—' : format(before), periodChangeLabel(comparison.check.state, before, now)])} />
    {note && <p className={muted}>{note}</p>}<p className={muted}>{current.bulkInvoices} {current.bulkInvoices === 1 ? 'invoice' : 'invoices'} of ₹2 L or more this period.</p>
  </section>;
}

export function GrowthPeriodBridge({ data, comparisonKey }: { data: GrowthPeriodData; comparisonKey: ComparisonKey }) {
  const comparison = data.comparisons.find(c => c.key === comparisonKey) ?? data.comparisons[0];
  if (!comparison.bridge) return <section className={card}><h2 className="text-base font-bold">Where growth came from</h2><p className={muted}>No sales history for {comparison.label} yet, so there is nothing to compare.</p></section>;
  const note = comparisonNote(comparison.check, comparison.label);
  return <BridgeChart bridge={comparison.bridge} startLabel={comparison.label} endLabel={data.current.label} caption={<>{comparison.label} → {data.current.label} · all sales{note && <span className="mt-2 block">{note}</span>}</>} footnote={`Regular = bought in 3 or more months of ${comparison.label}.`} />;
}
