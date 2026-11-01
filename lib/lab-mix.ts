export const labAreaCodes = ['HAEM', 'BIOCHEM', 'IMMUNO', 'HBA1C', 'URINE', 'COAG', 'RAPID', 'CULTURE'] as const;
export const labTestCodes = ['TSH', 'FT4', 'FT3_T3', 'VITD', 'B12', 'FERRITIN', 'PROLACTIN', 'BHCG', 'PSA', 'PCT', 'OTHER'] as const;
export const labPanelCodes = ['FERTILITY', 'VITD_B12', 'CARDIAC', 'TUMOUR', 'INFECTIOUS', 'OTHER'] as const;
export type LabFit = 'none' | 'vidas' | 'clia' | 'check' | 'unknown';
type AreaCode = typeof labAreaCodes[number];
type TestCode = typeof labTestCodes[number];
type PanelCode = typeof labPanelCodes[number];
type AreaStatus = 'in_house' | 'sends_out' | 'not_done';
type PanelStatus = 'in_house' | 'sent_out' | 'not_offered';
type Band = { min: number; max: number | null };
type Volume = Band & { exact: boolean };
export type LabMixPolicy = { version: number; cliaCutoffPerDay: number; packWastePerDay: number; staleAfterDays: number };
export type LabMix = {
  reportId: string; reportedBy: string; reportedOn: string; stale: boolean;
  areas: { area: AreaCode; name: string; status: AreaStatus; min: number | null; max: number | null; exact: boolean }[];
  busiest: ({ test: TestCode; name: string } & Volume) | null;
  panels: { panel: PanelCode; name: string; status: PanelStatus }[];
  fit: LabFit; packWasteRisk: boolean | null; policyVersion: number;
};
export type LabMixOptions = {
  areas: { code: AreaCode; name: string; brandsHint: string | null; bands: Band[] }[];
  tests: { code: TestCode; name: string }[];
  panels: { code: PanelCode; name: string }[];
  busiestBands: Band[]; policy: LabMixPolicy;
};
type CountInput = { exact: number; min?: never; max?: never } | { min: number; max: number | null; exact?: never };
export type LabMixInput = {
  customerId: string;
  areas?: (({ area: AreaCode; status: 'in_house' } & CountInput) | { area: AreaCode; status: 'sends_out' | 'not_done' })[] | null;
  busiest?: ({ test: TestCode } & CountInput) | null;
  panels?: { panel: PanelCode; status: PanelStatus }[] | null;
  labSize?: { testsPerDay: number; basis: 'lab_said' | 'observed'; statedMonthlySpendPaise?: number | null; note?: string | null } | null;
};

const immunoBands: Band[] = [{ min: 1, max: 14 }, { min: 15, max: 30 }, { min: 31, max: 60 }, { min: 61, max: null }];
const genericBands: Band[] = [{ min: 1, max: 20 }, { min: 21, max: 50 }, { min: 51, max: 100 }, { min: 101, max: null }];
const busiestBands: Band[] = [{ min: 1, max: 3 }, { min: 4, max: 8 }, { min: 9, max: null }];
const areaBands = (code: AreaCode) => code === 'IMMUNO' ? immunoBands : genericBands;
function invalid(): never { throw new Error('Invalid lab mix'); }
function object(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const v = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(v, key)) || Object.keys(v).some(key => !required.includes(key) && !optional.includes(key))) return invalid();
  return v;
}
function text(value: unknown): string { return typeof value === 'string' && value.trim() ? value : invalid(); }
function integer(value: unknown, min = 1, max = 100000): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : invalid();
}
function boolean(value: unknown): boolean { return typeof value === 'boolean' ? value : invalid(); }
function choice<T extends string>(value: unknown, choices: readonly T[]): T { return choices.includes(value as T) ? value as T : invalid(); }
function uuid(value: unknown): string { const s = text(value); return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : invalid(); }
function date(value: unknown): string {
  const s = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s) return invalid();
  return s;
}
function list<T>(value: unknown, parse: (item: unknown) => T): T[] { return Array.isArray(value) ? value.map(parse) : invalid(); }
function unique<T>(items: T[], code: (item: T) => string): T[] {
  if (new Set(items.map(code)).size !== items.length) return invalid();
  return items;
}
function sorted<T>(items: T[], code: (item: T) => string, order: readonly string[]): T[] {
  unique(items, code);
  if (items.some((item, i) => i > 0 && order.indexOf(code(items[i - 1])) >= order.indexOf(code(item)))) return invalid();
  return items;
}
function volume(v: Record<string, unknown>, bands: Band[]): Volume {
  const min = integer(v.min), max = v.max === null ? null : integer(v.max), exact = boolean(v.exact);
  if (exact ? min !== max : !bands.some(band => band.min === min && band.max === max)) return invalid();
  return { min, max, exact };
}
function parseBands(value: unknown, expected: Band[]): Band[] {
  const bands = list(value, item => { const v = object(item, ['min', 'max']); return { min: integer(v.min), max: v.max === null ? null : integer(v.max) }; });
  if (bands.length !== expected.length || bands.some((band, i) => band.min !== expected[i].min || band.max !== expected[i].max)) return invalid();
  return bands;
}
function policy(value: unknown): LabMixPolicy {
  const v = object(value, ['version', 'cliaCutoffPerDay', 'packWastePerDay', 'staleAfterDays']);
  return { version: integer(v.version, 1, 2147483647), cliaCutoffPerDay: integer(v.cliaCutoffPerDay, 1, 1000),
    packWastePerDay: integer(v.packWastePerDay, 1, 1000), staleAfterDays: integer(v.staleAfterDays, 7, 730) };
}

