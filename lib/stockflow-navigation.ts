export type OrderDashboardMessage = {
  type: 'stockflow-open-orders';
  status: string;
};

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
