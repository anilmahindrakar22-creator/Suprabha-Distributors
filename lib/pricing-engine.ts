export type PricingRole =
  | 'administrator'
  | 'management'
  | 'accounts'
  | 'sales'
  | 'operations'
  | 'warehouse'
  | 'service'
  | 'viewer';

export type ApprovedPriceContract = {
  id: string;
  price: number;
  validFrom: string;
  validTo: string | null;
  status: 'approved' | 'draft' | 'pending_approval' | 'superseded' | 'rejected' | 'cancelled';
  version: number;
};

export type TallySellingEvidence = {
  rate: number;
  invoiceDate: string;
  invoiceReference: string;
  sourceId: string;
  exceptional?: boolean;
  exceptionType?: 'foc' | 'scheme' | 'tender' | 'correction' | 'unusual_discount' | 'special_quotation';
};

export type PurchaseCostEvidence = {
  amount: number;
  effectiveAt: string;
  sourceReference: string;
  sourceVersion: string;
  kind: 'purchase_price' | 'landed_cost';
};

export type PricingPolicy = {
  minimumGrossMarginPercent: number;
  targetGrossMarginPercent: number | null;
  roundingIncrement: number;
  policyVersion: string;
  roundingRuleVersion: string;
};

export type PricingResolutionInput = {
  pricingDate: string;
  basePrice?: ApprovedPriceContract;
  contracts: ApprovedPriceContract[];
  sellingHistory: TallySellingEvidence[];
  latestCost: PurchaseCostEvidence | null;
  previousCost: PurchaseCostEvidence | null;
  policy: PricingPolicy;
};

export type PricingResolution = {
  continuityPrice: number | null;
  targetMarginPrice: number | null;
  recommendedPrice: number | null;
  recommendationReason: string;
  resolution: 'STANDARD_ITEM_PRICE' | 'APPROVED_CONTRACT_PRICE' | 'LAST_TALLY_INVOICE_PRICE' | 'NO_PRICE_HISTORY' | 'PRICE_REVIEW_REQUIRED' | 'PRICE_EXCEPTION';
  guardrail: 'PRICE_OK' | 'COST_INCREASE' | 'PRICE_REVIEW_REQUIRED';
  proposedRate: number | null;
  source: {
    type: 'STANDARD_ITEM_PRICE' | 'APPROVED_CONTRACT' | 'LAST_TALLY_INVOICE' | 'NONE';
    reference: string | null;
    date: string | null;
    version: string | null;
  };
  recentRates: TallySellingEvidence[];
  cost: {
    latest: PurchaseCostEvidence | null;
    previous: PurchaseCostEvidence | null;
    changeAmount: number | null;
    changePercent: number | null;
  };
  margin: {
    grossProfitAmount: number | null;
    grossMarginPercent: number | null;
    previousGrossMarginPercent: number | null;
    erosionPercentagePoints: number | null;
  };
  suggestion: {
    amount: number;
    unroundedAmount: number;
    targetMarginPercent: number;
    policyVersion: string;
    roundingRuleVersion: string;
    costSourceVersion: string;
  } | null;
  warnings: Array<'MISSING_COMPARABLE_HISTORIC_COST' | 'AMBIGUOUS_SALES_HISTORY' | 'PURCHASE_PRICE_INCREASED' | 'MISSING_PURCHASE_COST' | 'BELOW_MINIMUM_MARGIN' | 'LOSS_MAKING' | 'NO_ELIGIBLE_PRICE_HISTORY'>;
};

export const PRICING_ROLES = new Set<PricingRole>(['administrator', 'management', 'accounts']);

