import { ShieldAlert } from 'lucide-react';
import { orderDateTime } from '@/lib/order-date';
import { priceApprovalSummaries } from '@/lib/price-approval-summary';
import type { OrderPricingWorkspace } from '@/lib/pricing-types';

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const shortDate = (value: string) => value ? new Date(`${value.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }) : '';
/** The facts an approver needs before tapping Approve: price, recent bills to this customer, cost and margin. */
export function PriceApprovalCard({ workspace }: { workspace: OrderPricingWorkspace }) {
  const summaries = priceApprovalSummaries(workspace);
  if (!summaries.length) return null;
  return <section aria-label="Price waiting for approval" className="mt-3 space-y-3">
    {summaries.map((item) => {
      const marginClass = item.marginTone === 'loss' ? 'text-sf-danger' : item.marginTone === 'below_minimum' ? 'text-sf-warning' : item.marginTone === 'ok' ? 'text-sf-success' : 'text-sf-muted';
      return <article key={item.exceptionId} className="rounded-xl border border-sf-warning-line bg-white p-4">
        <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-sf-warning"><ShieldAlert aria-hidden="true" size={14} />Price waiting for approval</p>
        <h3 className="mt-2 font-bold text-sf-ink">{item.itemName}</h3>
        <p className="mt-1 text-sm text-sf-muted"><strong className="text-xl font-extrabold text-sf-ink">{rupees.format(item.rate)}</strong> per unit · {Math.round(Number(item.quantity || 0)).toLocaleString('en-IN')} qty{item.quantity > 1 ? ` · ${rupees.format(item.lineTotal)} total` : ''}</p>
        <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs font-bold text-sf-subtle">Recent bills to this customer</dt><dd className="mt-1">{item.recentBills.length ? <ul className="space-y-0.5">{item.recentBills.map((bill) => <li key={`${bill.reference}-${bill.rate}`} className="tabular-nums text-sf-strong"><strong>{rupees.format(bill.rate)}</strong> <span className="text-sf-subtle">· {shortDate(bill.date)} · {bill.reference}</span></li>)}</ul> : <span className="text-sf-muted">No earlier bills for this item</span>}
            {item.belowLatestBill ? <p className="mt-1 text-xs font-bold text-sf-warning">{rupees.format(item.belowLatestBill)} below the latest bill</p> : item.mixedHistory ? <p className="mt-1 text-xs font-bold text-sf-label">Billed at different rates recently</p> : null}</dd></div>
          <div><dt className="text-xs font-bold text-sf-subtle">Margin at this price</dt><dd className="mt-1">{item.marginPercent == null ? <span className="text-sf-muted">No purchase cost on record</span> : <><strong className={`tabular-nums ${marginClass}`}>{item.marginPercent.toFixed(1)}%</strong> <span className="text-sf-subtle">· {rupees.format(item.marginAmount ?? 0)} per unit</span>
            {item.marginTone === 'below_minimum' ? <p className="text-xs font-bold text-sf-warning">Below the {item.minimumMarginPercent}% minimum</p> : item.marginTone === 'loss' ? <p className="text-xs font-bold text-sf-danger">Below purchase cost</p> : null}
            {item.cost ? <p className="text-xs text-sf-subtle">Cost {rupees.format(item.cost.amount)}{item.cost.reference ? ` · bill ${item.cost.reference}` : ''}{item.cost.date ? ` · ${shortDate(item.cost.date)}` : ''}</p> : null}</>}</dd></div>
        </dl>
        <p className="mt-3 border-t border-sf-line-soft pt-3 text-sm text-sf-body"><span className="font-bold">Reason:</span> {item.reason}</p>
        <p className="mt-1 text-xs text-sf-subtle">Requested by {item.requestedBy} · {orderDateTime(item.requestedAt)}</p>
      </article>;
    })}
  </section>;
}
