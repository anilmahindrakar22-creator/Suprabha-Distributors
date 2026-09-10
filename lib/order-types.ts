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
  tallyBalance?: number | null;
  balanceAsOf?: string | null;
};

export type OrderSummary = {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string | null;
  status: string;
  priority?: 'normal' | 'high' | 'urgent';
  assignedToEmail?: string | null;
  source: string;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  lineCount: number;
  totalQuantity: number;
  reservedQuantity: number;
  tallyInvoiceNumber: string | null;
  deliveryAddress?: string | null;
  expectedDeliveryDate?: string | null;
  courierName?: string | null;
  trackingNumber?: string | null;
  dispatchDate?: string | null;
  vehicleNumber?: string | null;
  deliveredAt?: string | null;
  receivedBy?: string | null;
  podReference?: string | null;
  lines: OrderLineSummary[];
  events: OrderEvent[];
  exceptions: DeliveryException[];
  installations: EquipmentInstallation[];
};

export type TallyInvoice = {
  voucherNumber: string;
  reference: string | null;
  party: string;
  date: string;
  masterId: string | null;
  lineItems?: Array<{ itemName: string; quantity: number }>;
};

export type TallyLineReconciliation = {
  state: 'not_billed' | 'identity_unverified' | 'awaiting_detail' | 'matched' | 'mismatch';
  differences: Array<{ itemName: string; orderedQuantity: number; invoicedQuantity: number }>;
};

export type EquipmentInstallation = {
  id: string;
  tallyKey: string;
  itemName: string;
  status: 'scheduled' | 'completed';
  scheduledDate: string;
  engineerEmail: string | null;
  siteContact: string | null;
  serialNumber: string | null;
  commissioningNotes: string | null;
  createdBy: string;
  createdAt: string;
  completedBy: string | null;
  completedAt: string | null;
};

export type DeliveryException = {
  id: string;
  category: 'delayed' | 'failed_delivery' | 'damaged' | 'wrong_item' | 'other';
  status: 'open' | 'resolved';
  summary: string;
  ownerEmail: string | null;
  resolution: string | null;
  createdBy: string;
  createdAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
};

