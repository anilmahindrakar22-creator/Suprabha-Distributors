import { describe, expect, it, vi } from 'vitest';
vi.mock('next/link', () => ({ default: 'a' }));
import { renderToStaticMarkup } from 'react-dom/server';
import { EconomicActionOptions, ProposedTargetReview, EconomicApprovalPreview, EconomicHealthBadge, EconomicTargetAdvancedDetails, EconomicTargetCard, InstrumentEconomicsWorkspace, economicCommandNotice, ItemGpBreakdown, reagentLifetime, reportingPeriodLabel } from '@/components/instrument-economics-workspace';
import { capitalBeyondManagementReview } from '@/components/instrument-economics-evidence-forms';
import type { EconomicTarget } from '@/lib/instrument-economics-types';
import { CommandForm } from '@/components/instrument-economics-workspace';

const target: EconomicTarget = {
  id: 'target-1', kind: 'placement', name: 'Central Lab', companyId: 'company-guid', customerId: 'customer-1', customerName: 'City Hospital',
  customerSourceId: 'canonical-customer-guid', siteId: 'site-1', modelId: 'model-1', installationId: null, effectiveFrom: '2026-01-01', effectiveTo: null,
  approval: 'approved', version: 2, capitalPaise: '1250500', revenuePaise: '590050', knownGpPaise: '175025', missingCostLines: 2,
  attributedLines: 5, recoveryPaise: '175025', outstandingPaise: '1075475', health: 'watch', forecastMonths: 18,
  expectation: { id: 'expectation-1', monthlyRevenuePaise: '100000', monthlyGpPaise: '25000', effectiveFrom: '2026-04-01', reason: 'Current approved baseline' },
};

