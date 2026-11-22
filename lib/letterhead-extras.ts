export type LetterheadExtras = {
  logo: { type: 'image/png' | 'image/jpeg'; base64: string } | null;
  terms: string[];
  version: number;
};

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 2147483647;
const validTerms = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 5 && Array.from(v).every(t => typeof t === 'string' &&
  !/[\r\n]/.test(t) && Array.from(t.trim()).length >= 1 && Array.from(t.trim()).length <= 200);
function decodeLogo(value: unknown): Uint8Array | null {
  if (!record(value) || !exact(value, ['type', 'base64']) || !['image/png', 'image/jpeg'].includes(value.type as string) ||
    typeof value.base64 !== 'string' || value.base64.length > 54_616 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64)) return null;
  try {
    const bytes = Uint8Array.from(atob(value.base64), c => c.charCodeAt(0));
    if (bytes.length < 100 || bytes.length > 40_960) return null;
    const magic = value.type === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10] : [255, 216, 255];
    return magic.every((b, i) => bytes[i] === b) ? bytes : null;
  } catch { return null; }
}
const validLogo = (v: unknown): v is LetterheadExtras['logo'] => v === null || decodeLogo(v) !== null;

export function parseLetterheadExtras(value: unknown): LetterheadExtras {
  if (!record(value) || !exact(value, ['logo', 'terms', 'version']) || !validLogo(value.logo) ||
    !validTerms(value.terms) || !positive(value.version)) throw new Error('Invalid letterhead extras response');
  return { logo: value.logo === null ? null : { ...value.logo }, terms: [...value.terms], version: value.version };
}

type Payload = Pick<LetterheadExtras, 'logo' | 'terms'> & { idempotencyKey: string; expectedVersion: number };
export function validateLetterheadExtrasCommand(value: unknown): { action: 'set_letterhead_extras'; payload: Payload } | null {
  if (!record(value) || !exact(value, ['action', 'payload']) || value.action !== 'set_letterhead_extras' || !record(value.payload)) return null;
  const p = value.payload;
  if (!exact(p, ['idempotencyKey', 'expectedVersion', 'logo', 'terms']) || typeof p.idempotencyKey !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.idempotencyKey) ||
    !positive(p.expectedVersion) || !validLogo(p.logo) || !validTerms(p.terms)) return null;
  return { action: 'set_letterhead_extras', payload: { idempotencyKey: p.idempotencyKey, expectedVersion: p.expectedVersion,
    logo: p.logo === null ? null : { ...p.logo }, terms: p.terms.map(t => t.trim()) } };
}

export function logoBytes(extras: LetterheadExtras): Uint8Array | null {
  return extras.logo === null ? null : decodeLogo(extras.logo);
}
