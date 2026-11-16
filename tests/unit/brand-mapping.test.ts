import { describe, expect, it } from 'vitest';
import { buildSetItemKindPayload, parseBrandMappingCommand, parseBrandMappingResponse } from '@/lib/brand-mapping';

const id = 'b3a10000-0000-4000-8000-000000000001';
const base = { expectedLinkId: null, idempotencyKey: 'brand-mapping-test-key' };
const read = () => ({
  brands: [{ code: 'BIOMERIEUX', name: 'bioMérieux', areas: ['IMMUNO', 'CULTURE'] }],
  groups: [{ group: '\u0004 Primary', label: 'Primary', items: 1, salesPaise: 100, linkId: id, kind: 'none', brandCode: null }],
  items: [{ itemKey: 'item-1', name: 'Item', group: 'Primary', salesPaise: -50, linkId: id, kind: 'inherit', brandCode: null }],
  equipment: [{ itemKey: 'machine', name: 'Machine', installs: 2, linkId: null, areaCode: null }],
  total: 1, page: 1, unmappedSalesPaise: 0, totalSalesPaise: 100,
});

describe('brand mapping commands', () => {
  it('builds the exact item-kind payload and trims the reason', () => {
    const input = { requestId: id, companyId: 'company-1', productId: 'product-1', kind: 'consumable' as const, reason: ' Costly reagent ' };
    expect(buildSetItemKindPayload(input)).toEqual({ ...input, reason: 'Costly reagent' });
    expect(parseBrandMappingCommand({ action: 'set_item_kind', ...input })).toEqual({ action: 'set_item_kind', payload: { ...input, reason: 'Costly reagent' } });
    for (const change of [{ reason: 'ab' }, { reason: 'x'.repeat(501) }, { kind: 'other' }, { companyId: '' }, { productId: '' }, { requestId: 'bad' }, { extra: true }]) {
      expect(parseBrandMappingCommand({ action: 'set_item_kind', ...input, ...change })).toBeNull();
    }
  });
  it.each([
    { action: 'set_group_brand', group: '\u0004 Primary', brandCode: 'SYSMEX', ...base },
    { action: 'set_group_brand', group: '', brandCode: null, ...base },
    { action: 'set_item_brand', itemKey: 'key', brandCode: null, ...base },
    { action: 'set_item_brand', itemKey: 'key', clear: true, ...base, expectedLinkId: id },
    { action: 'set_equipment_area', itemKey: 'key', areaCode: 'HAEM', ...base },
    { action: 'set_equipment_area', itemKey: 'key', areaCode: null, ...base },
    { action: 'add_brand', name: 'bioMérieux new', idempotencyKey: base.idempotencyKey },
  ])('parses $action without changing exact keys', input => {
    const { action, ...payload } = input;
    expect(parseBrandMappingCommand(input)).toEqual({ action, payload });
  });
  it.each([
    null, [], {}, { action: 'get_brand_mapping' },
    { action: 'set_group_brand', group: 'x', ...base },
    { action: 'set_group_brand', group: 'x', brandCode: 1, ...base },
    { action: 'set_group_brand', group: 'x', brandCode: 'sysmex', ...base },
    { action: 'set_group_brand', group: 'x', brandCode: null, ...base, expectedLinkId: 'bad' },
    { action: 'set_group_brand', group: 'x', brandCode: null, ...base, extra: true },
    { action: 'set_item_brand', itemKey: '', brandCode: null, ...base },
    { action: 'set_group_brand', group: 'x', clear: false, ...base },
    { action: 'set_group_brand', group: 'x', clear: true, brandCode: null, ...base },
    { action: 'set_item_brand', itemKey: 'x', clear: false, ...base },
    { action: 'set_item_brand', itemKey: 'x', clear: true, brandCode: null, ...base },
    { action: 'set_equipment_area', itemKey: 'x', areaCode: 'INVALID', ...base },
    { action: 'add_brand', name: 'x', idempotencyKey: base.idempotencyKey },
    { action: 'add_brand', name: 'x'.repeat(61), idempotencyKey: base.idempotencyKey },
    { action: 'add_brand', name: 'Brand', idempotencyKey: 'short' },
    { action: 'add_brand', name: 'Brand', idempotencyKey: ' '.repeat(16) },
    { action: 'add_brand', name: 'Brand', idempotencyKey: 'x'.repeat(201) },
    { action: 'add_brand', name: 'Brand', idempotencyKey: base.idempotencyKey, payload: {} },
    { action: 'add_brand', name: '12', idempotencyKey: base.idempotencyKey },
  ])('rejects invalid command %#', input => expect(parseBrandMappingCommand(input)).toBeNull());
});

