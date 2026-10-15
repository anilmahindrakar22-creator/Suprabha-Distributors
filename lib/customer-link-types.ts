export const customerLinkStates = ['suggested', 'linked', 'conflict'] as const;
export type CustomerLinkState = typeof customerLinkStates[number];
export type CustomerLinkRow = {
  customerId: string; customerName: string; city: string | null; ledgerName: string; guid: string;
  state: CustomerLinkState;
  linkedTo?: { customerId: string; name: string } | { guid: string };
};
export type CustomerLinksResponse = {
  companyId: string; sourceVersion: string; observedAt: string; rows: CustomerLinkRow[];
  page: { page: number; pageSize: 25; total: number };
} | { companyId: null; sourceVersion: null; rows: []; waiting: true }
  | { companies: string[] };
export type ConfirmCustomerLinksResult = { ok: true; confirmed: number; customerIds: string[] };
export type CustomerLinkCommand = { action: 'confirm_customer_links'; payload: {
  companyId: string; sourceVersion: string; rows: { customerId: string; ledgerGuid: string }[];
  reason: string; idempotencyKey: string;
} };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function parseLinkCommand(value: unknown): CustomerLinkCommand | null {
  if (!record(value) || !exactKeys(value, ['action', 'companyId', 'sourceVersion', 'rows', 'reason', 'idempotencyKey'])
    || value.action !== 'confirm_customer_links') return null;
  const { companyId, sourceVersion, rows, reason, idempotencyKey } = value;
  if (typeof companyId !== 'string' || !companyId.trim() || companyId.trim().length > 240
    || typeof sourceVersion !== 'string' || !sourceVersion.trim() || sourceVersion.trim().length > 240
    || typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 300
    || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 16 || idempotencyKey.length > 200
    || !Array.isArray(rows) || rows.length < 1 || rows.length > 50) return null;
  const customers = new Set<string>();
  const ledgers = new Set<string>();
  const parsedRows: CustomerLinkCommand['payload']['rows'] = [];
  for (const row of rows) {
    if (!record(row) || !exactKeys(row, ['customerId', 'ledgerGuid'])
      || typeof row.customerId !== 'string' || !uuidPattern.test(row.customerId)
      || typeof row.ledgerGuid !== 'string' || !row.ledgerGuid.trim() || row.ledgerGuid.trim().length > 240) return null;
    const customerId = row.customerId.toLowerCase();
    const ledgerGuid = row.ledgerGuid.trim();
    if (customers.has(customerId) || ledgers.has(ledgerGuid)) return null;
    customers.add(customerId);
    ledgers.add(ledgerGuid);
    parsedRows.push({ customerId, ledgerGuid });
  }
  return { action: 'confirm_customer_links', payload: {
    companyId: companyId.trim(), sourceVersion: sourceVersion.trim(), rows: parsedRows,
    reason: reason.trim(), idempotencyKey: idempotencyKey.trim(),
  } };
}
