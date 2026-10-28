'use client';

import { useEffect, useState } from 'react';
import { fetchSalesCoverage, formatPaise, type SalesCoverage } from '@/lib/sales-coverage';
import { hasAnyStockFlowRole } from '@/lib/user-types';

const shortMonth = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'Asia/Kolkata' });
const monthYear = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
function timestamp(value: string) {
  const date = new Date(value);
  const day = `${new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'Asia/Kolkata' }).format(date)} ${shortMonth.format(date)}`;
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(date).toLowerCase();
  return `${day}, ${time}`;
}
function windowLabel(window: SalesCoverage['window']) {
  const from = new Date(`${window.from}T00:00:00Z`);
  const to = new Date(`${window.to}T00:00:00Z`);
  return `${from.getUTCFullYear() === to.getUTCFullYear() ? shortMonth.format(from) : monthYear.format(from)}–${monthYear.format(to)}`;
}

export function SalesCoverageCard({ roles }: { roles: unknown }) {
  return hasAnyStockFlowRole(roles, ['administrator', 'management', 'accounts']) ? <LoadedSalesCoverageCard /> : null;
}

function LoadedSalesCoverageCard() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ loading: boolean; coverage: SalesCoverage | null; error: boolean }>({ loading: true, coverage: null, error: false });
  useEffect(() => {
    const controller = new AbortController();
    void fetchSalesCoverage(controller.signal).then(coverage => {
      if (!controller.signal.aborted) setState({ loading: false, coverage, error: false });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ loading: false, coverage: null, error: true });
    });
    return () => controller.abort();
  }, [attempt]);
  function refresh() {
    setState({ loading: true, coverage: null, error: false });
    setAttempt(value => value + 1);
  }
  return <section aria-label="Sales coverage" className="min-w-0 rounded-xl border border-sf-line-soft bg-white p-4 text-sm [overflow-wrap:anywhere]">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-extrabold">Sales coverage</h2>
      <button type="button" aria-label="Refresh sales coverage" disabled={state.loading} onClick={refresh} className="min-h-9 rounded-lg border border-sf-line px-3 text-xs font-bold text-sf-body disabled:opacity-50">Refresh</button>
    </div>
    {state.loading ? <output className="mt-2 block text-sf-muted">Loading sales coverage…</output> : state.error ? <div className="mt-2 text-sf-muted">Sales coverage unavailable <button type="button" onClick={refresh} className="min-h-9 rounded-lg border border-sf-line px-3 font-bold">Retry</button></div> : state.coverage ? <SalesCoverageContents coverage={state.coverage} /> : null}
  </section>;
}

export function SalesCoverageContents({ coverage }: { coverage: SalesCoverage }) {
  const neverCovered = !coverage.complete && coverage.coveredFrom === null && coverage.coveredTo === null && coverage.importedAt === null;
  return <div className="mt-2 space-y-3">
    <p className="text-sf-muted">{neverCovered ? 'No complete sales window yet' : coverage.complete ? `${windowLabel(coverage.window)} · complete · as of ${timestamp(coverage.importedAt!)}` : `${windowLabel(coverage.window)} · incomplete · ${coverage.blockingCount} blocking ${coverage.blockingCount === 1 ? 'item' : 'items'}`}</p>
    {!coverage.complete ? <details className="rounded-lg border border-sf-line-soft p-3">
      <summary className="cursor-pointer font-semibold">Blocking items ({coverage.blockingCount})</summary>
      <ul className="mt-2 space-y-2">{coverage.blockingItems.slice(0, 20).map((item, index) => <li key={`${item.sourceId}:${index}`}>{item.reason} · {timestamp(item.recordedAt)} · {item.sourceId}</li>)}</ul>
    </details> : null}
    {coverage.rebuild.state === 'paused' ? <output title={coverage.rebuild.reason ?? undefined} className="block text-sf-warning">Economics results paused since {timestamp(coverage.rebuild.since!)}. Figures shown are from before the pause.</output> : null}
    <dl className="space-y-3">{coverage.months.map(row => <div key={row.month} className="min-w-0 sm:flex sm:gap-4">
      <dt className="font-semibold sm:w-20 sm:shrink-0">{monthYear.format(new Date(`${row.month}-01T00:00:00Z`))}</dt>
      <dd className={row.state === 'matches' ? 'text-sf-success' : row.state === 'differs' ? 'text-sf-warning' : 'text-sf-muted'}>
        App {formatPaise(row.appNetPaise)} · {row.tallyNetPaise === null ? 'no Tally control' : <>Tally {formatPaise(row.tallyNetPaise)} · {row.state === 'matches' ? 'matches' : `differs by ${row.differencePaise! < 0 ? '−' : '+'}${formatPaise(Math.abs(row.differencePaise!))}`}</>}
      </dd>
    </div>)}</dl>
  </div>;
}