export type OrderEvent = {
  id: number;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  actorEmail: string;
  actorRole: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type OrderLineSummary = {
  tallyKey: string;
  itemName: string;
  itemGroup: string | null;
  baseUnit: string | null;
  quantity: number;
  reservedQuantity: number;
  fulfilledQuantity?: number;
  batchNumber?: string | null;
  expiryDate?: string | null;
};

export type OrderBootstrap = {
  actor: { email: string; role: string };
  snapshot: { company: string; fetchedAt: string; catalogVersion?: string; catalog: CatalogItem[]; tallyInvoices?: TallyInvoice[] };
  customerVersion?: string;
  customers: CustomerDirectoryEntry[];
  orders: OrderSummary[];
  operations: Record<string, number>;
  pagination?: { page: number; pageCount: number; pageSize: number; total: number };
};

export function currentTallyFinancialYear(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric' }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const start = month >= 4 ? year : year - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}

export function tallyInvoiceReconciliationDetail(order: OrderSummary, invoices?: TallyInvoice[], now = new Date(), snapshotFetchedAt?: string) {
  if (!order.tallyInvoiceNumber) return { state: 'not_billed' as const, matchedVoucherNumber: null };
  if (!invoices) return { state: 'awaiting_sync' as const, matchedVoucherNumber: null };
  if (snapshotFetchedAt) {
    const snapshotTime = Date.parse(snapshotFetchedAt);
    const snapshotAge = now.getTime() - snapshotTime;
    if (!Number.isFinite(snapshotTime) || snapshotAge > 20 * 60_000 || snapshotAge < -5 * 60_000) return { state: 'verification_stale' as const, matchedVoucherNumber: null };
  }
  const ledger = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-IN');
  const references = order.tallyInvoiceNumber.split(',').map((value) => value.trim()).filter(Boolean);
  if (references.length === 0 || references.length > 5) return { state: 'unmatched' as const, matchedVoucherNumber: null };
  if (new Set(references.map((value) => value.toLocaleLowerCase('en-IN'))).size !== references.length) return { state: 'ambiguous' as const, matchedVoucherNumber: null };
  const matched: TallyInvoice[] = [];
  for (const reference of references) {
    const expected = reference.toLocaleLowerCase('en-IN');
    const numericExpected = /^\d+$/.test(expected) ? expected.replace(/^0+(?=\d)/, '') : null;
    const candidates = invoices.filter((item) => {
      if (!numericExpected && item.voucherNumber.trim().toLocaleLowerCase('en-IN') === expected) return true;
      if (!numericExpected) return false;
      const currentYearVoucher = item.voucherNumber.trim().toUpperCase().match(/^SD\/(\d{2}-\d{2})\/0*(\d+)$/);
      return currentYearVoucher?.[1] === currentTallyFinancialYear(now) && currentYearVoucher[2].replace(/^0+(?=\d)/, '') === numericExpected;
    });
    if (candidates.length === 0) return { state: 'unmatched' as const, matchedVoucherNumber: null };
    if (candidates.length > 1) return { state: 'ambiguous' as const, matchedVoucherNumber: null };
    matched.push(candidates[0]);
  }
  if (!ledger(order.customerName) || matched.some((invoice) => ledger(invoice.party || '') !== ledger(order.customerName))) return { state: 'customer_mismatch' as const, matchedVoucherNumber: null };
  return { state: 'verified' as const, matchedVoucherNumber: matched.map((invoice) => invoice.voucherNumber.trim()).join(', ') };
}

export function tallyInvoiceReconciliation(order: OrderSummary, invoices?: TallyInvoice[], now = new Date(), snapshotFetchedAt?: string) {
  return tallyInvoiceReconciliationDetail(order, invoices, now, snapshotFetchedAt).state;
}

function normalizedTallyItem(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-IN');
}

export function tallyInvoiceLineReconciliation(order: OrderSummary, invoices?: TallyInvoice[], now = new Date(), snapshotFetchedAt?: string): TallyLineReconciliation {
  if (!order.tallyInvoiceNumber) return { state: 'not_billed', differences: [] };
  const identity = tallyInvoiceReconciliationDetail(order, invoices, now, snapshotFetchedAt);
  if (identity.state !== 'verified' || !identity.matchedVoucherNumber || !invoices) return { state: 'identity_unverified', differences: [] };
  const matchedNumbers = new Set(identity.matchedVoucherNumber.split(',').map((value) => value.trim()));
  const matchedInvoices = invoices.filter((item) => matchedNumbers.has(item.voucherNumber.trim()));
  if (matchedInvoices.length !== matchedNumbers.size || matchedInvoices.some((invoice) => !invoice.lineItems)) return { state: 'awaiting_detail', differences: [] };

  const ordered = new Map<string, { itemName: string; quantity: number }>();
  for (const line of order.lines) {
    // Invoice exports currently carry the exact Tally stock-item name. Keep
    // matching conservative until a stable item GUID is exported on both sides.
    const key = normalizedTallyItem(line.itemName);
    const current = ordered.get(key);
    ordered.set(key, { itemName: line.itemName, quantity: (current?.quantity || 0) + Number(line.quantity) });
  }
  const invoiced = new Map<string, { itemName: string; quantity: number }>();
  for (const line of matchedInvoices.flatMap((invoice) => invoice.lineItems || [])) {
    const key = normalizedTallyItem(line.itemName);
    if (!key || !Number.isFinite(Number(line.quantity))) continue;
    const current = invoiced.get(key);
    invoiced.set(key, { itemName: line.itemName, quantity: (current?.quantity || 0) + Math.abs(Number(line.quantity)) });
  }
  const differences = [...new Set([...ordered.keys(), ...invoiced.keys()])].flatMap((key) => {
    const orderLine = ordered.get(key); const invoiceLine = invoiced.get(key);
    const orderedQuantity = orderLine?.quantity || 0; const invoicedQuantity = invoiceLine?.quantity || 0;
    return orderedQuantity === invoicedQuantity ? [] : [{ itemName: orderLine?.itemName || invoiceLine?.itemName || key, orderedQuantity, invoicedQuantity }];
  });
  return { state: differences.length ? 'mismatch' : 'matched', differences };
}

export function orderNeedsBillingAttention(order: OrderSummary, invoices?: TallyInvoice[], now = new Date(), snapshotFetchedAt?: string) {
  if (!order.tallyInvoiceNumber) return false;
  const identity = tallyInvoiceReconciliation(order, invoices, now, snapshotFetchedAt);
  if (['unmatched', 'customer_mismatch', 'ambiguous', 'verification_stale'].includes(identity)) return true;
  return identity === 'verified' && tallyInvoiceLineReconciliation(order, invoices, now, snapshotFetchedAt).state === 'mismatch';
}

export function orderMatchesCaptureDate(order: OrderSummary, date: string) {
  if (!date) return true;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(order.createdAt)) === date;
}

export function orderMatchesCaptureDateRange(order: OrderSummary, from: string, to: string) {
  if (!to) return orderMatchesCaptureDate(order, from);
  const captured = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(order.createdAt));
  return captured >= from && captured <= to;
}

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
  if (['confirmed', 'partially_reserved', 'fully_reserved', 'ready_for_picking', 'picked', 'packed'].includes(status)) return 'Pick & pack';
  if (['awaiting_tally_billing', 'billed_in_tally'].includes(status)) return 'Tally billing';
  if (['ready_for_dispatch', 'dispatched'].includes(status)) return 'Dispatch';
  if (status === 'delivered') return 'Delivered';
  if (status === 'cancelled') return 'Cancelled';
  return status.replaceAll('_', ' ');
}