describe('instrument economics presentation', () => {
  it('shows the previous customer in installation option labels', () => {
    const data: import('@/lib/instrument-economics-types').EconomicsWorkspaceData = {
      actorEmail: 'rr-management@test.local', targets: [], customers: [], sourceLines: [], mappings: [], exceptions: [], leakage: [], cases: [],
      canManage: true, canApprove: false, canAct: false, generation: null, lastRebuiltAt: null, sourceImportedAt: null,
      sourceLineCount: 0, unattributedPaise: '0', reportingFrom: '2026-09-01', reportingTo: '2026-10-01',
      policy: { attractiveMonths: 24, reviewMonths: 36, exceptionMonths: 48, forecastWindowMonths: 3, watchRevenuePercent: 80, criticalRevenuePercent: 50 },
      installations: [
      { id: 'rr-installation', name: 'RR analyzer', serialNumber: 'rr 1', customerName: 'Lab B', instrumentId: 'rr-instrument', modelId: 'rr-model', movedFrom: 'Lab A' },
      { id: 'new-installation', name: 'New analyzer', serialNumber: 'NEW-1', customerName: 'Lab B', movedFrom: null },
    ] };
    const html = renderToStaticMarkup(<CommandForm action="create_target" data={data} disabled={false} busy={false} onSubmit={async () => undefined} />);
    expect(html).toContain('RR analyzer · rr 1 · Lab B · moved from Lab A');
    expect(html).toContain('New analyzer · NEW-1 · Lab B</option>');
    expect(html.match(/<option value=""[^>]*>None<\/option>/g)).toHaveLength(1);
  });
  it('formats automatic approval notices and falls back for absent or invalid payback', () => {
    expect(economicCommandNotice({ autoApproved: { paybackMonths: '23.456', attractiveMonths: 24 } })).toBe('Saved. Approved automatically: payback 23.5 months (within 24).');
    expect(economicCommandNotice({ autoApproved: { paybackMonths: 24, attractiveMonths: 24 } })).toBe('Saved. Approved automatically: payback 24.0 months (within 24).');
    expect(economicCommandNotice({})).toBe('Saved. Workspace refreshed with the latest records.');
    expect(economicCommandNotice({ autoApproved: { paybackMonths: 'x', attractiveMonths: 24 } })).toBe('Saved. Workspace refreshed with the latest records.');
  });
  it('offers the policy action only to administrators', () => {
    const management = renderToStaticMarkup(<EconomicActionOptions data={{ canAdministrator: false }} />);
    expect(management).not.toContain('value="set_policy"');
    expect(management).toContain('value="set_expectation"');
    const administrator = renderToStaticMarkup(<EconomicActionOptions data={{ canAdministrator: true }} />);
    expect(administrator).toContain('<option value="set_policy">Set policy version</option>');
  });
  it('gates capital increases using approved GP and exact paise at the review boundary', () => {
    const approved = { ...target, capitalPaise: '30000000', instrumentBillingPaise: '0', investmentReview: { status: 'within_limit' as const, expectedMonthlyGpPaise: '1000000', expectedPaybackMonths: 30, netInvestmentPaise: '30000000', expectationId: 'original', policyId: 'policy', reviewMonths: 36, exceptionMonths: 48 } };
    expect(capitalBeyondManagementReview(approved, BigInt(6000000), 36)).toBe(false);
    expect(capitalBeyondManagementReview(approved, BigInt(6000001), 36)).toBe(true);
    expect(capitalBeyondManagementReview(approved, BigInt(-1), 36)).toBe(false);
    expect(capitalBeyondManagementReview({ ...approved, approval: 'proposed' }, BigInt(10000000), 36)).toBe(false);
    expect(capitalBeyondManagementReview({ ...approved, instrumentBillingPaise: '40000000' }, BigInt(40000000), 36)).toBe(false);
    expect(capitalBeyondManagementReview({ ...approved, expectation: { ...target.expectation!, monthlyGpPaise: '9000000' } }, BigInt(6000001), 36)).toBe(true);
  });
  it('requires administrator permission beyond the review band while leaving rejection available', () => {
    const proposal = { ...target, approval: 'proposed' as const, approvalPreview: { status: 'director_exception_required' as const, capitalPaise: '40000000', instrumentBillingPaise: '0', netInvestmentPaise: '40000000', expectedMonthlyGpPaise: '1000000', expectedPaybackMonths: 40, expectationId: 'start', expectationEffectiveFrom: '2026-01-01', policyId: 'policy-1', reviewMonths: 36, exceptionMonths: 48 } };
    const data = { generation: 'run-1', canApprove: true } as import('@/lib/instrument-economics-types').EconomicsWorkspaceData;
    const management = renderToStaticMarkup(<ProposedTargetReview target={proposal} data={data} disabled={false} onSubmit={() => undefined} />);
    expect(management).toContain('Needs an Administrator to approve (payback over 36 months).');
    expect(management).not.toContain('name="directorException"');
    expect(management).toContain('<option value="approved" disabled="">Approve</option>');
    expect(management).toContain('<option value="rejected">Reject</option>');
    const admin = renderToStaticMarkup(<ProposedTargetReview target={proposal} data={{ ...data, canAdministrator: true }} disabled={false} onSubmit={() => undefined} />);
    expect(admin).toContain('Administrator approval: I confirm this payback beyond the review band');
    expect(admin).toContain('name="directorException"');
    expect(admin).not.toContain('Needs an Administrator');
    const within = renderToStaticMarkup(<ProposedTargetReview target={{ ...proposal, approvalPreview: { ...proposal.approvalPreview, status: 'within_limit', expectedPaybackMonths: 36 } }} data={data} disabled={false} onSubmit={() => undefined} />);
    expect(within).toContain('<option value="approved">Approve</option>');
    expect(within).not.toContain('name="directorException"');
  });
  it('shows investment and recovery without an expected sales or GP target', () => {
    const html = renderToStaticMarkup(<EconomicTargetCard target={{ ...target, expectation: null, capitalPaise: '62500000', instrumentBillingPaise: '40000000', netInvestmentPaise: '22500000', recoveryPaise: '45000000', outstandingPaise: '17500000' }} />);
    expect(html).toContain('aria-label="Investment and recovery"');
    expect(html).toContain('Capital recovered');
    expect(html).toContain('₹50,000.00');
    expect(html).toContain('₹1,75,000.00');
    const advanced = renderToStaticMarkup(<EconomicTargetAdvancedDetails target={{ ...target, expectation: null }} />);
    expect(advanced).toContain('Expected sales / GP: not set');
    expect(advanced).toContain('Invoice and planning details');
  });
  it('does not present a proposal awaiting attribution as zero reagent sales or GP', () => {
    const proposed: EconomicTarget = { ...target, approval: 'proposed', health: 'proposed', revenuePaise: '0', knownGpPaise: '0', itemBreakdown: [] };
    const card = renderToStaticMarkup(<EconomicTargetCard target={proposed} />);
    expect(card).toContain('Pending approval');
    expect(card).toContain('Waiting for approval in Set up.');
    const breakdown = renderToStaticMarkup(<ItemGpBreakdown target={proposed} reportingFrom="2026-09-01" reportingTo="2026-10-01" />);
    expect(breakdown).toContain('Reagent sales and GP are pending approval.');
    expect(breakdown).not.toContain('₹0.00');
    expect(breakdown).not.toContain('No attributed reagent items were billed');
    expect(breakdown).not.toContain('Unique billed items');
  });
  it('distinguishes an unavailable item summary from a verified empty reporting month', () => {
    const props = { reportingFrom: '2026-09-01', reportingTo: '2026-10-01' };
    const unavailable = renderToStaticMarkup(<ItemGpBreakdown target={target} {...props} />);
    expect(unavailable).toContain('Refresh to load the item breakdown.');
    expect(unavailable).not.toContain('Unique billed items');
    const empty = renderToStaticMarkup(<ItemGpBreakdown target={{ ...target, revenuePaise: '0', knownGpPaise: '0', itemBreakdown: [] }} {...props} />);
    expect(empty).toContain('No attributed reagent items were billed in this reporting month.');
    expect(empty).toContain('Unique billed items');
    expect(empty).toContain(reportingPeriodLabel('2026-09-01', '2026-10-01'));
  });

  it('keeps different units separate while counting a canonical item once and retaining unavailable costs', () => {
    const html = renderToStaticMarkup(<ItemGpBreakdown target={{ ...target, itemBreakdown: [
      { productId: 'same-guid', productName: 'Reagent', unit: 'pack', quantity: '0.000001', revenuePaise: '9007199254740993', knownCostPaise: null, knownGpPaise: null, sourceLines: 1, missingCostLines: 1 },
      { productId: 'same-guid', productName: 'Reagent', unit: 'kit', quantity: '-1.000000', revenuePaise: '-100', knownCostPaise: '0', knownGpPaise: '-100', sourceLines: 1, missingCostLines: 0 },
    ] }} reportingFrom="2026-09-01" reportingTo="2026-10-01" />);
    expect(html).toMatch(/Unique billed items<\/dt><dd[^>]*>1<\/dd>/);
    expect(html).toContain('0.000001'); expect(html).toContain('-1');
    expect(html).toContain('₹9,00,71,99,25,47,409.93');
    expect(html).toContain('Unavailable · 1 line missing cost');
    expect(html).toContain('Known cost and GP include verified lines only.');
    expect(html).toContain('−₹1.00'); expect(html).toContain('text-red-800');
  });

  it.each([
    ['missing_baseline', 'Placement-start baseline required'], ['positive_gp_required', 'Positive expected GP required'],
    ['evidence_incomplete', 'Instrument evidence review required'], ['not_applicable', 'Placement cannot be approved'],
  ] as const)('explains the %s proposal blocker without inventing expected payback', (status, label) => {
    const preview = { status, capitalPaise: '55000000', instrumentBillingPaise: '0', netInvestmentPaise: '55000000', expectedMonthlyGpPaise: null, expectedPaybackMonths: null, expectationId: null, expectationEffectiveFrom: null, policyId: 'policy-1', reviewMonths: 36, exceptionMonths: 48 };
    const html = renderToStaticMarkup(<EconomicApprovalPreview target={{ ...target, approvalPreview: preview }} />);
    expect(html).toContain(label); expect(html).toContain('Unavailable'); expect(html).not.toContain('0 months');
  });
  it('explains that verified actual recovery works without an expected target', () => {
    const preview = { status: 'actuals_only' as const, capitalPaise: '62500000', instrumentBillingPaise: '40000000', netInvestmentPaise: '22500000', expectedMonthlyGpPaise: null, expectedPaybackMonths: null, expectationId: null, expectationEffectiveFrom: null, policyId: 'policy-1', reviewMonths: 36, exceptionMonths: 48 };
    const approval = renderToStaticMarkup(<EconomicApprovalPreview target={{ ...target, approvalPreview: preview }} />);
    expect(approval).toContain('Ready for actual tracking');
    expect(approval).toContain('Expected sales and GP are optional');
    const review = { status: 'planning_not_set' as const, expectedPaybackMonths: null, expectationId: null, policyId: 'policy-1', expectedMonthlyGpPaise: null, netInvestmentPaise: '22500000', reviewMonths: 36, exceptionMonths: 48 };
    expect(renderToStaticMarkup(<EconomicTargetAdvancedDetails target={{ ...target, approval: 'approved', investmentReview: review } as EconomicTarget} />)).toContain('Actual verified reagent GP still recovers the investment');
  });
  it('keeps tiny proposal threshold breaches visible and never falls back to a reporting-month baseline', () => {
    const preview = { status: 'director_exception_required' as const, capitalPaise: '64800001', instrumentBillingPaise: '0', netInvestmentPaise: '64800001', expectedMonthlyGpPaise: '1800000', expectedPaybackMonths: 36.000000555, expectationId: 'start', expectationEffectiveFrom: '2026-01-01', policyId: 'policy-1', reviewMonths: 36, exceptionMonths: 48 };
    const html = renderToStaticMarkup(<EconomicApprovalPreview target={{ ...target, approvalPreview: preview }} />);
    expect(html).toContain('Over 36 months'); expect(html).toContain('Approval baseline from 1 Jan 2026.'); expect(html).not.toContain('2026-04-01');
    expect(renderToStaticMarkup(<EconomicApprovalPreview target={{ ...target, approvalPreview: { ...preview, status: 'limit_exceeded', expectedPaybackMonths: 48.0000001 } }} />)).toContain('Over 48 months');
    expect(renderToStaticMarkup(<EconomicApprovalPreview target={target} />)).toContain('Refresh to load the financial approval preview.');
  });
  it.each([
    ['healthy', 'Healthy', 'text-emerald-800'], ['watch', 'Watch', 'text-amber-900'], ['critical', 'Critical', 'text-red-800'],
    ['data_incomplete', 'Data incomplete', 'text-slate-700'], ['inactive', 'Inactive', 'text-slate-600'], ['proposed', 'Proposed', 'text-blue-800'],
  ] as const)('shows %s with an explicit label and distinct color', (health, label, color) => {
    const html = renderToStaticMarkup(<EconomicHealthBadge health={health} />);
    expect(html).toContain(label); expect(html).toContain(color); expect(html).toContain('<svg');
  });

  it('renders only API-provided target values and formats paise without floating point', () => {
    const html = renderToStaticMarkup(<EconomicTargetCard target={target} />);
    expect(html).toContain('₹12,505.00'); expect(html).toContain('₹5,900.50'); expect(html).toContain('₹10,754.75');
    expect(html).toContain('2 sales need purchase-cost review');
    const advanced = renderToStaticMarkup(<EconomicTargetAdvancedDetails target={target} />);
    expect(advanced).toContain('18 months'); expect(advanced).toContain('Current expectation');
  });

  it('shows pooled recovery on the group and omits member-level capital and payback', () => {
    const html = renderToStaticMarkup(<EconomicTargetCard target={{ ...target, pooledIn: 'group-1' }} pooledInName="Regional group" />);
    expect(html).toContain('Pooled in Regional group');
    expect(html).toContain('recovery is reported for the group');
    expect(html).not.toContain('Capital</dt>'); expect(html).not.toContain('Recovery</dt>'); expect(html).not.toContain('Forecast</dt>');
  });

  it('shows payback as not applicable for placements with no capital exposure', () => {
    const html = renderToStaticMarkup(<EconomicTargetAdvancedDetails target={{ ...target, capitalPaise: '0', forecastMonths: null }} />);
    expect(html).toContain('Not applicable');
    expect(html).not.toContain('Unavailable');
    expect(renderToStaticMarkup(<EconomicTargetAdvancedDetails target={{ ...target, capitalPaise: '0', capitalEvidenceCurrent: false, forecastMonths: null }} />)).toContain('Evidence review required');
  });

  it('distinguishes recorded recovery from an unavailable forward forecast', () => {
    const recovered = { ...target, outstandingPaise: '0', recoveryPaise: target.capitalPaise, missingCostLines: 0, forecastMonths: null };
    expect(renderToStaticMarkup(<EconomicTargetAdvancedDetails target={recovered} />)).toContain('Recorded recovery complete');
    expect(renderToStaticMarkup(<EconomicTargetAdvancedDetails target={{ ...recovered, instrumentBillingCurrent: false }} />)).toContain('Evidence review required');
    expect(renderToStaticMarkup(<EconomicTargetAdvancedDetails target={{ ...recovered, capitalEvidenceCurrent: false }} />)).toContain('Evidence review required');
    expect(renderToStaticMarkup(<EconomicTargetAdvancedDetails target={{ ...recovered, missingCostLines: 1 }} />)).not.toContain('Recorded recovery complete');
    expect(renderToStaticMarkup(<EconomicTargetAdvancedDetails target={{ ...recovered, health: 'data_incomplete' }} />)).not.toContain('Recorded recovery complete');
  });
  it('retains over-recovery as a visible surplus rather than losing it at zero outstanding', () => {
    const html = renderToStaticMarkup(<EconomicTargetCard target={{ ...target, capitalPaise: '55000000', recoveryPaise: '57000025', outstandingPaise: '0', missingCostLines: 0 }} />);
    expect(html).toContain('Recorded surplus');
    expect(html).toContain('₹20,000.25');
    expect(html).toContain('not cash receipts');
    expect(renderToStaticMarkup(<EconomicTargetCard target={target} />)).not.toContain('Recorded surplus');
  });
  it('shows reagent sales since installation, excludes instrument billing and points missing purchases to To do', () => {
    const line = { id: 'r1', sourceLineId: 's1', targetId: 'target-1', status: 'verified', reason: 'Automatic Tally purchase cost', shareBasisPoints: 10000, quantity: '2', revenuePaise: '458000', costPaise: '0', gpPaise: '458000', date: '2026-07-25', voucherId: 'v1', revision: '1', productId: 'p1', productName: 'Albumin', unit: 'qty', costEvidence: null };
    const lifetime = reagentLifetime('target-1', [line, { ...line, id: 'r2', sourceLineId: 's2', costPaise: null, gpPaise: null, status: 'cost_unavailable', revenuePaise: '586000' }, { ...line, id: 'r3', sourceLineId: 's3', status: 'instrument_billing', revenuePaise: '40000000', costPaise: null, gpPaise: null }, { ...line, id: 'r4', targetId: 'other' }]);
    expect(lifetime).toEqual({ salesPaise: '1044000', knownGpPaise: '458000', lines: 2, missingCostLines: 1 });
    const html = renderToStaticMarkup(<EconomicTargetCard target={{ ...target, effectiveFrom: '2026-07-23' }} lifetime={lifetime} onReviewCosts={() => undefined} />);
    expect(html).toContain('Reagent sales since 23 Jul 2026'); expect(html).toContain('₹10,440.00');
    expect(html).toContain('Partial · 1 without purchase cost'); expect(html).toContain('1 sale needs purchase-cost review · See To do');
    expect(html).not.toContain('Invoice and planning details'); expect(html).not.toContain('Investment review required');
  });
  it('labels a whole reporting month in plain words', () => {
    expect(reportingPeriodLabel('2026-09-01', '2026-10-01')).toBe('September 2026');
    expect(reportingPeriodLabel('2026-09-10', '2026-09-20')).toBe('10 Sept 2026 to 19 Sept 2026');
  });
  it('labels lifetime reagent totals from the linked instrument sale date rather than installation', () => {
    const sold = { ...target, effectiveFrom: '2026-07-30', salesFrom: '2026-07-23' };
    const html = renderToStaticMarkup(<EconomicTargetCard target={sold} lifetime={{ salesPaise: '15000', knownGpPaise: '12000', lines: 3, missingCostLines: 0 }} />);
    expect(html).toContain('Reagent sales since 23 Jul 2026');
    expect(html).toContain('Reagent GP since 23 Jul 2026');
    expect(html).not.toContain('Reagent sales since 30 Jul 2026');
  });
  it('does not substitute installation when linked instrument sale-date evidence is unavailable', () => {
    const html = renderToStaticMarkup(<EconomicTargetCard target={{ ...target, salesFrom: null }} lifetime={{ salesPaise: '0', knownGpPaise: '0', lines: 0, missingCostLines: 0 }} />);
    expect(html).toContain('Instrument sale date needs review');
    expect(html).not.toContain('Reagent sales since');
  });
  it('links back to the workspace', () => {
    const html = renderToStaticMarkup(<InstrumentEconomicsWorkspace />);
    expect(html).toContain('href="/"'); expect(html).toContain('Back to workspace');
    const embedded = renderToStaticMarkup(<InstrumentEconomicsWorkspace embedded />);
    expect(embedded).not.toContain('Back to workspace');
  });
  it('shows source-driven investment review warnings separately from actual recovery forecast', () => {
    const investmentReview = { status: 'review_required', expectedPaybackMonths: 40, expectationId: 'approval-baseline', policyId: 'policy-1', expectedMonthlyGpPaise: '1000000', netInvestmentPaise: '40000000', reviewMonths: 36, exceptionMonths: 48 };
    const html = renderToStaticMarkup(<EconomicTargetAdvancedDetails target={{ ...target, investmentReview } as EconomicTarget} />);
    expect(html).toContain('Investment review required');
    expect(html).toContain('40 months');
    expect(html).toContain('border-amber-200');
    expect(html).toContain('Actual GP forecast');
    expect(html).not.toContain('Unapproved');
    const limit = renderToStaticMarkup(<EconomicTargetAdvancedDetails target={{ ...target, investmentReview: { ...investmentReview, status: 'limit_exceeded', expectedPaybackMonths: 55 } } as EconomicTarget} />);
    expect(limit).toContain('Investment payback limit exceeded');
    expect(limit).toContain('border-red-200');
    expect(limit).toContain('55 months');
    expect(limit).not.toContain('Forecast</dt>55 months');
  });
  it('does not duplicate investment warnings for pooled members or invent expected payback with missing evidence', () => {
    const investmentReview = { status: 'evidence_incomplete', expectedPaybackMonths: null, expectationId: null, policyId: 'policy-1', expectedMonthlyGpPaise: null, netInvestmentPaise: '40000000', reviewMonths: 36, exceptionMonths: 48 };
    expect(renderToStaticMarkup(<EconomicTargetAdvancedDetails target={{ ...target, investmentReview } as EconomicTarget} />)).toContain('Investment evidence review required');
    expect(renderToStaticMarkup(<EconomicTargetAdvancedDetails target={{ ...target, investmentReview, pooledIn: 'group-1' } as EconomicTarget} />)).not.toContain('Investment evidence review required');
  });
  it('keeps a small threshold breach visible when displayed month rounding reaches the threshold', () => {
    const investmentReview = { status: 'review_required', expectedPaybackMonths: 36, expectationId: 'approval-baseline', policyId: 'policy-1', expectedMonthlyGpPaise: '1800000', netInvestmentPaise: '64800001', reviewMonths: 36, exceptionMonths: 48 };
    expect(renderToStaticMarkup(<EconomicTargetAdvancedDetails target={{ ...target, investmentReview } as EconomicTarget} />)).toContain('Expected investment payback: Over 36 months');
    expect(renderToStaticMarkup(<EconomicTargetAdvancedDetails target={{ ...target, investmentReview: { ...investmentReview, status: 'limit_exceeded', expectedPaybackMonths: 48 } } as EconomicTarget} />)).toContain('Expected investment payback: Over 48 months');
  });
  it('explains slow actual payback even when expected investment remains within limits', () => {
    const investmentReview = { status: 'within_limit', expectedPaybackMonths: 30.56, expectationId: 'approval-baseline', policyId: 'policy-1', expectedMonthlyGpPaise: '1800000', netInvestmentPaise: '55000000', reviewMonths: 36, exceptionMonths: 48 };
    const forecastReview = { status: 'review_required', policyId: 'policy-1', reviewMonths: 36, exceptionMonths: 48 };
    const html = renderToStaticMarkup(<EconomicTargetAdvancedDetails target={{ ...target, health: 'watch', forecastMonths: 43, investmentReview, forecastReview } as EconomicTarget} />);
    expect(html).toContain('Actual recovery forecast needs review');
    expect(html).toContain('43 months');
    expect(html).toContain('Investment within review limit');
    expect(html).toContain('verified trailing reagent GP');
    const critical = renderToStaticMarkup(<EconomicTargetAdvancedDetails target={{ ...target, forecastMonths: 109, forecastReview: { ...forecastReview, status: 'limit_exceeded' } } as EconomicTarget} />);
    expect(critical).toContain('Actual recovery forecast exceeds limit');
    expect(critical).toContain('border-red-200');
    const stalled = renderToStaticMarkup(<EconomicTargetAdvancedDetails target={{ ...target, health: 'critical', missingCostLines: 0, forecastMonths: null, forecastReview: { ...forecastReview, status: 'non_positive_gp' } } as EconomicTarget} />);
    expect(stalled).toContain('Actual GP does not support recovery');
    expect(stalled).toContain('Actual recovery forecast: Unavailable');
    expect(stalled).toContain('GP is zero or negative while investment remains outstanding');
    expect(stalled).not.toContain('Infinity');
    expect(renderToStaticMarkup(<EconomicTargetAdvancedDetails target={{ ...target, forecastReview, pooledIn: 'group-1' } as EconomicTarget} />)).not.toContain('Actual recovery forecast needs review');
  });
});
