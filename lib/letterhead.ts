export type Letterhead = {
  companyName: string; address: string; gstin: string | null; phone: string;
  deliveryAddress: string; version: number; updatedAt: string;
};
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export function normalizeGstin(value: string): string | null { return value.trim().toUpperCase() || null; }
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const length = (v: unknown, max: number): v is string => typeof v === 'string' && Array.from(v).length <= max;
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const fields = (v: Record<string, unknown>) => typeof v.companyName === 'string' && length(v.companyName.trim(), 120) && v.companyName.trim().length > 0 &&
  length(v.address, 400) && length(v.phone, 40) && length(v.deliveryAddress, 400) &&
  (v.gstin === null || typeof v.gstin === 'string' && GSTIN_PATTERN.test(v.gstin));
export function parseLetterhead(value: unknown): Letterhead {
  if (!record(value) || !exact(value, ['companyName', 'address', 'gstin', 'phone', 'deliveryAddress', 'version', 'updatedAt']) ||
    !fields(value) || !positive(value.version) || typeof value.updatedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.updatedAt) ||
    !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('Invalid letterhead response');
  return { companyName: value.companyName as string, address: value.address as string, gstin: value.gstin as string | null,
    phone: value.phone as string, deliveryAddress: value.deliveryAddress as string, version: value.version, updatedAt: value.updatedAt };
}
type LetterheadPayload = Omit<Letterhead, 'version' | 'updatedAt'> & { idempotencyKey: string; expectedVersion: number };
export function validateLetterheadCommand(value: unknown): { action: 'set_letterhead'; payload: LetterheadPayload } | null {
  if (!record(value) || !exact(value, ['action', 'payload']) || value.action !== 'set_letterhead' || !record(value.payload)) return null;
  const p = value.payload;
  if (!exact(p, ['idempotencyKey', 'expectedVersion', 'companyName', 'address', 'gstin', 'phone', 'deliveryAddress']) ||
    typeof p.idempotencyKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.idempotencyKey) ||
    !positive(p.expectedVersion) || !fields(p)) return null;
  return { action: 'set_letterhead', payload: { idempotencyKey: p.idempotencyKey, expectedVersion: p.expectedVersion,
    companyName: (p.companyName as string).trim(), address: (p.address as string).trim(), gstin: p.gstin as string | null,
    phone: (p.phone as string).trim(), deliveryAddress: (p.deliveryAddress as string).trim() } };
}
