import { describe, expect, it } from 'vitest';
import { bandLabel, labAreaCodes, labPanelCodes, labTestCodes, parseLabMix, parseLabMixInput, parseLabMixOptions } from '@/lib/lab-mix';

const immuno = [{ min: 1, max: 14 }, { min: 15, max: 30 }, { min: 31, max: 60 }, { min: 61, max: null }];
const generic = [{ min: 1, max: 20 }, { min: 21, max: 50 }, { min: 51, max: 100 }, { min: 101, max: null }];
const busiestBands = [{ min: 1, max: 3 }, { min: 4, max: 8 }, { min: 9, max: null }];
const reportId = '19300000-0000-4000-8000-000000000001';
const area = { area: 'IMMUNO', name: 'Hormones / immunoassay', status: 'in_house', min: 15, max: 30, exact: false };
const busiest = { test: 'TSH', name: 'TSH', min: 3, max: 3, exact: true };
const panel = { panel: 'FERTILITY', name: 'Fertility', status: 'sent_out' };
const report = { reportId, reportedBy: 'sales@test.local', reportedOn: '2026-11-01', stale: false,
  areas: [area], busiest, panels: [panel], fit: 'clia', packWasteRisk: true, policyVersion: 1 };
const options = {
  areas: labAreaCodes.map(code => ({ code, name: code, brandsHint: code === 'HBA1C' ? null : 'Brand', bands: code === 'IMMUNO' ? immuno : generic })),
  tests: labTestCodes.map(code => ({ code, name: code })), panels: labPanelCodes.map(code => ({ code, name: code })),
  busiestBands, policy: { version: 1, cliaCutoffPerDay: 15, packWastePerDay: 4, staleAfterDays: 90 },
};

describe('lab mix read parser', () => {
  it('accepts reports, exact counts and open bands', () => {
    expect(parseLabMix(report)).toEqual(report);
    for (const band of immuno) {
      const value = { ...report, areas: [{ ...area, ...band }], fit: band.min < 15 ? 'vidas' : 'clia', busiest: null, packWasteRisk: null };
      expect(parseLabMix(value)).toEqual(value);
    }
    for (const exact of [1, 14, 15, 100000]) {
      const value = { ...report, areas: [{ ...area, min: exact, max: exact, exact: true }], fit: exact < 15 ? 'vidas' : 'clia', busiest: null, packWasteRisk: null };
      expect(parseLabMix(value)).toEqual(value);
    }
  });
  it('accepts unknown, none and changed-policy straddles', () => {
    expect(parseLabMix({ ...report, areas: [], busiest: null, fit: 'unknown', packWasteRisk: null }).fit).toBe('unknown');
    for (const status of ['not_done', 'sends_out']) {
      expect(parseLabMix({ ...report, areas: [{ ...area, status, min: null, max: null }], busiest: null, fit: 'none', packWasteRisk: null }).fit).toBe('none');
    }
    expect(parseLabMix({ ...report, fit: 'check', packWasteRisk: null, policyVersion: 2 }).fit).toBe('check');
    expect(parseLabMix({ ...report, busiest: { ...busiest, min: 4, max: 8, exact: false }, packWasteRisk: null }).packWasteRisk).toBeNull();
  });
  it.each([null, [], {}, { ...report, extra: true }, { ...report, reportId: 'bad' }, { ...report, reportedBy: '' },
    { ...report, reportedOn: '2026-02-30' }, { ...report, reportedOn: 'today' }, { ...report, stale: 1 }, { ...report, fit: 'guess' },
    { ...report, policyVersion: 0 }, { ...report, packWasteRisk: 'true' }, { ...report, busiest: undefined },
    { ...report, areas: [], panels: [], busiest: null }, { ...report, areas: [area, area] },
    { ...report, areas: [{ ...area, area: 'BOGUS' }] }, { ...report, areas: [{ ...area, min: 10, max: 20 }] },
    { ...report, areas: [{ ...area, exact: true }] }, { ...report, areas: [{ ...area, min: '15' }] },
    { ...report, areas: [{ ...area, status: 'sends_out' }] }, { ...report, areas: [{ ...area, extra: true }] },
    { ...report, areas: [{ ...area, status: 'not_done', min: null, max: null }], fit: 'none' },
    { ...report, busiest: { ...busiest, test: 'HBA1C' } }, { ...report, busiest: { ...busiest, extra: true } },
    { ...report, busiest: { ...busiest, min: 0, max: 0 } }, { ...report, busiest: { ...busiest, max: null } },
    { ...report, panels: [panel, panel] }, { ...report, panels: [{ ...panel, status: 'sends_out' }] },
    { ...report, panels: [{ ...panel, panel: 'CULTURE' }] }, { ...report, panels: [{ ...panel, extra: true }] },
    { ...report, busiest: null }, { ...report, fit: 'none' }, { ...report, fit: 'unknown' },
  ])('rejects invalid response %#', value => expect(() => parseLabMix(value)).toThrow());
  it('requires every response field and sorted unique areas', () => {
    for (const key of Object.keys(report)) {
      const value: Record<string, unknown> = { ...report }; delete value[key];
      expect(() => parseLabMix(value)).toThrow();
    }
    expect(() => parseLabMix({ ...report, areas: [area, { ...area, area: 'HAEM', min: 21, max: 50 }] })).toThrow();
  });
});

