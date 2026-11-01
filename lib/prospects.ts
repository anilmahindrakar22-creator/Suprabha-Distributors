import { bandLabel, labAreaCodes, type LabFit } from './lab-mix';

export type ProspectBrand = { code: string; name: string; areas: typeof labAreaCodes[number][] };
export type ProspectArea = { area: typeof labAreaCodes[number]; name: string; status: 'in_house' | 'sends_out' | 'not_done'; min: number | null; max: number | null; exact: boolean };
type ProspectRowBase = {
  customerId: string; name: string; city: string | null; reportedOn: string; stale: boolean; fit: LabFit | null;
  packWasteRisk: boolean | null; areas: ProspectArea[]; volume: number; hasOurMachine: boolean;
};
export type FinancialProspectRow = ProspectRowBase & { brandSalesPaise: number; buysBrand?: never };
export type SalesProspectRow = ProspectRowBase & { buysBrand: boolean; brandSalesPaise?: never };
export type ProspectRow = FinancialProspectRow | SalesProspectRow;
export type Prospects = {
  brand: ProspectBrand; brands: ProspectBrand[]; rows: ProspectRow[]; total: number; page: number;
  mappedShare: { unmappedSalesPaise: number; totalSalesPaise: number } | null;
};

export function prospectAreaLine(areas: ProspectArea[]): string {
  return areas.map(row => `${row.name} ${row.status === 'in_house'
    ? `${row.exact ? row.min : bandLabel(row.min!, row.max)}/day`
    : row.status === 'sends_out' ? 'sends out' : 'not done'}`).join(' · ');
}

/** Compare the actual share before rounding its display value. */
export function unmappedWarningPercent(share: Prospects['mappedShare']): number | null {
  return share && share.totalSalesPaise > 0 && share.unmappedSalesPaise / share.totalSalesPaise >= 0.1
    ? Math.round(100 * share.unmappedSalesPaise / share.totalSalesPaise) : null;
}

