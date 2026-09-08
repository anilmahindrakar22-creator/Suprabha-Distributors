import type { OrderSummary } from './order-types';

export type InstalledAsset = {
  installationId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string | null;
  tallyKey: string;
  itemName: string;
  serialNumber: string;
  installedAt: string;
  siteContact: string | null;
  engineerEmail: string | null;
  commissioningNotes: string | null;
};

export const serviceCategories = ['breakdown', 'preventive_maintenance', 'calibration', 'training', 'other'] as const;
export const servicePriorities = ['normal', 'high', 'urgent'] as const;
export type ServiceCategory = typeof serviceCategories[number];
export type ServicePriority = typeof servicePriorities[number];

export type ServiceTicketEvent = { id: string; eventType: 'opened' | 'resolved'; actorEmail: string; createdAt: string };
export type ServiceTicket = {
  id: string; ticketNumber: string; installationId: string; category: ServiceCategory; priority: ServicePriority;
  status: 'open' | 'resolved'; summary: string; resolution: string | null; createdBy: string; createdAt: string;
  resolvedBy: string | null; resolvedAt: string | null; version: number; events: ServiceTicketEvent[];
};
export type ServiceWorkspaceData = { assets: InstalledAsset[]; tickets: ServiceTicket[] };
export type ServiceCommand =
  | { action: 'create_service_ticket'; payload: { installationId: string; category: ServiceCategory; priority: ServicePriority; summary: string; idempotencyKey: string } }
  | { action: 'resolve_service_ticket'; payload: { ticketId: string; expectedVersion: number; resolution: string; idempotencyKey: string } };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateServiceCommand(input: unknown): ServiceCommand | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as { action?: unknown; payload?: unknown };
  if (!value.payload || typeof value.payload !== 'object') return null;
  const payload = value.payload as Record<string, unknown>;
  if (typeof payload.idempotencyKey !== 'string' || payload.idempotencyKey.length < 16 || payload.idempotencyKey.length > 200) return null;
  if (value.action === 'create_service_ticket') {
    const summary = typeof payload.summary === 'string' ? payload.summary.trim() : '';
    if (typeof payload.installationId !== 'string' || !uuidPattern.test(payload.installationId) || !serviceCategories.includes(payload.category as ServiceCategory) || !servicePriorities.includes(payload.priority as ServicePriority) || summary.length < 3 || summary.length > 500) return null;
    return { action: value.action, payload: { installationId: payload.installationId, category: payload.category as ServiceCategory, priority: payload.priority as ServicePriority, summary, idempotencyKey: payload.idempotencyKey } };
  }
  if (value.action === 'resolve_service_ticket') {
    const resolution = typeof payload.resolution === 'string' ? payload.resolution.trim() : '';
    if (typeof payload.ticketId !== 'string' || !uuidPattern.test(payload.ticketId) || !Number.isInteger(payload.expectedVersion) || Number(payload.expectedVersion) < 1 || resolution.length < 3 || resolution.length > 1000) return null;
    return { action: value.action, payload: { ticketId: payload.ticketId, expectedVersion: Number(payload.expectedVersion), resolution, idempotencyKey: payload.idempotencyKey } };
  }
  return null;
}

export function searchServiceWorkspace(data: ServiceWorkspaceData, input: string) {
  const query = input.trim().toLocaleLowerCase('en-IN');
  if (!query) return data;
  const assetIds = new Set(data.assets.filter((asset) => [asset.customerName, asset.customerPhone, asset.itemName, asset.serialNumber, asset.orderNumber, asset.siteContact].filter(Boolean).some((value) => String(value).toLocaleLowerCase('en-IN').includes(query))).map((asset) => asset.installationId));
  const tickets = data.tickets.filter((ticket) => assetIds.has(ticket.installationId) || [ticket.ticketNumber, ticket.summary, ticket.category, ticket.priority, ticket.resolution].filter(Boolean).some((value) => String(value).toLocaleLowerCase('en-IN').includes(query)));
  for (const ticket of tickets) assetIds.add(ticket.installationId);
  return { assets: data.assets.filter((asset) => assetIds.has(asset.installationId)), tickets };
}

export function installedAssetsFromOrders(orders: OrderSummary[]): InstalledAsset[] {
  return orders
    .flatMap((order) =>
      (order.installations || [])
        .filter((installation) => installation.status === 'completed' && installation.serialNumber && installation.completedAt)
        .map((installation) => ({
          installationId: installation.id,
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          tallyKey: installation.tallyKey,
          itemName: installation.itemName,
          serialNumber: installation.serialNumber as string,
          installedAt: installation.completedAt as string,
          siteContact: installation.siteContact,
          engineerEmail: installation.engineerEmail,
          commissioningNotes: installation.commissioningNotes,
        })),
    )
    .sort((left, right) => right.installedAt.localeCompare(left.installedAt));
}

export function searchInstalledAssets(assets: InstalledAsset[], input: string) {
  const query = input.trim().toLocaleLowerCase('en-IN');
  if (!query) return assets;
  return assets.filter((asset) =>
    [asset.customerName, asset.customerPhone, asset.itemName, asset.serialNumber, asset.orderNumber, asset.siteContact]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase('en-IN').includes(query)),
  );
}
