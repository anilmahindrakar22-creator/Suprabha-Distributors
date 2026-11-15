import { brandAreaCodes, type BrandAreaCode } from './brand-mapping';

export type GrowthBrandMeasures = {
  salesPaise: number; h1Paise: number; h2Paise: number; instrumentSalesPaise: number; consumablesSalesPaise: number;
  knownSalesPaise: number; gpPaise: number; marginPct: number | null; items: number;
};
export type GrowthBrandLine = GrowthBrandMeasures & { kind: 'line' | 'direct' | 'individual'; group: string | null; areaCode: BrandAreaCode | null };
export type GrowthBrandRow = GrowthBrandMeasures & {
  key: string; kind: 'brand' | 'none' | 'unmapped'; brandCode: string | null; name: string; lines: GrowthBrandLine[];
};
export type GrowthBrandsData = {
  window: { from: string; to: string; h2From: string };
  totals: { salesPaise: number; instrumentSalesPaise: number; consumablesSalesPaise: number; knownSalesPaise: number; gpPaise: number; marginPct: number | null };
  rows: GrowthBrandRow[];
};

type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const count = (v: unknown): v is number => integer(v) && v >= 0;
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const margin = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v));
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const rowKinds = ['brand', 'none', 'unmapped'];
const lineKinds = ['line', 'direct', 'individual'];
const areaCodes: readonly string[] = brandAreaCodes;

function measures(v: Obj): GrowthBrandMeasures | null {
  const paise = [v.salesPaise, v.h1Paise, v.h2Paise, v.instrumentSalesPaise, v.consumablesSalesPaise, v.knownSalesPaise, v.gpPaise];
  if (!paise.every(integer) || !margin(v.marginPct) || !count(v.items)) return null;
  return {
    salesPaise: v.salesPaise as number, h1Paise: v.h1Paise as number, h2Paise: v.h2Paise as number,
    instrumentSalesPaise: v.instrumentSalesPaise as number, consumablesSalesPaise: v.consumablesSalesPaise as number,
    knownSalesPaise: v.knownSalesPaise as number, gpPaise: v.gpPaise as number, marginPct: v.marginPct as number | null, items: v.items as number,
  };
}

function line(v: unknown): GrowthBrandLine | null {
  if (!object(v) || typeof v.kind !== 'string' || !lineKinds.includes(v.kind) || !(v.group === null || typeof v.group === 'string')) return null;
  if (!(v.areaCode === null || (typeof v.areaCode === 'string' && areaCodes.includes(v.areaCode)))) return null;
  const m = measures(v);
  return m && { ...m, kind: v.kind as GrowthBrandLine['kind'], group: v.group, areaCode: v.areaCode as BrandAreaCode | null };
}

function row(v: unknown): GrowthBrandRow | null {
  if (!object(v) || !text(v.key) || typeof v.kind !== 'string' || !rowKinds.includes(v.kind) || !text(v.name) || !Array.isArray(v.lines)) return null;
  if (v.kind === 'brand' ? !text(v.brandCode) : v.brandCode !== null) return null;
  const m = measures(v);
  const lines = v.lines.map(line);
  if (!m || lines.some(l => l === null)) return null;
  return { ...m, key: v.key, kind: v.kind as GrowthBrandRow['kind'], brandCode: v.brandCode as string | null, name: v.name, lines: lines as GrowthBrandLine[] };
}

export function normalizeGrowthBrands(raw: unknown): GrowthBrandsData | null {
  if (!object(raw) || !object(raw.window) || !object(raw.totals) || !Array.isArray(raw.rows)) return null;
  const { window: w, totals: t } = raw;
  if (!date(w.from) || !date(w.to) || !date(w.h2From)) return null;
  if (![t.salesPaise, t.instrumentSalesPaise, t.consumablesSalesPaise, t.knownSalesPaise, t.gpPaise].every(integer) || !margin(t.marginPct)) return null;
  const rows = raw.rows.map(row);
  if (rows.some(r => r === null)) return null;
  return {
    window: { from: w.from, to: w.to, h2From: w.h2From },
    totals: {
      salesPaise: t.salesPaise as number, instrumentSalesPaise: t.instrumentSalesPaise as number, consumablesSalesPaise: t.consumablesSalesPaise as number,
      knownSalesPaise: t.knownSalesPaise as number, gpPaise: t.gpPaise as number, marginPct: t.marginPct as number | null,
    },
    rows: rows as GrowthBrandRow[],
  };
}
