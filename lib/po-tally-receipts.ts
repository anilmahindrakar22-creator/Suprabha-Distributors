export type TallyReceiptCandidate = {
  sourceId: string; lineKey: string; date: string; reference: string;
  quantity: number; unit: string; selectable: boolean;
  reason: 'unit_mismatch' | 'exceeds_remaining' | null;
};
export type TallyReceiptLine = {
  itemKey: string; itemName: string; unit: string | null; quantity: number;
  receivedQuantity: number; remaining: number; candidates: TallyReceiptCandidate[];
};
export type TallyReceipts = { poId: string; version: number; lines: TallyReceiptLine[] };
export type TallyReceiptLink = { itemKey: string; sourceId: string; lineKey: string };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const invalid = () => new Error('Invalid Tally receipts response');

export function parseTallyReceiptCounts(value: unknown): { counts: Record<string, number> } {
  if (!record(value) || !record(value.counts)) throw invalid();
  const counts: Record<string, number> = {};
  for (const [id, count] of Object.entries(value.counts)) {
    if (!id || !number(count) || !Number.isSafeInteger(count)) throw invalid();
    Object.defineProperty(counts, id, { value: count, enumerable: true });
  }
  return { counts };
}

function candidate(value: unknown): TallyReceiptCandidate {
  if (!record(value) || !text(value.sourceId) || !value.sourceId || !text(value.lineKey) || !value.lineKey ||
    !text(value.date) || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) ||
    !Number.isFinite(Date.parse(value.date)) || new Date(value.date).toISOString().slice(0, 10) !== value.date ||
    !text(value.reference) || !number(value.quantity) || value.quantity <= 0 || !text(value.unit) ||
    typeof value.selectable !== 'boolean' || (value.reason !== null && value.reason !== 'unit_mismatch' && value.reason !== 'exceeds_remaining') ||
    (value.selectable !== (value.reason === null))) throw invalid();
  return { sourceId: value.sourceId, lineKey: value.lineKey, date: value.date, reference: value.reference,
    quantity: value.quantity, unit: value.unit, selectable: value.selectable, reason: value.reason };
}

export function parseTallyReceipts(value: unknown): TallyReceipts {
  if (!record(value) || !text(value.poId) || !value.poId || !number(value.version) || !Number.isSafeInteger(value.version) || value.version < 1 || !Array.isArray(value.lines)) throw invalid();
  const keys = new Set<string>();
  const lines = value.lines.map((line): TallyReceiptLine => {
    if (!record(line) || !text(line.itemKey) || !line.itemKey || keys.has(line.itemKey) || !text(line.itemName) ||
      !(line.unit === null || text(line.unit)) || !number(line.quantity) || line.quantity <= 0 ||
      !number(line.receivedQuantity) || !number(line.remaining) || !Array.isArray(line.candidates)) throw invalid();
    keys.add(line.itemKey);
    const candidates = line.candidates.map(candidate);
    const identities = new Set(candidates.map((entry) => JSON.stringify([entry.sourceId, entry.lineKey])));
    if (identities.size !== candidates.length) throw invalid();
    return { itemKey: line.itemKey, itemName: line.itemName, unit: line.unit, quantity: line.quantity,
      receivedQuantity: line.receivedQuantity, remaining: line.remaining, candidates };
  });
  return { poId: value.poId, version: value.version, lines };
}

export function defaultSelection(lines: TallyReceiptLine[]): TallyReceiptLink[] {
  return lines.flatMap((line) => {
    const selectable = line.candidates.filter((entry) => entry.selectable);
    return selectable.length === 1 ? [{ itemKey: line.itemKey, sourceId: selectable[0].sourceId, lineKey: selectable[0].lineKey }] : [];
  });
}