const visibleTransitionRoles: Record<string, readonly string[]> = {
  'phone_order_received->awaiting_confirmation': ['administrator', 'operations', 'sales'],
  'awaiting_confirmation->confirmed': ['administrator', 'operations', 'sales', 'management'],
  'awaiting_approval->confirmed': ['administrator', 'operations', 'sales', 'management'],
  'confirmed->packed': ['administrator', 'operations', 'warehouse'],
  'partially_reserved->packed': ['administrator', 'operations', 'warehouse'],
  'fully_reserved->packed': ['administrator', 'operations', 'warehouse'],
  'ready_for_picking->packed': ['administrator', 'operations', 'warehouse'],
  'picked->packed': ['administrator', 'operations', 'warehouse'],
  'packed->awaiting_tally_billing': ['administrator', 'operations', 'accounts'],
  'awaiting_tally_billing->billed_in_tally': ['administrator', 'operations', 'accounts'],
  'billed_in_tally->ready_for_dispatch': ['administrator', 'operations'],
};

export function canRoleTransitionOrder(role: string, fromStatus: string, toStatus: string) {
  return visibleTransitionRoles[`${fromStatus}->${toStatus}`]?.includes(role) ?? false;
}

export function billingHandoffText(order: OrderSummary) {
  const lines = order.lines.map((line) => {
    const unit = line.baseUnit ? ` ${line.baseUnit}` : '';
    return `- ${line.itemName}: ${Math.round(Number(line.quantity)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}${unit}`;
  });
  return [
    `Order: ${order.orderNumber}`,
    `Customer: ${order.customerName}`,
    order.customerPhone ? `Phone: ${order.customerPhone}` : '',
    order.assignedToEmail ? `Owner: ${order.assignedToEmail}` : '',
    'Products:',
    ...lines,
    order.deliveryAddress ? `Delivery: ${order.deliveryAddress}` : '',
    order.notes ? `Notes: ${order.notes}` : '',
  ].filter(Boolean).join('\n');
}

