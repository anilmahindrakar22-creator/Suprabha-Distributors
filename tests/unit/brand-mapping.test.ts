import { describe, expect, it } from 'vitest';
import { parseBrandMappingCommand, parseBrandMappingResponse } from '@/lib/brand-mapping';

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
  it('preserves Unicode, negative sales, cleared and explicit none links', () => {
    expect(parseBrandMappingResponse(read())).toEqual(read());
  });
  it.each([
    (r: ReturnType<typeof read>) => ({ ...r, extra: true }),
    (r: ReturnType<typeof read>) => ({ ...r, page: 0 }),
    (r: ReturnType<typeof read>) => ({ ...r, total: 0.5 }),
    (r: ReturnType<typeof read>) => ({ ...r, totalSalesPaise: '100' }),
    (r: ReturnType<typeof read>) => ({ ...r, totalSalesPaise: Number.NaN }),
    (r: ReturnType<typeof read>) => ({ ...r, brands: [{ ...r.brands[0], areas: ['BOGUS'] }] }),
    (r: ReturnType<typeof read>) => ({ ...r, groups: [{ ...r.groups[0], kind: 'inherit' }] }),
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
