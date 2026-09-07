import { describe, expect, it } from 'vitest';
import { orderListPageSize, parseOrderListQuery, queryOrderList } from '../../lib/order-list-query';
import type { OrderSummary } from '../../lib/order-types';

function order(index: number, overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    id: String(index), orderNumber: `SF-${index}`, customerName: `Customer ${index}`,
    customerPhone: null, status: 'phone_order_received', source: 'phone', notes: null,
    version: 1, createdAt: `2026-09-07T${String(index % 24).padStart(2, '0')}:00:00+05:30`,
    updatedAt: '2026-09-07T12:00:00+05:30', lineCount: 1, totalQuantity: 1,
    reservedQuantity: 0, tallyInvoiceNumber: null, lines: [{ tallyKey: `I-${index}`, itemName: `Item ${index}`, itemGroup: null, baseUnit: 'Nos', quantity: 1, reservedQuantity: 0 }],
    events: [], exceptions: [], installations: [], ...overrides,
  };
}

describe('bounded order list query', () => {
  it('accepts known filters and rejects abusive or malformed inputs', () => {
    expect(parseOrderListQuery(new URLSearchParams('page=2&status=history&query=lab&date=2026-09-07'))).toEqual({ page: 2, status: 'history', query: 'lab', captureDate: '2026-09-07' });
    expect(parseOrderListQuery(new URLSearchParams('page=0'))).toBeNull();
    expect(parseOrderListQuery(new URLSearchParams('status=unknown'))).toBeNull();
    expect(parseOrderListQuery(new URLSearchParams(`query=${'x'.repeat(121)}`))).toBeNull();
    expect(parseOrderListQuery(new URLSearchParams('date=07-09-2026'))).toBeNull();
  });

  it('returns only one page while retaining the full matching count', () => {
    const orders = Array.from({ length: 45 }, (_, index) => order(index + 1));
    const result = queryOrderList(orders, { page: 2, query: '', status: 'open', captureDate: '' });
    expect(result.orders).toHaveLength(orderListPageSize);
    expect(result.orders[0]?.orderNumber).toBe('SF-21');
    expect(result.pagination).toEqual({ page: 2, pageCount: 3, pageSize: 20, total: 45 });
  });

  it('searches product and invoice fields before pagination', () => {
    const orders = [order(1), order(2, { tallyInvoiceNumber: 'SD/26-27/0552' }), order(3, { lines: [{ tallyKey: 'P', itemName: 'Penicillin Kit', itemGroup: null, baseUnit: 'Nos', quantity: 1, reservedQuantity: 0 }] })];
    expect(queryOrderList(orders, { page: 1, query: '0552', status: 'all', captureDate: '' }).pagination.total).toBe(1);
    expect(queryOrderList(orders, { page: 1, query: 'penicillin', status: 'all', captureDate: '' }).orders[0]?.orderNumber).toBe('SF-3');
  });
});