/** Throws on malformed, unknown or inconsistent fields; optional sheet keys are handled by the caller. */
export function parseLabMix(value: unknown): LabMix {
  const v = object(value, ['reportId', 'reportedBy', 'reportedOn', 'stale', 'areas', 'busiest', 'panels', 'fit', 'packWasteRisk', 'policyVersion']);
  const areas = sorted(list(v.areas, item => {
    const a = object(item, ['area', 'name', 'status', 'min', 'max', 'exact']);
    const area = choice(a.area, labAreaCodes), status = choice(a.status, ['in_house', 'sends_out', 'not_done'] as const);
    if (status !== 'in_house' && (a.min !== null || a.max !== null || a.exact !== false)) return invalid();
    return { area, name: text(a.name), status, ...(status === 'in_house' ? volume(a, areaBands(area)) : { min: null, max: null, exact: false }) };
  }), a => a.area, labAreaCodes);
  const busiest = v.busiest === null ? null : (() => {
    const b = object(v.busiest, ['test', 'name', 'min', 'max', 'exact']);
    return { test: choice(b.test, labTestCodes), name: text(b.name), ...volume(b, busiestBands) };
  })();
  const panels = sorted(list(v.panels, item => {
    const p = object(item, ['panel', 'name', 'status']);
    return { panel: choice(p.panel, labPanelCodes), name: text(p.name), status: choice(p.status, ['in_house', 'sent_out', 'not_offered'] as const) };
  }), p => p.panel, labPanelCodes);
  const fit = choice(v.fit, ['none', 'vidas', 'clia', 'check', 'unknown'] as const);
  const immuno = areas.find(a => a.area === 'IMMUNO');
  const packWasteRisk = v.packWasteRisk === null ? null : boolean(v.packWasteRisk);
  if (!areas.length && !panels.length || busiest && immuno?.status !== 'in_house'
    || (!immuno ? fit !== 'unknown' : immuno.status !== 'in_house' ? fit !== 'none' : !['vidas', 'clia', 'check'].includes(fit))
    || packWasteRisk !== null && (fit !== 'clia' || !busiest)
    || fit === 'check' && immuno?.exact || fit === 'vidas' && immuno?.max === null
    || packWasteRisk === true && busiest?.max === null) return invalid();
  return { reportId: uuid(v.reportId), reportedBy: text(v.reportedBy), reportedOn: date(v.reportedOn), stale: boolean(v.stale),
    areas, busiest, panels, fit, packWasteRisk, policyVersion: integer(v.policyVersion, 1, 2147483647) };
}