export function canAccessRestrictedPricing(role: string): role is PricingRole {
  return PRICING_ROLES.has(role as PricingRole);
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundUp(value: number, increment: number) {
  return roundMoney(Math.ceil(value / increment - 1e-10) * increment);
}

function grossMarginPercent(price: number, cost: number) {
  return price > 0 ? ((price - cost) / price) * 100 : null;
}

function currentContract(contracts: ApprovedPriceContract[], pricingDate: string) {
  const valid = contracts.filter((contract) =>
    (contract.status === 'approved' || contract.status === 'superseded')
    && Number.isFinite(contract.price)
    && contract.price > 0
    && validDate(contract.validFrom)
    && contract.validFrom <= pricingDate
    && (contract.validTo === null || (validDate(contract.validTo) && contract.validTo >= pricingDate)),
  );
  if (valid.length > 1) throw new Error('Conflicting approved price contracts');
  return valid[0] ?? null;
}

function eligibleSellingHistory(history: TallySellingEvidence[], pricingDate: string) {
  return history
    .filter((entry) => Number.isFinite(entry.rate) && entry.rate > 0 && validDate(entry.invoiceDate) && entry.invoiceDate <= pricingDate && !entry.exceptional && !entry.exceptionType)
    .sort((left, right) => right.invoiceDate.localeCompare(left.invoiceDate) || right.sourceId.localeCompare(left.sourceId));
}

export function resolveCustomerPrice(input: PricingResolutionInput): PricingResolution {
  if (!validDate(input.pricingDate)) throw new Error('A valid pricing date is required');
  const eligibleCost = (cost: PurchaseCostEvidence | null) => cost && Number.isFinite(cost.amount) && cost.amount >= 0 && validDate(cost.effectiveAt) && cost.effectiveAt <= input.pricingDate ? cost : null;
  input = { ...input, latestCost: eligibleCost(input.latestCost), previousCost: eligibleCost(input.previousCost) };
  const { policy } = input;
  if (!Number.isFinite(policy.minimumGrossMarginPercent) || policy.minimumGrossMarginPercent < -100 || policy.minimumGrossMarginPercent >= 100) throw new Error('Invalid minimum margin policy');
  if (policy.targetGrossMarginPercent !== null && (!Number.isFinite(policy.targetGrossMarginPercent) || policy.targetGrossMarginPercent < 0 || policy.targetGrossMarginPercent >= 100)) throw new Error('Invalid target margin policy');
  if (!Number.isFinite(policy.roundingIncrement) || policy.roundingIncrement <= 0) throw new Error('Invalid rounding policy');

  const contract = currentContract(input.contracts, input.pricingDate);
  const eligibleHistory = eligibleSellingHistory(input.sellingHistory, input.pricingDate);
  const lastSale = eligibleHistory[0] ?? null;
  const basePrice = input.basePrice ? currentContract([input.basePrice], input.pricingDate) : null;
  const ambiguous = !!lastSale && eligibleHistory.some((sale) => sale.invoiceDate === lastSale.invoiceDate && sale.rate !== lastSale.rate);
  const comparable = input.latestCost && input.previousCost && input.latestCost.kind === input.previousCost.kind
    && input.latestCost.effectiveAt <= input.pricingDate && input.previousCost.effectiveAt <= (lastSale?.invoiceDate || input.pricingDate);
  const continuityPrice = contract ? null : lastSale
    ? comparable && !ambiguous ? roundMoney(lastSale.rate + Math.max(input.latestCost!.amount - input.previousCost!.amount, 0)) : null
    : basePrice && input.latestCost ? basePrice.price : null;
  const targetMarginPrice = input.latestCost && input.latestCost.effectiveAt <= input.pricingDate && policy.targetGrossMarginPercent !== null
    ? roundUp(input.latestCost.amount / (1 - policy.targetGrossMarginPercent / 100), policy.roundingIncrement) : null;
  const proposedRate = contract?.price ?? (continuityPrice == null ? null : Math.max(continuityPrice, targetMarginPrice ?? continuityPrice));
  const recommendationReason = contract ? 'Fixed agreement retained; review margin before changing its terms.'
    : proposedRate == null ? 'Reliable pricing evidence is incomplete; review is required.'
    : !lastSale ? 'No genuine customer history; use the governed base price checked against target margin.'
    : targetMarginPrice != null && targetMarginPrice > continuityPrice! ? 'Target-margin price exceeds continuity and improves gross profit.'
    : input.latestCost && input.previousCost && input.latestCost.amount > input.previousCost.amount ? 'Pass through the absolute cost increase while preserving established customer economics.'
    : 'Preserve the last customer rate; lower purchase cost does not trigger a price reduction.';
  const source = contract
    ? { type: 'APPROVED_CONTRACT' as const, reference: contract.id, date: contract.validFrom, version: String(contract.version) }
    : lastSale
      ? { type: 'LAST_TALLY_INVOICE' as const, reference: lastSale.invoiceReference, date: lastSale.invoiceDate, version: lastSale.sourceId }
      : basePrice ? { type: 'STANDARD_ITEM_PRICE' as const, reference: basePrice.id, date: basePrice.validFrom, version: String(basePrice.version) } : { type: 'NONE' as const, reference: null, date: null, version: null };

  const recentRates = eligibleHistory.slice(0, 5);
  const warnings: PricingResolution['warnings'] = [];
  if (lastSale && !comparable) warnings.push('MISSING_COMPARABLE_HISTORIC_COST');
  if (ambiguous) warnings.push('AMBIGUOUS_SALES_HISTORY');
  if (proposedRate === null) warnings.push('NO_ELIGIBLE_PRICE_HISTORY');
  if (input.latestCost === null) warnings.push('MISSING_PURCHASE_COST');

  const costChangeAmount = comparable ? roundMoney(input.latestCost!.amount - input.previousCost!.amount) : null;
  const costChangePercent = comparable && input.previousCost!.amount > 0
    ? roundMoney(((input.latestCost!.amount - input.previousCost!.amount) / input.previousCost!.amount) * 100)
    : null;
  const currentMargin = proposedRate !== null && input.latestCost ? grossMarginPercent(proposedRate, input.latestCost.amount) : null;
  const previousMargin = lastSale && input.previousCost ? grossMarginPercent(lastSale.rate, input.previousCost.amount) : null;
  const erosion = currentMargin !== null && previousMargin !== null ? roundMoney(currentMargin - previousMargin) : null;
  const increased = costChangeAmount !== null && costChangeAmount > 0;
  if (increased) warnings.push('PURCHASE_PRICE_INCREASED');
  if (proposedRate !== null && input.latestCost && proposedRate < input.latestCost.amount) warnings.push('LOSS_MAKING');
  if (currentMargin !== null && currentMargin < policy.minimumGrossMarginPercent) warnings.push('BELOW_MINIMUM_MARGIN');

  const guardrail: PricingResolution['guardrail'] = proposedRate === null
    || input.latestCost === null
    || warnings.includes('LOSS_MAKING')
    || warnings.includes('BELOW_MINIMUM_MARGIN')
    ? 'PRICE_REVIEW_REQUIRED'
    : increased ? 'COST_INCREASE' : 'PRICE_OK';

  let suggestion: PricingResolution['suggestion'] = null;
  if (input.latestCost && input.latestCost.effectiveAt <= input.pricingDate && policy.targetGrossMarginPercent !== null) {
    const unrounded = input.latestCost.amount / (1 - policy.targetGrossMarginPercent / 100);
    suggestion = {
      amount: roundUp(unrounded, policy.roundingIncrement),
      unroundedAmount: roundMoney(unrounded),
      targetMarginPercent: policy.targetGrossMarginPercent,
      policyVersion: policy.policyVersion,
      roundingRuleVersion: policy.roundingRuleVersion,
      costSourceVersion: input.latestCost.sourceVersion,
    };
  }

  const resolution: PricingResolution['resolution'] = proposedRate === null
    ? input.sellingHistory.length === 0 ? 'NO_PRICE_HISTORY' : 'PRICE_REVIEW_REQUIRED'
    : guardrail === 'PRICE_REVIEW_REQUIRED'
      ? 'PRICE_REVIEW_REQUIRED'
      : contract ? 'APPROVED_CONTRACT_PRICE' : lastSale ? 'LAST_TALLY_INVOICE_PRICE' : 'STANDARD_ITEM_PRICE';

  return {
    continuityPrice, targetMarginPrice, recommendedPrice: proposedRate, recommendationReason,
    resolution,
    guardrail,
    proposedRate: proposedRate === null ? null : roundMoney(proposedRate),
    source,
    recentRates,
    cost: {
      latest: input.latestCost,
      previous: input.previousCost,
      changeAmount: costChangeAmount,
      changePercent: costChangePercent,
    },
    margin: {
      grossProfitAmount: proposedRate !== null && input.latestCost ? roundMoney(proposedRate - input.latestCost.amount) : null,
      grossMarginPercent: currentMargin === null ? null : roundMoney(currentMargin),
      previousGrossMarginPercent: previousMargin === null ? null : roundMoney(previousMargin),
      erosionPercentagePoints: erosion,
    },
    suggestion,
    warnings,
  };
}
