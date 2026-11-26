export type GrowthNewLabRow = {
  labKey: string; customerId: string | null; name: string | null; town: string | null; phone: string | null;
  firstPurchaseOn: string; firstOrderPaise: number; orderDays: number; lastPurchaseOn: string;
  daysSinceFirst: number; totalPaise: number; status: 'overdue' | 'due' | 'early' | 'repeat';
};
export type GrowthNewLabsData = {
  filter: 'new'; windowDays: 90; asOf: string; totalLabs: number; repeatLabs: number; rows: GrowthNewLabRow[];
};

type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const nullableText = (v: unknown): v is string | null => v === null || typeof v === 'string';
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

function row(v: unknown): GrowthNewLabRow | null {
  if (!object(v) || typeof v.labKey !== 'string' || !v.labKey.trim()) return null;
  if (!(v.customerId === null || (typeof v.customerId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.customerId)))) return null;
  if (!nullableText(v.name) || !nullableText(v.town) || !nullableText(v.phone)) return null;
  if (!date(v.firstPurchaseOn) || !date(v.lastPurchaseOn)) return null;
  if (!integer(v.firstOrderPaise) || !integer(v.orderDays) || !integer(v.daysSinceFirst) || !integer(v.totalPaise)) return null;
  if (v.status !== 'overdue' && v.status !== 'due' && v.status !== 'early' && v.status !== 'repeat') return null;
  return { labKey: v.labKey, customerId: v.customerId, name: v.name, town: v.town, phone: v.phone,
    firstPurchaseOn: v.firstPurchaseOn, firstOrderPaise: v.firstOrderPaise, orderDays: v.orderDays,
    lastPurchaseOn: v.lastPurchaseOn, daysSinceFirst: v.daysSinceFirst, totalPaise: v.totalPaise, status: v.status };
}

export function normalizeGrowthNewLabs(raw: unknown): GrowthNewLabsData | null {
  if (!object(raw) || raw.filter !== 'new' || raw.windowDays !== 90 || !date(raw.asOf)) return null;
  if (!integer(raw.totalLabs) || !integer(raw.repeatLabs) || raw.repeatLabs > raw.totalLabs) return null;
  if (!Array.isArray(raw.rows) || raw.rows.length > 50 || raw.rows.length > raw.totalLabs) return null;
  const rows = raw.rows.map(row);
  if (rows.some(r => r === null)) return null;
  return { filter: 'new', windowDays: 90, asOf: raw.asOf, totalLabs: raw.totalLabs, repeatLabs: raw.repeatLabs, rows: rows as GrowthNewLabRow[] };
}
