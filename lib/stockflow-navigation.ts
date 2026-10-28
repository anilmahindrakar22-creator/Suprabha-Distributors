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

export function readRequestsDashboardMessage(value: unknown): RequestsDashboardMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (Object.keys(message).length !== 2 ||
      !Object.hasOwn(message, 'type') || !Object.hasOwn(message, 'section') ||
      message.type !== 'stockflow-open-requests' || message.section !== 'to-order') return null;
  return { type: 'stockflow-open-requests', section: 'to-order' };
}