describe('brand mapping response', () => {
  it('accepts item kinds while preserving separate brand link state and exact IDs', () => {
    const response = { ...read(), items: [{ ...read().items[0], kind: 'instrument', brandKind: 'inherit', kindSource: 'auto', autoKind: 'instrument', companyId: 'company-1', productId: 'product-1' }] };
    expect(parseBrandMappingResponse(response)).toEqual(response);
    expect(parseBrandMappingResponse({ ...response, items: [{ ...response.items[0], kindSource: 'invalid' }] })).toBeNull();
    expect(parseBrandMappingResponse({ ...response, items: [{ ...response.items[0], autoKind: 'invalid' }] })).toBeNull();
  });
  it('preserves Unicode, negative sales, cleared and explicit none links', () => {
    expect(parseBrandMappingResponse(read())).toEqual(read());
  });
  it('preserves the latest cleared group link for the next save', () => {
    const response = { ...read(), groups: [{ ...read().groups[0], kind: 'inherit' }] };
    expect(parseBrandMappingResponse(response)).toEqual(response);
    expect(parseBrandMappingResponse({ ...response, groups: [{ ...response.groups[0], brandCode: 'SYSMEX' }] })).toBeNull();
    expect(parseBrandMappingResponse({ ...response, groups: [{ ...response.groups[0], linkId: null }] })).toBeNull();
  });
  it.each([
    (r: ReturnType<typeof read>) => ({ ...r, extra: true }),
    (r: ReturnType<typeof read>) => ({ ...r, page: 0 }),
    (r: ReturnType<typeof read>) => ({ ...r, total: 0.5 }),
    (r: ReturnType<typeof read>) => ({ ...r, totalSalesPaise: '100' }),
    (r: ReturnType<typeof read>) => ({ ...r, totalSalesPaise: Number.NaN }),
    (r: ReturnType<typeof read>) => ({ ...r, brands: [{ ...r.brands[0], areas: ['BOGUS'] }] }),
    (r: ReturnType<typeof read>) => ({ ...r, groups: [{ ...r.groups[0], kind: 'brand' }] }),
    (r: ReturnType<typeof read>) => ({ ...r, groups: [{ ...r.groups[0], linkId: null }] }),
    (r: ReturnType<typeof read>) => ({ ...r, items: [{ ...r.items[0], brandCode: 'SYSMEX' }] }),
    (r: ReturnType<typeof read>) => ({ ...r, items: Array.from({ length: 21 }, () => r.items[0]) }),
    (r: ReturnType<typeof read>) => ({ ...r, equipment: [{ ...r.equipment[0], installs: 0 }] }),
    (r: ReturnType<typeof read>) => ({ ...r, equipment: [{ ...r.equipment[0], areaCode: 'HAEM' }] }),
  ])('rejects malformed response %#', change => expect(parseBrandMappingResponse(change(read()))).toBeNull());
  it.each([null, [], {}, { ...read(), items: null }])('rejects incomplete shape %#', value => {
    expect(parseBrandMappingResponse(value)).toBeNull();
  });
});

const areaId = 'b3a10000-0000-4000-8000-000000000002';
const treeRow = (over: Record<string, unknown> = {}) => ({
  group: 'Line A', parent: 'Principal', top: 'Principal', depth: 1, items: 0, salesPaise: 5,
  linkId: null, kind: null, brandCode: null, inheritedBrandCode: 'SYSMEX', areaLinkId: areaId, areaCode: 'HAEM', ...over,
});
const withTree = (rows: unknown[] = [treeRow()], observed: string | null = '2026-11-13T05:00:00Z') => ({ ...read(), tree: rows, catalogObservedAt: observed });

describe('brand tree response', () => {
  it('accepts group clear commands and inherited tree links without a brand code', () => {
    const { action, ...payload } = { action: 'set_group_brand', group: 'Line A', clear: true, ...base };
    expect(parseBrandMappingCommand({ action, ...payload })).toEqual({ action, payload });
    const response = withTree([treeRow({ linkId: id, kind: 'inherit' })]);
    expect(parseBrandMappingResponse(response)).toEqual(response);
    expect(parseBrandMappingResponse(withTree([treeRow({ linkId: id, kind: 'inherit', brandCode: 'SYSMEX' })]))).toBeNull();
  });
  it('still parses the old shape and parses the new shape', () => {
    expect(parseBrandMappingResponse(read())).toEqual(read());
    expect(parseBrandMappingResponse(withTree())).toEqual(withTree());
    expect(parseBrandMappingResponse(withTree([treeRow({ inheritedBrandCode: null, areaLinkId: null, areaCode: null })], null))).not.toBeNull();
  });
  it.each([
    ['only tree', () => ({ ...read(), tree: [] })],
    ['only catalogObservedAt', () => ({ ...read(), catalogObservedAt: null })],
    ['extra tree row key', () => withTree([{ ...treeRow(), extra: 1 }])],
    ['area code without link', () => withTree([treeRow({ areaLinkId: null })])],
    ['lower-case inherited code', () => withTree([treeRow({ inheritedBrandCode: 'sysmex' })])],
    ['negative items', () => withTree([treeRow({ items: -1 })])],
    ['inherited code with own link', () => withTree([treeRow({ linkId: id, kind: 'brand', brandCode: 'SYSMEX' })])],
    ['bad date', () => withTree([treeRow()], 'not a date')],
  ])('rejects %s', (_name, make) => expect(parseBrandMappingResponse(make())).toBeNull());
});

describe('set_group_area command', () => {
  const area = { action: 'set_group_area', group: '\u0004 Primary ', expectedLinkId: null, areaCode: 'HAEM', idempotencyKey: base.idempotencyKey };
  it('parses a valid area and a null area and keeps the group raw', () => {
    const { action, ...payload } = area;
    expect(parseBrandMappingCommand(area)).toEqual({ action, payload });
    expect(parseBrandMappingCommand({ ...area, areaCode: null })).toEqual({ action, payload: { ...payload, areaCode: null } });
  });
  it.each([{ areaCode: 'INVALID' }, { extra: true }, { group: '' }, { expectedLinkId: 'bad' }])('rejects %o', change => {
    expect(parseBrandMappingCommand({ ...area, ...change })).toBeNull();
  });
});
