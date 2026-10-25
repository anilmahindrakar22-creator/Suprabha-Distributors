'use client';

import { useEffect, useState } from 'react';
import { CircleCheck, ClipboardCopy, ReceiptText } from 'lucide-react';
import { readJsonResponse } from '@/lib/http-json';
import type { OrderSummary } from '@/lib/order-types';
import { billingSheetText, formatBillingQuantity, formatRupees, type BillingSheet } from '@/lib/billing-sheet';

type State = { key: string; sheet: BillingSheet | null; error: string };

/** Everything the billing person needs to punch the Tally invoice, in one piece: approved prices only. */
export function BillingSheetPanel({ order }: { order: OrderSummary }) {
  const key = `${order.id}:${order.version}`;
  const [state, setState] = useState<State>({ key: '', sheet: null, error: '' });
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/pricing?orderId=${encodeURIComponent(order.id)}&view=billing`, { cache: 'no-store', signal: controller.signal })
      .then((response) => readJsonResponse<BillingSheet>(response, 'Billing details could not load'))
      .then((sheet) => { if (!controller.signal.aborted) setState({ key, sheet, error: '' }); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setState({ key, sheet: null, error: cause instanceof Error ? cause.message : 'Billing details could not load' }); });
    return () => controller.abort();
  }, [key, order.id]);
  const current = state.key === key ? state : { key, sheet: null, error: '' };
  const sheet = current.sheet;
  async function copy() {
    if (!sheet) return;
    try { await navigator.clipboard.writeText(billingSheetText(sheet)); setCopied(true); window.setTimeout(() => setCopied(false), 3000); }
    catch { setCopied(false); }
  }
  return <section aria-label="Billing sheet" className="mt-3 rounded-xl border border-sf-line bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-sf-label"><ReceiptText aria-hidden="true" size={14} />Billing sheet · approved prices before GST</p>
      {sheet?.ready ? <button type="button" onClick={() => void copy()} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-sf-line px-3 text-sm font-bold text-sf-body hover:bg-sf-soft">{copied ? <CircleCheck aria-hidden="true" size={16} className="text-sf-success" /> : <ClipboardCopy aria-hidden="true" size={16} />}{copied ? 'Copied' : 'Copy for Tally'}</button> : null}
    </div>
    {current.error ? <p role="alert" className="mt-3 text-sm text-sf-danger">{current.error}</p>
      : !sheet ? <p className="mt-3 text-sm text-sf-muted">Loading billing details…</p>
      : !sheet.ready ? <p className="mt-3 text-sm font-bold text-sf-warning">{sheet.reason || 'Billing details are not ready.'}</p>
      : <>
        <p className="mt-2 text-lg font-extrabold text-sf-ink">{sheet.customerName}</p>
        <p className="text-xs text-sf-subtle">{sheet.orderNumber}</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left text-sm">
            <thead className="text-xs text-sf-subtle"><tr><th className="py-2 pr-3 font-bold">Item</th><th className="py-2 pr-3 text-right font-bold">Quantity</th><th className="py-2 pr-3 text-right font-bold">Rate</th><th className="py-2 text-right font-bold">Amount</th></tr></thead>
            <tbody>{sheet.lines?.map((line) => <tr key={line.lineId} className="border-t border-sf-line-soft">
              <td className="py-2 pr-3 font-bold text-sf-strong">{line.itemName}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatBillingQuantity(line.billQuantity)}{line.unit ? ` ${line.unit}` : ''}{sheet.quantitySource === 'packed' && line.packedQuantity != null && Number(line.packedQuantity) !== Number(line.orderedQuantity) ? <span className="block text-xs text-sf-warning">ordered {formatBillingQuantity(line.orderedQuantity)}</span> : null}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatRupees(line.approvedRate)}</td>
              <td className="py-2 text-right font-bold tabular-nums">{formatRupees(line.amount)}</td>
            </tr>)}</tbody>
            <tfoot><tr className="border-t-2 border-sf-line"><td colSpan={3} className="py-2 pr-3 text-right font-bold text-sf-label">Total before GST</td><td className="py-2 text-right text-base font-extrabold tabular-nums text-sf-ink">{formatRupees(sheet.total ?? 0)}</td></tr></tfoot>
          </table>
        </div>
        {sheet.quantitySource === 'ordered' ? <p className="mt-2 text-xs font-bold text-sf-warning">Packed quantities were not recorded for this order, so the ordered quantities are shown. Check with packing before billing.</p> : <p className="mt-2 text-xs text-sf-subtle">Quantities are what was packed. Enter the Tally invoice number below once the bill is punched.</p>}
      </>}
  </section>;
}