function localDateKey(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

export function orderOperationsText(order: OrderSummary) {
  const lines = order.lines.map((line) => `- ${line.itemName}: ${line.quantity} ${line.baseUnit || ''}`.trim());
  return [
    `${order.orderNumber} · ${orderStage(order.status)}`,
    `Customer: ${order.customerName}`,
    order.customerPhone ? `Phone: ${order.customerPhone}` : '',
    order.assignedToEmail ? `Owner: ${order.assignedToEmail}` : '',
    'Products:',
    ...lines,
    order.expectedDeliveryDate ? `Promised delivery: ${order.expectedDeliveryDate}` : '',
    order.deliveryAddress ? `Delivery address: ${order.deliveryAddress}` : '',
    order.tallyInvoiceNumber ? `Tally invoice: ${order.tallyInvoiceNumber}` : '',
    order.trackingNumber ? `Dispatch: ${order.courierName || 'Courier'} · ${order.trackingNumber}${order.vehicleNumber ? ` · ${order.vehicleNumber}` : ''}` : '',
    order.deliveredAt ? `Delivered: ${new Date(order.deliveredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}${order.receivedBy ? ` · ${order.receivedBy}` : ''}` : '',
    order.notes ? `Notes: ${order.notes}` : '',
  ].filter(Boolean).join('\n');
}

export function isOrderDeliveryOverdue(order: OrderSummary, today = new Date()) {
  return Boolean(
    order.expectedDeliveryDate &&
    !['cancelled', 'delivered'].includes(order.status) &&
    order.expectedDeliveryDate < localDateKey(today),
  );
}

function csvCell(value: string | number | null | undefined) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function ordersCsv(orders: OrderSummary[], reconciliation?: { invoices?: TallyInvoice[]; fetchedAt?: string; now?: Date }) {
  const headings = ['Order', 'Customer', 'Phone', 'Stage', 'Assigned to', 'Products', 'Quantity', 'Tally invoice', 'Invoice identity', 'Product and quantity check', 'Invoice differences', 'Expected delivery', 'Courier', 'Tracking', 'Last updated'];
  const rows = orders.map((order) => {
    const identity = reconciliation ? tallyInvoiceReconciliation(order, reconciliation.invoices, reconciliation.now, reconciliation.fetchedAt) : '';
    const lines = reconciliation ? tallyInvoiceLineReconciliation(order, reconciliation.invoices, reconciliation.now, reconciliation.fetchedAt) : null;
    return [
      order.orderNumber,
      order.customerName,
      order.customerPhone,
      orderStage(order.status),
      order.assignedToEmail,
      order.lines.map((line) => `${line.itemName} (${line.quantity} ${line.baseUnit || ''})`.trim()).join('; '),
      order.totalQuantity,
      order.tallyInvoiceNumber,
      identity.replaceAll('_', ' '),
      lines?.state.replaceAll('_', ' ') || '',
      lines?.differences.map((item) => `${item.itemName}: ordered ${item.orderedQuantity}; invoiced ${item.invoicedQuantity}`).join(' | ') || '',
      order.expectedDeliveryDate,
      order.courierName,
      order.trackingNumber,
      order.updatedAt,
    ];
  });
  return [headings, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function filterOrders(orders: OrderSummary[], query: string, status: string) {
  const normalized = query.trim().toLocaleLowerCase('en-IN');
  const exactCustomer = normalized.startsWith('customer:') ? normalized.slice('customer:'.length).trim() : '';
  const exactAssignee = normalized.startsWith('assignee:') ? normalized.slice('assignee:'.length).trim() : '';
  return orders.filter((order) => {
    const searchable = [
      order.orderNumber,
      order.customerName,
      order.customerPhone,
      order.tallyInvoiceNumber,
      order.assignedToEmail,
      ...(order.lines || []).map((line) => line.itemName),
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('en-IN');
    const matchesStatus =
      status === 'all' ||
      (status === 'open' && !['delivered', 'cancelled'].includes(order.status)) ||
      (status === 'history' && ['delivered', 'cancelled'].includes(order.status)) ||
      (status === 'billing' && order.status === 'awaiting_tally_billing') ||
      (status === 'picking' && ['confirmed', 'partially_reserved', 'fully_reserved', 'ready_for_picking', 'picked'].includes(order.status)) ||
      (status === 'dispatch_ready' && ['billed_in_tally', 'ready_for_dispatch'].includes(order.status)) ||
      (status === 'delivery_due_today' && isOrderDeliveryDue(order)) ||
      (status === 'delivery_due_soon' && isOrderDeliveryDue(order, 6)) ||
      (status === 'back_ordered' && isOrderBackOrdered(order)) ||
      (status === 'delivery_exception' && (order.exceptions || []).some((item) => item.status === 'open')) ||
      (status === 'priority_urgent' && order.priority === 'urgent' && !['delivered', 'cancelled'].includes(order.status)) ||
      (status === 'priority_high' && ['high', 'urgent'].includes(order.priority || 'normal') && !['delivered', 'cancelled'].includes(order.status)) ||
      (status === 'overdue' && isOrderDeliveryOverdue(order)) ||
      (status === 'attention' && orderAttentionReasons(order).length > 0) ||
      order.status === status;
    const matchesSearch = exactCustomer
      ? order.customerName.trim().toLocaleLowerCase('en-IN') === exactCustomer
      : exactAssignee
        ? exactAssignee === 'unassigned'
          ? !order.assignedToEmail
          : order.assignedToEmail?.trim().toLocaleLowerCase('en-IN') === exactAssignee
        : !normalized || searchable.includes(normalized);
    return matchesStatus && matchesSearch;
  });
}

export function pageItems<T>(items: T[], requestedPage: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), pageCount);
  return { page, pageCount, items: items.slice((page - 1) * pageSize, page * pageSize) };
}

export function orderAttentionReasons(order: OrderSummary, now = new Date()) {
  if (['cancelled', 'delivered'].includes(order.status)) return [];
  const reasons: string[] = [];
  const ageHours = (now.getTime() - new Date(order.updatedAt).getTime()) / 3_600_000;
  const limit = ['phone_order_received', 'awaiting_confirmation', 'awaiting_approval'].includes(order.status) ? 4 : ['confirmed', 'packed'].includes(order.status) ? 24 : 48;
  if (ageHours > limit) reasons.push(`No progress for over ${limit} hours`);
  if (isOrderDeliveryOverdue(order, now)) reasons.push('Delivery overdue');
  if ((order.exceptions || []).some((item) => item.status === 'open')) reasons.push('Open delivery exception');
  if ((order.installations || []).some((item) => item.status === 'scheduled' && item.scheduledDate < localDateKey(now))) reasons.push('Installation overdue');
  if (isOrderBackOrdered(order)) reasons.push('Partial fulfilment or back-order');
  if (order.status === 'ready_for_dispatch' && (!order.courierName || !order.trackingNumber || !order.dispatchDate)) reasons.push('Dispatch details missing');
  if (order.status === 'dispatched' && (!order.receivedBy || !order.deliveredAt)) reasons.push('Delivery confirmation pending');
  return reasons;
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
        priority?: 'normal' | 'high' | 'urgent';
        expectedDeliveryDate?: string;
        notes?: string;
        lines: Array<{ tallyKey: string; quantity: number }>;
      };
    }
  | {
      action: 'transition_order';
      payload: {
        idempotencyKey?: string;
        orderId: string;
        expectedVersion: number;
        toStatus: string;
        reason?: string;
        tallyInvoiceNumber?: string;
      };
    }
  | {
      action: 'save_fulfilment';
      payload: {
        idempotencyKey?: string;
        orderId: string;
        expectedVersion: number;
        deliveryAddress?: string;
        expectedDeliveryDate?: string;
        lines: Array<{ tallyKey: string; fulfilledQuantity: number }>;
      };
    }
  | {
      action: 'save_dispatch';
      payload: { idempotencyKey?: string; orderId: string; expectedVersion: number; courierName: string; trackingNumber: string; dispatchDate: string; vehicleNumber?: string };
    }
  | {
      action: 'confirm_delivery';
      payload: { idempotencyKey?: string; orderId: string; expectedVersion: number; deliveredAt: string; receivedBy: string; podReference?: string };
    }
  | {
      action: 'edit_order';
      payload: { idempotencyKey?: string; orderId: string; expectedVersion: number; customerName: string; customerPhone?: string; notes?: string; reason?: string; lines: Array<{ tallyKey: string; quantity: number }> };
    }
  | {
      action: 'create_exception';
      payload: { idempotencyKey?: string; orderId: string; expectedVersion: number; category: DeliveryException['category']; summary: string; ownerEmail?: string };
    }
  | {
      action: 'resolve_exception';
      payload: { idempotencyKey?: string; orderId: string; expectedVersion: number; exceptionId: string; resolution: string };
    }
  | {
      action: 'schedule_installation';
      payload: { idempotencyKey?: string; orderId: string; expectedVersion: number; tallyKey: string; scheduledDate: string; engineerEmail?: string; siteContact?: string };
    }
  | {
      action: 'complete_installation';
      payload: { idempotencyKey?: string; orderId: string; expectedVersion: number; installationId: string; serialNumber: string; commissioningNotes: string };
    }
  | {
      action: 'set_order_priority';
      payload: { idempotencyKey?: string; orderId: string; expectedVersion: number; priority: 'normal' | 'high' | 'urgent' };
    }
  | {
      action: 'set_order_assignee';
      payload: { idempotencyKey?: string; orderId: string; expectedVersion: number; assignedToEmail?: string };
    }
  | {
      action: 'record_billing_review';
      payload: { idempotencyKey?: string; orderId: string; expectedVersion: number; outcome: 'investigating' | 'accepted_difference' | 'tally_corrected'; note: string };
    };

export function isValidCalendarDate(value: unknown) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function orderBackOrderedQuantity(order: OrderSummary) {
  return order.lines.reduce((total, line) => total + Math.max(Number(line.quantity) - Number(line.fulfilledQuantity || 0), 0), 0);
}

export function isOrderBackOrdered(order: OrderSummary) {
  if (['cancelled', 'delivered'].includes(order.status)) return false;
  const fulfilmentStarted = order.lines.some((line) => Number(line.fulfilledQuantity || 0) > 0);
  const fulfilmentDue = ['packed', 'awaiting_tally_billing', 'billed_in_tally', 'ready_for_dispatch', 'dispatched'].includes(order.status);
  return (fulfilmentStarted || fulfilmentDue) && orderBackOrderedQuantity(order) > 0;
}

export function isOrderDeliveryDue(order: OrderSummary, horizonDays = 0, today = new Date()) {
  if (!order.expectedDeliveryDate || ['cancelled', 'delivered'].includes(order.status)) return false;
  const start = localDateKey(today);
  const end = localDateKey(new Date(today.getTime() + Math.max(0, horizonDays) * 86_400_000));
  return order.expectedDeliveryDate >= start && order.expectedDeliveryDate <= end;
}

export function orderDeliveryReminder(order: OrderSummary, today = new Date()): 'overdue' | 'today' | 'soon' | null {
  if (isOrderDeliveryOverdue(order, today)) return 'overdue';
  if (isOrderDeliveryDue(order, 0, today)) return 'today';
  if (isOrderDeliveryDue(order, 6, today)) return 'soon';
  return null;
}

export function repeatOrderTemplate(order: OrderSummary) {
  return {
    customerName: order.customerName,
    customerPhone: order.customerPhone || '',
    source: 'phone' as const,
    lines: (order.lines || []).map((line) => ({ tallyKey: line.tallyKey, quantity: line.quantity })),
  };
}

function isIsoInstant(value: unknown) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

export function validateOrderCommand(value: unknown): OrderCommand | null {
  if (!value || typeof value !== 'object') return null;
  const command = value as { action?: unknown; payload?: unknown };
  if (
    !['create_order', 'transition_order', 'save_fulfilment', 'save_dispatch', 'confirm_delivery', 'edit_order', 'create_exception', 'resolve_exception', 'schedule_installation', 'complete_installation', 'set_order_priority', 'set_order_assignee', 'record_billing_review'].includes(
      String(command.action),
    ) ||
    !command.payload ||
    typeof command.payload !== 'object'
  ) {
    return null;
  }

  const payload = command.payload as Record<string, unknown>;
  const validRequestKey = () => typeof payload.idempotencyKey === 'string' && payload.idempotencyKey.length >= 16 && payload.idempotencyKey.length <= 200;
  const validMutationIdentity = () => validRequestKey() && typeof payload.orderId === 'string' && payload.orderId.length >= 1 && payload.orderId.length <= 100 && Number.isInteger(Number(payload.expectedVersion)) && Number(payload.expectedVersion) >= 1;
  const boundedOptionalText = (field: string, maximum: number) => payload[field] === undefined || (typeof payload[field] === 'string' && String(payload[field]).length <= maximum);
  const validQuantityLine = (line: unknown, quantityField: 'quantity' | 'fulfilledQuantity', allowZero = false) => {
    if (!line || typeof line !== 'object') return false;
    const item = line as Record<string, unknown>;
    const quantity = Number(item[quantityField]);
    return typeof item.tallyKey === 'string' && item.tallyKey.length >= 1 && item.tallyKey.length <= 300 && Number.isInteger(quantity) && quantity >= (allowZero ? 0 : 1) && quantity <= 1_000_000;
  };
  if (command.action === 'create_order') {
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    const validLines =
      lines.length >= 1 &&
      lines.length <= 50 &&
      lines.every((line) => validQuantityLine(line, 'quantity'));
    if (
      !validRequestKey() ||
      typeof payload.customerName !== 'string' ||
      payload.customerName.trim().length < 2 ||
      payload.customerName.length > 200 ||
      !['phone', 'email', 'whatsapp', 'walk_in'].includes(String(payload.source)) ||
      !boundedOptionalText('customerId', 100) ||
      !boundedOptionalText('customerPhone', 40) ||
      !boundedOptionalText('customerCity', 120) ||
      !boundedOptionalText('notes', 2000) ||
      (payload.priority !== undefined && (typeof payload.priority !== 'string' || !['normal', 'high', 'urgent'].includes(payload.priority))) ||
      (payload.expectedDeliveryDate !== undefined && payload.expectedDeliveryDate !== '' && !isValidCalendarDate(payload.expectedDeliveryDate)) ||
      !validLines
    ) {
      return null;
    }
  } else if (command.action === 'set_order_priority') {
    if (!validMutationIdentity() || typeof payload.priority !== 'string' || !['normal', 'high', 'urgent'].includes(payload.priority)) return null;
  } else if (command.action === 'set_order_assignee') {
    if (!validMutationIdentity() || !boundedOptionalText('assignedToEmail', 254) || payload.assignedToEmail !== undefined && typeof payload.assignedToEmail !== 'string') return null;
    if (typeof payload.assignedToEmail === 'string' && payload.assignedToEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.assignedToEmail)) return null;
  } else if (command.action === 'transition_order') {
    const transitionStatuses = ['awaiting_confirmation', 'awaiting_approval', 'confirmed', 'packed', 'awaiting_tally_billing', 'billed_in_tally', 'ready_for_dispatch', 'dispatched', 'delivered', 'cancelled'];
    const invoiceReferences = typeof payload.tallyInvoiceNumber === 'string' ? payload.tallyInvoiceNumber.split(',').map((item) => item.trim()).filter(Boolean) : [];
    if (
      typeof payload.idempotencyKey !== 'string' || payload.idempotencyKey.length < 16 || payload.idempotencyKey.length > 200 ||
      typeof payload.orderId !== 'string' || payload.orderId.length < 1 || payload.orderId.length > 100 ||
      !Number.isInteger(Number(payload.expectedVersion)) || Number(payload.expectedVersion) < 1 ||
      typeof payload.toStatus !== 'string' || !transitionStatuses.includes(payload.toStatus) ||
      (payload.reason !== undefined && (typeof payload.reason !== 'string' || payload.reason.length > 500)) ||
      (payload.tallyInvoiceNumber !== undefined && (typeof payload.tallyInvoiceNumber !== 'string' || payload.tallyInvoiceNumber.length > 160 || invoiceReferences.length < 1 || invoiceReferences.length > 5 || invoiceReferences.some((item) => item.length > 80)))
    ) return null;
  } else if (command.action === 'save_fulfilment') {
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    if (!validMutationIdentity() || lines.length < 1 || lines.length > 50 || !lines.every((line) => validQuantityLine(line, 'fulfilledQuantity', true)) || !boundedOptionalText('deliveryAddress', 1000) || (payload.expectedDeliveryDate !== undefined && !isValidCalendarDate(payload.expectedDeliveryDate))) return null;
  } else if (command.action === 'save_dispatch') {
    if (!validMutationIdentity() || typeof payload.courierName !== 'string' || payload.courierName.trim().length < 2 || payload.courierName.length > 160 || typeof payload.trackingNumber !== 'string' || payload.trackingNumber.trim().length < 2 || payload.trackingNumber.length > 160 || !isValidCalendarDate(payload.dispatchDate) || !boundedOptionalText('vehicleNumber', 40)) return null;
  } else if (command.action === 'confirm_delivery') {
    if (!validMutationIdentity() || typeof payload.receivedBy !== 'string' || payload.receivedBy.trim().length < 2 || payload.receivedBy.length > 160 || !isIsoInstant(payload.deliveredAt) || !boundedOptionalText('podReference', 160)) return null;
  } else if (command.action === 'edit_order') {
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    if (!validMutationIdentity() || typeof payload.customerName !== 'string' || payload.customerName.trim().length < 2 || payload.customerName.length > 200 || !boundedOptionalText('customerPhone', 40) || !boundedOptionalText('notes', 2000) || !boundedOptionalText('reason', 500) || lines.length < 1 || lines.length > 50 || !lines.every((line) => validQuantityLine(line, 'quantity'))) return null;
  } else if (command.action === 'create_exception') {
    if (!validMutationIdentity() || !['delayed', 'failed_delivery', 'damaged', 'wrong_item', 'other'].includes(String(payload.category)) || typeof payload.summary !== 'string' || payload.summary.trim().length < 3 || payload.summary.length > 500 || !boundedOptionalText('ownerEmail', 254)) return null;
  } else if (command.action === 'record_billing_review') {
    if (!validMutationIdentity() || !['investigating', 'accepted_difference', 'tally_corrected'].includes(String(payload.outcome)) || typeof payload.note !== 'string' || payload.note.trim().length < 3 || payload.note.length > 1000) return null;
  } else if (command.action === 'resolve_exception') {
    if (!validMutationIdentity() || typeof payload.exceptionId !== 'string' || payload.exceptionId.length < 1 || payload.exceptionId.length > 100 || typeof payload.resolution !== 'string' || payload.resolution.trim().length < 3 || payload.resolution.length > 500) return null;
  } else if (command.action === 'schedule_installation') {
    if (!validMutationIdentity() || typeof payload.tallyKey !== 'string' || payload.tallyKey.length < 1 || payload.tallyKey.length > 300 || !isValidCalendarDate(payload.scheduledDate) || !boundedOptionalText('engineerEmail', 254) || !boundedOptionalText('siteContact', 200)) return null;
  } else if (command.action === 'complete_installation') {
    if (!validMutationIdentity() || typeof payload.installationId !== 'string' || payload.installationId.length < 1 || payload.installationId.length > 100 || typeof payload.serialNumber !== 'string' || payload.serialNumber.trim().length < 2 || payload.serialNumber.length > 100 || typeof payload.commissioningNotes !== 'string' || payload.commissioningNotes.trim().length < 3 || payload.commissioningNotes.length > 1000) return null;
  }

  return command as OrderCommand;
}