export function parseLabMixOptions(value: unknown): LabMixOptions {
  const v = object(value, ['areas', 'tests', 'panels', 'busiestBands', 'policy']);
  return {
    areas: sorted(list(v.areas, item => {
      const a = object(item, ['code', 'name', 'brandsHint', 'bands']), code = choice(a.code, labAreaCodes);
      return { code, name: text(a.name), brandsHint: a.brandsHint === null ? null : text(a.brandsHint), bands: parseBands(a.bands, areaBands(code)) };
    }), a => a.code, labAreaCodes),
    tests: sorted(list(v.tests, item => { const t = object(item, ['code', 'name']); return { code: choice(t.code, labTestCodes), name: text(t.name) }; }), t => t.code, labTestCodes),
    panels: sorted(list(v.panels, item => { const p = object(item, ['code', 'name']); return { code: choice(p.code, labPanelCodes), name: text(p.name) }; }), p => p.code, labPanelCodes),
    busiestBands: parseBands(v.busiestBands, busiestBands), policy: policy(v.policy),
  };
}

function countInput(value: unknown, bands: Band[]): CountInput {
  const v = object(value, [], ['exact', 'min', 'max']);
  if (Object.hasOwn(v, 'exact')) {
    if (Object.keys(v).length !== 1) return invalid();
    return { exact: integer(v.exact) };
  }
  object(v, ['min', 'max']);
  const result = volume({ ...v, exact: false }, bands);
  return { min: result.min, max: result.max };
}

/** Shared transport validation; SQL also checks active lookup codes and authorization. */
export function parseLabMixInput(value: unknown): LabMixInput {
  const v = object(value, ['customerId'], ['areas', 'busiest', 'panels', 'labSize']);
  const result: LabMixInput = { customerId: uuid(v.customerId) };
  if (Object.hasOwn(v, 'areas')) result.areas = v.areas === null ? null : unique(list(v.areas, item => {
    const a = object(item, ['area', 'status'], ['exact', 'min', 'max']);
    const area = choice(a.area, labAreaCodes), status = choice(a.status, ['in_house', 'sends_out', 'not_done'] as const);
    const { area: _area, status: _status, ...counts } = a;
    if (status === 'in_house') return { area, status, ...countInput(counts, areaBands(area)) };
    if (Object.keys(counts).length) return invalid();
    return { area, status };
  }), a => a.area);
  if (Object.hasOwn(v, 'busiest')) result.busiest = v.busiest === null ? null : (() => {
    const b = object(v.busiest, ['test'], ['exact', 'min', 'max']);
    const { test, ...counts } = b;
    if (!result.areas?.some(a => a.area === 'IMMUNO' && a.status === 'in_house')) return invalid();
    return { test: choice(test, labTestCodes), ...countInput(counts, busiestBands) };
  })();
  if (Object.hasOwn(v, 'panels')) result.panels = v.panels === null ? null : unique(list(v.panels, item => {
    const p = object(item, ['panel', 'status']);
    return { panel: choice(p.panel, labPanelCodes), status: choice(p.status, ['in_house', 'sent_out', 'not_offered'] as const) };
  }), p => p.panel);
  if (!result.areas?.length && !result.panels?.length && !result.busiest) return invalid();
  if (Object.hasOwn(v, 'labSize')) result.labSize = v.labSize === null ? null : (() => {
    const s = object(v.labSize, ['testsPerDay', 'basis'], ['statedMonthlySpendPaise', 'note']);
    const parsed: NonNullable<LabMixInput['labSize']> = { testsPerDay: integer(s.testsPerDay), basis: choice(s.basis, ['lab_said', 'observed'] as const) };
    if (Object.hasOwn(s, 'statedMonthlySpendPaise')) parsed.statedMonthlySpendPaise = s.statedMonthlySpendPaise === null ? null : integer(s.statedMonthlySpendPaise, 0, 9e15);
    if (Object.hasOwn(s, 'note')) {
      parsed.note = s.note === null ? null : text(s.note).trim();
      if (parsed.note !== null && (parsed.note.length < 3 || parsed.note.length > 500)) return invalid();
    }
    return parsed;
  })();
  return result;
}

export function bandLabel(min: number, max: number | null): string {
  integer(min);
  if (max !== null && integer(max) < min) return invalid();
  return max === null ? `${min}+` : min === max ? String(min) : `${min}–${max}`;
}
