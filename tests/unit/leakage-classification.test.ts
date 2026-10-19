import { describe, expect, it } from 'vitest';
import { buildLeakageClassification } from '@/lib/leakage-classification';

function form(values: Record<string, string | string[] | undefined>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) for (const item of Array.isArray(value) ? value : [value]) result.append(key, item);
  return result;
}
describe('leakage classifications', () => {
  it('keeps an uninvestigated shortfall unknown', () => {
    expect(buildLeakageClassification(form({}))).toEqual({ primaryReason: 'unknown', reasonCodes: ['unknown'], confidence: 'unknown', evidenceReference: '' });
  });
  it('retains multiple contributing reasons without a causal amount allocation', () => {
    expect(buildLeakageClassification(form({ primaryReason: 'competitor_sourcing', reasonCodes: ['competitor_sourcing', 'pricing_pressure'], confidence: 'suspected' }))).toEqual({ primaryReason: 'competitor_sourcing', reasonCodes: ['competitor_sourcing', 'pricing_pressure'], confidence: 'suspected', evidenceReference: '' });
  });
  it('requires evidence before a competitor claim becomes confirmed', () => {
    expect(() => buildLeakageClassification(form({ primaryReason: 'competitor_sourcing', confidence: 'confirmed' }))).toThrow('supporting evidence');
    expect(buildLeakageClassification(form({ primaryReason: 'competitor_sourcing', confidence: 'confirmed', evidenceReference: ' Visit note VN-12 / customer-confirmed supplier invoice ' })).evidenceReference).toBe('Visit note VN-12 / customer-confirmed supplier invoice');
  });
  it.each([{ primaryReason: 'invented' }, { primaryReason: 'downtime', reasonCodes: ['invented'] }, { confidence: 'certain' }, { confidence: 'confirmed', evidenceReference: 'note' }, { primaryReason: 'unknown', reasonCodes: ['downtime'] }])('rejects inconsistent classifications: %j', values => {
    expect(() => buildLeakageClassification(form(values))).toThrow();
  });
});
