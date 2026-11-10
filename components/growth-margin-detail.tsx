'use client';

import { useEffect, useRef, useState } from 'react';
import { normalizeGrowthMarginDetail, normalizeGrowthBilledBelow, type GrowthBilledBelow, type GrowthMarginDetail as Detail } from '@/lib/growth-margin-types';
import { formatPaise } from '@/lib/wallet-format';
import type { GrowthNavigation } from './growth-drilldown';

export type MarginSelection = { itemKey: string } | { labKey: string };
const button = 'min-h-9 rounded-lg border border-sf-line px-3 text-xs text-sf-brand disabled:text-sf-muted';
const money = (n: number | null) => n === null ? '—' : formatPaise(n);

export function GrowthBilledBelowDetail({ navigation, onClose }: { navigation: GrowthNavigation; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<GrowthBilledBelow | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
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
    void fetch(`/api/growth/margin?billedBelow=1&page=${page}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const value = normalizeGrowthBilledBelow(await response.json());
      if (!value || value.page !== page) throw new Error();
      if (!controller.signal.aborted) setData(previous => ({ ...value, rows: page === 1 ? value.rows : [...(previous?.rows ?? []), ...value.rows] }));
    }).catch(() => { if (!controller.signal.aborted) setError(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, revision]);
  return <dialog ref={dialog} aria-labelledby="growth-billed-below-title" aria-describedby="growth-billed-below-explanation" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); }
  }} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)'));
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }} className="fixed inset-x-0 bottom-0 top-auto m-0 h-[85dvh] max-h-[85dvh] w-full max-w-full overflow-y-auto overscroll-contain rounded-t-2xl border border-sf-line bg-white p-4 text-sm text-sf-strong [overflow-wrap:anywhere] backdrop:bg-sf-ink/30 md:inset-y-0 md:left-auto md:right-0 md:h-dvh md:max-h-dvh md:w-[420px] md:rounded-none md:p-5">
    <div className="flex justify-end"><button className={button} onClick={onClose} aria-label="Close billed below approved price">Close</button></div>
    <h2 id="growth-billed-below-title" className="mt-2 text-base font-bold">Billed below approved price</h2>
    <p id="growth-billed-below-explanation" className="mt-2 text-xs text-sf-muted">Invoice lines billed under the approved price · 12 months</p>
    {loading && <p role="status" className="py-4 text-xs">Loading invoice lines…</p>}
    {error && <p role="alert" className="py-4 text-xs">Couldn&apos;t load this check <button className={button} onClick={() => setRevision(n => n + 1)}>Retry</button></p>}
    <ul aria-label="Billed below approved price results">{data?.rows.map((row, index) => <li key={index} className="space-y-1 border-b border-sf-line-soft py-2">
      <p>{row.date} · <strong>{row.name ?? 'Unnamed lab'}</strong>{row.town && ` · ${row.town}`}</p>
      <p className="text-xs text-sf-muted">{row.itemName} · billed {money(row.billedRatePaise)} per unit vs approved {money(row.approvedRatePaise)} · {row.quantity} units · {money(row.gapPaise)} short</p>
      <button className={button} onClick={() => { onClose(); navigation.onOpenCustomer(row.customerId); }}>Open</button>
    </li>)}</ul>
    {data && <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><p role="status" className="text-xs text-sf-muted">Showing {data.rows.length} of {data.total}</p>{data.rows.length < data.total && <button className={button} disabled={loading || error} onClick={() => setPage(n => n + 1)}>Load more</button>}</div>}
  </dialog>;
}

export function GrowthMarginDetail({ selection, navigation, onClose }: { selection: MarginSelection; navigation: GrowthNavigation; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<Detail | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState(false);
  const reviewRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const panel = dialog.current!;
    panel.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { reviewRequest.current?.abort(); panel.close(); document.body.style.overflow = overflow; trigger?.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false);
    const params = new URLSearchParams({ ...selection, page: String(page) });
    void fetch(`/api/growth/margin?${params}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const value = normalizeGrowthMarginDetail(await response.json());
      if (!value || value.page !== page || ('itemKey' in selection ? value.kind !== 'item' || value.itemKey !== selection.itemKey : value.kind !== 'lab' || value.labKey !== selection.labKey)) throw new Error();
      if (!controller.signal.aborted) setData(previous => ({ ...value, rows: page === 1 ? value.rows : [...(previous?.kind === value.kind ? previous.rows : []), ...value.rows] }) as Detail);
    }).catch(() => { if (!controller.signal.aborted) setError(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selection, page, revision]);
  const navigate = (action: () => void) => { onClose(); action(); };
  const review = async (customerId: string, tallyItemKey: string, typical: number, price: number, quantity: number, itemKey: string | null) => {
    setReviewError(false); setReviewing(true);
    const controller = new AbortController();
    reviewRequest.current = controller;
    try {
      let labs = data?.kind === 'item' ? data.labs : null;
      if (labs === null && itemKey) {
        const response = await fetch(`/api/growth/margin?${new URLSearchParams({ itemKey, page: '1' })}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error();
        const item = normalizeGrowthMarginDetail(await response.json());
        if (!item || item.kind !== 'item' || item.itemKey !== itemKey || item.page !== 1) throw new Error();
        labs = item.labs;
      }
      if (labs === null) throw new Error();
      if (!controller.signal.aborted) navigate(() => navigation.onOpenPriceReview?.({ customerId, tallyItemKey, suggestedPricePaise: typical, reason: `Growth review: pays ${money(price)} per unit for ${quantity}; typical ${money(typical)} across ${labs} labs.` }));
    } catch { if (!controller.signal.aborted) setReviewError(true); }
    finally { if (!controller.signal.aborted) setReviewing(false); }
  };
  return <dialog ref={dialog} aria-labelledby="growth-margin-detail-title" aria-describedby="growth-margin-detail-explanation" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); }
  }} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select, input, [tabindex="0"]'));
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }} className="fixed inset-x-0 bottom-0 top-auto m-0 h-[85dvh] max-h-[85dvh] w-full max-w-full overflow-y-auto overscroll-contain rounded-t-2xl border border-sf-line bg-white p-4 text-sm text-sf-strong [overflow-wrap:anywhere] backdrop:bg-sf-ink/30 md:inset-y-0 md:left-auto md:right-0 md:h-dvh md:max-h-dvh md:w-[420px] md:rounded-none md:p-5">
    <div className="space-y-2"><div className="flex justify-end"><button className={button} onClick={onClose} aria-label="Close margin detail">Close</button></div><h2 id="growth-margin-detail-title" className="text-base font-bold">{data ? `${data.name ?? (data.kind === 'item' ? 'Unnamed item' : '(unlinked ledger)')} · ${data.kind === 'item' ? 'price per unit by lab' : 'items bought'}` : 'Margin detail'}</h2><p id="growth-margin-detail-explanation" className="text-xs text-sf-muted">{data?.kind === 'item' ? `Typical (median) ${money(data.typicalPricePaise)} across ${data.labs} labs. Labs under 90% of typical are highlighted; prices under 40% are probably a different pack and are not counted.` : 'Consumables bought by this lab · average purchase cost.'}</p></div>
    {loading && <p role="status" className="py-4 text-xs">Loading margin detail…</p>}{error && <p role="alert" className="py-4 text-xs">Margin detail is unavailable. <button className={button} onClick={() => setRevision(n => n + 1)}>Retry</button></p>}
    {reviewError && <p role="alert" className="text-xs">Could not open price review. Try again.</p>}
    <ul aria-label="Margin detail results">{data?.rows.map((row, index) => {
      const itemRow = 'labKey' in row;
      const customerId = itemRow ? row.customerId : data.kind === 'lab' ? data.customerId : null;
      const tallyItemKey = itemRow ? data.kind === 'item' ? data.tallyItemKey : null : row.tallyItemKey;
      const typical = itemRow ? data.kind === 'item' ? data.typicalPricePaise : null : row.typicalPricePaise;
      const highlighted = row.belowTypical && !row.packDifference;
      return <li key={index} className={`space-y-1 border-b border-sf-line-soft py-2 ${highlighted ? 'rounded-md bg-sf-warning-soft px-2' : ''}`}><p className="text-sm"><strong>{row.name ?? (itemRow ? '(unlinked ledger)' : 'Unnamed item')}</strong>{itemRow && row.town && <span className="text-xs text-sf-muted"> · {row.town}</span>}</p><p className="text-xs text-sf-muted">{money(row.unitPricePaise)} per unit{!itemRow && ` (typical ${money(typical)})`} · {row.quantity} bought{!itemRow && ` · margin ${row.marginPct === null ? '—' : row.marginPct.toFixed(1) + '%'}`}{row.approvedPricePaise !== null && ` · Approved ${money(row.approvedPricePaise)}`}</p>
      {row.packDifference && <p className="text-xs text-sf-muted">Probably a different pack · not counted</p>}
      <div className="flex flex-wrap gap-1.5">{highlighted && (customerId === null ? <button className={button} onClick={() => navigate(navigation.onLinkLedger)}>Link</button> : tallyItemKey === null ? <button className={button} disabled>Not in price book</button> : navigation.onOpenPriceReview && typical !== null && <button className={button} disabled={reviewing} onClick={() => void review(customerId, tallyItemKey, typical, row.unitPricePaise, row.quantity, itemRow ? null : row.itemKey)}>Review prices</button>)}{customerId && <button className={button} onClick={() => navigate(() => navigation.onOpenCustomer(customerId))}>Open</button>}</div>
      </li>;
    })}</ul>
    {data && <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><p role="status" className="text-xs text-sf-muted">Showing {data.rows.length} of {data.total}</p>{data.rows.length < data.total && <button className={button} disabled={loading || error} onClick={() => setPage(n => n + 1)}>Load more</button>}</div>}
  </dialog>;
}
