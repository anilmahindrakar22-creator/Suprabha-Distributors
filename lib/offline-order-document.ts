import { validateOrderCommand } from './order-types';
import type { OfflineOrderDraft } from './offline-order-drafts';

export type OfflineProduct = { tallyKey: string; item: string; group: string; baseUnit: string };
export type OfflineCustomer = { id: string; name: string };
export type OfflineOrderDocument = {
  version: 1;
  actorEmail: string;
  preparedAt: string;
  products: OfflineProduct[];
  customers: OfflineCustomer[];
  drafts: OfflineOrderDraft[];
};
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown, max = 1000): value is string {
  return typeof value === 'string' && value.length <= max;
}
/** Explicit reconstruction prevents accidental commercial fields reaching storage. */
export function offlineOrderDocument(value: unknown, actorEmail: string): OfflineOrderDocument {
  if (!record(value) || value.version !== 1 || value.actorEmail !== actorEmail.trim().toLowerCase()
    || !text(value.preparedAt) || !Number.isFinite(Date.parse(value.preparedAt))
    || !Array.isArray(value.products) || value.products.length > 10_000
    || !Array.isArray(value.customers) || value.customers.length > 10_000
    || !Array.isArray(value.drafts) || value.drafts.length > 100) throw new Error('Invalid offline data for this account.');
  const products = value.products.map((product) => {
    if (!record(product) || !text(product.tallyKey) || !text(product.item) || !text(product.group) || !text(product.baseUnit)) throw new Error('Invalid offline product.');
    return { tallyKey: product.tallyKey, item: product.item, group: product.group, baseUnit: product.baseUnit };
  });
  const customers = value.customers.map((customer) => {
    if (!record(customer) || !text(customer.id, 100) || !text(customer.name, 200)) throw new Error('Invalid offline customer.');
    return { id: customer.id, name: customer.name };
  });
  const drafts = value.drafts.map((draft) => {
    if (!record(draft) || draft.schemaVersion !== 1 || draft.actorEmail !== value.actorEmail
      || !['draft', 'pending', 'error'].includes(String(draft.state)) || !text(draft.updatedAt)
      || !Number.isFinite(Date.parse(draft.updatedAt)) || !record(draft.command)
      || draft.command.action !== 'create_order' || !validateOrderCommand(draft.command)) throw new Error('Invalid saved offline order.');
    const command = validateOrderCommand(draft.command)!;
    if (command.action !== 'create_order') throw new Error('Invalid saved offline order.');
    const p = command.payload;
    // Do not retain arbitrary extra properties accepted by older command readers.
    return { schemaVersion: 1 as const, actorEmail: value.actorEmail as string,
      state: draft.state as OfflineOrderDraft['state'], updatedAt: draft.updatedAt,
      command: { action: 'create_order' as const, payload: {
        idempotencyKey: p.idempotencyKey, customerName: p.customerName, source: p.source,
        ...(p.customerId !== undefined ? { customerId: p.customerId } : {}),
        ...(p.customerPhone !== undefined ? { customerPhone: p.customerPhone } : {}),
        ...(p.customerCity !== undefined ? { customerCity: p.customerCity } : {}),
        ...(p.deliveryAddress !== undefined ? { deliveryAddress: p.deliveryAddress } : {}),
        ...(p.notes !== undefined ? { notes: p.notes } : {}),
        ...(p.priority !== undefined ? { priority: p.priority } : {}),
        ...(p.expectedDeliveryDate !== undefined ? { expectedDeliveryDate: p.expectedDeliveryDate } : {}),
        lines: p.lines.map(({ tallyKey, quantity }) => ({ tallyKey, quantity })),
      } },
    };
  });
  return { version: 1, actorEmail: value.actorEmail as string, preparedAt: value.preparedAt, products, customers, drafts };
}