function invalid(): never { throw new Error('Invalid prospects'); }
function obj(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const v = value as Record<string, unknown>;
  if (required.some(k => !Object.hasOwn(v, k)) || Object.keys(v).some(k => !required.includes(k) && !optional.includes(k))) return invalid();
  return v;
}
function str(value: unknown): string { return typeof value === 'string' && value.trim().length > 0 ? value : invalid(); }
function bool(value: unknown): boolean { return typeof value === 'boolean' ? value : invalid(); }
function int(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : invalid();
}
function money(value: unknown): number { return typeof value === 'number' && Number.isSafeInteger(value) ? value : invalid(); }
function uuid(value: unknown): string {
  const s = str(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : invalid();
}
function date(value: unknown): string {
  const s = str(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? s : invalid();
}
function areaCode(value: unknown): typeof labAreaCodes[number] {
  return labAreaCodes.includes(value as typeof labAreaCodes[number]) ? value as typeof labAreaCodes[number] : invalid();
}
function orderedAreas(value: unknown): typeof labAreaCodes[number][] {
  if (!Array.isArray(value)) return invalid();
  const result = value.map(areaCode);
  if (new Set(result).size !== result.length) return invalid();
  return result;
}
function parseBrand(value: unknown): ProspectBrand {
  const b = obj(value, ['code', 'name', 'areas']);
  const code = str(b.code);
  if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) return invalid();
  return { code, name: str(b.name), areas: orderedAreas(b.areas) };
}
function parseRow(value: unknown, brand: ProspectBrand, mode: 'financial' | 'sales'): ProspectRow {
  const common = ['customerId', 'name', 'city', 'reportedOn', 'stale', 'fit', 'packWasteRisk', 'areas', 'volume', 'hasOurMachine'];
  const v = mode === 'financial' ? obj(value, [...common, 'brandSalesPaise']) : obj(value, [...common, 'buysBrand']);
  if (Object.hasOwn(v, mode === 'financial' ? 'buysBrand' : 'brandSalesPaise')) return invalid();
  const areas = Array.isArray(v.areas) ? v.areas.map(item => {
    const a = obj(item, ['area', 'name', 'status', 'min', 'max', 'exact']);
    const area = areaCode(a.area), status = a.status;
    if (!['in_house', 'sends_out', 'not_done'].includes(status as string) || !brand.areas.includes(area)) return invalid();
    const min = a.min === null ? null : int(a.min, 1, 100000), max = a.max === null ? null : int(a.max, 1, 100000), exact = bool(a.exact);
    if (status === 'in_house') {
      const bands = area === 'IMMUNO'
        ? [[1, 14], [15, 30], [31, 60], [61, null]] as const
        : [[1, 20], [21, 50], [51, 100], [101, null]] as const;
      if (min === null || max !== null && max < min || exact && max !== min
        || !exact && !bands.some(([lo, hi]) => min === lo && max === hi)) return invalid();
    } else if (min !== null || max !== null || exact) return invalid();
    return { area, name: str(a.name), status: status as ProspectArea['status'], min, max, exact };
  }) : invalid();
  if (new Set(areas.map(a => a.area)).size !== areas.length
    || areas.some((a, i) => i > 0 && labAreaCodes.indexOf(areas[i - 1].area) >= labAreaCodes.indexOf(a.area))) return invalid();
  if (!areas.some(a => a.status === 'in_house' || a.status === 'sends_out')) return invalid();
  const immuno = brand.areas.includes('IMMUNO');
  const fit = v.fit === null ? null : v.fit;
  if (!immuno && fit !== null) return invalid();
  const packWasteRisk = v.packWasteRisk === null ? null : bool(v.packWasteRisk);
  if (!immuno && packWasteRisk !== null) return invalid();
  const immunoArea = areas.find(a => a.area === 'IMMUNO');
  if (immuno) {
    if (fit === null) return invalid();
    if (!immunoArea ? fit !== 'unknown'
      : immunoArea.status !== 'in_house' ? fit !== 'none'
        : !['vidas', 'clia', 'check'].includes(fit as string)) return invalid();
    if (fit === 'check' && immunoArea?.exact || fit === 'vidas' && immunoArea?.max === null) return invalid();
  }
  if (packWasteRisk !== null && fit !== 'clia') return invalid();
  const volume = int(v.volume);
  if (volume !== areas.reduce((sum, a) => sum + (a.status === 'in_house' ? a.min! : 0), 0)) return invalid();
  const base: ProspectRowBase = {
    customerId: uuid(v.customerId), name: str(v.name), city: v.city === null ? null : str(v.city), reportedOn: date(v.reportedOn),
    stale: bool(v.stale), fit: fit as LabFit | null, packWasteRisk, areas, volume, hasOurMachine: bool(v.hasOurMachine),
  };
  return mode === 'financial' ? { ...base, brandSalesPaise: money(v.brandSalesPaise) } : { ...base, buysBrand: bool(v.buysBrand) };
}

/** Strictly validates the paginated prospects transport payload and its mutually exclusive row modes. */
export function parseProspects(value: unknown): Prospects {
  const v = obj(value, ['brand', 'brands', 'rows', 'total', 'page', 'mappedShare']);
  const brand = parseBrand(v.brand);
  if (!Array.isArray(v.brands)) return invalid();
  const brands = v.brands.map(parseBrand);
  if (!brands.length || new Set(brands.map(b => b.code)).size !== brands.length || !brands.some(b => b.code === brand.code && b.name === brand.name && b.areas.join(',') === brand.areas.join(','))) return invalid();
  const total = int(v.total), page = int(v.page, 1, 4000);
  if (!Array.isArray(v.rows) || v.rows.length > 20 || v.rows.length > total) return invalid();
  const financial = v.mappedShare !== null;
  let mappedShare: Prospects['mappedShare'] = null;
  if (financial) {
    const m = obj(v.mappedShare, ['unmappedSalesPaise', 'totalSalesPaise']);
    mappedShare = { unmappedSalesPaise: money(m.unmappedSalesPaise), totalSalesPaise: money(m.totalSalesPaise) };
  }
  const rows = v.rows.map(row => parseRow(row, brand, financial ? 'financial' : 'sales'));
  if (new Set(rows.map(r => r.customerId)).size !== rows.length) return invalid();
  return { brand, brands, rows, total, page, mappedShare };
}
