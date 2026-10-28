import { describe, expect, it } from 'vitest';
import { validateEconomicReadAction } from '@/lib/instrument-economics';

it('accepts sales coverage only as a known economics GET read', () => {
  expect(validateEconomicReadAction('get_sales_coverage')).toBe('get_sales_coverage');
  expect(validateEconomicReadAction(null)).toBe('get_instrument_economics');
  expect(validateEconomicReadAction('get_instrument_economics')).toBe('get_instrument_economics');
  expect(validateEconomicReadAction('rebuild')).toBeNull();
  expect(validateEconomicReadAction('')).toBeNull();
});
import { actualReagentEconomics, allocateEconomicMoney, isEffectiveOn, reagentLeakageOpportunity, recoveryPosition, resolveEconomicTarget } from '@/lib/instrument-economics';
const verifiedCost = (amountPaise: string) => ({ status: 'verified' as const, amountPaise, sourceRevisionId: 'purchase-rev-1', policyVersion: 'batch-v1' });

describe('actual instrument economics', () => {
  it('calculates actual GP from net Tally sales and evidenced cost', () => {
    expect(actualReagentEconomics('5000000', verifiedCost('3200000'))).toMatchObject({ gpPaise: '1800000', gpBasisPoints: '3600', status: 'verified' });
  });
  it('keeps FOC cost negative in GP and does not divide zero sales', () => {
    expect(actualReagentEconomics('0', verifiedCost('200000'))).toMatchObject({ gpPaise: '-200000', gpBasisPoints: null });
  });
  it('supports inherited physical returns and value-only credits', () => {
    expect(actualReagentEconomics('-5000000', verifiedCost('-3200000'))).toMatchObject({ gpPaise: '-1800000', gpBasisPoints: null });
    expect(actualReagentEconomics('-10000', verifiedCost('0')).gpPaise).toBe('-10000');
  });
  it.each(['unavailable', 'unverified'] as const)('never invents GP when cost is %s', status => {
    expect(actualReagentEconomics('5000000', { status, reason: 'No historical batch evidence' })).toMatchObject({ gpPaise: null, costPaise: null, status });
  });
  it('rejects malformed money and verification without provenance', () => {
    expect(() => actualReagentEconomics('12.5', verifiedCost('1'))).toThrow();
    expect(() => actualReagentEconomics('10', { ...verifiedCost('1'), policyVersion: '' })).toThrow();
  });
});

describe('deterministic shared attribution', () => {
  const a = { placementId: 'p-a', groupId: null }, b = { placementId: 'p-b', groupId: null };
  it('uses unique targets and approved groups without serial-level guesses', () => {
    expect(resolveEconomicTarget([a], [])).toMatchObject({ method: 'unique', shares: [{ targetId: 'p-a', basisPoints: 10000 }] });
    expect(resolveEconomicTarget([{ ...a, groupId: 'g' }, { ...b, groupId: 'g' }], ['g'])).toMatchObject({ method: 'group', shares: [{ targetId: 'g', basisPoints: 10000 }] });
    expect(resolveEconomicTarget([{ ...a, groupId: 'g' }], ['g'])).toMatchObject({ method: 'group', shares: [{ targetId: 'g', basisPoints: 10000 }] });
  });
  it('leaves no candidates or ambiguity unattributed', () => {
    expect(resolveEconomicTarget([], [])).toMatchObject({ status: 'unattributed', reason: 'no_compatible_placement' });
    expect(resolveEconomicTarget([a, b], [])).toMatchObject({ status: 'unattributed', reason: 'ambiguous_placements' });
  });
  it('requires complete eligible allocations and surfaces conflicting rules', () => {
    const rule = [{ targetId: 'p-a', basisPoints: 7000 }, { targetId: 'p-b', basisPoints: 3000 }];
    expect(resolveEconomicTarget([a, b], [], [rule])).toMatchObject({ method: 'allocation', shares: rule });
    expect(resolveEconomicTarget([a, b], [], [rule, rule])).toMatchObject({ status: 'unattributed', reason: 'conflicting_rules' });
    expect(() => resolveEconomicTarget([a, b], [], [[{ targetId: 'p-inactive', basisPoints: 10000 }]])).toThrow();
    expect(() => resolveEconomicTarget([a, b], [], [[{ targetId: 'p-a', basisPoints: 10000 }]])).toThrow('every eligible');
  });
  it('conserves paise with deterministic positive and negative rounding', () => {
    const shares = [{ targetId: 'b', basisPoints: 5000 }, { targetId: 'a', basisPoints: 5000 }];
    expect(allocateEconomicMoney('1', shares)).toEqual([{ ...shares[0], amountPaise: '0' }, { ...shares[1], amountPaise: '1' }]);
    expect(allocateEconomicMoney('-1', shares)).toEqual([{ ...shares[0], amountPaise: '0' }, { ...shares[1], amountPaise: '-1' }]);
    const big = allocateEconomicMoney('9999999999999999999', shares);
    expect(big.reduce((sum, row) => sum + BigInt(row.amountPaise), BigInt(0)).toString()).toBe('9999999999999999999');
    expect(() => allocateEconomicMoney('100', [{ targetId: 'a', basisPoints: 7000 }])).toThrow();
  });
  it('uses half-open placement dates and validates calendar dates', () => {
    expect(isEffectiveOn('2026-08-01', '2026-01-01', '2026-08-01')).toBe(false);
    expect(isEffectiveOn('2026-01-01', '2026-01-01', null)).toBe(true);
    expect(() => isEffectiveOn('2026-02-30', '2026-01-01', null)).toThrow();
  });
});

describe('recovery and leakage estimates', () => {
  it('retains negative GP and surplus without treating revenue as recovery', () => {
    expect(recoveryPosition('100000', '-20000', '0')).toMatchObject({ recoveryPaise: '-20000', outstandingPaise: '120000' });
    expect(recoveryPosition('100000', '130000', '0')).toMatchObject({ outstandingPaise: '0', surplusPaise: '30000' });
  });
  it('values a 300-unit gap at expected ₹100 price and ₹60 cost as an estimate', () => {
    expect(reagentLeakageOpportunity({ expectedUnits: 1000, comparableActualUnits: 700, expectedUnitPricePaise: '10000', expectedUnitCostPaise: '6000', evidenceTier: 'supply_proxy' })).toEqual({ unitShortfall: 300, potentialRevenuePaise: '3000000', potentialGpPaise: '1200000', evidenceTier: 'supply_proxy', valuation: 'estimate' });
  });
  it('closes supply gaps for FOC units without inventing value when assumptions are missing', () => {
    expect(reagentLeakageOpportunity({ expectedUnits: 1000, comparableActualUnits: 1000, expectedUnitPricePaise: null, expectedUnitCostPaise: null, evidenceTier: 'supply_proxy' })).toMatchObject({ unitShortfall: 0, potentialRevenuePaise: null, potentialGpPaise: null });
  });
});
