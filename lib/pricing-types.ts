const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export type PricingLineResolution = {
  lineId: string;
  tallyKey: string;
  itemName: string;
  quantity: number;
  resolution: 'APPROVED_CONTRACT_PRICE' | 'LAST_TALLY_INVOICE_PRICE' | 'NO_PRICE_HISTORY' | 'PRICE_REVIEW_REQUIRED';
  guardrail: 'PRICE_OK' | 'COST_INCREASE' | 'PRICE_REVIEW_REQUIRED';
  proposedRate: number | null;
  source: { type: 'APPROVED_CONTRACT' | 'LAST_TALLY_INVOICE' | 'NONE'; reference: string | null; date: string | null; version: string | null };
  recentRates: Array<{ rate: number; invoiceDate: string; invoiceReference: string; sourceVersion: string }>;
  cost: null | { id: string; amount: number; kind: string; effectiveAt: string; sourceReference: string; sourceVersion: string; previousAmount: number | null; changeAmount: number | null; changePercent: number | null };
  margin: { grossProfitAmount: number | null; grossMarginPercent: number | null; previousGrossMarginPercent: number | null; erosionPercentagePoints: number | null };
  suggestion: null | { amount: number; unroundedAmount: number; targetMarginPercent: number; policyVersion: string; roundingRuleVersion: string; costSourceVersion: string };
  warnings: string[];
};

export type OrderPricingWorkspace = {
  orderId: string;
  orderNumber: string;
  customerId: string | null;
  customerName: string;
  orderVersion: number;
  pricingState: 'review_required' | 'approval_required' | 'approved' | 'invalidated';
  currentSnapshotId: string | null;
  lines: PricingLineResolution[];
  exceptions: Array<{ id: string; lineId: string; referenceRate: number | null; enteredRate: number; differenceAmount: number | null; differencePercent: number | null; reason: string; state: 'pending'; requestedBy: string; requestedAt: string; version: number }>;
};

export type CustomerPriceContract = {
  id: string;
  customerId: string;
  customerName: string;
  tallyKey: string;
  price: number;
  currency: 'INR';
  validFrom: string;
  validTo: string | null;
  status: 'draft' | 'pending_approval' | 'approved' | 'superseded' | 'rejected' | 'cancelled';
  source: 'customer_contract' | 'quotation' | 'scheme' | 'tender' | 'manual_governed';
  sourceReference: string | null;
  reason: string;
  approvedBy: string | null;
  approvedAt: string | null;
  version: number;
  supersedesPriceId: string | null;
  createdBy: string;
  createdAt: string;
};

export type PricingCommand =
  | { action: 'submit_order_pricing'; payload: { orderId: string; expectedVersion: number; pricingDate?: string; idempotencyKey: string; lines: Array<{ lineId: string; enteredRate: number; reason?: string }> } }
  | { action: 'approve_price_exception' | 'reject_price_exception'; payload: { exceptionId: string; expectedVersion: number; reason: string; idempotencyKey: string } }
  | { action: 'create_price_contract'; payload: { customerId: string; tallyKey: string; price: number; validFrom: string; validTo?: string; source: 'customer_contract' | 'quotation' | 'scheme' | 'tender' | 'manual_governed'; sourceReference?: string; reason: string; supersedesPriceId?: string; idempotencyKey: string } }
  | { action: 'approve_price_contract' | 'reject_price_contract'; payload: { contractId: string; expectedVersion: number; reason: string; idempotencyKey: string } };

function validKey(value: unknown) {
  return typeof value === 'string' && value.trim().length >= 16 && value.length <= 200;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

function exactObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function validatePricingCommand(value: unknown): PricingCommand | null {
  const command = exactObject(value);
  const payload = exactObject(command?.payload);
  if (!command || !payload || !validKey(payload.idempotencyKey)) return null;
  if (command.action === 'submit_order_pricing') {
    if (!isUuid(payload.orderId) || !Number.isInteger(payload.expectedVersion) || Number(payload.expectedVersion) < 1) return null;
    if (payload.pricingDate !== undefined && (typeof payload.pricingDate !== 'string' || !datePattern.test(payload.pricingDate))) return null;
    if (!Array.isArray(payload.lines) || payload.lines.length < 1 || payload.lines.length > 100) return null;
    const lines = payload.lines.map(exactObject);
    if (lines.some((line) => !line || !isUuid(line.lineId) || typeof line.enteredRate !== 'number' || !Number.isFinite(line.enteredRate) || line.enteredRate <= 0 || line.enteredRate > 100_000_000 || (line.reason !== undefined && (typeof line.reason !== 'string' || line.reason.trim().length > 1000)))) return null;
    return command as unknown as PricingCommand;
  }
  if (command.action === 'approve_price_exception' || command.action === 'reject_price_exception') {
    if (!isUuid(payload.exceptionId) || !Number.isInteger(payload.expectedVersion) || Number(payload.expectedVersion) < 1 || typeof payload.reason !== 'string' || payload.reason.trim().length < 3 || payload.reason.length > 1000) return null;
    return command as unknown as PricingCommand;
  }
  if (command.action === 'create_price_contract') {
    const sources = ['customer_contract', 'quotation', 'scheme', 'tender', 'manual_governed'];
    if (!isUuid(payload.customerId) || typeof payload.tallyKey !== 'string' || payload.tallyKey.trim().length < 1 || payload.tallyKey.length > 240 || typeof payload.price !== 'number' || !Number.isFinite(payload.price) || payload.price <= 0 || payload.price > 100_000_000 || typeof payload.validFrom !== 'string' || !datePattern.test(payload.validFrom) || (payload.validTo !== undefined && (typeof payload.validTo !== 'string' || !datePattern.test(payload.validTo) || payload.validTo < payload.validFrom)) || typeof payload.source !== 'string' || !sources.includes(payload.source) || typeof payload.reason !== 'string' || payload.reason.trim().length < 3 || payload.reason.length > 1000 || (payload.supersedesPriceId !== undefined && !isUuid(payload.supersedesPriceId))) return null;
    return command as unknown as PricingCommand;
  }
  if (command.action === 'approve_price_contract' || command.action === 'reject_price_contract') {
    if (!isUuid(payload.contractId) || !Number.isInteger(payload.expectedVersion) || Number(payload.expectedVersion) < 1 || typeof payload.reason !== 'string' || payload.reason.trim().length < 3 || payload.reason.length > 1000) return null;
    return command as unknown as PricingCommand;
  }
  return null;
}

export function validPriceContractLookup(customerId: string | null, tallyKey: string | null) {
  return (!customerId || uuidPattern.test(customerId)) && (!tallyKey || tallyKey.trim().length <= 240);
}

export function validPricingLookup(orderId: string | null, pricingDate: string | null) {
  return Boolean(orderId && uuidPattern.test(orderId) && (!pricingDate || datePattern.test(pricingDate)));
}
