'use client';

import { useEffect, useState } from 'react';
import { readJsonResponse } from '@/lib/http-json';
import { normalizeObservedChanges, type ObservedChanges } from '@/lib/observed-change-types';

const button = 'min-h-11 rounded-xl border border-sf-accent-line bg-white px-4 text-sm font-bold text-sf-strong disabled:opacity-40';
const money = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
const day = (value: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
const filters = { up: 'Increases', fell: 'Volume fell', down: 'Decreases' } as const;
const labels = { fell: 'Fell', held: 'Held', rose: 'Rose' };

export function ObservedPriceChanges() {
  const [open, setOpen] = useState(false);
  const [activated, setActivated] = useState(false);
  const [filter, setFilter] = useState<keyof typeof filters | null>(null);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [changes, setChanges] = useState<number | null>(null);
  const [result, setResult] = useState<{ data: ObservedChanges | null; error: boolean; forbidden: boolean; loading: boolean }>({ data: null, error: false, forbidden: false, loading: true });
  function startLoading() { setExpandedRow(null); setResult({ data: null, error: false, forbidden: false, loading: true }); }
  useEffect(() => {
    if (!activated) return;
    const controller = new AbortController();
    const query = filter === 'fell' ? '&volume=fell' : filter ? `&direction=${filter}` : '';
    fetch(`/api/pricing?observed=1&page=${page}${query}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (response.status === 401 || response.status === 403) {
          if (!controller.signal.aborted) setResult({ data: null, error: false, forbidden: true, loading: false });
          return;
        }
        const data = normalizeObservedChanges(await readJsonResponse<unknown>(response, 'Price changes could not load'));
        if (!data) throw new Error('Invalid observed changes');
        if (!controller.signal.aborted) {
          setChanges(data.summary.changes);
          setResult({ data, error: false, forbidden: false, loading: false });
        }
      })
      .catch(() => { if (!controller.signal.aborted) setResult({ data: null, error: true, forbidden: false, loading: false }); });
    return () => controller.abort();
  }, [activated, page, filter, retry]);
  if (result.forbidden) return null;
  const data = result.data;
  return <section aria-label="Changes seen in Tally" className="min-w-0 border-t border-sf-line-soft p-4 [overflow-wrap:anywhere]">
    <h3><button type="button" aria-expanded={open} className={`${button} max-w-full text-left`} onClick={() => { setOpen(value => !value); setActivated(true); }}>Changes seen in Tally{changes !== null ? ` · ${changes}` : ''}</button></h3>
    {open ? result.loading ? <p className="mt-2 text-sm text-sf-muted">Loading price changes…</p>
      : result.error ? <p className="mt-2 text-sm text-sf-muted">Price changes could not load. <button type="button" className={button} onClick={() => { startLoading(); setRetry(value => value + 1); }}>Retry</button></p>
      : data ? <>
        <p className="mt-2 text-xs text-sf-muted">Rates that moved in Tally without a StockFlow approval, and what the lab bought before and after. A review signal, not a cause. Sales up to {data.salesThrough ? day(data.salesThrough) : 'not available'}.</p>
        <p className="mt-2 text-sm text-sf-muted">{data.summary.increases} increases: volume fell in {data.summary.increasesFell}, held in {data.summary.increasesHeld}, rose in {data.summary.increasesRose} · {data.summary.decreases} decreases</p>
        <div className="mt-3 flex flex-wrap gap-2">{(Object.keys(filters) as (keyof typeof filters)[]).map(key => <button type="button" key={key} aria-pressed={filter === key} className={`${button} ${filter === key ? '!border-sf-ink !bg-sf-ink !text-white' : ''}`} onClick={() => { startLoading(); setFilter(filter === key ? null : key); setPage(1); }}>{filters[key]}</button>)}</div>
        {data.rows.length === 0 ? <p className="mt-3 text-sm text-sf-muted">No price changes seen in Tally for this filter.</p> : <ul aria-label="Price changes seen in Tally" className="mt-3 divide-y divide-sf-line-soft">{data.rows.map((row, index) => <li key={`${row.customerName}-${row.itemKey}-${row.changedOn}-${index}`} className="min-w-0 py-3">
          <button type="button" aria-expanded={expandedRow === index} className="block min-h-11 w-full min-w-0 text-left [overflow-wrap:anywhere]" onClick={() => setExpandedRow(expandedRow === index ? null : index)}>
            <span className="flex items-start justify-between gap-2"><span className="min-w-0 text-sm text-sf-strong"><strong>{row.customerName}</strong> · {row.itemKey}</span><span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${row.volume === 'fell' ? 'bg-sf-danger-soft text-sf-danger' : row.volume === 'rose' ? 'bg-sf-success-soft text-sf-success' : 'bg-sf-soft text-sf-muted'}`}>{labels[row.volume]}</span></span>
            <span className="mt-1 block text-xs text-sf-muted">{day(row.changedOn)} · {money(row.beforeRatePaise)} → {money(row.afterRatePaise)} ({row.changePct < 0 ? '−' : '+'}{Math.abs(row.changePct).toFixed(1)}%) · qty {row.beforeQty} → {row.afterQty}</span>
            {expandedRow === index ? <span className="mt-2 block text-xs text-sf-muted">Over {row.windowDays} days before and after · sales {money(row.beforeRevenuePaise)} → {money(row.afterRevenuePaise)} · {row.beforeGpPaise === null || row.afterGpPaise === null ? 'GP not shown: cost missing' : `GP ${money(row.beforeGpPaise)} → ${money(row.afterGpPaise)}`}</span> : null}
          </button>
        </li>)}</ul>}
        {data.total > 10 ? <div className="mt-3 flex justify-between gap-2"><button type="button" className={button} disabled={page <= 1} onClick={() => { startLoading(); setPage(value => value - 1); }}>Previous</button><button type="button" className={button} disabled={page * 10 >= data.total || page >= 100} onClick={() => { startLoading(); setPage(value => value + 1); }}>Next</button></div> : null}
      </> : null : null}
  </section>;
}
