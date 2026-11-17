import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EconomicTarget } from '@/lib/instrument-economics-types';
import { labTotals } from '@/lib/economics-lab-totals';
import { EconomicsLabTotal } from '@/components/economics-lab-total';

const target = (overrides: Partial<EconomicTarget> = {}): EconomicTarget => ({
  id: 'instrument-1', kind: 'placement', name: 'Coag analyser', companyId: 'company-1', customerId: 'customer-1', customerName: 'Test Lab A', customerSourceId: 'source-1', siteId: 'site-1', modelId: 'model-1', installationId: null,
  effectiveFrom: '2026-01-01', effectiveTo: null, approval: 'approved', version: 1, capitalPaise: '100', revenuePaise: '0', knownGpPaise: '0', missingCostLines: 0, attributedLines: 0, recoveryPaise: '50', outstandingPaise: '50', health: 'healthy', forecastMonths: null, expectation: null, ...overrides,
});

describe('lab totals', () => {
  it('rolls up a three instrument lab and removes the customer suffix from names', () => {
    const result = labTotals([
      target({ id: 'ca', name: 'Coag analyser · Test Lab A', capitalPaise: '45000000', recoveryPaise: '33333334', reagentLifetime: { salesPaise: '0', knownGpPaise: '0', lines: 0, missingCostLines: 0 } }),
      target({ id: 'xn', name: 'Haematology analyser · Test Lab A', capitalPaise: '69000000', recoveryPaise: '1216983' }),
      target({ id: 'sys', name: 'Biochemistry analyser · Test Lab A', capitalPaise: '62500000', recoveryPaise: '12184951' }),
    ], '2026-11-17');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ capitalPaise: BigInt(176500000), recoveryPaise: BigInt(46735268), outstandingPaise: BigInt(129764732), surplusPaise: BigInt(0) });
    expect(result[0].members.map(member => member.id)).toEqual(['ca', 'sys', 'xn']);
    expect(result[0].members[0]).toMatchObject({ name: 'Coag analyser', noReagentSales: true });
  });

  it('omits a lab with only one approved instrument', () => {
    expect(labTotals([target(), target({ id: 'proposed', approval: 'proposed' })], '2026-11-17')).toEqual([]);
  });

  it('counts pooled recovery once through its group', () => {
    const rows = [target({ id: 'p1', pooledIn: 'group-1', recoveryPaise: '100' }), target({ id: 'p2', pooledIn: 'group-1', recoveryPaise: '200' }), target({ id: 'group-1', kind: 'group', recoveryPaise: '300' }), target({ id: 'other', name: 'Haematology analyser', recoveryPaise: '100' })];
    const result = labTotals(rows, '2026-11-17');
    expect(result[0].members.map(member => member.id)).toEqual(['group-1', 'other']);
    expect(result[0].recoveryPaise).toBe(BigInt(400));
  });

  it('reports surplus above investment', () => {
    const result = labTotals([target({ id: 'a', capitalPaise: '100', recoveryPaise: '300' }), target({ id: 'b', capitalPaise: '100', recoveryPaise: '200' })], '2026-11-17')[0];
    expect(result).toMatchObject({ outstandingPaise: BigInt(0), surplusPaise: BigInt(300) });
  });

  it('drops a lab with an unparsable member amount', () => {
    expect(labTotals([target(), target({ id: 'bad', capitalPaise: '1.5' })], '2026-11-17')).toEqual([]);
  });

  it('renders the lab card and money values', () => {
    const lab = labTotals([target({ id: 'a', name: 'Coag analyser', capitalPaise: '45000000', recoveryPaise: '33333334', reagentLifetime: { salesPaise: '0', knownGpPaise: '0', lines: 0, missingCostLines: 0 } }), target({ id: 'b', name: 'Haematology analyser', capitalPaise: '69000000', recoveryPaise: '1216983' })], '2026-11-17')[0];
    const html = renderToStaticMarkup(<EconomicsLabTotal lab={lab} forecastWindowMonths={3} />);
    expect(html).toContain('aria-label="Lab total"');
    expect(html).toContain('Invested');
    expect(html).toContain('₹11,40,000.00');
    expect(html).toContain('₹3,45,503.17');
    expect(html).toContain('No reagent sales linked yet');
  });
});