describe('lab mix options parser', () => {
  it('accepts complete options, null brands and active subsets', () => {
    expect(parseLabMixOptions(options)).toEqual(options);
    const subset = { ...options, areas: options.areas.slice(2), tests: [], panels: [] };
    expect(parseLabMixOptions(subset)).toEqual(subset);
  });
  it.each([null, {}, { ...options, extra: true }, { ...options, busiestBands: generic },
    { ...options, areas: [options.areas[0], options.areas[0]] }, { ...options, areas: [...options.areas].reverse() },
    { ...options, areas: [{ ...options.areas[0], brandsHint: 5 }] }, { ...options, areas: [{ ...options.areas[0], bands: immuno }] },
    { ...options, areas: [{ ...options.areas[0], extra: true }] }, { ...options, tests: [{ code: 'UNKNOWN', name: 'Unknown' }] },
    { ...options, panels: [{ ...options.panels[0], extra: true }] }, { ...options, tests: [options.tests[0], options.tests[0]] },
    { ...options, policy: { ...options.policy, version: 1.5 } }, { ...options, policy: { ...options.policy, extra: true } },
    { ...options, policy: { ...options.policy, cliaCutoffPerDay: 0 } }, { ...options, policy: { ...options.policy, packWastePerDay: 1001 } },
    { ...options, policy: { ...options.policy, staleAfterDays: 6 } }, { ...options, policy: { ...options.policy, staleAfterDays: 731 } },
  ])('rejects malformed options %#', value => expect(() => parseLabMixOptions(value)).toThrow());
});

describe('lab mix input and labels', () => {
  it('accepts bands, exact and explicit nullable optional values', () => {
    const input = { customerId: reportId, areas: [{ area: 'IMMUNO', status: 'in_house', min: 61, max: null }],
      busiest: { test: 'TSH', exact: 3 }, panels: null, labSize: { testsPerDay: 80, basis: 'lab_said', note: ' At visit ' } };
    expect(parseLabMixInput(input)).toEqual({ ...input, labSize: { ...input.labSize, note: 'At visit' } });
    expect(parseLabMixInput({ customerId: reportId, panels: [{ panel: 'CARDIAC', status: 'not_offered' }], areas: null, busiest: null, labSize: null }).panels).toHaveLength(1);
  });
  it.each([[1, 14, '1–14'], [61, null, '61+'], [9, null, '9+'], [21, 50, '21–50'], [15, 15, '15']] as const)('labels %s to %s', (min, max, label) => expect(bandLabel(min, max)).toBe(label));
  it.each([[0, 14], [15, 14], [1.5, null], [1, 100001]] as const)('rejects invalid label bounds %s %s', (min, max) => expect(() => bandLabel(min, max)).toThrow());
});
