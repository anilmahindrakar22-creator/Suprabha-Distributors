import { describe, expect, it } from 'vitest';
import { parseUnlinkedReceipts } from '../../lib/po-unlinked-receipts';

const body = () => ({ page: 1, pageSize: 20, total: 1, rows: [{
  sourceId: 'purchase-1', lineKey: '1', date: '2026-11-19', reference: 'Bill 1',
  itemKey: 'item', itemName: 'Item', quantity: 12, linkedQuantity: 10, unlinkedQuantity: 2,
  unit: null, openPo: { id: 'fa000000-0000-4000-8000-000000000001', poNumber: 'PO-1', stillDue: 4 },
}] });
describe('unlinked receipts parser', () => {
  it('parses a valid body and a null PO', () => {
    expect(parseUnlinkedReceipts(body())).toEqual(body());
    const value = body();
    expect(parseUnlinkedReceipts({ ...value, rows: [{ ...value.rows[0], openPo: null }] }).rows[0].openPo).toBeNull();
  });
  it('rejects extra row keys including money', () => {
    const value = body();
    expect(() => parseUnlinkedReceipts({ ...value, rows: [{ ...value.rows[0], amount: 100 }] })).toThrow();
  });
  it('rejects zero unlinked quantity', () => {
    const value = body(); value.rows[0].unlinkedQuantity = 0;
    expect(() => parseUnlinkedReceipts(value)).toThrow();
  });
  it.each([{ id: 'bad' }, { stillDue: 0 }, { stillDue: Infinity }, { amount: 1 }, { poNumber: 1 }])('rejects a bad open PO: %j', patch => {
    const value = body();
    expect(() => parseUnlinkedReceipts({ ...value, rows: [{ ...value.rows[0], openPo: { ...value.rows[0].openPo, ...patch } }] })).toThrow();
  });
  it.each([
    { extra: true }, { page: 0 }, { pageSize: 10 }, { total: 1.5 },
    { rows: [{ ...body().rows[0], date: '2026-02-30' }] },
    { rows: [{ ...body().rows[0], linkedQuantity: -1 }] },
    { rows: [{ ...body().rows[0], quantity: NaN }] },
  ])('rejects invalid metadata and fields: %j', patch => {
    expect(() => parseUnlinkedReceipts({ ...body(), ...patch })).toThrow();
  });
});
