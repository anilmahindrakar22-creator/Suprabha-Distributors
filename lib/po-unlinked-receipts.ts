export type UnlinkedReceipt = {
  sourceId: string; lineKey: string; date: string; reference: string;
  itemKey: string; itemName: string; quantity: number; linkedQuantity: number;
  unlinkedQuantity: number; unit: string | null;
  openPo: { id: string; poNumber: string; stillDue: number } | null;
};
export type UnlinkedReceipts = { page: number; pageSize: number; total: number; rows: UnlinkedReceipt[] };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const integer = (value: unknown): value is number => number(value) && Number.isSafeInteger(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalid = () => new Error('Invalid unlinked receipts response');

export function parseUnlinkedReceipts(value: unknown): UnlinkedReceipts {
  if (!record(value) || !exact(value, ['page', 'pageSize', 'total', 'rows']) ||
    !integer(value.page) || value.page < 1 || value.page > 100 || value.pageSize !== 20 ||
    !integer(value.total) || !Array.isArray(value.rows) || value.rows.length > 20) throw invalid();
  const rows = value.rows.map((row): UnlinkedReceipt => {
    if (!record(row) || !exact(row, ['sourceId', 'lineKey', 'date', 'reference', 'itemKey', 'itemName',
      'quantity', 'linkedQuantity', 'unlinkedQuantity', 'unit', 'openPo']) ||
      !text(row.sourceId) || !row.sourceId || !text(row.lineKey) || !row.lineKey ||
      !text(row.date) || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(Date.parse(row.date)) ||
      new Date(row.date).toISOString().slice(0, 10) !== row.date || !text(row.reference) ||
      !text(row.itemKey) || !row.itemKey || !text(row.itemName) || !number(row.quantity) ||
      !number(row.linkedQuantity) || !number(row.unlinkedQuantity) || row.unlinkedQuantity <= 0 ||
      !(row.unit === null || text(row.unit))) throw invalid();
    const po = row.openPo;
    if (po !== null && (!record(po) || !exact(po, ['id', 'poNumber', 'stillDue']) ||
      !text(po.id) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(po.id) ||
      !text(po.poNumber) || !number(po.stillDue) || po.stillDue <= 0)) throw invalid();
    return { sourceId: row.sourceId, lineKey: row.lineKey, date: row.date, reference: row.reference,
      itemKey: row.itemKey, itemName: row.itemName, quantity: row.quantity, linkedQuantity: row.linkedQuantity,
      unlinkedQuantity: row.unlinkedQuantity, unit: row.unit, openPo: po as UnlinkedReceipt['openPo'] };
  });
  return { page: value.page, pageSize: value.pageSize, total: value.total, rows };
}
