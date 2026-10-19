import { describe, expect, it, vi } from 'vitest';
vi.mock('next/link', () => ({ default: 'a' }));
import { costVerificationSaleLines } from '@/lib/instrument-economics-forms';
import { reagentLifetime } from '@/components/instrument-economics-workspace';
import type { EconomicsWorkspaceData } from '@/lib/instrument-economics-types';

type Attribution = NonNullable<EconomicsWorkspaceData['attributionLines']>[number];
type Source = NonNullable<EconomicsWorkspaceData['sourceLines']>[number];

// Mirrors migration 20261019150000: keep targeted rows, any non-"unplaced" reason, and unplaced
// rows for customers that have a target. Every screen calculation must be unchanged by the trim.
const targets = [{ id: 't1', companyId: 'c', customerSourceId: 'Lab A' }];
const source = (id: string, customer: string, kind = 'sale'): Source => ({ id, companyId: 'c', voucherId: `v-${id}`, revision: '1', lineKey: '1', date: '2026-10-01', kind, customerSourceId: customer, productId: `p-${id}`, productName: `P ${id}`, voucherNumber: `SD/${id}`, quantity: '1', unit: 'Nos', netSalesPaise: '1000', batchId: null } as Source);
const row = (id: string, sourceLineId: string, targetId: string | null, reason: string, status: string, cost: string | null): Attribution => ({ id, sourceLineId, targetId, status, reason, shareBasisPoints: 10000, quantity: '1', revenuePaise: '1000', costPaise: cost, gpPaise: cost == null ? null : '400', date: '2026-10-01', voucherId: `v-${sourceLineId}`, revision: '1', productId: `p-${sourceLineId}`, productName: `P ${sourceLineId}`, unit: 'Nos', costEvidence: null });

const sources = [source('a1', 'Lab A'), source('a2', 'Lab A'), source('a3', 'Lab A'), source('b1', 'Lab B'), source('b2', 'Lab B'), source('z1', 'Lab Z')];
const full: Attribution[] = [
  row('r1', 'a1', 't1', 'verified', 'verified', '600'),
  row('r2', 'a2', 't1', 'cost_unavailable', 'cost_unavailable', null),
  row('r3', 'a3', null, 'no_verified_compatible_placement', 'unattributed', null),
  row('r4', 'b1', null, 'no_verified_compatible_placement', 'unattributed', null),
  row('r5', 'b2', null, 'no_verified_compatible_placement', 'unattributed', null),
  row('r6', 'z1', null, 'unlinked_or_invalid_adjustment', 'unattributed', null),
];
const customerOf = new Map(sources.map((line) => [line.id, line.customerSourceId]));
const trimmed = full.filter((line) => line.targetId != null || line.reason !== 'no_verified_compatible_placement' || targets.some((target) => target.customerSourceId === customerOf.get(line.sourceLineId)));

describe('trimmed economics full read', () => {
  it('drops only unplaced sales of customers without an instrument', () => {
    expect(trimmed.map((line) => line.id)).toEqual(['r1', 'r2', 'r3', 'r6']);
  });
  it('keeps cost verification, lifetime and breakdown identical', () => {
    expect(costVerificationSaleLines(sources, trimmed)).toEqual(costVerificationSaleLines(sources, full));
    expect(reagentLifetime('t1', trimmed)).toEqual(reagentLifetime('t1', full));
    expect(trimmed.filter((line) => line.targetId === 't1')).toEqual(full.filter((line) => line.targetId === 't1'));
  });
  it('keeps the unplaced sales suggested for a target customer', () => {
    const suggested = (lines: Attribution[]) => lines.filter((line) => !line.targetId && line.reason === 'no_verified_compatible_placement' && customerOf.get(line.sourceLineId) === 'Lab A').map((line) => line.id);
    expect(suggested(trimmed)).toEqual(suggested(full));
  });
});
