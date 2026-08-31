export type CatalogItem = {
  tallyKey: string;
  item: string;
  group: string;
  baseUnit: string;
  closing: number;
  active: boolean;
};

export type CustomerDirectoryEntry = {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  tallyKey: string | null;
};

export type OrderSummary = {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string | null;
  status: string;
  source: string;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  lineCount: number;
  totalQuantity: number;
  reservedQuantity: number;
  tallyInvoiceNumber: string | null;
  lines: OrderLineSummary[];
};

export type OrderLineSummary = {
  tallyKey: string;
  itemName: string;
  itemGroup: string | null;
  baseUnit: string | null;
  quantity: number;
  reservedQuantity: number;
};

export type OrderBootstrap = {
  actor: { email: string; role: string };
  snapshot: { company: string; fetchedAt: string; catalog: CatalogItem[] };
  customers: CustomerDirectoryEntry[];
  orders: OrderSummary[];
  operations: Record<string, number>;
};

export function searchCustomers(
  customers: CustomerDirectoryEntry[],
  input: string,
  limit = 8,
) {
  const query = input.trim().toLocaleLowerCase('en-IN');
  if (!query) return [];
  return customers
    .filter((customer) =>
      [customer.name, customer.phone, customer.city, customer.tallyKey]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('en-IN').includes(query)),
    )
    .slice(0, limit);
}

export function searchCatalog(
  catalog: CatalogItem[],
  input: string,
  excludedTallyKeys: ReadonlySet<string> = new Set(),
  limit = 8,
) {
  const query = input.trim().toLocaleLowerCase('en-IN');
  if (!query) return [];
  return catalog
    .filter(
      (item) =>
        item.active &&
        !excludedTallyKeys.has(item.tallyKey) &&
        `${item.item} ${item.group}`.toLocaleLowerCase('en-IN').includes(query),
    )
    .slice(0, limit);
}

export function orderStage(status: string) {
  if (['phone_order_received', 'awaiting_confirmation', 'awaiting_approval'].includes(status)) return 'Confirmation';
  if (['confirmed', 'partially_reserved', 'fully_reserved'].includes(status)) return 'Stock allocation';
  if (['ready_for_picking', 'picked', 'packed'].includes(status)) return 'Pick & pack';
  if (['awaiting_tally_billing', 'billed_in_tally'].includes(status)) return 'Tally billing';
  if (['ready_for_dispatch', 'dispatched'].includes(status)) return 'Dispatch';
  if (status === 'delivered') return 'Delivered';
  if (status === 'cancelled') return 'Cancelled';
  return status.replaceAll('_', ' ');
}

export function filterOrders(orders: OrderSummary[], query: string, status: string) {
  const normalized = query.trim().toLocaleLowerCase('en-IN');
  return orders.filter((order) => {
    const searchable = [
      order.orderNumber,
      order.customerName,
      order.customerPhone,
      order.tallyInvoiceNumber,
      ...(order.lines || []).map((line) => line.itemName),
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('en-IN');
    const matchesStatus =
      status === 'all' ||
      (status === 'open' && !['delivered', 'cancelled'].includes(order.status)) ||
      (status === 'history' && ['delivered', 'cancelled'].includes(order.status)) ||
      order.status === status;
    return matchesStatus && (!normalized || searchable.includes(normalized));
  });
}

export type OrderCommand =
  | {
      action: 'create_order';
      payload: {
        idempotencyKey: string;
        customerId?: string;
        customerName: string;
        customerPhone?: string;
        customerCity?: string;
        source: 'phone' | 'email' | 'whatsapp' | 'walk_in';
        notes?: string;
        lines: Array<{ tallyKey: string; quantity: number }>;
      };
    }
  | {
      action: 'transition_order';
      payload: {
        orderId: string;
        expectedVersion: number;
        toStatus: string;
        reason?: string;
        tallyInvoiceNumber?: string;
      };
    }
  | {
      action: 'reserve_order';
      payload: { orderId: string; expectedVersion: number };
    };

export function validateOrderCommand(value: unknown): OrderCommand | null {
  if (!value || typeof value !== 'object') return null;
  const command = value as { action?: unknown; payload?: unknown };
  if (
    !['create_order', 'transition_order', 'reserve_order'].includes(
      String(command.action),
    ) ||
    !command.payload ||
    typeof command.payload !== 'object'
  ) {
    return null;
  }

  const payload = command.payload as Record<string, unknown>;
  if (command.action === 'create_order') {
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    const validLines =
      lines.length >= 1 &&
      lines.length <= 50 &&
      lines.every(
        (line) =>
          Boolean(line) &&
          typeof line === 'object' &&
          typeof (line as Record<string, unknown>).tallyKey === 'string' &&
          Number.isFinite(Number((line as Record<string, unknown>).quantity)) &&
          Number((line as Record<string, unknown>).quantity) > 0,
      );
    if (
      typeof payload.idempotencyKey !== 'string' ||
      payload.idempotencyKey.length < 16 ||
      typeof payload.customerName !== 'string' ||
      payload.customerName.trim().length < 2 ||
      !validLines
    ) {
      return null;
    }
  } else if (
    typeof payload.orderId !== 'string' ||
    !Number.isInteger(Number(payload.expectedVersion)) ||
    (command.action === 'transition_order' &&
      typeof payload.toStatus !== 'string')
  ) {
    return null;
  }

  return command as OrderCommand;
}
