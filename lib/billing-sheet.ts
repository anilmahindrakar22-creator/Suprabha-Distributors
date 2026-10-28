/** Approved-price billing sheet (server view=billing): no cost, margin or price history. */
export type BillingSheet = {
  view: 'billing'; orderId: string; orderNumber: string; customerName: string; status: string;
  ready: boolean; reason?: string; total?: number;
  /** packed: amounts on packed quantities; ordered: packing quantities were never recorded. */
  quantitySource?: 'packed' | 'ordered';
  lines?: Array<{ lineId: string; itemName: string; unit: string | null; orderedQuantity: number; packedQuantity: number | null; billQuantity: number; approvedRate: number; amount: number }>;
};

export const BILLING_ROLES = ['administrator', 'management', 'accounts', 'billing'] as const;
export const BILLING_STATUSES = ['awaiting_tally_billing', 'billed_in_tally'] as const;

const rupees = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
const qty = (value: number) => Number(value).toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** Plain text the billing person pastes or reads while punching the Tally invoice. */
export function billingSheetText(sheet: BillingSheet) {
  if (!sheet.ready || !sheet.lines) return '';
  return [
    `Order: ${sheet.orderNumber}`,
    `Customer: ${sheet.customerName}`,
    ...sheet.lines.map((line) => `- ${line.itemName}: ${qty(line.billQuantity)}${line.unit ? ` ${line.unit}` : ''} × ${rupees(line.approvedRate)} = ${rupees(line.amount)}`),
    `Total before GST: ${rupees(sheet.total ?? 0)}`,
  ].join('\n');
}

export { rupees as formatRupees, qty as formatBillingQuantity };
