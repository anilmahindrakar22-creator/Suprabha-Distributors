export const brandAreaCodes = ['HAEM', 'BIOCHEM', 'IMMUNO', 'HBA1C', 'URINE', 'COAG', 'RAPID', 'CULTURE'] as const;
export type BrandAreaCode = typeof brandAreaCodes[number];
export type BrandLinkKind = 'brand' | 'none';
export type BrandMappingBrand = { code: string; name: string; areas: BrandAreaCode[] };
export type BrandMappingGroup = {
  group: string; label: string; items: number; salesPaise: number;
  linkId: string | null; kind: BrandLinkKind | null; brandCode: string | null;
};
export type BrandMappingItem = {
  itemKey: string; name: string; group: string; salesPaise: number;
  linkId: string | null; kind: BrandLinkKind | 'inherit' | null; brandCode: string | null;
};
export type BrandMappingEquipment = { itemKey: string; name: string; installs: number; linkId: string | null; areaCode: BrandAreaCode | null };
export type BrandMappingResponse = {
  brands: BrandMappingBrand[]; groups: BrandMappingGroup[]; items: BrandMappingItem[];
  equipment: BrandMappingEquipment[]; total: number; page: number;
  unmappedSalesPaise: number; totalSalesPaise: number;
};
type ExpectedLink = { expectedLinkId: string | null; idempotencyKey: string };
export type BrandMappingCommand =
  | { action: 'set_group_brand'; payload: ExpectedLink & { group: string; brandCode: string | null } }
  | { action: 'set_item_brand'; payload: ExpectedLink & { itemKey: string } & ({ brandCode: string | null } | { clear: true }) }
  | { action: 'set_equipment_area'; payload: ExpectedLink & { itemKey: string; areaCode: BrandAreaCode | null } }
  | { action: 'add_brand'; payload: { name: string; idempotencyKey: string } };
export type BrandMappingCommandResult = { ok: true; linkId: string } | { ok: true; code: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const code = /^[A-Z][A-Z0-9_]{1,39}$/;
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const keys = (v: Record<string, unknown>, expected: string[]) => Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v, k));
const text = (v: unknown): v is string => typeof v === 'string';
const nonempty = (v: unknown): v is string => text(v) && v.trim().length > 0;
const validCode = (v: unknown): v is string => text(v) && code.test(v);
const area = (v: unknown): v is BrandAreaCode => text(v) && (brandAreaCodes as readonly string[]).includes(v);
const nullableUuid = (v: unknown) => v === null || (text(v) && uuid.test(v));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const count = (v: unknown, minimum = 0): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= minimum;
const length = (v: string) => Array.from(v).length;

/** Exact Tally keys and groups must survive parsing unchanged, including control characters. */
export function parseBrandMappingCommand(value: unknown): BrandMappingCommand | null {
  if (!record(value) || !text(value.idempotencyKey) || length(value.idempotencyKey.trim()) < 16 || length(value.idempotencyKey) > 200) return null;
  const { action, ...payload } = value;
  if (action === 'add_brand') {
    if (!keys(payload, ['name', 'idempotencyKey']) || !text(payload.name)) return null;
    const name = payload.name.trim();
    const derived = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    if (length(name) < 2 || length(name) > 60 || !code.test(derived)) return null;
    return { action, payload: { name, idempotencyKey: value.idempotencyKey } };
  }
  if (!nullableUuid(payload.expectedLinkId)) return null;
  const common = ['expectedLinkId', 'idempotencyKey'];
  if (action === 'set_group_brand') {
    if (!keys(payload, common.concat('group', 'brandCode')) || !text(payload.group)
      || !(payload.brandCode === null || validCode(payload.brandCode))) return null;
  } else if (action === 'set_item_brand') {
    if (!nonempty(payload.itemKey)) return null;
    if (Object.hasOwn(payload, 'clear')) {
      if (!keys(payload, common.concat('itemKey', 'clear')) || payload.clear !== true) return null;
    } else if (!keys(payload, common.concat('itemKey', 'brandCode')) || !(payload.brandCode === null || validCode(payload.brandCode))) return null;
  } else if (action === 'set_equipment_area') {
    if (!keys(payload, common.concat('itemKey', 'areaCode')) || !nonempty(payload.itemKey)
      || !(payload.areaCode === null || area(payload.areaCode))) return null;
  } else return null;
  return { action, payload } as BrandMappingCommand;
}

function link(v: Record<string, unknown>, inherit: boolean) {
  if (!nullableUuid(v.linkId)) return false;
  if (v.linkId === null) return v.kind === null && v.brandCode === null;
  if (v.kind === 'brand') return validCode(v.brandCode);
  return (v.kind === 'none' || (inherit && v.kind === 'inherit')) && v.brandCode === null;
}

/** Reject partial or drifted gateway output before presenting it as mapping data. */
export function parseBrandMappingResponse(value: unknown): BrandMappingResponse | null {
  if (!record(value) || !keys(value, ['brands', 'groups', 'items', 'equipment', 'total', 'page', 'unmappedSalesPaise', 'totalSalesPaise'])
    || !count(value.total) || !count(value.page, 1) || value.page > 4000
    || !finite(value.unmappedSalesPaise) || !finite(value.totalSalesPaise)) return null;
  if (!Array.isArray(value.brands) || !value.brands.every(v => record(v) && keys(v, ['code', 'name', 'areas'])
    && validCode(v.code) && nonempty(v.name) && Array.isArray(v.areas) && v.areas.every(area)
    && new Set(v.areas).size === v.areas.length)) return null;
  if (!Array.isArray(value.groups) || !value.groups.every(v => record(v)
    && keys(v, ['group', 'label', 'items', 'salesPaise', 'linkId', 'kind', 'brandCode'])
    && text(v.group) && text(v.label) && count(v.items, 1) && finite(v.salesPaise) && link(v, false))) return null;
  if (!Array.isArray(value.items) || value.items.length > 20 || value.items.length > value.total || !value.items.every(v => record(v)
    && keys(v, ['itemKey', 'name', 'group', 'salesPaise', 'linkId', 'kind', 'brandCode'])
    && nonempty(v.itemKey) && nonempty(v.name) && text(v.group) && finite(v.salesPaise) && link(v, true))) return null;
  if (!Array.isArray(value.equipment) || !value.equipment.every(v => record(v)
    && keys(v, ['itemKey', 'name', 'installs', 'linkId', 'areaCode']) && nonempty(v.itemKey) && nonempty(v.name)
    && count(v.installs, 1) && nullableUuid(v.linkId) && (v.areaCode === null || (v.linkId !== null && area(v.areaCode))))) return null;
  return value as BrandMappingResponse;
}
