export const walletMethods = [
  { value: 'customer_stated', label: 'Customer stated' },
  { value: 'test_volume', label: 'From test volume' },
  { value: 'manager_estimate', label: 'Manager estimate' },
] as const;
export const walletConfidences = [
  { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' },
] as const;
export type WalletDivision = { id: string; name: string; active: boolean; sortOrder: number; version: number };
export type WalletEstimate = {
  id: string; customerId: string; divisionId: string; monthlyWalletPaise: string;
  method: typeof walletMethods[number]['value']; confidence: typeof walletConfidences[number]['value'];
  note: string; asOf: string; createdAt: string; createdBy: string;
};
export type CustomerWalletRow = Omit<WalletEstimate, 'id' | 'customerId' | 'divisionId'> & {
  division: Pick<WalletDivision, 'id' | 'name' | 'active'>;
};
export type CustomerWallet = { current: CustomerWalletRow[]; totalMonthlyWalletPaise: string; history: CustomerWalletRow[] };
export type WalletCommand =
  | { action: 'set_wallet_division'; payload: { divisionId?: string; name: string; active: boolean; sortOrder?: number; expectedVersion?: number; idempotencyKey: string } }
  | { action: 'record_wallet_estimate'; payload: Omit<WalletEstimate, 'id' | 'createdAt' | 'createdBy'> & { idempotencyKey: string } };
export const walletUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cap = BigInt('1000000000000');
const object = (input: unknown): input is Record<string, unknown> => !!input && typeof input === 'object' && !Array.isArray(input);
function kolkataToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
export function validateWalletCommand(input: unknown): WalletCommand | null {
  if (!object(input) || !object(input.payload)) return null;
  const p = input.payload;
  if (typeof p.idempotencyKey !== 'string' || p.idempotencyKey.trim().length < 16 || p.idempotencyKey.length > 200) return null;
  if (input.action === 'set_wallet_division') {
    if (typeof p.name !== 'string' || p.name.trim().length < 2 || p.name.trim().length > 60 || typeof p.active !== 'boolean'
      || (p.divisionId !== undefined && (typeof p.divisionId !== 'string' || !walletUuidPattern.test(p.divisionId)))
      || (p.sortOrder !== undefined && (!Number.isInteger(p.sortOrder) || Number(p.sortOrder) < 0 || Number(p.sortOrder) > 10000))
      || (p.expectedVersion !== undefined && (!Number.isInteger(p.expectedVersion) || Number(p.expectedVersion) < 1 || Number(p.expectedVersion) > 2147483647))
      || (p.divisionId !== undefined && p.expectedVersion === undefined)) return null;
    return { action: input.action, payload: { name: p.name.trim(), active: p.active, idempotencyKey: p.idempotencyKey,
      ...(p.divisionId === undefined ? {} : { divisionId: p.divisionId as string }),
      ...(p.sortOrder === undefined ? {} : { sortOrder: Number(p.sortOrder) }),
      ...(p.expectedVersion === undefined ? {} : { expectedVersion: Number(p.expectedVersion) }) } };
  }
  if (input.action !== 'record_wallet_estimate'
    || typeof p.customerId !== 'string' || !walletUuidPattern.test(p.customerId)
    || typeof p.divisionId !== 'string' || !walletUuidPattern.test(p.divisionId)
    || typeof p.monthlyWalletPaise !== 'string' || !/^[0-9]{1,13}$/.test(p.monthlyWalletPaise) || BigInt(p.monthlyWalletPaise) > cap
    || !walletMethods.some(m => m.value === p.method) || !walletConfidences.some(c => c.value === p.confidence)
    || typeof p.note !== 'string' || p.note.trim().length < 3 || p.note.trim().length > 500
    || typeof p.asOf !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(p.asOf)
    || p.asOf < '2000-01-01' || p.asOf > kolkataToday()) return null;
  const date = new Date(`${p.asOf}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== p.asOf) return null;
  return { action: input.action, payload: { customerId: p.customerId, divisionId: p.divisionId,
    monthlyWalletPaise: p.monthlyWalletPaise, method: p.method as WalletEstimate['method'], confidence: p.confidence as WalletEstimate['confidence'],
    note: p.note.trim(), asOf: p.asOf, idempotencyKey: p.idempotencyKey } };
}
export function rupeesToPaise(text: string): string | null {
  const value = text.replace(/,/g, '');
  if (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const digits = (whole + fraction.padEnd(2, '0')).replace(/^0+(?=\d)/, '');
  if (digits.length > 13 || BigInt(digits) > cap) return null;
  return digits;
}
export function formatPaise(paise: string): string {
  const value = BigInt(paise);
  const fraction = value % BigInt(100);
  return `₹${(value / BigInt(100)).toLocaleString('en-IN')}${fraction === BigInt(0) ? '' : '.' + fraction.toString().padStart(2, '0')}`;
}
