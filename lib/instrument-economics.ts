/** Shared server-side economics primitives. Money is signed integer paise. */
export function validateEconomicReadAction(action: string | null): 'get_instrument_economics' | 'get_sales_coverage' | null {
  if (action === null || action === 'get_instrument_economics') return 'get_instrument_economics';
  return action === 'get_sales_coverage' ? action : null;
}
export type EconomicMoney = string;
export type CostEvidence =
  | { status: 'verified'; amountPaise: EconomicMoney; sourceRevisionId: string; policyVersion: string }
  | { status: 'unavailable' | 'unverified'; reason: string };

function paise(value: string): bigint {
  if (!/^-?(0|[1-9]\d*)$/.test(value) || value.length > 20) throw new Error('Money must be bounded integer paise');
  return BigInt(value);
}

export function actualReagentEconomics(netSalesPaise: EconomicMoney, cost: CostEvidence) {
  const revenue = paise(netSalesPaise);
  if (cost.status !== 'verified') return { netSalesPaise, costPaise: null, gpPaise: null, gpBasisPoints: null, status: cost.status, reason: cost.reason };
  if (!cost.sourceRevisionId.trim() || !cost.policyVersion.trim()) throw new Error('Verified cost requires source and policy evidence');
  const purchaseCost = paise(cost.amountPaise);
  const gp = revenue - purchaseCost;
  return { netSalesPaise, costPaise: cost.amountPaise, gpPaise: gp.toString(),
    gpBasisPoints: revenue > BigInt(0) ? (gp * BigInt(10000) / revenue).toString() : null,
    status: 'verified' as const, sourceRevisionId: cost.sourceRevisionId, policyVersion: cost.policyVersion };
}

/** Input must already be net of GST/discounts; callers preserve source components. */
export function allocateEconomicMoney(totalPaise: EconomicMoney, shares: { targetId: string; basisPoints: number }[]) {
  const total = paise(totalPaise);
  if (!shares.length || new Set(shares.map(share => share.targetId)).size !== shares.length ||
    shares.some(share => !share.targetId.trim() || !Number.isInteger(share.basisPoints) || share.basisPoints <= 0 || share.basisPoints > 10000) ||
    shares.reduce((sum, share) => sum + share.basisPoints, 0) !== 10000) throw new Error('Unique allocation shares must total 100%');
  // Largest remainder, ties by stable target ID: independent of query ordering.
  const sign = total < BigInt(0) ? BigInt(-1) : BigInt(1);
  const absolute = total * sign;
  const rows = shares.map(share => ({ ...share, amount: absolute * BigInt(share.basisPoints) / BigInt(10000), remainder: absolute * BigInt(share.basisPoints) % BigInt(10000) }));
  let residual = absolute - rows.reduce((sum, row) => sum + row.amount, BigInt(0));
  const ranked = [...rows].sort((a, b) => a.remainder === b.remainder ? (a.targetId < b.targetId ? -1 : 1) : a.remainder > b.remainder ? -1 : 1);
  for (const row of ranked) { if (residual === BigInt(0)) break; row.amount += BigInt(1); residual -= BigInt(1); }
  return rows.map(row => ({ targetId: row.targetId, basisPoints: row.basisPoints, amountPaise: (row.amount * sign).toString() }));
}

export type AttributionCandidate = { placementId: string; groupId: string | null };
export type AttributionResult =
  | { status: 'attributed'; method: 'unique' | 'group' | 'allocation'; shares: { targetId: string; basisPoints: number }[] }
  | { status: 'unattributed'; reason: 'no_compatible_placement' | 'ambiguous_placements' | 'conflicting_rules' };

/** Receives only dated, site-resolved candidates from verified mapping storage. */
export function resolveEconomicTarget(candidates: AttributionCandidate[], approvedGroupIds: string[], allocationRules: { targetId: string; basisPoints: number }[][] = []): AttributionResult {
  if (new Set(candidates.map(candidate => candidate.placementId)).size !== candidates.length) throw new Error('Duplicate placement candidate');
  if (!candidates.length) return { status: 'unattributed', reason: 'no_compatible_placement' };
  if (candidates.length === 1) {
    const candidate = candidates[0];
    const group = candidate.groupId && approvedGroupIds.includes(candidate.groupId) ? candidate.groupId : null;
    return { status: 'attributed', method: group ? 'group' : 'unique', shares: [{ targetId: group ?? candidate.placementId, basisPoints: 10000 }] };
  }
  const groups = new Set(candidates.map(candidate => candidate.groupId));
  const group = candidates[0].groupId;
  if (groups.size === 1 && group && approvedGroupIds.includes(group)) return { status: 'attributed', method: 'group', shares: [{ targetId: group, basisPoints: 10000 }] };
  if (allocationRules.length > 1) return { status: 'unattributed', reason: 'conflicting_rules' };
  if (allocationRules.length === 1) {
    const shares = allocationRules[0];
    allocateEconomicMoney('0', shares);
    const ids = new Set(candidates.map(candidate => candidate.placementId));
    if (shares.length !== ids.size || shares.some(share => !ids.has(share.targetId))) throw new Error('Allocation must cover every eligible placement');
    return { status: 'attributed', method: 'allocation', shares };
  }
  return { status: 'unattributed', reason: 'ambiguous_placements' };
}

export function isEffectiveOn(date: string, from: string, to: string | null): boolean {
  for (const value of [date, from, ...(to ? [to] : [])]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('Valid business date required');
  }
  if (to && to <= from) throw new Error('Effective interval must have positive duration');
  return date >= from && (!to || date < to);
}

export function recoveryPosition(capitalPaise: EconomicMoney, verifiedGpPaise: EconomicMoney, eligibleContributionsPaise: EconomicMoney) {
  const capital = paise(capitalPaise);
  if (capital < BigInt(0)) throw new Error('Capital exposure cannot be negative');
  const recovery = paise(verifiedGpPaise) + paise(eligibleContributionsPaise);
  const position = capital - recovery;
  return { recoveryPaise: recovery.toString(), positionPaise: position.toString(),
    outstandingPaise: (position > BigInt(0) ? position : BigInt(0)).toString(),
    surplusPaise: (position < BigInt(0) ? -position : BigInt(0)).toString() };
}

export function reagentLeakageOpportunity(input: {
  expectedUnits: number; comparableActualUnits: number; expectedUnitPricePaise: EconomicMoney | null;
  expectedUnitCostPaise: EconomicMoney | null; evidenceTier: 'observed_consumption' | 'supply_proxy' | 'commercial_expectation';
}) {
  if (![input.expectedUnits, input.comparableActualUnits].every(Number.isSafeInteger) || input.expectedUnits < 0) throw new Error('Use bounded integer base units');
  const gap = Math.max(0, input.expectedUnits - input.comparableActualUnits);
  if (!Number.isSafeInteger(gap)) throw new Error('Unit gap is outside supported range');
  const price = input.expectedUnitPricePaise === null ? null : paise(input.expectedUnitPricePaise);
  const cost = input.expectedUnitCostPaise === null ? null : paise(input.expectedUnitCostPaise);
  if ((price !== null && price < BigInt(0)) || (cost !== null && cost < BigInt(0))) throw new Error('Expected unit values cannot be negative');
  return { unitShortfall: gap, potentialRevenuePaise: price === null ? null : (BigInt(gap) * price).toString(),
    potentialGpPaise: price === null || cost === null ? null : (BigInt(gap) * (price - cost)).toString(),
    evidenceTier: input.evidenceTier, valuation: 'estimate' as const };
}
