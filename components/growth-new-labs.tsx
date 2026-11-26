'use client';

import { useEffect, useState } from 'react';
import { normalizeGrowthNewLabs, type GrowthNewLabsData } from '@/lib/growth-new-lab-types';
import { formatPaise } from '@/lib/wallet-format';

const card = 'min-w-0 space-y-3 rounded-xl border border-sf-line-soft bg-white p-4 lg:p-5';
const muted = 'text-xs text-sf-muted';
const button = 'min-h-9 rounded-lg border border-sf-line px-3 text-xs text-sf-brand';
const statuses = {
  overdue: { label: 'Overdue', tone: 'bg-sf-danger-soft text-sf-danger border-sf-danger-line' },
  due: { label: 'Due', tone: 'bg-sf-warning-soft text-sf-warning border-sf-warning-line' },
  early: { label: 'Early', tone: 'bg-sf-soft-0 text-sf-muted border-sf-line' },
  repeat: { label: 'Ordered again', tone: 'bg-sf-success-soft text-sf-success border-sf-success-line' },
};
const shortDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });

export function GrowthNewLabs({ onOpenCustomer }: { onOpenCustomer?: (customerId: string) => void }) {
  const [data, setData] = useState<GrowthNewLabsData | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/growth/lab-months?filter=new', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const next = normalizeGrowthNewLabs(response.ok ? await response.json() : null);
      if (!next) throw new Error('New labs are unavailable');
      if (!controller.signal.aborted) setData(next);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [revision]);
  return <section className={card} aria-labelledby="growth-new-labs-title">
    <h2 id="growth-new-labs-title" className="text-base font-bold">New labs, first 90 days</h2>
    {data && <p className="text-sm font-bold">{data.repeatLabs} of {data.totalLabs} new labs have ordered again</p>}
    <p className={muted}>Second order due at 30 days, overdue at 45. Call overdue labs first.</p>
    {error ? <div role="alert" className="text-xs">New labs are unavailable. <button type="button" className={button} onClick={() => { setError(false); setRevision(n => n + 1); }}>Retry</button></div>
      : !data ? <output className="block animate-pulse rounded bg-sf-soft-0 p-4 text-xs">Loading labs…</output>
      : <>
        {data.rows.length ? <ol aria-label="Call list" className="space-y-2">
          {data.rows.map(row => <li key={row.labKey} className="min-w-0 space-y-1.5 rounded-lg border border-sf-line p-3 text-xs">
            <p className="flex min-w-0 flex-wrap items-center gap-1.5"><strong className="min-w-0 break-words">{row.name || 'Unnamed lab'}</strong><span className={`shrink-0 rounded-full border px-1.5 text-[10px] font-bold leading-4 ${statuses[row.status].tone}`}>{statuses[row.status].label}</span></p>
            <p className="break-words text-sf-muted">{row.town && `${row.town} · `}first order {shortDate(row.firstPurchaseOn)} · {formatPaise(row.firstOrderPaise)} · {row.daysSinceFirst} days ago</p>
            {row.orderDays >= 2 && <p className={muted}>{row.orderDays} order days · last {shortDate(row.lastPurchaseOn)}</p>}
            <div className="flex flex-wrap gap-1.5">
              {row.customerId && <button type="button" className={button} disabled={!onOpenCustomer} onClick={() => onOpenCustomer?.(row.customerId!)}>Open customer</button>}
              {row.phone && <a className={`${button} inline-flex items-center`} href={`tel:${row.phone}`}>Call</a>}
            </div>
          </li>)}
        </ol> : <p className={muted}>No labs placed their first order in the last 90 days.</p>}
        {data.rows.length === 50 && data.totalLabs > 50 && <p className={muted}>Showing 50 of {data.totalLabs}</p>}
      </>}
  </section>;
}
