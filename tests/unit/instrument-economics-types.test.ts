import { describe, expect, it } from 'vitest';
import { normalizeEconomicAreaMetadata, validateEconomicCommand, type EconomicItemAreasPayload, type EconomicMappingsPayload } from '@/lib/instrument-economics-types';

const linkId = '12345678-1234-1234-1234-123456789abc';
const lab = { code: 'COAG', name: 'Coagulation' };
const item = { companyId: 'company', productId: 'item', areaCode: 'COAG', linkId };

describe('economics area metadata contract', () => {
  it('defaults absent optional keys to empty arrays on existing workspace responses', () => {
    expect(normalizeEconomicAreaMetadata({ targets: [] })).toEqual({ labAreas: [], itemAreas: [] });
    expect(normalizeEconomicAreaMetadata({ labAreas: [lab] })).toEqual({ labAreas: [lab], itemAreas: [] });
    expect(normalizeEconomicAreaMetadata({ itemAreas: [item] })).toEqual({ labAreas: [], itemAreas: [item] });
  });
  it.each(['summary', 'detail', 'full'])('keeps area metadata and null-clear concurrency IDs on %s', readView => {
    const itemAreas = [item, { ...item, companyId: 'other-company', areaCode: null }];
    expect(normalizeEconomicAreaMetadata({ readView, labAreas: [lab], itemAreas })).toEqual({ labAreas: [lab], itemAreas });
  });
  it.each([null, [], 'bad', { labAreas: null }, { itemAreas: {} }, { labAreas: undefined }, { itemAreas: undefined },
    { labAreas: [null] }, { labAreas: [{ ...lab, code: 'UNKNOWN' }] }, { labAreas: [{ code: 'COAG', name: '' }] },
    { labAreas: [lab, lab] }, { itemAreas: [null] }, { itemAreas: [item, item] },
    ...['companyId', 'productId', 'linkId'].flatMap(key => [null, 1, '', ' '].map(value => ({ itemAreas: [{ ...item, [key]: value }] }))),
    { itemAreas: [{ ...item, linkId: 'not-a-uuid' }] }, { itemAreas: [{ ...item, areaCode: 'UNKNOWN' }] },
    { itemAreas: [{ ...item, areaCode: undefined }] }, { itemAreas: [{ companyId: 'company', productId: 'item', linkId }] },
  ])('rejects malformed present metadata: %j', raw => {
    expect(normalizeEconomicAreaMetadata(raw)).toBeNull();
  });
  it('accepts action and payload contracts without stripping batch group data', () => {
    const area: EconomicItemAreasPayload = { companyId: 'company', reason: 'Correct test area', areaCode: null, items: [{ productId: 'item', expectedLinkId: linkId }] };
    const mappings: EconomicMappingsPayload = { companyId: 'company', modelId: 'model', targetId: 'target', reason: 'Group with ticks', group: { groupId: 'group', expectedCatalogId: linkId, effectiveFrom: '2026-11-01' }, items: [] };
    for (const command of [
      { action: 'set_item_areas', payload: { ...area, idempotencyKey: 'area-command-0000001' } },
      { action: 'set_mappings', payload: { ...mappings, idempotencyKey: 'mapping-command-0001' } },
    ]) expect(validateEconomicCommand(command)).toEqual(command);
  });
});
