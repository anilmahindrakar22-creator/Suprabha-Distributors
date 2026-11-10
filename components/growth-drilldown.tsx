'use client';

import { useEffect, useRef, useState } from 'react';
import { normalizeGrowthLabs } from '@/lib/growth-types';
import { formatPaise } from '@/lib/wallet-format';

export type GrowthSelection = { list: string; month?: string; half?: 'H1' | 'H2'; sort?: 'value' | 'months' | 'last' | 'per_month'; count: number; title: string; explanation: string };
export type GrowthNavigation = {
  onOpenPriceReview?: (review: { customerId: string; tallyItemKey: string; suggestedPricePaise: number; reason: string }) => void;
  onOpenCustomer: (id: string) => void;
  onPlanVisit: (id: string) => void;
  onLinkLedger: () => void;
  onOpenEconomics: () => void;
  onOpenBrandSetup: () => void;
  onOpenMyActions: () => void;
};
const button = 'min-h-9 rounded-lg border border-sf-line px-3 text-xs text-sf-brand';
const dateLabel = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function GrowthDrilldown({ selection, onClose, ...navigation }: GrowthNavigation & { selection: GrowthSelection; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const skipped = selection.list === 'month_skipped';
  const stopped = selection.list === 'bridge_stopped';
  const invoices = selection.list === 'bulk_invoices' || selection.list === 'month_large_purchases';
  const [sort, setSort] = useState(selection.sort ?? (skipped ? 'months' : 'value'));
  const [regularOnly, setRegularOnly] = useState(true);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<NonNullable<ReturnType<typeof normalizeGrowthLabs>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const panel = dialog.current!;
    panel.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { panel.close(); document.body.style.overflow = overflow; trigger?.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false);
    const params = new URLSearchParams({ list: selection.list, ...(selection.month ? { month: selection.month } : {}), page: String(page), sort });
    if (selection.half) params.set('half', selection.half);
    if (stopped) params.set('regularOnly', String(regularOnly));
    void fetch(`/api/growth/labs?${params}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const result = normalizeGrowthLabs(await response.json());
      if (!result || result.list !== selection.list || result.month !== (selection.month ?? null) || result.page !== page) throw new Error();
      if (!controller.signal.aborted) setData(previous => ({ ...result, rows: page === 1 ? result.rows : [...(previous?.rows ?? []), ...result.rows] }));
    }).catch(() => { if (!controller.signal.aborted) setError(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selection, sort, regularOnly, page, revision, stopped]);
  const navigate = (action: () => void) => { onClose(); action(); };
  return <dialog ref={dialog} aria-labelledby="growth-drill-title" aria-describedby="growth-drill-explanation" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select, input, [tabindex="0"]'));
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }} className="fixed inset-x-0 bottom-0 top-auto m-0 h-[85dvh] max-h-[85dvh] w-full max-w-full overflow-y-auto overscroll-contain rounded-t-2xl border border-sf-line bg-white p-4 text-sm text-sf-strong [overflow-wrap:anywhere] backdrop:bg-sf-ink/30 md:inset-y-0 md:left-auto md:right-0 md:h-dvh md:max-h-dvh md:w-[420px] md:rounded-none md:p-5">
    <div className="space-y-2"><div className="flex justify-end"><button className={button} onClick={onClose} aria-label="Close drilldown">Close</button></div><h2 id="growth-drill-title" className="text-base font-bold">{selection.title} · {data?.total ?? selection.count}</h2><p id="growth-drill-explanation">{selection.explanation}</p>{!invoices && <p className="text-xs text-sf-muted">↑/↓/→ compares the last 3 months against the 3 before.</p>}{skipped && <p className="font-bold text-sf-brand">Call or visit; record what is holding them back.</p>}</div>
    <>
      <div className="my-3 flex flex-wrap items-center gap-3"><label className="flex items-center gap-2">Sort <select className="min-h-11 max-w-full rounded-lg border border-sf-line bg-white px-2" value={sort} onChange={event => { const value = event.target.value; if (value !== 'value' && value !== 'months' && value !== 'last' && value !== 'per_month') return; setSort(value); setPage(1); setData(null); }}>{!skipped && <option value="value">{selection.list.startsWith('bridge_') ? '₹ change' : selection.list === 'regular_labs' ? '₹ in 12 months' : selection.list === 'window_labs' ? '₹ in period' : '₹ this month'}</option>}{!invoices && <option value="months">months bought</option>}{selection.list === 'window_labs' && <option value="per_month">₹ per buying month</option>}<option value="last">last bought</option></select></label>{stopped && <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={regularOnly} onChange={event => { setRegularOnly(event.target.checked); setPage(1); setData(null); }} />Regular only</label>}</div>
      <ul aria-label={skipped ? 'Regulars who skipped' : 'Drilldown results'}>{data?.rows.map((row, index) => 'supplierName' in row ? <li key={index} className="space-y-1 border-b border-sf-line-soft py-2"><strong>{row.supplierName ?? 'Supplier not named'}</strong><p className="text-xs text-sf-muted">{formatPaise(row.valuePaise)} · {dateLabel(row.date)}</p><button className={button} onClick={() => navigate(navigation.onOpenEconomics)}>Check in Economics</button></li> : 'invoice' in row ? <li key={index} className="grid min-w-0 gap-1 border-b border-sf-line-soft py-2 md:grid-cols-[minmax(0,1fr)_auto]"><strong className="text-sm">{row.name ?? 'Tally ledger not linked'}</strong><p className="text-xs text-sf-muted md:col-start-1">{formatPaise(row.valuePaise)} · {dateLabel(row.date)}</p><div className="md:col-start-2 md:row-start-1 md:row-end-3">{row.customerId ? <button className={button} onClick={() => navigate(() => navigation.onOpenCustomer(row.customerId!))}>Open</button> : <button className={button} onClick={() => navigate(navigation.onLinkLedger)}>Link</button>}</div></li> : <li key={`${row.labKey}-${index}`} className="grid min-w-0 gap-x-3 gap-y-0.5 border-b border-sf-line-soft py-1 md:grid-cols-[minmax(0,1fr)_auto] md:py-2"><p className="min-w-0 text-sm"><strong>{row.name ?? 'Tally ledger not linked'}</strong>{row.town && <span className="text-sf-muted"> · {row.town}</span>}</p><p className="min-w-0 text-xs leading-snug text-sf-muted md:col-start-1">{row.valuePaise !== null && <>{formatPaise(row.valuePaise)} {selection.list.startsWith('bridge_') ? 'change' : selection.list === 'regular_labs' ? 'in 12 months' : selection.list === 'window_labs' ? 'in period' : 'this month'} · </>}{row.monthsBought} of 12 months · last {row.lastBoughtOn ? dateLabel(row.lastBoughtOn) : '—'} · <span className="font-bold text-sf-brand">{row.trend === 'up' ? '↑' : row.trend === 'down' ? '↓' : row.trend === 'flat' ? '→' : '—'}</span></p><div className="flex flex-wrap gap-1.5 md:col-start-2 md:row-start-1 md:row-end-3 md:items-center">{row.customerId ? <>{(skipped || stopped) && <button className={button} onClick={() => navigate(() => navigation.onPlanVisit(row.customerId!))}>Plan visit</button>}<button className={button} onClick={() => navigate(() => navigation.onOpenCustomer(row.customerId!))}>Open</button></> : <button className={button} onClick={() => navigate(navigation.onLinkLedger)}>Link</button>}</div></li>)}</ul>
      {loading && <p role="status" className="py-3">Loading…</p>}{error && <div role="alert" className="py-3">Could not load this list. <button className={button} onClick={() => setRevision(n => n + 1)}>Retry</button></div>}{!loading && !error && data?.total === 0 && <p className="py-3">No labs in this list</p>}{data && <p className="mt-4">Showing {data.rows.length} of {data.total}{data.rows.length < data.total && <> · <button disabled={loading || error} className="min-h-11 text-sf-brand underline" onClick={() => setPage(n => n + 1)}>Load more</button></>}</p>}
    </>
  </dialog>;
}
