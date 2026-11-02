import { describe, expect, it } from 'vitest';
import { parseProspects, prospectAreaLine, unmappedWarningPercent } from '@/lib/prospects';
import type { ProspectArea } from '@/lib/prospects';

const brand = { code: 'ACME', name: 'Acme', areas: ['HAEM', 'IMMUNO'] };
const customerId = '19300000-0000-4000-8000-000000000001';
const row = { customerId, name: 'Central Lab', city: null, reportedOn: '2026-11-01', stale: false, fit: 'none', packWasteRisk: null,
  areas: [{ area: 'HAEM', name: 'Haematology', status: 'in_house', min: 1, max: 20, exact: false },
    { area: 'IMMUNO', name: 'Immunoassay', status: 'sends_out', min: null, max: null, exact: false }],
  volume: 1, hasOurMachine: true, focus: true, brandSalesPaise: -1200 };
const payload = { brand, brands: [brand], rows: [row], total: 1, page: 1, mappedShare: { unmappedSalesPaise: 300, totalSalesPaise: -900 } };

describe('prospect display helpers', () => {
  it('joins band, exact, sends-out and not-done areas without losing Unicode', () => {
    const areas: ProspectArea[] = [
      { area: 'IMMUNO', name: 'Hormones', status: 'in_house', min: 15, max: 30, exact: false },
      { area: 'HAEM', name: 'Haematology', status: 'in_house', min: 35, max: 35, exact: true },
      { area: 'URINE', name: 'Urine', status: 'sends_out', min: null, max: null, exact: false },
      { area: 'COAG', name: 'Coagulation', status: 'not_done', min: null, max: null, exact: false },
    ];
    expect(prospectAreaLine(areas)).toBe('Hormones 15–30/day · Haematology 35/day · Urine sends out · Coagulation not done');
    expect(prospectAreaLine([{ ...areas[0], min: 61, max: null }])).toBe('Hormones 61+/day');
    expect(prospectAreaLine([])).toBe('');
  });

  it('warns at exactly ten percent, using the unrounded share', () => {
    expect(unmappedWarningPercent({ unmappedSalesPaise: 100, totalSalesPaise: 1000 })).toBe(10);
    expect(unmappedWarningPercent({ unmappedSalesPaise: 99, totalSalesPaise: 1000 })).toBeNull();
    expect(unmappedWarningPercent({ unmappedSalesPaise: 185, totalSalesPaise: 1000 })).toBe(19);
  });

  it('does not warn without positive total sales or a financial share', () => {
    expect(unmappedWarningPercent(null)).toBeNull();
    expect(unmappedWarningPercent({ unmappedSalesPaise: 100, totalSalesPaise: 0 })).toBeNull();
    expect(unmappedWarningPercent({ unmappedSalesPaise: 100, totalSalesPaise: -1000 })).toBeNull();
  });
});

describe('parseProspects', () => {
  it('parses financial rows and preserves the selected brand area order', () => {
    expect(parseProspects(payload)).toEqual(payload);
  });

  it('parses sales mode when mappedShare is null', () => {
    const salesRow = { ...row, buysBrand: true } as Record<string, unknown>;
    delete salesRow.brandSalesPaise;
    expect(parseProspects({ ...payload, rows: [salesRow], mappedShare: null }).rows[0]).toMatchObject({ buysBrand: true });
  });

  it('accepts alphabetic SYSMEX brand areas and null equipment fit', () => {
    const sysmex = { code: 'SYSMEX', name: 'Sysmex', areas: ['COAG', 'HAEM', 'URINE'] };
    const result = { ...payload, brand: sysmex, brands: [sysmex], rows: [{ ...row, fit: null, areas: [row.areas[0]], brandSalesPaise: 0 }] };
    expect(parseProspects(result)).toEqual(result);
  });

  it.each([
    ['unknown root key', { ...payload, extra: true }],
    ['missing focus', { ...payload, rows: [(() => { const { focus: _focus, ...rest } = row; return rest; })()] }],
    ['non-boolean focus', { ...payload, rows: [{ ...row, focus: 'true' }] }],
    ['mixed row modes', { ...payload, rows: [{ ...row, buysBrand: true }] }],
    ['area outside brand', { ...payload, rows: [{ ...row, areas: [{ ...row.areas[0], area: 'URINE' }] }] }],
    ['wrong volume sum', { ...payload, rows: [{ ...row, volume: 4 }] }],
    ['duplicate customer', { ...payload, rows: [row, row], total: 2 }],
    ['no qualifying area', { ...payload, rows: [{ ...row, areas: [{ area: 'HAEM', name: 'Haematology', status: 'not_done', min: null, max: null, exact: false }], volume: 0 }] }],
    ['sales mode leaked amount', { ...payload, mappedShare: null, rows: [{ ...row, buysBrand: true }] }],
    ['sales mode missing boolean', { ...payload, mappedShare: null, rows: [(() => { const { brandSalesPaise: _amount, ...rest } = row; return rest; })()] }],
    ['financial mode missing amount', { ...payload, rows: [(() => { const { brandSalesPaise: _amount, ...rest } = row; return rest; })()] }],
    ['financial mode leaked boolean', { ...payload, rows: [{ ...row, buysBrand: true }] }],
    ['non-IMMUNO fit', { ...payload, brand: { ...brand, areas: ['HAEM'] }, brands: [{ ...brand, areas: ['HAEM'] }], rows: [{ ...row, fit: 'none', packWasteRisk: null, areas: [row.areas[0]] }] }],
    ['invalid date', { ...payload, rows: [{ ...row, reportedOn: '2026-02-30' }] }],
    ['invalid page', { ...payload, page: 4001 }],
    ['invalid total', { ...payload, total: -1 }],
    ['short brand code', { ...payload, brand: { ...brand, code: 'A' }, brands: [{ ...brand, code: 'A' }] }],
    ['long brand code', { ...payload, brand: { ...brand, code: 'A'.repeat(41) }, brands: [{ ...brand, code: 'A'.repeat(41) }] }],
    ['null IMMUNO fit', { ...payload, rows: [{ ...row, fit: null }] }],
    ['CLIA fit on sends-out IMMUNO', { ...payload, rows: [{ ...row, fit: 'clia' }] }],
    ['invalid band', { ...payload, rows: [{ ...row, areas: [{ ...row.areas[0], max: 19 }, row.areas[1]] }] }],
    ['reversed area order', { ...payload, rows: [{ ...row, areas: [...row.areas].reverse() }] }],
    ['nonfinite amount', { ...payload, rows: [{ ...row, brandSalesPaise: Infinity }] }],
  ])('rejects %s', (_label, value) => {
    expect(() => parseProspects(value)).toThrow();
  });
});
