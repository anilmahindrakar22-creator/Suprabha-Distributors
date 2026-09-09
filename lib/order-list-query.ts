import type { OrderSummary, TallyInvoice } from './order-types';
import { filterOrders, isValidCalendarDate, orderMatchesCaptureDateRange, orderNeedsBillingAttention, pageItems } from './order-types';

export const orderListPageSize = 20;

export type OrderListQuery = {
  page: number;
  query: string;
  status: string;
  captureDate: string;
  captureDateTo?: string;
};

export function orderListUrl(query: OrderListQuery, exportAll = false) {
  const parameters = new URLSearchParams({
    [exportAll ? 'export' : 'list']: '1',
    page: String(query.page),
    status: query.status,
  });
  if (query.query) parameters.set('query', query.query);
  if (query.captureDate) parameters.set('date', query.captureDate);
  if (query.captureDateTo) parameters.set('dateTo', query.captureDateTo);
  return `/api/orders?${parameters.toString()}`;
}

const allowedStatuses = new Set([
  'all', 'open', 'history', 'billing', 'billing_attention', 'picking', 'dispatch_ready', 'delivery_due_today', 'delivery_due_soon', 'back_ordered', 'delivery_exception', 'overdue', 'attention',
  'phone_order_received', 'awaiting_confirmation', 'awaiting_approval', 'confirmed', 'packed',
  'awaiting_tally_billing', 'billed_in_tally', 'ready_for_dispatch', 'dispatched',
  'delivered', 'cancelled',
]);

export function parseOrderListQuery(parameters: URLSearchParams): OrderListQuery | null {
  const rawPage = parameters.get('page') || '1';
  const page = Number(rawPage);
  const query = (parameters.get('query') || '').trim();
  const status = parameters.get('status') || 'open';
  const captureDate = parameters.get('date') || '';
  const captureDateTo = parameters.get('dateTo') || '';
  if (!Number.isInteger(page) || page < 1 || page > 10_000) return null;
  if (query.length > 220 || !allowedStatuses.has(status)) return null;
  if (captureDate && !isValidCalendarDate(captureDate)) return null;
  if (captureDateTo && (!captureDate || !isValidCalendarDate(captureDateTo) || captureDateTo < captureDate)) return null;
  return { page, query, status, captureDate, captureDateTo };
}

export function queryOrderList(orders: OrderSummary[], query: OrderListQuery) {
  const matching = matchingOrderList(orders, query);
  const result = pageItems(matching, query.page, orderListPageSize);
  return {
    orders: result.items,
    pagination: {
      page: result.page,
      pageCount: result.pageCount,
      pageSize: orderListPageSize,
      total: matching.length,
    },
  };
}

export function matchingOrderList(orders: OrderSummary[], query: OrderListQuery) {
  return filterOrders(orders, query.query, query.status)
    .filter((order) => orderMatchesCaptureDateRange(order, query.captureDate, query.captureDateTo || ''));
}

export function queryBillingAttentionList(orders: OrderSummary[], invoices: TallyInvoice[], snapshotFetchedAt: string, page: number, now = new Date()) {
  const matching = orders.filter((order) => orderNeedsBillingAttention(order, invoices, now, snapshotFetchedAt));
  const result = pageItems(matching, page, orderListPageSize);
  return {
    orders: result.items,
    pagination: { page: result.page, pageCount: result.pageCount, pageSize: orderListPageSize, total: matching.length },
  };
}
