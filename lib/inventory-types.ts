export type InventoryAction = 'receive_stock' | 'adjust_stock' | 'allocate_order' | 'release_order';

export type InventoryProduct = {
  tallyKey: string;
  name: string;
  group: string;
  baseUnit: string;
  trackingMode: 'none' | 'batch' | 'expiry';
  active: boolean;
};

export type InventoryBalance = {
  tallyKey: string;
  name: string;
  batchNumber: string;
  expiryDate: string | null;
  locationCode: string;
  onHand: number;
  reserved: number;
  available: number;
};

export type InventoryBootstrap = {
  products: InventoryProduct[];
  balances: InventoryBalance[];
  reconciliation: Array<{ tallyKey: string; name: string; baseUnit: string; tallyOnHand: number; ledgerOnHand: number; variance: number; tallyFetchedAt: string | null }>;
};

export type InventoryCommand =
  | {
      action: 'receive_stock';
      payload: {
        idempotencyKey: string;
        tallyKey: string;
        batchNumber: string;
        expiryDate?: string;
        quantity: number;
        locationCode?: string;
        sourceDocument?: string;
      };
    }
  | {
      action: 'adjust_stock';
      payload: {
        idempotencyKey: string;
        tallyKey: string;
        batchNumber: string;
        quantityDelta: number;
        reason: string;
        locationCode?: string;
      };
    }
  | { action: 'allocate_order'; payload: { idempotencyKey: string; orderId: string; expectedVersion: number } }
  | { action: 'release_order'; payload: { idempotencyKey: string; orderId: string; expectedVersion: number; reason: string } };

function text(value: unknown, minimum = 1): value is string {
  return typeof value === 'string' && value.trim().length >= minimum;
}

function date(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function validateInventoryCommand(value: unknown): InventoryCommand | null {
  if (!value || typeof value !== 'object') return null;
  const command = value as { action?: unknown; payload?: unknown };
  if (!command.payload || typeof command.payload !== 'object') return null;
  const payload = command.payload as Record<string, unknown>;
  if (!text(payload.idempotencyKey, 16)) return null;

  if (command.action === 'allocate_order' || command.action === 'release_order') {
    if (!text(payload.orderId) || !Number.isInteger(payload.expectedVersion) || Number(payload.expectedVersion) < 1) return null;
    if (command.action === 'release_order' && !text(payload.reason, 3)) return null;
    return command as InventoryCommand;
  }

  if (!text(payload.tallyKey) || !text(payload.batchNumber)) return null;
  if (payload.locationCode !== undefined && !text(payload.locationCode)) return null;

  if (command.action === 'receive_stock') {
    if (!Number.isFinite(payload.quantity) || Number(payload.quantity) <= 0) return null;
    if (payload.expiryDate !== undefined && !date(payload.expiryDate)) return null;
    if (payload.sourceDocument !== undefined && !text(payload.sourceDocument)) return null;
    return command as InventoryCommand;
  }

  if (command.action === 'adjust_stock') {
    if (!Number.isFinite(payload.quantityDelta) || Number(payload.quantityDelta) === 0 || !text(payload.reason, 3)) return null;
    return command as InventoryCommand;
  }

  return null;
}
