import { describe, expect, it } from 'vitest';
import { cleanBrandName, suggestBrand } from '@/lib/brand-suggestions';

const brand = (name: string) => ({ name, code: name.toUpperCase().replace(/[^A-Z0-9]+/g, '_') });

describe('suggestBrand', () => {
  it.each([
    ['Diasys Diagnostic India Pvt Ltd', 'DiaSys', 'DIASYS'],
    ['Tulip Diagnostics Pvt Ltd.', 'Tulip', 'TULIP'],
    ['MERIL DIAGNOSTICS', 'Meril', 'MERIL'],
    ['Arkray Heath Care 12%', 'Arkray', 'ARKRAY'],
    ['Arkrya Health Care', 'Arkray', 'ARKRAY'],
    ['J MITRA 12%', 'J Mitra', 'J_MITRA'],
    ['Pharma', 'Meril', null],
    ['Pharma', 'Pharma Plus', null],
    ['SYS 480', 'Sysmex', null],
  ])('%s with %s gives %s', (group, name, expected) => {
    expect(suggestBrand(group, [brand(name)])).toBe(expected);
  });

  it('returns null when two brands match', () => {
    expect(suggestBrand('Meril Tulip Diagnostics', [brand('Meril'), brand('Tulip')])).toBeNull();
  });
});

describe('cleanBrandName', () => {
  it('strips tax rates and company-form words but keeps case', () => {
    expect(cleanBrandName('Test Principal Diagnostics Pvt Ltd.')).toBe('Test Principal Diagnostics');
    expect(cleanBrandName('Unknown Agency 12%')).toBe('Unknown Agency');
  });
});
