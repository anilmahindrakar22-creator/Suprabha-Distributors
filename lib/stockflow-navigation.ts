export type OrderDashboardMessage = {
  type: 'stockflow-open-orders';
  status: string;
};

export function defaultOrderFilterForRole(role: string) {
  if (role === 'administrator' || role === 'management') return 'awaiting_confirmation';
  if (role === 'accounts') return 'billing';
  if (role === 'warehouse') return 'picking';
  return 'open';
}

const allowedOrderFilters = new Set([
  'all',
  'attention',
  'awaiting_confirmation',
  'awaiting_approval',
  'billing',
  'dispatch_ready',
  'packed',
  'picking',
  'dispatched',
  'overdue',
]);

export function readOrderDashboardMessage(value: unknown): OrderDashboardMessage | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if (message.type !== 'stockflow-open-orders' || typeof message.status !== 'string') return null;
  return allowedOrderFilters.has(message.status)
    ? { type: 'stockflow-open-orders', status: message.status }
    : null;
}

export type RequestsDashboardMessage = {
  type: 'stockflow-open-requests';
  section: 'to-order';
};

export type StockPoDraftItem = { itemKey: string; quantity: number };
export type StockPoDraftMessage = { type: 'stockflow-create-po'; items: StockPoDraftItem[] };
export const STOCK_PO_DRAFT_MAX = 50;

export function readOpenCustomerMessage(value: unknown): { type: 'stockflow-open-customer'; customerId: string } | null {
  if (!value || typeof value !== 'object' ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return null;
  const message = value as Record<string, unknown>;
  if (Reflect.ownKeys(message).length !== 2 || !Object.hasOwn(message, 'type') || !Object.hasOwn(message, 'customerId') ||
    message.type !== 'stockflow-open-customer' || typeof message.customerId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(message.customerId)) return null;
  return { type: 'stockflow-open-customer', customerId: message.customerId };
}

export function readStockPoDraftMessage(value: unknown): StockPoDraftMessage | null {
  const plain = (input: unknown): input is Record<string, unknown> => !!input && typeof input === 'object'
    && (Object.getPrototypeOf(input) === Object.prototype || Object.getPrototypeOf(input) === null);
  if (!plain(value) || Reflect.ownKeys(value).length !== 2 || !Object.hasOwn(value, 'type')
    || !Object.hasOwn(value, 'items') || value.type !== 'stockflow-create-po'
    || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > STOCK_PO_DRAFT_MAX) return null;
  const items: StockPoDraftItem[] = [];
  const seen = new Set<string>();
  for (const item of value.items) {
    if (!plain(item) || Reflect.ownKeys(item).length !== 2 || !Object.hasOwn(item, 'itemKey')
      || !Object.hasOwn(item, 'quantity') || typeof item.itemKey !== 'string' || !item.itemKey.trim()
      || item.itemKey.length > 220 || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity)
      || item.quantity <= 0 || item.quantity > 1_000_000 || seen.has(item.itemKey)) return null;
    seen.add(item.itemKey);
    items.push({ itemKey: item.itemKey, quantity: item.quantity });
  }
  return { type: 'stockflow-create-po', items };
}

export function readRequestsDashboardMessage(value: unknown): RequestsDashboardMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (Object.keys(message).length !== 2 ||
      !Object.hasOwn(message, 'type') || !Object.hasOwn(message, 'section') ||
      message.type !== 'stockflow-open-requests' || message.section !== 'to-order') return null;
  return { type: 'stockflow-open-requests', section: 'to-order' };
}
