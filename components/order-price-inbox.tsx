'use client';

import { useEffect, useState } from 'react';
import { CircleCheck, RefreshCw } from 'lucide-react';
import { readJsonResponse } from '@/lib/http-json';
import { loadOrderPriceApprovals, type OrderPriceApproval } from '@/lib/order-price-approvals';
import { PriceApprovalCard } from './price-approval-card';

type InboxState = { status: 'loading' | 'ready' | 'error'; items: OrderPriceApproval[]; truncated: boolean; message: string };

/** Order prices waiting for a decision, listed in the Pricing inbox beside customer price-book proposals. */
export function OrderPriceInbox({ canApprove, onCount }: { canApprove: boolean; onCount?: (count: number) => void }) {
  const [state, setState] = useState<InboxState>({ status: 'loading', items: [], truncated: false, message: '' });
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    loadOrderPriceApprovals(fetch)
      .then((result) => { if (!live) return; setState({ status: 'ready', ...result, message: '' }); onCount?.(result.items.length); })
      .catch((cause: unknown) => { if (live) setState((current) => ({ ...current, status: 'error', message: cause instanceof Error ? cause.message : 'Order prices could not be loaded' })); });
    return () => { live = false; };
  }, [version, onCount]);

  async function decide(item: OrderPriceApproval, exceptionId: string, expectedVersion: number, action: 'approve_price_exception' | 'reject_price_exception') {
    if (busy) return;
    const reason = action === 'approve_price_exception' ? 'Price reviewed and approved' : (reasons[exceptionId] || '').trim();
    setBusy(exceptionId); setError(''); setNotice('');
    try {
      await readJsonResponse(await fetch('/api/pricing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, payload: { exceptionId, expectedVersion, reason, idempotencyKey: crypto.randomUUID() } }) }), 'The price decision could not be saved');
      setNotice(`${item.orderNumber}: price ${action === 'approve_price_exception' ? 'approved' : 'rejected'}.`);
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
      : !state.items.length ? <p className="px-4 py-4 text-sm text-sf-muted">No order prices are waiting for approval.</p>
      : <div className="space-y-4 p-4">{state.items.map((item) => <article key={item.orderId} aria-label={`${item.orderNumber}, ${item.customerName}`} className="min-w-0">
        <p className="text-sm font-bold text-sf-strong">{item.customerName} <span className="font-semibold text-sf-subtle">· {item.orderNumber}</span></p>
        <PriceApprovalCard workspace={item.workspace} />
        {item.workspace.exceptions.map((exception) => canApprove ? <div key={exception.id} className="mt-2 grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
          <button type="button" disabled={Boolean(busy)} onClick={() => void decide(item, exception.id, exception.version, 'approve_price_exception')} className="min-h-11 rounded-xl bg-sf-ink px-5 text-sm font-bold text-white hover:bg-sf-ink-hover disabled:opacity-50">{busy === exception.id ? 'Saving…' : `Approve ${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(exception.enteredRate)}`}</button>
          <input aria-label={`Rejection reason for ${item.orderNumber}`} value={reasons[exception.id] || ''} onChange={(event) => setReasons((value) => ({ ...value, [exception.id]: event.target.value }))} maxLength={1000} placeholder="Reason, required to reject" className="min-h-11 min-w-0 rounded-lg border border-sf-line px-3 text-sm" />
          <button type="button" disabled={Boolean(busy) || (reasons[exception.id] || '').trim().length < 3} onClick={() => void decide(item, exception.id, exception.version, 'reject_price_exception')} className="min-h-11 rounded-xl border border-sf-danger-line px-4 text-sm font-bold text-sf-danger disabled:opacity-50">Reject</button>
        </div> : <p key={exception.id} className="mt-2 text-xs font-bold text-sf-warning">Waiting for management to approve.</p>)}
      </article>)}
        {state.truncated ? <p className="text-xs text-sf-subtle">Showing order prices from the first 200 active orders. Use Orders → Prices to approve for the rest.</p> : null}
      </div>}
  </section>;
}
