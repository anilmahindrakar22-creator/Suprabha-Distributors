export type GrowthTier = 'diamond' | 'platinum' | 'gold' | 'silver' | 'untiered';
export type GrowthTierList = GrowthTier | 'movers' | 'placement';
export const growthTierOrder: GrowthTier[] = ['diamond', 'platinum', 'gold', 'silver', 'untiered'];
export type GrowthTierRow = { tier: GrowthTier; labs: number; consumablesPaise: number; sharePct: number; withInstrument: number };
export type GrowthTiersData = {
  month: string; stale: boolean;
  bands: { diamond: number; platinum: number; gold: number; silver: number };
  tiers: GrowthTierRow[]; movers: { up: number; down: number }; placement: { labs: number; consumablesPaise: number };
};
export type GrowthTierLab = {
  labKey: string; customerId: string | null; name: string | null; town: string | null; phone: string | null;
  tier: GrowthTier; consumablesPaise: number; hasInstrument: boolean; previousTier: GrowthTier | null;
  change: 'up' | 'down' | 'same' | 'new';
};
export type GrowthTierLabsData = { list: GrowthTierList; totalLabs: number; rows: GrowthTierLab[] };

type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const nullableText = (v: unknown): v is string | null => v === null || typeof v === 'string';
export const isGrowthTier = (v: unknown): v is GrowthTier => v === 'diamond' || v === 'platinum' || v === 'gold' || v === 'silver' || v === 'untiered';
const isList = (v: unknown): v is GrowthTierList => isGrowthTier(v) || v === 'movers' || v === 'placement';
const month = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-01$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

function tierRow(v: unknown): GrowthTierRow | null {
  if (!object(v) || !isGrowthTier(v.tier) || !integer(v.labs) || !integer(v.consumablesPaise) || !integer(v.withInstrument) || v.withInstrument > v.labs) return null;
  if (typeof v.sharePct !== 'number' || !Number.isFinite(v.sharePct) || v.sharePct < 0 || v.sharePct > 100) return null;
  return { tier: v.tier, labs: v.labs, consumablesPaise: v.consumablesPaise, sharePct: v.sharePct, withInstrument: v.withInstrument };
}
export function normalizeGrowthTiers(raw: unknown): GrowthTiersData | null {
  if (!object(raw) || !month(raw.month) || typeof raw.stale !== 'boolean' || !object(raw.bands) || !Array.isArray(raw.tiers) || raw.tiers.length !== 5) return null;
  const b = raw.bands, m = raw.movers, p = raw.placement;
  if (!integer(b.diamond) || !integer(b.platinum) || !integer(b.gold) || !integer(b.silver) || !(b.diamond > b.platinum && b.platinum > b.gold && b.gold > b.silver)) return null;
  if (!object(m) || !integer(m.up) || !integer(m.down) || !object(p) || !integer(p.labs) || !integer(p.consumablesPaise)) return null;
  const tiers = raw.tiers.map(tierRow);
  if (tiers.some((row, i) => row === null || row.tier !== growthTierOrder[i])) return null;
  return { month: raw.month, stale: raw.stale, bands: { diamond: b.diamond, platinum: b.platinum, gold: b.gold, silver: b.silver }, tiers: tiers.filter(row => row !== null), movers: { up: m.up, down: m.down }, placement: { labs: p.labs, consumablesPaise: p.consumablesPaise } };
}
function lab(v: unknown): GrowthTierLab | null {
  if (!object(v) || !text(v.labKey) || !(v.customerId === null || text(v.customerId)) || !nullableText(v.name) || !nullableText(v.town) || !nullableText(v.phone)) return null;
  if (!isGrowthTier(v.tier) || !integer(v.consumablesPaise) || typeof v.hasInstrument !== 'boolean' || !(v.previousTier === null || isGrowthTier(v.previousTier))) return null;
  if (v.change !== 'up' && v.change !== 'down' && v.change !== 'same' && v.change !== 'new') return null;
  return { labKey: v.labKey, customerId: v.customerId, name: v.name, town: v.town, phone: v.phone, tier: v.tier, consumablesPaise: v.consumablesPaise, hasInstrument: v.hasInstrument, previousTier: v.previousTier, change: v.change };
}
export function normalizeGrowthTierLabs(raw: unknown): GrowthTierLabsData | null {
  if (!object(raw) || !isList(raw.list) || !integer(raw.totalLabs) || !Array.isArray(raw.rows) || raw.rows.length > 100 || raw.totalLabs < raw.rows.length) return null;
  const rows = raw.rows.map(lab);
  if (rows.some(row => row === null)) return null;
  return { list: raw.list, totalLabs: raw.totalLabs, rows: rows.filter(row => row !== null) };
}
