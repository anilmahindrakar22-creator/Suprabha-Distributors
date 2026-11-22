export type GrowthLabMonthRow = {
  labKey: string; customerId: string | null; name: string | null; town: string | null;
  totalPaise: number; monthsPaise: number[]; buyingMonths: number;
  lastPurchaseOn?: string; usualMonthlyPaise?: number; monthsMissed?: number; phone?: string | null;
  previousNinetyPaise?: number; lastNinetyPaise?: number;
};
export type GrowthLabMonthsData = {
  filter: 'top' | 'lapsing' | 'declining';
  window: { from: string; to: string };
  months: string[];
  totalLabs: number;
  rows: GrowthLabMonthRow[];
};

type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const month = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

function row(v: unknown): GrowthLabMonthRow | null {
  if (!object(v) || !text(v.labKey) || !(v.customerId === null || typeof v.customerId === 'string')) return null;
  if (!(v.name === null || typeof v.name === 'string') ||!(v.town === null || typeof v.town === 'string')) return null;
  if (!integer(v.totalPaise) || v.totalPaise <= 0) return null;
  if (!Array.isArray(v.monthsPaise) || v.monthsPaise.length !== 12 || !v.monthsPaise.every(integer)) return null;
  if (!integer(v.buyingMonths) || v.buyingMonths < 0 || v.buyingMonths > 12) return null;
  if ('lastPurchaseOn' in v && !date(v.lastPurchaseOn)) return null;
  if ('usualMonthlyPaise' in v && (!integer(v.usualMonthlyPaise) || v.usualMonthlyPaise < 0)) return null;
  if ('monthsMissed' in v && (!integer(v.monthsMissed) || v.monthsMissed < 0)) return null;
  if ('phone' in v && !(v.phone === null || typeof v.phone === 'string')) return null;
  if ('previousNinetyPaise' in v && (!integer(v.previousNinetyPaise) || v.previousNinetyPaise < 0)) return null;
  if ('lastNinetyPaise' in v && (!integer(v.lastNinetyPaise) || v.lastNinetyPaise < 0)) return null;
  return { labKey: v.labKey, customerId: v.customerId, name: v.name, town: v.town, totalPaise: v.totalPaise, monthsPaise: v.monthsPaise as number[], buyingMonths: v.buyingMonths,
    ...('lastPurchaseOn' in v ? { lastPurchaseOn: v.lastPurchaseOn as string } : {}),
    ...('usualMonthlyPaise' in v ? { usualMonthlyPaise: v.usualMonthlyPaise as number } : {}),
    ...('monthsMissed' in v ? { monthsMissed: v.monthsMissed as number } : {}),
    ...('phone' in v ? { phone: v.phone as string | null } : {}),
    ...('previousNinetyPaise' in v ? { previousNinetyPaise: v.previousNinetyPaise as number } : {}),
    ...('lastNinetyPaise' in v ? { lastNinetyPaise: v.lastNinetyPaise as number } : {}),
  };
}

export function normalizeGrowthLabMonths(raw: unknown, filter: GrowthLabMonthsData['filter'] = 'top'): GrowthLabMonthsData | null {
  if (!object(raw) || !object(raw.window) || !Array.isArray(raw.months) || !Array.isArray(raw.rows)) return null;
  const w = raw.window;
  if (!date(w.from) || !date(w.to)) return null;
  if (raw.months.length !== 12 || !raw.months.every(month)) return null;
  if (raw.rows.length > (filter === 'top' ? 20 : 50)) return null;
  const rows = raw.rows.map(row);
  if (rows.some(r => r === null)) return null;
  if (filter === 'declining' && rows.some(r => r?.previousNinetyPaise === undefined || r?.lastNinetyPaise === undefined)) return null;
  if (!integer(raw.totalLabs) || raw.totalLabs < rows.length) return null;
  return { filter, window: { from: w.from, to: w.to }, months: raw.months as string[], totalLabs: raw.totalLabs, rows: rows as GrowthLabMonthRow[] };
}
