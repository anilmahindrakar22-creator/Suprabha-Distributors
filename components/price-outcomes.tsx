'use client';

import { useEffect, useState } from 'react';
import { readJsonResponse } from '@/lib/http-json';
import { normalizePriceOutcomes, type PriceOutcomeRow, type PriceOutcomeState, type PriceOutcomes as Outcomes } from '@/lib/price-outcome-types';

const labels: Record<PriceOutcomeState, string> = { different: 'Different', not_billed: 'Not billed', matches: 'Matches', cannot_match: "Can't match" };
const reasons = { no_ledger_link: 'customer not linked to a Tally ledger', item_not_in_tally: 'item not found in Tally', unit_differs: 'Tally bills it in a different pack or unit' };
const button = 'min-h-11 rounded-xl border border-sf-accent-line bg-white px-4 text-sm font-bold text-sf-strong disabled:opacity-40';
const money = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
const day = (value: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));

function detail(row: PriceOutcomeRow) {
  const approved = `Approved ${money(row.approvedPaise)}`;
  let result: string;
  if (row.state === 'cannot_match') result = `${approved} · can't check: ${reasons[row.reason!]}`;
  else if (row.state === 'not_billed') result = `${approved} from ${day(row.effectiveFrom)} · not billed since`;
  else if (row.state === 'matches') result = `${approved} · billed at this rate on ${day(row.lastBilledOn!)} · ${row.lines} invoices`;
  else {
    const delta = row.lastBilledPaise! - row.approvedPaise;
    result = `${approved} · billed ${money(row.lastBilledPaise!)} on ${day(row.lastBilledOn!)} (${money(Math.abs(delta))} ${delta < 0 ? 'less' : 'more'}) · ${row.differentLines} of ${row.lines} invoices differ`;
  }
  return result + (row.packLines > 0 && row.state !== 'cannot_match' ? ` · ${row.packLines} in another pack ignored` : '');
}

export function PriceOutcomes() {
  const [filter, setFilter] = useState<PriceOutcomeState | null>(null);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ data: Outcomes | null; error: boolean; forbidden: boolean; loading: boolean }>({ data: null, error: false, forbidden: false, loading: true });
  function startLoading() { setResult({ data: null, error: false, forbidden: false, loading: true }); }
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/pricing?outcomes=1&page=${page}${filter ? `&state=${filter}` : ''}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (response.status === 401 || response.status === 403) {
          if (!controller.signal.aborted) setResult({ data: null, error: false, forbidden: true, loading: false });
          return;
        }
        const data = normalizePriceOutcomes(await readJsonResponse<unknown>(response, 'Approved prices could not load'));
        if (!data) throw new Error('Invalid price outcomes');
        if (!controller.signal.aborted) setResult({ data, error: false, forbidden: false, loading: false });
      })
      .catch(() => { if (!controller.signal.aborted) setResult({ data: null, error: true, forbidden: false, loading: false }); });
    return () => controller.abort();
  }, [page, filter, retry]);
  if (result.forbidden) return null;
  const data = result.data;
  return <section aria-label="Approved vs billed" className="min-w-0 border-t border-sf-line-soft p-4 [overflow-wrap:anywhere]">
    <h3 className="text-sm font-extrabold text-sf-strong">Approved vs billed</h3>
    {result.loading ? <p className="mt-2 text-sm text-sf-muted">Loading approved prices…</p>
      : result.error ? <p className="mt-2 text-sm text-sf-muted">Approved prices could not load. <button type="button" className={button} onClick={() => { startLoading(); setRetry(value => value + 1); }}>Retry</button></p>
      : data ? <>
        <p className="mt-2 text-xs text-sf-muted">Each approved price checked against Tally invoices since it took effect · within ₹1 counts as the same · sales up to {data.salesThrough ? day(data.salesThrough) : 'not available'}</p>
        <div className="mt-3 flex flex-wrap gap-2">{(Object.keys(labels) as PriceOutcomeState[]).map(state => <button type="button" key={state} aria-pressed={filter === state} className={`${button} ${filter === state ? '!border-sf-ink !bg-sf-ink !text-white' : ''}`} onClick={() => { startLoading(); setFilter(filter === state ? null : state); setPage(1); }}>{labels[state]} {data.counts[state]}</button>)}</div>
        {data.rows.length === 0 ? <p className="mt-3 text-sm text-sf-muted">No approved prices yet.</p> : <ul aria-label="Approved prices" className="mt-3 divide-y divide-sf-line-soft">{data.rows.map(row => <li key={row.priceId} className="min-w-0 py-3">
          <div className="flex items-start justify-between gap-2"><p className="min-w-0 text-sm text-sf-strong"><strong>{row.customerName}</strong> · {row.itemKey}</p><span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${row.state === 'different' ? 'bg-sf-danger-soft text-sf-danger' : row.state === 'matches' ? 'bg-sf-success-soft text-sf-success' : 'bg-sf-soft text-sf-muted'}`}>{labels[row.state]}</span></div>
          <p className="mt-1 text-xs text-sf-muted">{detail(row)}</p>
        </li>)}</ul>}
        {data.total > 10 ? <div className="mt-3 flex justify-between gap-2"><button type="button" className={button} disabled={page <= 1} onClick={() => { startLoading(); setPage(value => value - 1); }}>Previous</button><button type="button" className={button} disabled={page * 10 >= data.total || page >= 100000} onClick={() => { startLoading(); setPage(value => value + 1); }}>Next</button></div> : null}
        <p className="mt-3 text-xs text-sf-muted">Before/after outcome comparison starts when 10 approved prices are 60 days old (now: {data.matureCount}).</p>
      </> : null}
  </section>;
}
