import type { LeakageClassification } from './leakage-classification';
export type EconomicItemBreakdown = {
  productId: string; productName: string; unit: string; quantity: string;
  revenuePaise: string; knownCostPaise: string | null; knownGpPaise: string | null;
  sourceLines: number; missingCostLines: number;
};
export type EconomicTarget = {
  id: string; kind: 'placement' | 'group'; name: string; companyId: string; customerId: string;
  customerName: string; customerSourceId: string; siteId: string; modelId: string;
  installationId: string | null; effectiveFrom: string; effectiveTo: string | null;
  salesFrom?: string | null;
  approval: 'proposed' | 'approved' | 'rejected'; version: number;
  pooledIn?: string | null;
  capitalPaise: string; revenuePaise: string; knownGpPaise: string; missingCostLines: number;
  capitalSource?: 'tally_purchase' | 'manual_evidence' | 'pooled_capital'; capitalEvidenceCurrent?: boolean;
  acquisitionProductId?: string | null; acquisitionUnit?: string | null;
  instrumentBillingPaise?: string; netInvestmentPaise?: string; instrumentBillingCurrent?: boolean;
  approvalPreview?: null | { status: 'within_limit' | 'actuals_only' | 'director_exception_required' | 'limit_exceeded' | 'missing_baseline' | 'positive_gp_required' | 'evidence_incomplete' | 'not_applicable'; capitalPaise: string; instrumentBillingPaise: string; netInvestmentPaise: string; expectedMonthlyGpPaise: string | null; expectedPaybackMonths: number | null; expectationId: string | null; expectationEffectiveFrom: string | null; policyId: string; reviewMonths: number; exceptionMonths: number };
  investmentReview?: null | { status: 'within_limit' | 'planning_not_set' | 'review_required' | 'limit_exceeded' | 'positive_gp_required' | 'evidence_incomplete' | 'not_applicable'; expectedPaybackMonths: number | null; netInvestmentPaise: string; expectationId: string | null; expectedMonthlyGpPaise: string | null; policyId: string; reviewMonths: number; exceptionMonths: number; approvedNetInvestmentPaise?: string | null; approvedPaybackMonths?: number | null; approvedDirectorException?: boolean };
  itemBreakdown?: EconomicItemBreakdown[];
  reagentLifetime?: { salesPaise: string; knownGpPaise: string; lines: number; missingCostLines: number };
  attributedLines: number; recoveryPaise: string; outstandingPaise: string;
  health: 'healthy' | 'watch' | 'critical' | 'data_incomplete' | 'inactive' | 'proposed';
  forecastReview?: null | { status: 'within_limit' | 'review_required' | 'limit_exceeded' | 'non_positive_gp' | 'not_available'; policyId: string; reviewMonths: number; exceptionMonths: number };
  forecastMonths: number | null;
  expectation: null | { id: string; monthlyRevenuePaise: string; monthlyGpPaise: string; effectiveFrom: string; reason: string };
};
export type EconomicMapping = { id: string; companyId: string; modelId: string; productId: string; targetId: string | null; effect: 'include' | 'exclude'; effectiveFrom: string; effectiveTo: string | null; reason: string };
export type EconomicException = { sourceId: string; productId: string; date: string; netSalesPaise: string; status: string; reason: string; voucherNumber?: string | null; voucherType?: string | null; voucherDate?: string | null; detail?: string | null; kind?: string | null };
export type LeakageCase = LeakageClassification & { evaluation?: { generationId?: string; expectationId?: string; observationId?: string | null; evaluatedAt?: string; evidenceTier?: string; status?: string; expectedUnits?: string; actualUnits?: string; shortfallUnits?: string; windowFrom?: string; windowTo?: string }; id: string; targetId: string; title: string; reason: string; status: 'detected' | 'qualified' | 'in_progress' | 'recovered' | 'partially_recovered' | 'no_recovery' | 'dismissed'; owner: string; dueDate: string | null; action: string; outcome: string; version: number; potentialRevenuePaise: string | null; potentialGpPaise: string | null; recoveredRevenuePaise: string; recoveredGpPaise: string | null; recoveryReviewRequired?: boolean };
export type LeakageOpportunity = { expectedRevenuePaise?: string | null; actualRevenuePaise?: string | null; expectedGpPaise?: string | null; actualGpPaise?: string | null; revenueVariancePaise?: string | null; gpVariancePaise?: string | null; financialVarianceStatus?: string; attributionComplete?: boolean; targetId: string; productId: string; windowFrom: string; windowTo: string; expectedUnits: string; actualUnits: string; shortfallUnits: string; potentialRevenuePaise: string | null; potentialGpPaise: string | null; evidenceTier: string; status: string; observationId?: string | null; evidenceReference?: string | null; actualConsumptionUnits?: string | null; externalSupplyUnits?: string | null };
export type EconomicsWorkspaceData = {
  /** summary: cards only; detail: tabs, with sourceLines limited to purchases and instrument customers' sales; full: everything. */
  readView?: 'summary' | 'detail' | 'full';
  todoCount?: number;
  actorEmail: string;
  itemGroupCatalogs?: { id: string; companyId: string; sourceVersion: string; observedAt: string; current: boolean; groups: { id: string; name: string; parentId: string | null; itemCount: number }[]; products: { id: string; name: string; groupId: string | null; unit: string }[] }[];
  itemGroupMappings?: { id: string; companyId: string; modelId: string; groupId: string; targetId: string | null; effect: 'include' | 'exclude'; effectiveFrom: string; effectiveTo: string | null; catalogId: string; reason: string }[];

  businessDate?: string; businessTimezone?: string;
  sourceDocumentExclusions?: { sourceId: string; revision: string; date: string; voucherType: string; reason: string; cancelled: boolean }[];
  sourceDocumentExclusionCount?: number;
  acquisitionReviewItems?: { targetId: string; targetName: string; expectedVersion: number; voucherId: string; expectedSourceRevision: string; changed: boolean; cancelled: boolean; previousAmountPaise: string; proposedAmountPaise: string | null; capitalDeltaPaise: string | null; productId: string; lineKey: string }[];
  caseHistory?: { id: string; caseId: string; action: string; actor: string; recordedAt: string; payload: Record<string, unknown> }[];
  caseHistoryTruncated?: boolean;
  acquisitionReviews?: Record<string, unknown>[];
  instrumentBillings?: { target_id: string; source_line_id: string; source_id: string; line_key: string; actor: string; reason: string; current: boolean; billedRecoveryPaise: string }[];
  reportingSummary?: { missingCostLines?: number; netSalesPaise: string; attributedSalesPaise: string; unattributedSalesPaise: string; excludedSalesPaise: string; instrumentBillingSalesPaise?: string; verifiedCostPaise: string; knownGpPaise: string; missingCostSalesPaise: string };
  attributionLines?: { id: string; sourceLineId: string; targetId: string | null; status: string; reason: string; shareBasisPoints: number; quantity: string; revenuePaise: string; costPaise: string | null; gpPaise: string | null; date: string; voucherId: string; revision: string; productId: string; productName: string; unit: string; costEvidence: string | null }[];
  allocations?: { id: string; companyId: string; customerSourceId: string; siteId: string; productId: string; effectiveFrom: string; effectiveTo: string | null; reason: string; shares: { targetId: string; basisPoints: number }[] }[];
  observations?: Record<string, unknown>[];
  groupMemberships?: { id: string; groupId: string; placementId: string; effectiveFrom: string; effectiveTo: string | null }[];
  sourceLines?: { id: string; companyId: string; voucherId: string; voucherNumber?: string | null; revision: string; lineKey: string; date: string; kind: 'sale' | 'purchase' | 'purchase_return' | 'credit' | 'return'; customerSourceId: string | null; productId: string; productName?: string; quantity: string; unit: string; netSalesPaise: string; batchId: string | null }[];
  ledger?: Record<string, unknown>[];
  expectationHistory?: Record<string, unknown>[];
  targets: EconomicTarget[]; mappings: EconomicMapping[]; exceptions: EconomicException[];
  leakage: LeakageOpportunity[]; cases: LeakageCase[];
  installations: { id: string; name: string; serialNumber: string; customerName: string }[];
  customers: { id: string; name: string }[];
  canManage: boolean; canApprove: boolean; canAct: boolean;
  generation: string | null; lastRebuiltAt: string | null; sourceImportedAt: string | null;
  sourceLineCount: number; unattributedPaise: string; reportingFrom: string; reportingTo: string;
  policy: { attractiveMonths: number; reviewMonths: number; exceptionMonths: number; forecastWindowMonths: number; watchRevenuePercent: number; criticalRevenuePercent: number };
};

export const economicActions = ['register_historical_instrument','create_target', 'set_mapping', 'set_item_group_mapping', 'set_expectation','record_observation', 'approve_target', 'link_instrument_billing', 'review_acquisition', 'record_capital', 'set_group_members', 'close_group_membership', 'set_allocation','close_allocation', 'close_target', 'set_policy', 'rebuild', 'create_case', 'update_case', 'claim_recovery', 'verify_cost', 'resolve_line'] as const;
export type EconomicAction = typeof economicActions[number];
export type EconomicCommand = { action: EconomicAction; payload: Record<string, unknown> & { idempotencyKey: string } };

export function validateEconomicCommand(input: unknown): EconomicCommand | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (!economicActions.includes(value.action as EconomicAction) || !value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) return null;
  const payload = value.payload as Record<string, unknown>;
  if (typeof payload.idempotencyKey !== 'string' || payload.idempotencyKey.length < 16 || payload.idempotencyKey.length > 200) return null;
  return { action: value.action as EconomicAction, payload: payload as EconomicCommand['payload'] };
}
