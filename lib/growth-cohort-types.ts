export type GrowthCohortCounts = {
  labs: number; active: number; activePct: number; stopped: number; lostPaise: number;
};
export type GrowthCohortRow = GrowthCohortCounts & { cohort: string; label: string };
export type GrowthCohortsData = {
  asOf: string; historyFrom: string; reconciled: boolean;
  rows: GrowthCohortRow[]; totals: GrowthCohortCounts;
};
export type GrowthCohortLab = {
  labKey: string; customerId: string | null; name: string; town: string | null;
  firstPurchaseOn: string; lastPurchaseOn: string; lostPaise: number;
};
export type GrowthCohortLabsData = { cohort: string; label: string; totalLabs: number; rows: GrowthCohortLab[] };

type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const cohort = (v: unknown): v is string => typeof v === 'string' && /^(existing|\d{4})$/.test(v);
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

function counts(v: unknown): GrowthCohortCounts | null {
  if (!object(v) || !integer(v.labs) || !integer(v.active) || !integer(v.activePct) || v.activePct > 100 || !integer(v.stopped) || !integer(v.lostPaise)) return null;
  return { labs: v.labs, active: v.active, activePct: v.activePct, stopped: v.stopped, lostPaise: v.lostPaise };
}
function row(v: unknown): GrowthCohortRow | null {
  if (!object(v) || !cohort(v.cohort) || !text(v.label)) return null;
  const values = counts(v);
  return values && { cohort: v.cohort, label: v.label, ...values };
}
function lab(v: unknown): GrowthCohortLab | null {
  if (!object(v) || !text(v.labKey) || !(v.customerId === null || text(v.customerId)) || !text(v.name) || !(v.town === null || typeof v.town === 'string')) return null;
  if (!date(v.firstPurchaseOn) || !date(v.lastPurchaseOn) || !integer(v.lostPaise)) return null;
  return { labKey: v.labKey, customerId: v.customerId, name: v.name, town: v.town, firstPurchaseOn: v.firstPurchaseOn, lastPurchaseOn: v.lastPurchaseOn, lostPaise: v.lostPaise };
}
export function normalizeGrowthCohorts(raw: unknown): GrowthCohortsData | null {
  if (!object(raw) || !date(raw.asOf) || !date(raw.historyFrom) || typeof raw.reconciled !== 'boolean' || !Array.isArray(raw.rows) || raw.rows.length > 30) return null;
  const rows = raw.rows.map(row), totals = counts(raw.totals);
  if (!totals || rows.some(r => r === null)) return null;
  return { asOf: raw.asOf, historyFrom: raw.historyFrom, reconciled: raw.reconciled, rows: rows.filter(r => r !== null), totals };
}
export function normalizeGrowthCohortLabs(raw: unknown): GrowthCohortLabsData | null {
  if (!object(raw) || !cohort(raw.cohort) || !text(raw.label) || !integer(raw.totalLabs) || !Array.isArray(raw.rows) || raw.rows.length > 50 || raw.totalLabs < raw.rows.length) return null;
  const rows = raw.rows.map(lab);
  if (rows.some(r => r === null)) return null;
  return { cohort: raw.cohort, label: raw.label, totalLabs: raw.totalLabs, rows: rows.filter(r => r !== null) };
}
