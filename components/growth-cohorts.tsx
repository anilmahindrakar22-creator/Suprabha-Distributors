'use client';

import { useEffect, useState } from 'react';
import { normalizeGrowthCohorts, normalizeGrowthCohortLabs, type GrowthCohortsData, type GrowthCohortRow, type GrowthCohortLabsData } from '@/lib/growth-cohort-types';
import { formatPaise } from '@/lib/wallet-format';

const card = 'min-w-0 space-y-3 rounded-xl border border-sf-line-soft bg-white p-4 lg:p-5';
const muted = 'text-xs text-sf-muted';
const button = 'min-h-9 rounded-lg border border-sf-line px-3 text-xs text-sf-brand';
const dateLabel = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function StoppedLabs({ cohort, onOpenCustomer }: { cohort: GrowthCohortRow; onOpenCustomer?: (customerId: string) => void }) {
  const [data, setData] = useState<GrowthCohortLabsData | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/growth/cohorts?cohort=${encodeURIComponent(cohort.cohort)}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const next = normalizeGrowthCohortLabs(response.ok ? await response.json() : null);
      if (!next || next.cohort !== cohort.cohort) throw new Error('Unavailable');
      if (!controller.signal.aborted) setData(next);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [cohort.cohort, revision]);
  return <div id="growth-cohort-stopped" className="min-w-0 space-y-3">
    <h3 className="text-sm font-bold">Stopped labs, {cohort.label}</h3>
    {error ? <div role="alert" className="text-xs">Stopped labs are unavailable. <button type="button" className={button} onClick={() => { setError(false); setRevision(n => n + 1); }}>Retry</button></div>
      : !data ? <output className="block animate-pulse rounded bg-sf-soft-0 p-4 text-xs">Loading labs…</output>
      : <><ol aria-label="Stopped labs" className="space-y-2">
        {data.rows.map(lab => <li key={lab.labKey} className="min-w-0 space-y-1.5 break-words rounded-lg border border-sf-line p-3 text-xs">
          <p><strong>{lab.name}</strong></p>
          <p className={muted}>{lab.town ? `${lab.town} · ` : ''}last bought {dateLabel(lab.lastPurchaseOn)}</p>
          <p>₹ lost {formatPaise(lab.lostPaise)}</p>
          {lab.customerId && <button type="button" className={button} disabled={!onOpenCustomer} onClick={() => onOpenCustomer?.(lab.customerId!)}>Open customer</button>}
        </li>)}
      </ol>{data.totalLabs > data.rows.length && <p className={muted}>Showing {data.rows.length} of {data.totalLabs}</p>}</>}
  </div>;
}

export function GrowthCohorts({ onOpenCustomer }: { onOpenCustomer?: (customerId: string) => void }) {
  const [data, setData] = useState<GrowthCohortsData | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<GrowthCohortRow | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/growth/cohorts', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const next = normalizeGrowthCohorts(response.ok ? await response.json() : null);
      if (!next) throw new Error('Unavailable');
      if (!controller.signal.aborted) setData(next);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [revision]);
  return <section className={card} aria-labelledby="growth-cohorts-title">
    <h2 id="growth-cohorts-title" className="text-base font-bold">Labs by year first bought</h2>
    <p className={muted}>Active = bought in the last 90 days. Stopped = nothing for 6 months; ₹ lost = what they bought in their last 12 months.</p>
    {error ? <div role="alert" className="text-xs">Lab cohorts are unavailable. <button type="button" className={button} onClick={() => { setError(false); setRevision(n => n + 1); }}>Retry</button></div>
      : !data ? <output className="block animate-pulse rounded bg-sf-soft-0 p-4 text-xs">Loading labs…</output>
      : <><div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-xs tabular-nums">
          <thead><tr className="border-b border-sf-line text-sf-muted">{['First bought', 'Labs', 'Still buying', 'Stopped', '₹ lost'].map((label, i) => <th key={label} scope="col" className={`px-2 py-2 font-normal ${i === 0 ? 'text-left' : 'text-right'}`}>{label}</th>)}</tr></thead>
          <tbody>{data.rows.map(row => <tr key={row.cohort} className={`border-t border-sf-line-soft ${row.stopped > 0 ? 'cursor-pointer hover:bg-sf-soft-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-brand' : ''}`}
            tabIndex={row.stopped > 0 ? 0 : undefined} role={row.stopped > 0 ? 'button' : undefined} aria-expanded={row.stopped > 0 ? selected?.cohort === row.cohort : undefined} aria-controls={row.stopped > 0 && selected?.cohort === row.cohort ? 'growth-cohort-stopped' : undefined}
            onClick={row.stopped > 0 ? () => setSelected(selected?.cohort === row.cohort ? null : row) : undefined}
            onKeyDown={row.stopped > 0 ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(selected?.cohort === row.cohort ? null : row); } } : undefined}>
            <th scope="row" className="px-2 py-2 text-left font-normal">{row.label}</th><td className="px-2 py-2 text-right">{row.labs}</td><td className="px-2 py-2 text-right whitespace-nowrap">{row.active} ({row.activePct}%)</td><td className="px-2 py-2 text-right">{row.stopped}</td><td className="px-2 py-2 text-right whitespace-nowrap">{formatPaise(row.lostPaise)}</td>
          </tr>)}</tbody>
          <tfoot><tr className="border-t border-sf-line font-bold"><th scope="row" className="px-2 py-2 text-left">All labs</th><td className="px-2 py-2 text-right">{data.totals.labs}</td><td className="px-2 py-2 text-right whitespace-nowrap">{data.totals.active} ({data.totals.activePct}%)</td><td className="px-2 py-2 text-right">{data.totals.stopped}</td><td className="px-2 py-2 text-right whitespace-nowrap">{formatPaise(data.totals.lostPaise)}</td></tr></tfoot>
        </table>
      </div>
      {data.reconciled === false && <p className={muted}>Some months are not reconciled yet, so counts may change slightly.</p>}
      {selected && <StoppedLabs key={selected.cohort} cohort={selected} onOpenCustomer={onOpenCustomer} />}</>}
  </section>;
}
