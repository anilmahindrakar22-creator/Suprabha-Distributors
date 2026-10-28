'use client';

import { useEffect, useRef, useState } from 'react';
import { CircleCheck, RefreshCw } from 'lucide-react';
import { readJsonResponse } from '@/lib/http-json';
import { loadOrderPriceApprovals, type OrderPriceApproval } from '@/lib/order-price-approvals';
import { PriceApprovalCard } from './price-approval-card';

type InboxState = { status: 'loading' | 'ready' | 'error'; items: OrderPriceApproval[]; truncated: boolean; message: string };
const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const validRate = (rate: number) => Number.isFinite(rate) && rate > 0 && rate <= 100_000_000 && Math.abs(Math.round(rate * 100) - rate * 100) < 1e-6;

/** Order prices waiting for a decision, listed in the Pricing inbox beside customer price-book proposals. */
export function OrderPriceInbox({ canApprove, canChange = false, onCount }: { canApprove: boolean; canChange?: boolean; onCount?: (count: number) => void }) {
  const [state, setState] = useState<InboxState>({ status: 'loading', items: [], truncated: false, message: '' });
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [changedRates, setChangedRates] = useState<Record<string, string>>({});
  const [savedPrices, setSavedPrices] = useState<Record<string, { version: number; checked: boolean }>>({});
  const priceChangeRequests = useRef(new Map<string, { fingerprint: string; idempotencyKey: string }>());
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    loadOrderPriceApprovals(fetch)
      .then((result) => {
        if (!live) return;
        setSavedPrices(current => Object.fromEntries(result.items.flatMap(item => item.workspace.exceptions.flatMap(exception => current[exception.id]?.version === exception.version ? [[exception.id, current[exception.id]]] : []))));
        setState({ status: 'ready', ...result, message: '' }); onCount?.(result.items.length);
      })
      .catch((cause: unknown) => { if (live) setState((current) => ({ ...current, status: 'error', message: cause instanceof Error ? cause.message : 'Order prices could not be loaded' })); });
    return () => { live = false; };
  }, [version, onCount]);

  async function decide(item: OrderPriceApproval, exceptionId: string, expectedVersion: number, action: 'approve_price_exception' | 'reject_price_exception', changedRate?: number) {
    if (busy) return;
    const reason = action === 'approve_price_exception' && changedRate === undefined ? 'Price reviewed and approved' : (reasons[exceptionId] || '').trim();
    const saveAsCustomerPrice = savedPrices[exceptionId]?.version === expectedVersion ? savedPrices[exceptionId].checked : true;
    if (changedRate !== undefined && (!canApprove || !canChange || action !== 'approve_price_exception' || !validRate(changedRate) || reason.length < 3 || reason.length > 1000)) return;
    setBusy(exceptionId); setError(''); setNotice('');
    try {
      let idempotencyKey;
      if (changedRate !== undefined) {
        const fingerprint = JSON.stringify([expectedVersion, changedRate, reason, saveAsCustomerPrice]);
        let request = priceChangeRequests.current.get(exceptionId);
        if (request?.fingerprint !== fingerprint) {
          request = { fingerprint, idempotencyKey: crypto.randomUUID() };
          priceChangeRequests.current.set(exceptionId, request);
        }
        idempotencyKey = request.idempotencyKey;
      } else idempotencyKey = crypto.randomUUID();
      const response = await fetch('/api/pricing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, payload: { exceptionId, expectedVersion, reason, idempotencyKey, ...(action === 'approve_price_exception' ? { saveAsCustomerPrice } : {}), ...(changedRate !== undefined ? { changedRate } : {}) } }) });
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) priceChangeRequests.current.delete(exceptionId);
      await readJsonResponse(response, 'The price decision could not be saved');
      priceChangeRequests.current.delete(exceptionId);
      setChangedRates((rates) => { const next = { ...rates }; delete next[exceptionId]; return next; });
      setNotice(changedRate !== undefined ? `${item.orderNumber}: price changed to ${rupees.format(changedRate)} and approved.` : `${item.orderNumber}: price ${action === 'approve_price_exception' ? 'approved' : 'rejected'}.`);
      setVersion((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The price decision could not be saved');
    } finally { setBusy(''); }
  }

  return <section aria-label="Order prices waiting for approval" className="border-b border-sf-line-soft">
    <div className="flex items-center justify-between gap-3 px-4 pt-4">
      <h3 className="text-sm font-extrabold text-sf-strong">Order prices</h3>
      <button type="button" aria-label="Refresh order prices" onClick={() => setVersion((value) => value + 1)} disabled={state.status === 'loading'} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-sf-label hover:bg-sf-soft disabled:opacity-50"><RefreshCw aria-hidden="true" size={14} />Refresh</button>
    </div>
    {notice ? <output className="mx-4 mt-2 flex items-center gap-1.5 text-sm font-bold text-sf-success"><CircleCheck aria-hidden="true" size={16} />{notice}</output> : null}
    {error ? <p role="alert" className="mx-4 mt-2 text-sm text-sf-danger">{error}</p> : null}
    {state.status === 'loading' && !state.items.length ? <p className="px-4 py-4 text-sm text-sf-muted">Loading order prices…</p>
      : state.status === 'error' ? <p role="alert" className="px-4 py-4 text-sm text-sf-danger">{state.message}</p>
      : !state.items.length ? <p className="px-4 py-4 text-sm text-sf-muted">{state.truncated ? 'No order prices are waiting for approval in the loaded orders.' : 'No order prices are waiting for approval.'}</p>
      : <div className="space-y-4 p-4">{state.items.map((item) => <article key={item.orderId} aria-label={`${item.orderNumber}, ${item.customerName}`} className="min-w-0">
        <p className="text-sm font-bold text-sf-strong">{item.customerName} <span className="font-semibold text-sf-subtle">· {item.orderNumber}</span></p>
        <PriceApprovalCard workspace={item.workspace} />
        {item.workspace.exceptions.map((exception, index) => {
          const saveLabel = item.workspace.exceptions.length === 1 ? `Save as ${item.customerName}'s price for ${item.workspace.lines.find(line => line.lineId === exception.lineId)?.itemName ?? 'this item'}` : "Save as this customer's price for these items";
          return canApprove ? <div key={exception.id} className={`mt-2 grid gap-2 sm:items-center ${canChange ? 'sm:grid-cols-[auto_auto_minmax(0,1fr)_auto]' : 'sm:grid-cols-[auto_minmax(0,1fr)_auto]'}`}>
          <div className="min-w-0 sm:col-span-full">
            <label className="flex min-h-11 items-center gap-3 text-sm font-bold text-sf-body">
              <input type="checkbox" aria-label={`${saveLabel} · ${item.orderNumber} · item ${index + 1}`} checked={savedPrices[exception.id]?.version === exception.version ? savedPrices[exception.id].checked : true} disabled={Boolean(busy)} onChange={event => setSavedPrices(current => ({ ...current, [exception.id]: { version: exception.version, checked: event.target.checked } }))} className="size-4 shrink-0 accent-sf-accent" />
              {saveLabel}
            </label>
            <p className="text-xs text-sf-muted">Next orders use this price without approval until purchase cost rises over 2%.</p>
          </div>
          <button type="button" disabled={Boolean(busy)} onClick={() => void decide(item, exception.id, exception.version, 'approve_price_exception')} className="min-h-11 rounded-xl bg-sf-ink px-5 text-sm font-bold text-white hover:bg-sf-ink-hover disabled:opacity-50">{busy === exception.id ? 'Saving…' : `Approve ${rupees.format(exception.enteredRate)}`}</button>
          {canChange ? <button type="button" aria-expanded={exception.id in changedRates} disabled={Boolean(busy)} onClick={() => {
            priceChangeRequests.current.delete(exception.id);
            setChangedRates((rates) => { const next = { ...rates }; if (exception.id in next) delete next[exception.id]; else next[exception.id] = String(exception.enteredRate); return next; });
          }} className="min-h-11 rounded-xl border border-sf-line px-4 text-sm font-bold text-sf-body disabled:opacity-50">Change price…</button> : null}
          <input aria-label={`Reason for ${item.orderNumber}`} value={reasons[exception.id] || ''} onChange={(event) => setReasons((value) => ({ ...value, [exception.id]: event.target.value }))} required={canChange && exception.id in changedRates} minLength={3} maxLength={1000} disabled={Boolean(busy)} placeholder={canChange ? 'Reason, required to reject or change price' : 'Reason, required to reject'} className="min-h-11 min-w-0 rounded-lg border border-sf-line px-3 text-sm" />
          <button type="button" disabled={Boolean(busy) || (reasons[exception.id] || '').trim().length < 3} onClick={() => void decide(item, exception.id, exception.version, 'reject_price_exception')} className="min-h-11 rounded-xl border border-sf-danger-line px-4 text-sm font-bold text-sf-danger disabled:opacity-50">Reject</button>
          {canChange && exception.id in changedRates ? <div className="grid min-w-0 gap-2 sm:col-span-full sm:grid-cols-[minmax(0,1fr)_auto]">
            <input aria-label={`New price for ${item.orderNumber}`} type="number" inputMode="decimal" min="0.01" max="100000000" step="0.01" required disabled={Boolean(busy)} value={changedRates[exception.id]} onChange={(event) => setChangedRates((rates) => ({ ...rates, [exception.id]: event.target.value }))} className="min-h-11 min-w-0 rounded-lg border border-sf-line px-3 text-sm" />
            <button type="button" disabled={Boolean(busy) || !validRate(Number(changedRates[exception.id])) || (reasons[exception.id] || '').trim().length < 3} onClick={() => void decide(item, exception.id, exception.version, 'approve_price_exception', Number(changedRates[exception.id]))} className="min-h-11 rounded-xl bg-sf-ink px-5 text-sm font-bold text-white hover:bg-sf-ink-hover disabled:opacity-50">{busy === exception.id ? 'Saving…' : `Approve ${rupees.format(Number(changedRates[exception.id]))}`}</button>
            {(reasons[exception.id] || '').trim().length < 3 ? <p className="text-xs font-bold text-sf-warning sm:col-span-full">Reason required to change the price</p> : null}
          </div> : null}
        </div> : <p key={exception.id} className="mt-2 text-xs font-bold text-sf-warning">Waiting for management to approve.</p>;
        })}
      </article>)}
      </div>}
    {state.status === 'ready' && state.truncated ? <p className="px-4 pb-4 text-xs text-sf-subtle">Showing order prices from the first 200 active orders. Use Orders → Prices to approve for the rest.</p> : null}
  </section>;
}
