import type { OrderPricingWorkspace } from '@/lib/pricing-types';

export type PriceApprovalSummary = {
  exceptionId: string;
  itemName: string;
  quantity: number;
  rate: number;
  lineTotal: number;
  /** Most recent distinct bills to this customer, newest first (at most three). */
  recentBills: Array<{ rate: number; date: string; reference: string }>;
  /** Positive when the price is below the latest bill. */
  belowLatestBill: number | null;
  cost: { amount: number; date: string; reference: string } | null;
  marginPercent: number | null;
  marginAmount: number | null;
  minimumMarginPercent: number | null;
  marginTone: 'ok' | 'below_minimum' | 'loss' | 'unknown';
  mixedHistory: boolean;
  reason: string;
  requestedBy: string;
  requestedAt: string;
};

/** Everything an approver needs to decide on each pending order price, from the pricing workspace. */
export function priceApprovalSummaries(workspace: OrderPricingWorkspace | null): PriceApprovalSummary[] {
  if (!workspace) return [];
  return workspace.exceptions.map((exception) => {
    const line = workspace.lines.find((candidate) => candidate.lineId === exception.lineId);
    const quantity = Number(line?.quantity ?? 0);
    const rate = Number(exception.enteredRate);
    const seen = new Set<string>();
    const recentBills = (line?.recentRates ?? [])
      .filter((bill) => Number.isFinite(Number(bill.rate)))
      .slice()
      .sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate))
      .filter((bill) => {
        const key = `${bill.invoiceReference}|${bill.rate}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 3)
      .map((bill) => ({ rate: Number(bill.rate), date: bill.invoiceDate, reference: bill.invoiceReference }));
    const latest = recentBills[0]?.rate;
    const costAmount = line?.cost?.amount ?? line?.currentCost ?? null;
    const cost = costAmount == null ? null : { amount: Number(costAmount), date: line?.cost?.effectiveAt ?? '', reference: line?.cost?.sourceReference ?? '' };
    const marginAmount = cost && rate > 0 ? rate - cost.amount : null;
    const marginPercent = marginAmount != null ? Math.round((marginAmount / rate) * 1000) / 10 : null;
    const minimumMarginPercent = line?.policy?.minimumMarginPercent ?? null;
    const marginTone = marginPercent == null ? 'unknown' : marginPercent < 0 ? 'loss' : minimumMarginPercent != null && marginPercent < minimumMarginPercent ? 'below_minimum' : 'ok';
    return {
      exceptionId: exception.id,
      itemName: line?.itemName ?? 'Order line',
      quantity,
      rate,
      lineTotal: rate * quantity,
      recentBills,
      belowLatestBill: latest != null && latest > rate ? latest - rate : null,
      cost,
      marginPercent,
      marginAmount,
      minimumMarginPercent,
      marginTone,
      mixedHistory: new Set(recentBills.map((bill) => bill.rate)).size > 1 || Boolean(line?.warnings?.includes('AMBIGUOUS_SALES_HISTORY')),
      reason: exception.reason,
      requestedBy: exception.requestedBy,
      requestedAt: exception.requestedAt,
    };
  });
}
