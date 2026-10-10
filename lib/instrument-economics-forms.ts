import type { EconomicsWorkspaceData } from '@/lib/instrument-economics-types';

type SourceLine = NonNullable<EconomicsWorkspaceData['sourceLines']>[number];
type AttributionLine = NonNullable<EconomicsWorkspaceData['attributionLines']>[number];
type FormValues = Record<string, unknown>;
export const maxEconomicEvidenceRows = 20;

function value(raw: FormValues, key: string): string {
  return typeof raw[key] === 'string' ? raw[key].trim() : '';
}

function quantityMicros(input: string): bigint {
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(input)) throw new Error('Enter a positive quantity with no more than six decimal places.');
  const [whole, fraction = ''] = input.split('.');
  const result = BigInt(whole) * BigInt(1000000) + BigInt(fraction.padEnd(6, '0'));
  if (result <= BigInt(0)) throw new Error('Enter a positive quantity with no more than six decimal places.');
  return result;
}

function rowIndices(raw: FormValues, prefix: string): number[] {
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  const rows = Object.keys(raw).flatMap(key => { const match = key.match(pattern); return match ? [Number(match[1])] : []; }).sort((a, b) => a - b);
  if (!rows.length || rows.length > maxEconomicEvidenceRows || rows.some((index, position) => index !== position)) throw new Error(`Enter between 1 and ${maxEconomicEvidenceRows} complete evidence rows.`);
  return rows;
}

export function compatiblePurchaseLines(sale: SourceLine | undefined, lines: SourceLine[]): SourceLine[] {
  if (!sale || sale.kind !== 'sale') return [];
  return lines.filter(line => line.kind === 'purchase' && line.companyId === sale.companyId && line.productId === sale.productId && line.unit === sale.unit
    && line.date <= sale.date && (sale.batchId == null || sale.batchId === line.batchId));
}

export type PurchaseMatchKind = 'none' | 'zero_value_only' | 'short_quantity' | 'single' | 'multiple';

export function purchaseMatchKind(sale: SourceLine, lines: SourceLine[]): PurchaseMatchKind {
  const purchases = compatiblePurchaseLines(sale, lines);
  if (!purchases.length) return 'none';
  const micros = (input: string) => { try { return quantityMicros(input); } catch { return BigInt(0); } };
  if (purchases.reduce((total, line) => total + micros(line.quantity), BigInt(0)) < micros(sale.quantity)) return 'short_quantity';
  if (purchases.every(line => BigInt(line.netSalesPaise) === BigInt(0))) return 'zero_value_only';
  return purchases.length === 1 ? 'single' : 'multiple';
}

export function costVerificationSaleLines(lines: SourceLine[], attributionLines: AttributionLine[] = []): SourceLine[] {
  const missing = new Set(attributionLines.filter(line => line.targetId && line.status === 'cost_unavailable' && line.costPaise == null).map(line => line.sourceLineId));
  return lines.filter(line => line.kind === 'sale' && Number(line.quantity) > 0 && missing.has(line.id))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.productName || a.productId).localeCompare(b.productName || b.productId) || a.id.localeCompare(b.id));
}

export function buildPurchaseAllocations(raw: FormValues, lines: SourceLine[]) {
  const sale = lines.find(line => line.id === value(raw, 'sourceLineId') && line.kind === 'sale');
  if (!sale) throw new Error('Choose a current sale to verify.');
  const eligible = compatiblePurchaseLines(sale, lines);
  const seen = new Set<string>(); let total = BigInt(0);
  const allocations = rowIndices(raw, 'purchaseLineId').map(index => {
    const purchaseLineId = value(raw, `purchaseLineId${index}`); const quantity = value(raw, `purchaseQuantity${index}`);
    const purchase = eligible.find(line => line.id === purchaseLineId);
    if (!purchase) throw new Error(`Choose compatible historical purchase evidence in row ${index + 1}.`);
    if (seen.has(purchaseLineId)) throw new Error('Use each purchase source only once.');
    seen.add(purchaseLineId);
    const amount = quantityMicros(quantity);
    if (amount > quantityMicros(purchase.quantity)) throw new Error(`Purchase quantity ${index + 1} exceeds the source quantity.`);
    total += amount;
    return { purchaseLineId, quantity };
  });
  if (total !== quantityMicros(sale.quantity)) throw new Error('Purchase allocations must cover the complete sale quantity exactly.');
  return allocations;
}

export function buildAllocationShares(raw: FormValues) {
  const seen = new Set<string>(); let total = 0;
  const shares = rowIndices(raw, 'allocationTargetId').map(index => {
    const targetId = value(raw, `allocationTargetId${index}`); const percent = value(raw, `allocationPercent${index}`);
    if (!targetId || seen.has(targetId)) throw new Error('Choose a different placement for each allocation row.');
    if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(percent)) throw new Error('Enter allocation percentages with no more than two decimal places.');
    const [whole, fraction = ''] = percent.split('.');
    const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (basisPoints < 1 || basisPoints > 10000) throw new Error('Each allocation share must be greater than zero and no more than 100%.');
    seen.add(targetId); total += basisPoints;
    return { targetId, basisPoints };
  });
  if (shares.length < 2 || total !== 10000) throw new Error('Allocation shares must total exactly 100%.');
  return shares;
}
