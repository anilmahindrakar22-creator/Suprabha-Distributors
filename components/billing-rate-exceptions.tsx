'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { readJsonResponse } from '@/lib/http-json';
import { formatRupees } from '@/lib/billing-sheet';
import type { RateExceptions } from '@/lib/rate-check';

export function BillingRateExceptions() {
  const [state, setState] = useState<{ data: RateExceptions | null; error: string; forbidden: boolean }>({ data: null, error: '', forbidden: false });
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/pricing?rateExceptions=1', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (response.status === 403) {
          if (!controller.signal.aborted) setState({ data: null, error: '', forbidden: true });
          return;
        }
        const data = await readJsonResponse<RateExceptions>(response, 'Bills could not load');
        if (!Array.isArray(data?.orders) || typeof data.checkedCount !== 'number') {
          if (!controller.signal.aborted) setState({ data: null, error: '', forbidden: true });
          return;
        }
        if (!controller.signal.aborted) setState({ data, error: '', forbidden: false });
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setState({ data: null, error: cause instanceof Error ? cause.message : 'Bills could not load', forbidden: false }); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [version]);
  if (state.forbidden) return null;
  return <section aria-label="Bills that differ from approved price" className="border-t border-sf-line-soft">
    <div className="flex items-center justify-between gap-3 px-4 pt-4">
      <h3 className="text-sm font-extrabold text-sf-strong">Bills that differ from approved price</h3>
      <button type="button" aria-label="Refresh bills that differ from approved price" onClick={() => { setLoading(true); setVersion((value) => value + 1); }} disabled={loading} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-sf-label hover:bg-sf-soft disabled:opacity-50"><RefreshCw aria-hidden="true" size={14} />Refresh</button>
    </div>
    {state.data ? <p className="px-4 pt-2 text-xs text-sf-muted">Checked the last {state.data.checkedCount} billed orders · differences over ₹1 per unit</p> : null}
    {loading ? <p className="p-4 text-sm text-sf-muted">Loading bills…</p>
      : state.error ? <p role="alert" className="p-4 text-sm text-sf-danger">{state.error}</p>
      : !state.data?.orders.length ? <p className="p-4 text-sm text-sf-muted">No billed order differs from its approved price.</p>
      : <div className="space-y-3 p-4">{state.data.orders.map((order) => <article key={order.orderId} aria-label={`${order.orderNumber}, ${order.customerName}`} className="min-w-0 [overflow-wrap:anywhere]">
        <p className="text-sm font-bold text-sf-strong">{order.customerName} · {order.orderNumber}</p>
        <p className="text-sm text-sf-danger">{order.differentCount} {order.differentCount === 1 ? 'item differs' : 'items differ'}{order.worstDifference !== null ? ` · worst ${formatRupees(Math.abs(order.worstDifference))} ${order.worstDifference < 0 ? 'lower' : 'higher'}` : ''}</p>
      </article>)}</div>}
  </section>;
}
