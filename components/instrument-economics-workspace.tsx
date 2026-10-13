'use client';

import { PageHeader, pageActionClass } from './page-header';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type SubmitEvent } from 'react';
import Link from 'next/link';
import { LeakageEconomicsVariance } from '@/components/leakage-economics-variance';
import { EconomicDocumentExclusions } from '@/components/economic-document-exclusions';
import { LeakageCaseHistory } from '@/components/leakage-case-history';
import { LeakageCaseStatus } from '@/components/leakage-case-status';
import { LeakageClassificationFields } from '@/components/leakage-classification-fields';
import { buildLeakageClassification, leakageReasonLabels } from '@/lib/leakage-classification';
import { Activity, AlertTriangle, CheckCircle2, CircleDollarSign, RefreshCw, ShieldAlert } from 'lucide-react';
import type { EconomicAction, EconomicTarget, EconomicsWorkspaceData as BaseEconomicsWorkspaceData, LeakageCase } from '@/lib/instrument-economics-types';
import { buildAllocationShares, buildPurchaseAllocations, costVerificationSaleLines, purchaseMatchKind } from '@/lib/instrument-economics-forms';
import { clearEconomicRecoveryReference, readEconomicRecoveryReference, writeEconomicRecoveryReference, type EconomicRecoveryReference } from '@/lib/instrument-economics-recovery';
import { capitalBeyondManagementReview, MappingOptions, HistoricalInstrumentFields, AcquisitionReviewFields, EconomicMappingIdentityFields, EconomicAllocationRows, InstrumentAcquisitionFields, InstrumentBillingFields, ItemGroupMappingFields, PurchaseCostVerificationFields } from '@/components/instrument-economics-evidence-forms';
import { filterEconomicTargets, InstrumentEconomicsPortfolioFilters, type InstrumentEconomicsPortfolioFilterValues as EconomicPortfolioFilters } from '@/components/instrument-economics-portfolio-filters';
import { readJsonBody } from '@/lib/http-json';

type EconomicsWorkspaceData = BaseEconomicsWorkspaceData & { canAdministrator?: boolean };

export function economicCommandNotice(body: { autoApproved?: { paybackMonths?: number | string; attractiveMonths?: number } }): string {
  const payback = Number(body.autoApproved?.paybackMonths);
  return body.autoApproved && Number.isFinite(payback)
    ? `Saved. Approved automatically: payback ${payback.toFixed(1)} months (within ${body.autoApproved.attractiveMonths}).`
    : 'Saved. Workspace refreshed with the latest records.';
}

function startLoadMeasurement() {
  try {
    for (const name of ['sf-economics-fetch-start', 'sf-economics-parsed', 'sf-economics-rendered']) performance.clearMarks(name);
    performance.clearMeasures('sf-economics-load');
    return performance.now();
  } catch { return null; } // Optional measurement must not block the workspace.
}

type Health = EconomicTarget['health'];
const healthStyle: Record<Health, string> = {
  healthy: 'border-emerald-200 bg-emerald-50 text-emerald-800', watch: 'border-amber-200 bg-amber-50 text-amber-900',
  critical: 'border-red-200 bg-red-50 text-red-800', data_incomplete: 'border-slate-200 bg-slate-100 text-slate-700',
  inactive: 'border-slate-200 bg-slate-100 text-slate-600', proposed: 'border-blue-200 bg-blue-50 text-blue-800',
};
const healthLabel: Record<Health, string> = { healthy: 'Healthy', watch: 'Watch', critical: 'Critical', data_incomplete: 'Data incomplete', inactive: 'Inactive', proposed: 'Proposed' };
const money = (paise: string | null | undefined) => {
  if (paise == null || !/^-?\d+$/.test(paise)) return 'Unavailable';
  const value = BigInt(paise); const sign = value < BigInt(0) ? '−' : ''; const abs = value < BigInt(0) ? -value : value;
  const whole = abs / BigInt(100); const fraction = String(abs % BigInt(100)).padStart(2, '0');
  return `${sign}₹${whole.toLocaleString('en-IN')}.${fraction}`;
};
const economicTimestampFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
function economicTimestamp(value: string | null | undefined): string {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : economicTimestampFormat.format(date);
}
function recoverySurplusPaise(target: EconomicTarget): string | null {
  if (!/^-?\d+$/.test(target.capitalPaise) || !/^-?\d+$/.test(target.recoveryPaise)) return null;
  const surplus = BigInt(target.recoveryPaise) - BigInt(target.capitalPaise);
  return surplus > BigInt(0) ? surplus.toString() : null;
}
function RecoverySurplus({ target }: { target: EconomicTarget }) {
  const surplus = recoverySurplusPaise(target);
  return surplus !== null ? <Metric label="Recorded surplus" value={money(surplus)} hint="Economic recovery above capital; not cash receipts" /> : null;
}
function rupeesToPaise(value: string): string {
  const normalized = value.trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) throw new Error('Enter an amount with up to two decimal places.');
  const negative = normalized.startsWith('-'); const clean = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ''] = clean.split('.'); const paise = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
  return `${negative && paise !== BigInt(0) ? '-' : ''}${paise}`;
}
function forecastLabel(target: EconomicTarget): string {
  if (target.approval === 'proposed') return 'Pending approval';
  if (target.capitalEvidenceCurrent === false || target.instrumentBillingCurrent === false) return 'Evidence review required';
  if (/^0+$/.test(target.capitalPaise)) return 'Not applicable';
  if (/^0+$/.test(target.outstandingPaise) && target.approval === 'approved' && target.missingCostLines === 0 && target.health !== 'data_incomplete') return 'Recorded recovery complete';
  return target.forecastMonths == null ? 'Unavailable' : `${target.forecastMonths} months`;
}
export function EconomicHealthBadge({ health }: { health: Health }) {
  const Icon = health === 'healthy' ? CheckCircle2 : health === 'critical' ? AlertTriangle : health === 'proposed' ? ShieldAlert : Activity;
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${healthStyle[health]}`}><Icon size={14} aria-hidden="true" />{healthLabel[health]}</span>;
}

function reagentAmount(target: EconomicTarget, amount: string | null | undefined) {
  return target.approval === 'proposed' ? 'Pending approval' : money(amount);
}

const economicCodeLabels: Record<string, string> = {
  supply_proxy: 'Based on supplies billed', observed_test_workload: 'Based on observed test workload', inventory_reconciled: 'Based on reconciled stock',
  observed_consumption: 'Based on observed consumption', commercial_expectation: 'Based on commercial expectation',
  data_review_required: 'Data needs review', missing_cost: 'Cost missing', baseline_incomplete: 'Baseline incomplete',
};
function economicCodeLabel(code: string | null | undefined): string {
  if (!code) return 'Unavailable';
  const text = economicCodeLabels[code] ?? code.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const displayDateFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
function displayDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : displayDateFormat.format(date);
}
export function reportingPeriodLabel(from: string, to: string): string {
  const start = new Date(`${from}T00:00:00Z`); const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return `${from} to ${to}`;
  if (start.getUTCDate() === 1 && end.getTime() === Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)) return monthFormat.format(start);
  return `${displayDateFormat.format(start)} to ${displayDateFormat.format(new Date(end.getTime() - 86400000))}`;
}
const salesWithoutPurchase = (count: number) => `${count} ${count === 1 ? 'sale needs' : 'sales need'} purchase-cost review`;

export type ReagentLifetime = { salesPaise: string; knownGpPaise: string; lines: number; missingCostLines: number };
export function reagentLifetime(targetId: string, lines: NonNullable<EconomicsWorkspaceData['attributionLines']>): ReagentLifetime {
  let sales = BigInt(0); let gp = BigInt(0); let count = 0; let missing = 0;
  for (const line of lines) {
    if (line.targetId !== targetId || line.status === 'instrument_billing') continue;
    count += 1;
    if (/^-?\d+$/.test(line.revenuePaise)) sales += BigInt(line.revenuePaise);
    if (line.gpPaise != null && /^-?\d+$/.test(line.gpPaise)) gp += BigInt(line.gpPaise); else missing += 1;
  }
  return { salesPaise: sales.toString(), knownGpPaise: gp.toString(), lines: count, missingCostLines: missing };
}

function InlineMetric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="min-w-0"><dt className="text-xs font-medium text-sf-muted">{label}</dt><dd className={value === 'Unavailable' ? 'text-sm font-semibold text-sf-subtle' : 'text-sm font-extrabold text-sf-strong'}>{value}</dd>{hint ? <p className="text-xs text-sf-muted">{hint}</p> : null}</div>;
}

function ReagentSummary({ target, lifetime, period }: { target: EconomicTarget; lifetime?: ReagentLifetime; period?: string }) {
  const monthName = period ?? 'This month';
  if (target.approval === 'proposed' || !lifetime) {
    return <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2"><InlineMetric label={`Reagent sales · ${monthName}`} value={reagentAmount(target, target.revenuePaise)} /><InlineMetric label={`Reagent GP · ${monthName}`} value={reagentAmount(target, target.knownGpPaise)} hint={target.approval === 'proposed' ? 'Pending approval' : target.missingCostLines ? salesWithoutPurchase(target.missingCostLines) : undefined} /></dl>;
  }
  if (target.salesFrom === null) return <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2"><InlineMetric label="Reagent sales" value="Unavailable" hint="Instrument sale date needs review" /><InlineMetric label="Reagent GP" value="Unavailable" hint="Instrument sale date needs review" /></dl>;
  const since = displayDate(target.salesFrom ?? target.effectiveFrom);
  const gpUnavailable = lifetime.lines > 0 && lifetime.missingCostLines === lifetime.lines;
  return <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
    <InlineMetric label={`Reagent sales since ${since}`} value={money(lifetime.salesPaise)} hint={`${lifetime.lines} invoice ${lifetime.lines === 1 ? 'line' : 'lines'}`} />
    <InlineMetric label={`Reagent GP since ${since}`} value={gpUnavailable ? 'Unavailable' : money(lifetime.knownGpPaise)} hint={lifetime.missingCostLines ? `${gpUnavailable ? '' : 'Partial · '}${lifetime.missingCostLines} without purchase cost` : 'Cost from Tally purchases'} />
  </dl>;
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="min-w-0 rounded-xl bg-sf-soft p-3"><dt className="text-xs font-medium text-sf-muted">{label}</dt><dd className={`mt-1 break-words ${value === 'Unavailable' ? 'text-sm font-semibold text-sf-subtle' : 'text-base font-extrabold text-sf-strong'}`}>{value}</dd>{hint ? <p className="mt-1 text-xs text-sf-muted">{hint}</p> : null}</div>;
}
function InvestmentPaybackReview({ target }: { target: EconomicTarget }) {
  const review = target.investmentReview;
  if (!review || target.pooledIn || target.approval !== 'approved') return null;
  const labels = { within_limit: 'Investment within review limit', planning_not_set: 'Expected target not set', review_required: 'Investment review required', limit_exceeded: 'Investment payback limit exceeded', positive_gp_required: 'Positive expected GP required', evidence_incomplete: 'Investment evidence review required', not_applicable: 'No upfront investment exposure' };
  const critical = review.status === 'limit_exceeded' || review.status === 'positive_gp_required';
  const warning = review.status === 'review_required' || review.status === 'evidence_incomplete';
  const planningNotSet = review.status === 'planning_not_set';
  const Icon = critical || warning ? AlertTriangle : CheckCircle2;
  const paybackLabel = review.expectedPaybackMonths == null ? 'Unavailable' : review.status === 'limit_exceeded' && review.expectedPaybackMonths <= review.exceptionMonths ? `Over ${review.exceptionMonths} months` : review.status === 'review_required' && review.expectedPaybackMonths <= review.reviewMonths ? `Over ${review.reviewMonths} months` : `${review.expectedPaybackMonths} months`;
  return <section aria-label="Investment payback review" className={`mt-3 rounded-xl border p-3 text-xs ${critical ? 'border-red-200 bg-red-50 text-red-800' : warning ? 'border-amber-200 bg-amber-50 text-amber-900' : planningNotSet ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
    <p className="flex items-center gap-2 font-bold"><Icon size={16} aria-hidden="true" />{labels[review.status]}</p>
    {planningNotSet ? <p className="mt-1 leading-5">Actual verified reagent GP still recovers the investment. Add an expected sales/GP target later only when planning is needed.</p> : <><p className="mt-1 leading-5">Expected investment payback: {paybackLabel}. Review above {review.reviewMonths} months; maximum {review.exceptionMonths} months.</p><p className="mt-1 leading-5">Uses current placement investment and the expected GP approved at placement start. Actual GP forecast is shown separately.</p></>}
    {review.approvedPaybackMonths != null ? <p className="mt-1 leading-5">Original approval: {review.approvedPaybackMonths.toLocaleString('en-IN', { maximumFractionDigits: 2 })} months{review.approvedDirectorException ? ' · director exception recorded' : ''}. Original approval history is retained.</p> : null}
    {critical || warning ? <p className="mt-1 font-semibold">Management review required. Tally billing and recorded recovery remain authoritative.</p> : null}
  </section>;
}
function ActualPaybackReview({ target }: { target: EconomicTarget }) {
  const review = target.forecastReview;
  if (!review || target.pooledIn || !['review_required', 'limit_exceeded', 'non_positive_gp'].includes(review.status)) return null;
  if (target.forecastMonths == null && review.status !== 'non_positive_gp') return null;
  const critical = review.status === 'limit_exceeded' || review.status === 'non_positive_gp';
  const threshold = critical ? review.exceptionMonths : review.reviewMonths;
  const months = target.forecastMonths == null ? 'Unavailable' : target.forecastMonths <= threshold ? `Over ${threshold} months` : `${target.forecastMonths} months`;
  return <section aria-label="Actual GP forecast review" className={`mt-3 rounded-xl border p-3 text-xs ${critical ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
    <p className="flex items-center gap-2 font-bold"><AlertTriangle size={16} aria-hidden="true" />{review.status === 'non_positive_gp' ? 'Actual GP does not support recovery' : critical ? 'Actual recovery forecast exceeds limit' : 'Actual recovery forecast needs review'}</p>
    <p className="mt-1 leading-5">Actual recovery forecast: {months}. Review above {review.reviewMonths} months; maximum {review.exceptionMonths} months.</p>
    <p className="mt-1 leading-5">{review.status === 'non_positive_gp' ? 'Verified trailing reagent GP is zero or negative while investment remains outstanding.' : 'Based on outstanding investment and verified trailing reagent GP.'} Management review required.</p>
  </section>;
}

function ItemGroupMappingSummary({ target, data }: { target: EconomicTarget; data: EconomicsWorkspaceData }) {
  const mappings = (data.itemGroupMappings ?? [])
    .filter(row => row.companyId === target.companyId && row.modelId === target.modelId && (row.targetId === target.id || row.targetId === null))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || a.id.localeCompare(b.id));
  const catalog = (data.itemGroupCatalogs ?? [])
    .filter(row => row.companyId === target.companyId)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
  return <details className="mt-3 rounded-xl border border-sf-line-soft p-3">
    <summary className="-m-3 list-item cursor-pointer p-3 text-sm font-bold">Item group mappings ({mappings.length})</summary>
    {mappings.length ? <ul className="mt-2 space-y-3 text-sm">{mappings.map(row => {
      const group = catalog?.groups.find(item => item.id === row.groupId);
      const membership = catalog?.current && group
        ? `Current Tally membership: ${group.itemCount} items.`
        : 'Group catalog needs sync or review; current Tally membership is unavailable.';
      return <li key={row.id} className="border-t border-sf-line-soft pt-2">
        <strong>{group?.name ?? row.groupId}</strong> · {row.effect}
        <p className="text-xs text-sf-muted">{row.effectiveFrom}{row.effectiveTo ? ` until ${row.effectiveTo} (exclusive)` : ' · open-ended'} · {membership}</p>
        <p className="text-xs text-sf-muted">{row.reason}</p>
      </li>;
    })}</ul> : <p className="mt-2 text-sm text-sf-muted">No item group mappings apply to this instrument.</p>}
    {mappings.length && (!catalog || !catalog.current) ? <p className="mt-2 text-xs text-amber-900">The latest group catalog needs sync or review.</p> : null}
  </details>;
}

function recoveredInvestmentPaise(target: EconomicTarget): string | null {
  const billing = target.instrumentBillingPaise ?? '0';
  return /^-?\d+$/.test(target.recoveryPaise) && /^-?\d+$/.test(billing)
    ? (BigInt(target.recoveryPaise) - BigInt(billing)).toString() : null;
}
function recoveryPercent(recovered: string | null | undefined, investment: string | null | undefined): number | null {
  if (recovered == null || investment == null || !/^-?\d+$/.test(recovered) || !/^-?\d+$/.test(investment) || BigInt(investment) <= BigInt(0)) return null;
  const percent = (BigInt(recovered) * BigInt(100)) / BigInt(investment);
  return Number(percent < BigInt(0) ? BigInt(0) : percent > BigInt(100) ? BigInt(100) : percent);
}
function InvestmentRecovery({ target }: { target: EconomicTarget }) {
  if (target.pooledIn) return null;
  const billing = target.instrumentBillingPaise ?? '0';
  const recovered = recoveredInvestmentPaise(target);
  const investment = target.netInvestmentPaise ?? target.capitalPaise;
  const pending = target.approval === 'proposed';
  const percent = pending ? null : recoveryPercent(recovered, investment);
  return <section aria-label="Investment and recovery" className="mt-4 rounded-xl border border-sf-line-soft p-3">
    {pending ? <p className="text-sm text-sf-muted">Investment {money(investment)} · recovery starts after approval</p> : <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><span><span className="text-base font-extrabold text-sf-strong">{money(recovered)}</span> <span className="text-sm text-sf-muted">recovered of {money(investment)}</span></span><span className="text-sm text-sf-muted">Balance <strong className="text-sf-strong">{money(target.outstandingPaise)}</strong></span></p>}
    {percent !== null ? <figure aria-label="Recovery progress" title={`${percent}% recovered`} className="mt-2 h-2 overflow-hidden rounded-full bg-sf-line-soft"><div className={`h-full rounded-full ${percent >= 100 ? 'bg-sf-success' : 'bg-sf-accent'}`} style={{ width: `${percent}%` }} /></figure> : null}
    <details className="mt-2"><summary className="cursor-pointer text-xs font-bold text-sf-brand">Breakdown</summary>
    <dl className="mt-3 grid gap-2 sm:grid-cols-3">
      <Metric label="Investment" value={money(investment)} hint="Instrument cost less net instrument billing" />
      <Metric label="Capital recovered" value={pending ? 'Pending approval' : money(recovered)} hint={pending ? 'Reagent GP has not been calculated yet' : target.missingCostLines ? 'Verified GP and contributions only; costs still need review' : 'Cumulative reagent GP and eligible contributions'} />
      <Metric label="Balance to recover" value={money(target.outstandingPaise)} hint={pending ? 'Before reagent GP review' : target.missingCostLines ? 'Provisional while costs need review' : 'After recorded recovery'} />
    </dl>
    <p className="mt-3 text-xs text-sf-muted">Instrument cost {money(target.capitalPaise)} · Instrument billed {money(billing)}. Recovery is economic recovery, not cash collected.</p>
    <dl className="mt-2"><RecoverySurplus target={target} /></dl>
    </details>
  </section>;
}

const approvalLabel: Record<EconomicTarget['approval'], string> = { approved: 'Approved', proposed: 'Proposed', rejected: 'Rejected' };
export function EconomicTargetCard({ target, selected, pooledInName, expanded, onToggle, children, lifetime, period, onReviewCosts }: { target: EconomicTarget; selected?: boolean; pooledInName?: string; expanded?: boolean; onToggle?: () => void; children?: ReactNode; lifetime?: ReagentLifetime; period?: string; onReviewCosts?: () => void }) {
  const missingCost = target.approval === 'proposed' ? 0 : lifetime?.missingCostLines ?? target.missingCostLines;
  return <article className={`rounded-2xl border bg-white p-4 shadow-sm sm:p-5 ${selected ? 'border-sf-accent ring-2 ring-sf-accent/20' : 'border-sf-line-soft'}`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold text-sf-muted">{target.customerName}{target.kind === 'group' ? ' · group' : ''}</p><h3 className="mt-1 break-words text-lg font-extrabold text-sf-ink">{target.name}</h3><p className="mt-1 text-xs text-sf-muted">Since {displayDate(target.effectiveFrom)}{target.effectiveTo ? ` to ${displayDate(target.effectiveTo)}` : ''} · {approvalLabel[target.approval]}</p></div><EconomicHealthBadge health={target.health} /></div>
    {missingCost > 0 ? onReviewCosts
      ? <button type="button" onClick={onReviewCosts} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 text-sm font-bold text-amber-900"><AlertTriangle size={16} aria-hidden="true" />{salesWithoutPurchase(missingCost)} · See To do</button>
      : <p className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900"><AlertTriangle size={16} aria-hidden="true" />{salesWithoutPurchase(missingCost)}</p> : null}
    {target.pooledIn ? <p className="mt-3 inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-800">Pooled in {pooledInName ?? 'an approved group'} · recovery is reported for the group</p> : null}
    {target.approval === 'proposed' ? <p className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-900">Waiting for approval in Set up. Reagent sales are counted after approval.</p> : null}
    <InvestmentRecovery target={target} />
    <ReagentSummary target={target} lifetime={lifetime} period={period} />
    {onToggle ? <button type="button" onClick={onToggle} aria-expanded={expanded} className="mt-4 inline-flex min-h-10 items-center gap-1 rounded-lg border border-sf-line px-3 text-sm font-bold text-sf-brand">{expanded ? <>Hide sales &amp; items</> : <>Sales &amp; items</>}</button> : null}{expanded ? <div className="mt-4 space-y-4">{children}</div> : null}
  </article>;
}

// Planning, payback and invoice detail kept for Administrators under Advanced.
export function EconomicTargetAdvancedDetails({ target }: { target: EconomicTarget }) {
  return <div>
    <InvestmentPaybackReview target={target} />
    <ActualPaybackReview target={target} />
    {!target.pooledIn ? <details open className="mt-3 rounded-xl bg-sf-soft p-3"><summary className="-m-3 list-item cursor-pointer p-3 text-sm font-bold">Invoice and planning details</summary><dl className="mt-3 grid grid-cols-2 gap-2"><Metric label="Capital" value={money(target.capitalPaise)} /><Metric label="Instrument billing" value={money(target.instrumentBillingPaise ?? '0')} hint="Net invoiced recovery; not cash receipts" /><Metric label="Recovery" value={money(target.recoveryPaise)} hint="Instrument billing, recorded GP and contributions; not cash receipts" /><Metric label="Forecast" value={forecastLabel(target)} /></dl>{target.expectation ? <p className="mt-3 text-xs leading-5 text-sf-muted">Current expectation from {target.expectation.effectiveFrom}: revenue {money(target.expectation.monthlyRevenuePaise)}, GP {money(target.expectation.monthlyGpPaise)} monthly.</p> : <p className="mt-3 text-xs text-sf-muted">Expected sales / GP: not set. Investment and recorded recovery can be viewed without a planning target.</p>}</details> : null}
  </div>;
}

export function EconomicApprovalPreview({ target }: { target: EconomicTarget }) {
  const preview = target.approvalPreview;
  if (!preview) return <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Refresh to load the financial approval preview.</p>;
  const labels = { within_limit: 'Within approval limit', actuals_only: 'Ready for actual tracking', director_exception_required: 'Administrator approval required', limit_exceeded: 'Approval payback limit exceeded', missing_baseline: 'Placement-start baseline required', positive_gp_required: 'Positive expected GP required', evidence_incomplete: 'Instrument evidence review required', not_applicable: 'Placement cannot be approved' };
  const ready = preview.status === 'within_limit' || preview.status === 'actuals_only';
  const critical = preview.status === 'limit_exceeded' || preview.status === 'positive_gp_required';
  const rounded = preview.expectedPaybackMonths == null ? null : Number(preview.expectedPaybackMonths.toFixed(2));
  const payback = rounded == null ? 'Unavailable' : preview.status === 'limit_exceeded' && rounded <= preview.exceptionMonths ? `Over ${preview.exceptionMonths} months` : preview.status === 'director_exception_required' && rounded <= preview.reviewMonths ? `Over ${preview.reviewMonths} months` : `${rounded.toLocaleString('en-IN')} months`;
  const Icon = ready ? CheckCircle2 : AlertTriangle;
  return <section aria-label="Placement approval preview" className="mt-3 space-y-3">
    <p className={`flex items-center gap-2 rounded-lg border p-3 text-xs font-bold ${ready ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : critical ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}><Icon size={16} aria-hidden="true" />{labels[preview.status]}</p>
    <dl className="grid grid-cols-2 gap-2">
      <Metric label={target.kind === 'group' ? 'Pooled capital at start' : 'Instrument capital'} value={money(preview.capitalPaise)} />
      <Metric label="Instrument billing" value={money(preview.instrumentBillingPaise)} hint="Net invoiced recovery; not cash receipts" />
      <Metric label="Placement investment" value={money(preview.netInvestmentPaise)} />
      <Metric label="Expected monthly GP" value={preview.status === 'actuals_only' ? 'Not set' : money(preview.expectedMonthlyGpPaise)} />
      <Metric label="Expected investment payback" value={preview.status === 'actuals_only' ? 'Not set' : payback} />
    </dl>
    {preview.expectationEffectiveFrom ? <p className="text-xs text-sf-muted">Approval baseline from {/^\d{4}-\d{2}-\d{2}$/.test(preview.expectationEffectiveFrom) ? displayDate(preview.expectationEffectiveFrom) : preview.expectationEffectiveFrom}.</p> : null}
    {preview.status === 'actuals_only' ? <p className="text-xs leading-5 text-sf-muted">Expected sales and GP are optional. Approval starts attribution from verified Tally sales and purchase-cost evidence; a planning target can be added later.</p> : <><p className="text-xs leading-5 text-sf-muted">Investment = instrument capital − net instrument billing, with a minimum of zero. Expected payback = investment ÷ expected monthly reagent GP. Review above {preview.reviewMonths} months; maximum {preview.exceptionMonths} months.</p><p className="text-xs leading-5 text-sf-muted">This approval uses expected economics. Actual reagent GP and recovery are reported separately. Changed financial records require a refreshed review.</p></>}
  </section>;
}

export function ProposedTargetReview({ target, data, disabled, onSubmit }: { target: EconomicTarget; data: EconomicsWorkspaceData; disabled: boolean; onSubmit: (event: SubmitEvent<HTMLFormElement>) => void }) {
  const [decision, setDecision] = useState('');
  const administratorRequired = target.approvalPreview?.status === 'director_exception_required';
  const administratorBlocked = administratorRequired && !data.canAdministrator;
  const canApprove = !administratorBlocked && Boolean(data.generation && target.approvalPreview && ['within_limit', 'actuals_only', 'director_exception_required'].includes(target.approvalPreview.status));
  const administratorConfirmationRequired = administratorRequired && !!data.canAdministrator;
  return <div className="mt-3 rounded-xl border border-sf-line-soft p-3">
    <div className="flex flex-wrap justify-between gap-2"><strong className="break-words">{target.name}</strong><EconomicHealthBadge health="proposed" /></div>
    <p className="mt-1 text-xs text-sf-muted">{target.customerName} · version {target.version}</p>
    <EconomicApprovalPreview target={target} />
    {data.canApprove ? <form onSubmit={onSubmit} className="mt-3 grid gap-2"><fieldset disabled={disabled} className="grid gap-2">
      <input type="hidden" name="targetId" value={target.id} /><input type="hidden" name="expectedVersion" value={target.version} /><input type="hidden" name="expectedGeneration" value={data.generation ?? ''} />
      <label className="grid gap-1 text-xs font-semibold">Decision<select name="decision" required value={decision} onChange={event => setDecision(event.target.value)} className="min-h-10 rounded-lg border bg-white px-3 text-sm"><option value="" disabled>Select a decision…</option><option value="approved" disabled={!canApprove}>Approve</option><option value="rejected">Reject</option></select></label>
      <label className="grid gap-1 text-xs font-semibold">Decision reason<textarea name="reason" required minLength={3} rows={2} className="min-h-16 rounded-lg border px-3 py-2 text-sm" /></label>
      {administratorConfirmationRequired ? <label className="flex items-start gap-2 text-xs"><input name="directorException" type="checkbox" required={decision === 'approved'} className="mt-0.5" /> Administrator approval: I confirm this payback beyond the review band</label> : null}
      {administratorBlocked ? <p className="text-xs text-sf-muted">Needs an Administrator to approve (payback over {target.approvalPreview?.reviewMonths} months).</p> : null}
      {!canApprove && !administratorBlocked ? <p className="text-xs text-amber-900">Resolve the preview warning and refresh before approving. A rejection can still be recorded with a reason.</p> : null}
      <button disabled={disabled || (decision === 'approved' && !canApprove)} className="min-h-10 rounded-lg bg-sf-brand px-3 text-sm font-bold text-white disabled:opacity-50">Submit review</button>
    </fieldset></form> : null}
  </div>;
}

type Tab = 'Instruments' | 'To do' | 'Set up' | 'Advanced';
export function EconomicActionOptions({ data }: { data: Pick<EconomicsWorkspaceData, 'canAdministrator'> }) {
  return <>{(['register_historical_instrument', 'create_target', 'link_instrument_billing', 'review_acquisition', 'set_mapping', 'set_item_group_mapping', 'set_expectation', 'record_observation', 'record_capital', 'close_target', 'set_group_members', 'close_group_membership', 'set_allocation', 'close_allocation', 'set_policy', 'verify_cost', 'resolve_line'] as EconomicAction[]).filter(action => action !== 'set_policy' || data.canAdministrator).map(action => <option key={action} value={action}>{titleFor[action]}</option>)}</>;
}

type AdvancedTab = 'All actions' | 'Exceptions' | 'Reagent leakage' | 'Reports';
const advancedTabs: AdvancedTab[] = ['Reports', 'Exceptions', 'Reagent leakage', 'All actions'];
const fields: Record<string, Array<{ name: string; label: string; type?: string; required?: boolean; placeholder?: string }>> = {
  register_historical_instrument: [{ name: 'customerId', label: 'Customer', type: 'customer', required: true }, { name: 'installedOn', label: 'Confirmed installation date', type: 'date', required: true }, { name: 'reason', label: 'Installation verification evidence', required: true }],
  create_target: [
    { name: 'kind', label: 'Target kind', type: 'select', required: true }, { name: 'name', label: 'Target name', required: true }, { name: 'companyId', label: 'Tally company GUID', required: true },
    { name: 'customerId', label: 'Customer', type: 'customer', required: true }, { name: 'customerSourceId', label: 'Canonical customer GUID', required: true }, { name: 'siteId', label: 'Site ID', required: true },
    { name: 'modelId', label: 'Model ID', required: true }, { name: 'installationId', label: 'Installation', type: 'installation' }, { name: 'effectiveFrom', label: 'Effective from', type: 'date', required: true },
  ],
  set_mapping: [
    { name: 'effect', label: 'Effect', type: 'effect', required: true }, { name: 'effectiveFrom', label: 'Effective from', type: 'date', required: true }, { name: 'effectiveTo', label: 'Effective to', type: 'date' }, { name: 'reason', label: 'Reason', required: true },
  ],
  set_item_group_mapping: [
    { name: 'effect', label: 'Effect', type: 'effect', required: true }, { name: 'effectiveFrom', label: 'Effective from', type: 'date', required: true }, { name: 'effectiveTo', label: 'Effective to', type: 'date' }, { name: 'reason', label: 'Reason', required: true },
  ],
  set_expectation: [
    { name: 'targetId', label: 'Economic target', type: 'target', required: true }, { name: 'effectiveFrom', label: 'Effective from', type: 'date', required: true },
    { name: 'monthlyRevenuePaise', label: 'Monthly revenue (₹)', type: 'money', required: true }, { name: 'monthlyGpPaise', label: 'Monthly GP (₹)', type: 'money', required: true },
    { name: 'reason', label: 'Reason', required: true },
  ],
  record_observation: [{ name: 'targetId', label: 'Economic target', type: 'target', required: true }, { name: 'productId', label: 'Canonical reagent product', type: 'product', required: true }, { name: 'baseUnit', label: 'Base unit', required: true }, { name: 'windowFrom', label: 'Observation period starts', type: 'date', required: true }, { name: 'windowTo', label: 'Observation period ends (exclusive)', type: 'date', required: true }, { name: 'testCount', label: 'Tests completed', type: 'number', required: true }, { name: 'testsPerUnit', label: 'Tests per reagent unit', type: 'decimal', required: true }, { name: 'qcUnits', label: 'Quality control units', type: 'decimal' }, { name: 'openingStock', label: 'Opening stock (leave with closing stock blank, or enter both)', type: 'decimal' }, { name: 'closingStock', label: 'Closing stock (leave with opening stock blank, or enter both)', type: 'decimal' }, { name: 'netTransfers', label: 'Net transfers (signed)', type: 'decimal' }, { name: 'externalSupply', label: 'External supply units (separate evidence)', type: 'decimal' }, { name: 'evidenceReference', label: 'Evidence reference', required: true }],
  approve_target: [{ name: 'targetId', label: 'Proposed target', type: 'target', required: true }, { name: 'decision', label: 'Decision', type: 'decision', required: true }, { name: 'expectedVersion', label: 'Expected version', type: 'number', required: true }, { name: 'reason', label: 'Reason', required: true }, { name: 'directorException', label: 'Administrator approval: I confirm this payback beyond the review band', type: 'checkbox' }],
  close_target: [{ name: 'targetId', label: 'Target', type: 'target', required: true }, { name: 'expectedVersion', label: 'Expected version', type: 'number', required: true }, { name: 'effectiveTo', label: 'Effective to', type: 'date', required: true }, { name: 'reason', label: 'Reason', required: true }],
  record_capital: [{ name: 'targetId', label: 'Target', type: 'capitalTarget', required: true }, { name: 'amountPaise', label: 'Signed amount (₹)', type: 'money', required: true }, { name: 'kind', label: 'Entry kind', type: 'capitalKind', required: true }, { name: 'effectiveDate', label: 'Effective date', type: 'date', required: true }, { name: 'reason', label: 'Reason', required: true }, { name: 'directorException', label: 'Administrator approval: I confirm this payback beyond the review band', type: 'checkbox' }],
  set_group_members: [{ name: 'targetId', label: 'Group target', type: 'group', required: true }, { name: 'placementId', label: 'Placement member', type: 'placement', required: true }, { name: 'effectiveFrom', label: 'Effective from', type: 'date', required: true }, { name: 'effectiveTo', label: 'Effective to', type: 'date' }],
  close_group_membership: [{ name: 'membershipId', label: 'Group membership', type: 'membership', required: true }, { name: 'effectiveTo', label: 'Effective to', type: 'date', required: true }, { name: 'reason', label: 'Reason', required: true }],
  set_allocation: [{ name: 'companyId', label: 'Tally company GUID', required: true }, { name: 'customerSourceId', label: 'Canonical customer GUID', required: true }, { name: 'siteId', label: 'Site ID', required: true }, { name: 'productId', label: 'Tally product GUID', required: true }, { name: 'effectiveFrom', label: 'Effective from', type: 'date', required: true }, { name: 'effectiveTo', label: 'Effective to', type: 'date' }, { name: 'reason', label: 'Reason', required: true }],
  close_allocation: [{ name: 'allocationId', label: 'Open product allocation', type: 'allocation', required: true }, { name: 'effectiveTo', label: 'Effective to', type: 'date', required: true }, { name: 'reason', label: 'Reason', required: true }],
  set_policy: [{ name: 'attractiveMonths', label: 'Attractive expected payback (months)', type: 'number', required: true }, { name: 'reviewMonths', label: 'Management can approve up to (months)', type: 'number', required: true }, { name: 'exceptionMonths', label: 'Maximum permitted approval payback (months)', type: 'number', required: true }, { name: 'forecastWindowMonths', label: 'Forecast window (months)', type: 'number', required: true }, { name: 'watchRevenuePercent', label: 'Watch revenue threshold (%)', type: 'number', required: true }, { name: 'criticalRevenuePercent', label: 'Critical revenue threshold (%)', type: 'number', required: true }, { name: 'reason', label: 'Reason', required: true }],
  verify_cost: [],
  claim_recovery: [{ name: 'caseId', label: 'Leakage case', type: 'case', required: true }, { name: 'sourceLineId', label: 'Follow-up sale source line', type: 'saleLine', required: true }, { name: 'shareBasisPoints', label: 'Share (basis points, up to 10000)', type: 'number', required: true }, { name: 'reason', label: 'Recovery evidence', required: true }],
  resolve_line: [{ name: 'sourceLineId', label: 'Current unresolved source line', type: 'reviewLine', required: true }, { name: 'originalSaleLineId', label: 'Verified original sale for return or credit', type: 'saleLine' }, { name: 'focReason', label: 'FOC reason when reviewing a zero-value sale', type: 'focReason' }, { name: 'reason', label: 'Review evidence', required: true }],
};
const titleFor: Record<string, string> = { register_historical_instrument: 'Register existing instrument', review_acquisition: 'Review acquisition revision', link_instrument_billing: 'Link instrument selling invoice', create_target: 'Create target', set_mapping: 'Set product mapping', set_item_group_mapping: 'Map item group to instrument', set_expectation: 'Set expectation', record_observation: 'Record consumption observation', approve_target: 'Review proposed target', close_target: 'Close target', record_capital: 'Record capital or contribution', set_group_members: 'Set group member', close_group_membership: 'Close group membership', set_allocation: 'Set product allocation', close_allocation: 'Close product allocation', set_policy: 'Set policy version', verify_cost: 'Verify sale cost', claim_recovery: 'Claim recovery', resolve_line: 'Review source line' };

function Field({ field, data, targets }: { field: (typeof fields[string])[number]; data: EconomicsWorkspaceData; targets: EconomicTarget[] }) {
  const common = { 'aria-label': field.label, id: field.name, name: field.name, required: field.required, className: 'min-h-10 w-full rounded-lg border border-sf-line bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sf-accent' };
  let input: ReactNode;
  if (field.type === 'checkbox') input = <input {...common} type="checkbox" className="size-5 accent-sf-accent" />;
  else if (field.type === 'select' || field.type === 'effect' || field.type === 'decision' || field.type === 'capitalKind' || field.type === 'customer' || field.type === 'installation' || field.type === 'target' || field.type === 'capitalTarget' || field.type === 'group' || field.type === 'placement' || field.type === 'case' || field.type === 'membership' || field.type === 'allocation' || field.type === 'saleLine' || field.type === 'purchaseLine' || field.type === 'reviewLine' || field.type === 'focReason' || field.type === 'product') {
    let options: [string, string][] = [];
    if (field.type === 'select') options = [['placement', 'Placement'], ['group', 'Group']];
    if (field.type === 'effect') options = [['include', 'Include'], ['exclude', 'Exclude']];
    if (field.type === 'decision') options = [['approved', 'Approve'], ['rejected', 'Reject']];
    if (field.type === 'capitalKind') options = [['capital', 'Capital'], ['contribution', 'Contribution']];
    if (field.type === 'customer') options = data.customers.map(row => [row.id, row.name]);
    if (field.type === 'installation') options = [['', 'None'], ...data.installations.map<[string, string]>(row => [row.id, `${row.name} · ${row.serialNumber} · ${row.customerName}`])];
    if (field.type === 'target') options = targets.map<[string, string]>(row => [row.id, `${row.name} · ${row.customerName}`]);
    if (field.type === 'capitalTarget') options = targets.filter(row => !row.pooledIn).map<[string, string]>(row => [row.id, `${row.name} · ${row.customerName}`]);
    if (field.type === 'group') options = targets.filter(row => row.kind === 'group').map<[string, string]>(row => [row.id, `${row.name} · ${row.customerName}`]);
    if (field.type === 'placement') options = targets.filter(row => row.kind === 'placement').map<[string, string]>(row => [row.id, `${row.name} · ${row.customerName}`]);
    if (field.type === 'case') options = data.cases.map<[string, string]>(row => [row.id, `${row.title} · ${row.status}`]);
    if (field.type === 'membership') options = (data.groupMemberships ?? []).map<[string, string]>(row => [row.id, `${targets.find(target => target.id === row.groupId)?.name ?? row.groupId} → ${targets.find(target => target.id === row.placementId)?.name ?? row.placementId} · ${row.effectiveFrom}${row.effectiveTo ? ` to ${row.effectiveTo}` : ' active'}`]);
    if (field.type === 'allocation') options = (data.allocations ?? []).filter(row => !row.effectiveTo).map<[string, string]>(row => [row.id, `${row.productId} · ${row.siteId} · since ${row.effectiveFrom}`]);
    if (field.type === 'saleLine' || field.type === 'purchaseLine' || field.type === 'reviewLine') options = (data.sourceLines ?? []).filter(row => field.type === 'saleLine' ? row.kind === 'sale' : field.type === 'purchaseLine' ? row.kind === 'purchase' : row.kind !== 'purchase').map<[string, string]>(row => [`${row.id}`, `${row.date} · ${row.kind} · ${row.productName ? `${row.productName} (${row.productId})` : row.productId} · ${row.quantity} ${row.unit} · ${money(row.netSalesPaise)}`]);
    if (field.type === 'focReason') options = [['installation', 'Installation'], ['training', 'Training'], ['quality_control', 'Quality control'], ['replacement', 'Replacement'], ['commercial_support', 'Commercial support'], ['other', 'Other']];
    if (field.type === 'product') options = [...new Map((data.sourceLines ?? []).map(row => [row.productId, row])).values()].map<[string, string]>(row => [row.productId, row.productName ? `${row.productName} · ${row.productId}` : row.productId]);
    input = <select {...common} defaultValue="">{!field.required ? <option value="">None</option> : <option value="" disabled>Select…</option>}{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>;
  } else input = <><input {...common} list={field.name === 'productId' ? 'economic-product-options' : undefined} type={field.type === 'money' || field.type === 'decimal' ? 'text' : field.type ?? 'text'} inputMode={field.type === 'money' || field.type === 'decimal' ? 'decimal' : field.type === 'number' ? 'numeric' : undefined} min={field.name === 'testsPerUnit' ? '0.001' : ['testCount', 'qcUnits', 'externalSupply'].includes(field.name) ? '0' : undefined} step={field.type === 'decimal' ? 'any' : field.type === 'number' ? '1' : undefined} placeholder={field.placeholder} />{field.name === 'productId' ? <datalist id="economic-product-options">{[...new Map((data.sourceLines ?? []).map(line => [line.productId, line])).values()].map(line => <option key={line.productId} value={line.productId}>{line.productName ?? line.productId}</option>)}</datalist> : null}</>;
  return <label htmlFor={field.name} className="grid gap-1.5 text-xs font-semibold text-sf-body">{field.label}{input}</label>;
}

function ExpectationProductRows({ data }: { data: EconomicsWorkspaceData }) {
  const [count, setCount] = useState(1);
  const products = [...new Map((data.sourceLines ?? []).map(line => [line.productId, line])).values()];
  return <section aria-label="Expected reagent products" className="grid gap-3 rounded-xl border border-sf-line-soft p-3 sm:col-span-2"><div><h3 className="text-sm font-bold text-sf-strong">Expected reagent products</h3><p className="text-xs text-sf-muted">Add no more than five products. Each product needs its own base unit and monthly quantity, price and cost.</p></div>{Array.from({ length: count }, (_, index) => <fieldset key={index} className="grid gap-2 rounded-lg bg-sf-soft p-3 sm:grid-cols-2"><legend className="px-1 text-xs font-bold text-sf-body">Product {index + 1}</legend><label className="grid gap-1 text-xs font-semibold">Canonical product GUID<select name={`itemProductId${index}`} defaultValue="" className="min-h-10 rounded-lg border border-sf-line bg-white px-3 text-sm"><option value="">Select source product…</option>{products.map(line => <option key={line.productId} value={line.productId}>{line.productName ? `${line.productName} · ${line.productId}` : line.productId}</option>)}</select></label><label className="grid gap-1 text-xs font-semibold">Base unit<input name={`itemBaseUnit${index}`} className="min-h-10 rounded-lg border border-sf-line bg-white px-3 text-sm" /></label><label className="grid gap-1 text-xs font-semibold">Expected units per month<input name={`itemUnits${index}`} type="number" min="0" step="0.000001" className="min-h-10 rounded-lg border border-sf-line bg-white px-3 text-sm" /></label><label className="grid gap-1 text-xs font-semibold">Expected unit price (₹)<input name={`itemPrice${index}`} inputMode="decimal" className="min-h-10 rounded-lg border border-sf-line bg-white px-3 text-sm" /></label><label className="grid gap-1 text-xs font-semibold sm:col-span-2">Expected unit cost (₹)<input name={`itemCost${index}`} inputMode="decimal" className="min-h-10 rounded-lg border border-sf-line bg-white px-3 text-sm" /></label></fieldset>)}{count < 5 ? <button type="button" onClick={() => setCount(current => current + 1)} className="min-h-10 justify-self-start rounded-lg border border-sf-line px-3 text-sm font-bold text-sf-brand">Add another product</button> : null}</section>;
}

type SubmitCommand = (event: SubmitEvent<HTMLFormElement>, action: EconomicAction) => Promise<void>;
function CommandForm({ action, data, disabled, busy, onSubmit, label, simpleMapping = false }: { action: EconomicAction; data: EconomicsWorkspaceData; disabled: boolean; busy: boolean; onSubmit: SubmitCommand; label?: string; simpleMapping?: boolean }) {
  const targets = data.targets;
  const [acquisitionBlocked, setAcquisitionBlocked] = useState(false);
  const [capitalTargetId, setCapitalTargetId] = useState('');
  const [capitalAmount, setCapitalAmount] = useState('');
  const [capitalKind, setCapitalKind] = useState('capital');
  const capitalTarget = targets.find(row => row.id === capitalTargetId);
  const amountParts = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(capitalAmount.trim());
  const amountPaise = amountParts ? (BigInt(amountParts[2]) * BigInt(100) + BigInt((amountParts[3] ?? '').padEnd(2, '0'))) * (amountParts[1] === '-' ? BigInt(-1) : BigInt(1)) : BigInt(0);
  const capitalBeyondReview = action === 'record_capital' && capitalKind === 'capital' && capitalBeyondManagementReview(capitalTarget, amountPaise, data.policy.reviewMonths);
  const capitalBlocked = capitalBeyondReview && !data.canAdministrator;
  const [mappingTargetId, setMappingTargetId] = useState('');
  const mappingTarget = targets.find(row => row.id === mappingTargetId);
  const mappingFrom = mappingTarget?.salesFrom;
  return <form onChange={event => { const input = event.target; if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) return; if (input.name === 'targetId') setCapitalTargetId(input.value); if (input.name === 'amountPaise') setCapitalAmount(input.value); if (input.name === 'kind') setCapitalKind(input.value); }} onSubmit={event => { if (capitalBlocked || acquisitionBlocked) { event.preventDefault(); return; } void onSubmit(event, action); }} className="mt-4 grid gap-3 sm:grid-cols-2"><fieldset disabled={disabled} className="contents">
    {action === 'set_mapping' ? <EconomicMappingIdentityFields key={data.generation} data={data} simpleOnly={simpleMapping} onTargetChange={setMappingTargetId} /> : null}
    {action === 'set_item_group_mapping' ? <ItemGroupMappingFields key={data.generation} data={data} onTargetChange={setMappingTargetId} /> : null}
    {action === 'link_instrument_billing' ? <InstrumentBillingFields data={data} /> : null}
    {action === 'review_acquisition' ? <AcquisitionReviewFields items={data.acquisitionReviewItems ?? []} targets={targets} groupMemberships={data.groupMemberships} canAdministrator={!!data.canAdministrator} reviewMonths={data.policy.reviewMonths} onBlockedChange={setAcquisitionBlocked} /> : null}
    {action === 'register_historical_instrument' ? <HistoricalInstrumentFields lines={data.sourceLines ?? []} /> : null}
    {action === 'create_target' ? <InstrumentAcquisitionFields lines={data.sourceLines ?? []} /> : null}
    {action === 'verify_cost' ? <PurchaseCostVerificationFields lines={data.sourceLines ?? []} attributionLines={data.attributionLines ?? []} /> : null}
    {action === 'set_allocation' ? <EconomicAllocationRows targets={targets} /> : null}
    {action === 'set_mapping' || action === 'set_item_group_mapping' ? <MappingOptions key={`${data.generation}:${mappingTargetId}`} data={data} defaultFrom={mappingFrom} /> : null}
    {fields[action]?.filter(field => action !== 'set_mapping' && action !== 'set_item_group_mapping' && (field.name !== 'directorException' || !!data.canAdministrator)).map(field => <Field key={field.name} field={field} data={data} targets={targets} />)}
    {capitalBlocked ? <p className="text-xs text-sf-muted sm:col-span-2">Needs an Administrator to approve (payback over {data.policy.reviewMonths} months).</p> : null}
    {action === 'set_expectation' ? <ExpectationProductRows data={data} /> : null}
    <button disabled={disabled || capitalBlocked || acquisitionBlocked} className="min-h-11 rounded-xl bg-sf-brand px-4 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2">{busy ? 'Saving…' : label ?? titleFor[action]}</button>
  </fieldset></form>;
}

const plainQuantity = (quantity: string) => quantity.includes('.') ? quantity.replace(/\.?0+$/, '') : quantity;
function voucherNumbers(data: EconomicsWorkspaceData) {
  return new Map((data.sourceLines ?? []).map(line => [line.id, line.voucherNumber?.trim() || line.voucherId]));
}

function ReagentSalesList({ target, data }: { target: EconomicTarget; data: EconomicsWorkspaceData }) {
  const numbers = voucherNumbers(data);
  const rows = (data.attributionLines ?? []).filter(line => line.targetId === target.id).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return <section aria-label="Instrument sales" className="overflow-hidden rounded-xl border border-sf-line-soft bg-white">
    <div className="p-3 sm:p-4"><h3 className="text-base font-extrabold">{target.name} · sales</h3><p className="mt-1 text-sm text-sf-muted">Tally invoices counted for this instrument. Purchase cost comes from Tally automatically.</p>{target.kind === 'placement' ? <ItemGroupMappingSummary target={target} data={data} /> : null}</div>
    {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-sf-soft text-xs text-sf-muted"><tr>{['Date', 'Tally invoice', 'Item', 'Qty', 'Sales', 'Purchase cost', 'GP'].map(label => <th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead>
      <tbody>{rows.map(row => { const billing = row.status === 'instrument_billing'; return <tr key={row.id} className="border-t border-sf-soft"><td className="whitespace-nowrap p-3">{displayDate(row.date)}</td><td className="p-3">{numbers.get(row.sourceLineId) ?? row.voucherId}</td><td className="p-3">{billing ? 'Instrument billing' : row.productName || row.productId}</td><td className="whitespace-nowrap p-3">{plainQuantity(row.quantity)} {row.unit}</td><td className="whitespace-nowrap p-3">{money(row.revenuePaise)}</td><td className="whitespace-nowrap p-3">{billing ? '—' : row.costPaise == null ? <span className="text-amber-900">Cost unavailable</span> : money(row.costPaise)}</td><td className={`whitespace-nowrap p-3 font-semibold ${row.gpPaise == null ? 'text-slate-600' : row.gpPaise.startsWith('-') ? 'text-red-800' : 'text-emerald-800'}`}>{billing ? '—' : row.gpPaise == null ? '—' : money(row.gpPaise)}</td></tr>; })}</tbody></table></div>
      : <p className="px-5 pb-5 text-sm text-sf-muted">No sales are counted for this instrument yet.</p>}
  </section>;
}

type ItemRow = { productId: string; name: string };
function latestBy<T extends { effectiveFrom: string }>(rows: T[]): T | undefined {
  return rows.reduce<T | undefined>((latest, row) => !latest || row.effectiveFrom >= latest.effectiveFrom ? row : latest, undefined);
}
function ItemCommand({ action, fields, label, tone = 'plain', disabled, onSubmit }: { action: EconomicAction; fields: Record<string, string>; label: string; tone?: 'plain' | 'primary'; disabled: boolean; onSubmit: SubmitCommand }) {
  return <form onSubmit={event => void onSubmit(event, action)} className="inline">
    {Object.entries(fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
    <button disabled={disabled} className={`min-h-11 rounded-lg px-3 text-sm font-bold disabled:opacity-50 ${tone === 'primary' ? 'bg-sf-brand text-white' : 'border border-sf-line text-sf-brand'}`}>{label}</button>
  </form>;
}
// Add or remove reagent items for one instrument. Removing stops counting from today and keeps earlier sales.
function InstrumentItems({ target, data, disabled, onSubmit }: { target: EconomicTarget; data: EconomicsWorkspaceData; disabled: boolean; onSubmit: SubmitCommand }) {
  const today = data.businessDate ?? target.effectiveFrom;
  const catalog = (data.itemGroupCatalogs ?? []).filter(row => row.companyId === target.companyId && row.current).sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
  const names = new Map<string, string>();
  (data.sourceLines ?? []).filter(line => line.companyId === target.companyId).forEach(line => names.set(line.productId, line.productName || line.productId));
  catalog?.products.forEach(product => names.set(product.id, product.name));
  const nameOf = (productId: string) => names.get(productId) ?? productId;
  const groupName = (groupId: string) => catalog?.groups.find(group => group.id === groupId)?.name ?? groupId;
  const groupSize = (groupId: string) => catalog?.groups.find(group => group.id === groupId)?.itemCount;
  const scope = { companyId: target.companyId, modelId: target.modelId, targetId: target.id };
  const groupRules = new Map<string, NonNullable<EconomicsWorkspaceData['itemGroupMappings']>>();
  (data.itemGroupMappings ?? []).filter(row => row.targetId === target.id).forEach(row => groupRules.set(row.groupId, [...(groupRules.get(row.groupId) ?? []), row]));
  const groups = [...groupRules].map(([groupId, rows]) => ({ groupId, rule: latestBy(rows)! })).filter(({ rule }) => rule.effect === 'include' && (!rule.effectiveTo || rule.effectiveTo > today));
  const itemRules = new Map<string, typeof data.mappings>();
  data.mappings.filter(row => row.targetId === target.id).forEach(row => itemRules.set(row.productId, [...(itemRules.get(row.productId) ?? []), row]));
  const itemState = new Map([...itemRules].map(([productId, rows]) => [productId, latestBy(rows)!.effect]));
  const included: ItemRow[] = [...itemState].filter(([, effect]) => effect === 'include').map(([productId]) => ({ productId, name: nameOf(productId) }));
  const removed: ItemRow[] = [...itemState].filter(([, effect]) => effect === 'exclude').map(([productId]) => ({ productId, name: nameOf(productId) }));
  // Use verified Tally group relationships, never a brand-name guess. The parent
  // of SYS 480 is Diasys, so sibling Diasys items qualify, but Sysmex does not.
  const catalogGroups = new Map(catalog?.groups.map(group => [group.id, group]) ?? []);
  const catalogProducts = new Map(catalog?.products.map(product => [product.id, product]) ?? []);
  const families = new Set<string>();
  for (const groupId of [...groups.map(group => group.groupId), ...included.map(item => catalogProducts.get(item.productId)?.groupId)]) {
    if (groupId && catalogGroups.has(groupId)) families.add(catalogGroups.get(groupId)!.parentId ?? groupId);
  }
  const relatedItem = (productId: string) => {
    let groupId = catalogProducts.get(productId)?.groupId;
    const visited = new Set<string>();
    while (groupId && !visited.has(groupId)) {
      if (families.has(groupId)) return true;
      visited.add(groupId); groupId = catalogGroups.get(groupId)?.parentId;
    }
    return false;
  };
  const salesStart = target.salesFrom === undefined ? target.effectiveFrom : target.salesFrom;
  const lineCustomer = new Map((data.sourceLines ?? []).filter(line => line.companyId === target.companyId).map(line => [line.id, line.customerSourceId]));
  const suggestedSales = new Map<string, bigint>();
  (data.attributionLines ?? []).filter(line => !line.targetId && line.reason === 'no_verified_compatible_placement' && lineCustomer.get(line.sourceLineId) === target.customerSourceId && !itemState.has(line.productId) && relatedItem(line.productId) && salesStart != null && line.date >= salesStart)
    .forEach(line => suggestedSales.set(line.productId, (suggestedSales.get(line.productId) ?? BigInt(0)) + BigInt(line.revenuePaise)));
  const suggested = [...suggestedSales].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)).map(([productId, sales]) => ({ productId, name: nameOf(productId), sales: sales.toString() }));
  const [itemSearch, setItemSearch] = useState('');
  const searchWords = itemSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = searchWords.length ? [...names].filter(([, name]) => searchWords.every(word => name.toLowerCase().includes(word)))
    .sort((a, b) => Number(relatedItem(b[0])) - Number(relatedItem(a[0])) || a[1].localeCompare(b[1]))
    .map(([productId, name]) => ({ productId, name })) : suggested;
  const shownItems = matches.slice(0, searchWords.length ? 20 : 6);
  const countedItem = (productId: string) => {
    if (itemState.has(productId)) return itemState.get(productId) === 'include';
    let groupId = catalogProducts.get(productId)?.groupId;
    const visited = new Set<string>();
    while (groupId && !visited.has(groupId)) {
      if (groups.some(group => group.groupId === groupId && group.rule.effectiveFrom <= today)) return true;
      visited.add(groupId); groupId = catalogGroups.get(groupId)?.parentId;
    }
    return false;
  };
  const addFields = (productId: string) => ({ ...scope, productId, effect: 'include', effectiveFrom: itemState.has(productId) ? today : salesStart ?? '', effectiveTo: '', reason: `Added to ${target.name} from the instrument items list` });
  const canEdit = data.canManage && salesStart !== null;
  return <section aria-label="Instrument items" className="rounded-2xl border border-sf-line-soft bg-white p-4 sm:p-6">
    <h2 className="text-lg font-extrabold">{target.name} · items counted</h2>
    <p className="mt-1 text-sm text-sf-muted">These groups and items count toward this instrument&apos;s sales and GP.</p>
    <ul className="mt-3 divide-y divide-sf-soft">
      {groups.map(({ groupId, rule }) => <li key={groupId} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="text-sm"><strong>{groupName(groupId)}</strong> · Tally item group{groupSize(groupId) != null ? ` · ${groupSize(groupId)} items` : ''}</span>{canEdit && catalog ? <ItemCommand action="set_item_group_mapping" label="Remove group" disabled={disabled} onSubmit={onSubmit} fields={{ ...scope, groupId, expectedCatalogId: catalog.id, effect: 'exclude', effectiveFrom: today, effectiveTo: '', reason: `Removed group from ${target.name}` }} /> : null}{rule.effectiveFrom > today ? <span className="text-xs text-sf-muted">from {displayDate(rule.effectiveFrom)}</span> : null}</li>)}
      {included.map(item => <li key={item.productId} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="text-sm"><strong>{item.name}</strong> · single item</span>{canEdit ? <ItemCommand action="set_mapping" label="Remove" disabled={disabled} onSubmit={onSubmit} fields={{ ...scope, productId: item.productId, effect: 'exclude', effectiveFrom: today, effectiveTo: '', reason: `Removed from ${target.name} from the instrument items list` }} /> : null}</li>)}
      {!groups.length && !included.length ? <li className="py-2 text-sm text-sf-muted">No items are counted yet.</li> : null}
    </ul>
    {removed.length ? <details className="mt-3 rounded-xl bg-sf-soft p-3"><summary className="-m-3 list-item cursor-pointer p-3 text-sm font-bold">Removed items ({removed.length})</summary><ul className="mt-2 divide-y divide-sf-line-soft">{removed.map(item => <li key={item.productId} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="text-sm">{item.name}</span>{canEdit ? <ItemCommand action="set_mapping" label="Add back" disabled={disabled} onSubmit={onSubmit} fields={addFields(item.productId)} /> : null}</li>)}</ul></details> : null}
    {canEdit ? <>
      <div className="mt-4">
        <label className="grid gap-1 text-sm font-bold">Search all Tally items<input type="search" value={itemSearch} onChange={event => setItemSearch(event.target.value)} placeholder="Type an item name…" className="min-h-11 w-full rounded-xl border border-sf-line bg-white px-3 text-sm font-normal" /></label>
        <p className="mt-1 text-xs text-sf-muted">{names.size} items across all groups · Adding counts from {salesStart ? displayDate(salesStart) : 'the instrument sale date'}; adding back counts from today.</p>
        <output className="mt-3 block text-xs font-semibold text-sf-muted">{searchWords.length ? `${matches.length} matching items${matches.length > shownItems.length ? ' · Showing 20; type more to narrow the list' : ''}` : shownItems.length ? 'Suggested related items' : 'Type a name to find any Tally item.'}</output>
        {searchWords.length && !matches.length ? <p className="mt-2 text-sm text-sf-muted">No matching items. Try another name.</p> : null}
        <ul aria-label="Items to add" className="mt-2 max-h-80 overflow-y-auto divide-y divide-sf-soft">{shownItems.map(item => <li key={item.productId} className="flex items-center justify-between gap-3 py-2"><span className="min-w-0 text-sm"><strong className="break-words font-medium">{item.name}</strong>{catalogProducts.get(item.productId)?.groupId ? <span className="block text-xs text-sf-muted">{groupName(catalogProducts.get(item.productId)!.groupId!)}</span> : null}</span>{countedItem(item.productId) ? <span className="shrink-0 text-xs font-semibold text-emerald-800">Already counted</span> : <ItemCommand action="set_mapping" label={itemState.get(item.productId) === 'exclude' ? 'Add back' : 'Add'} tone="primary" disabled={disabled} onSubmit={onSubmit} fields={addFields(item.productId)} />}</li>)}</ul>
      </div>
    </> : null}
  </section>;
}

function missingPurchaseReason(sale: NonNullable<EconomicsWorkspaceData['sourceLines']>[number], lines: NonNullable<EconomicsWorkspaceData['sourceLines']>): string {
  // A batch mismatch falls back to FIFO across batches, so reasons consider every batch.
  switch (purchaseMatchKind({ ...sale, batchId: null }, lines)) {
    case 'none': return 'No Tally purchase of this item on or before the sale date. Import the purchase or check the item.';
    case 'short_quantity': return 'Tally purchases of this item are less than the quantity sold.';
    default: return 'Earlier sales already used the available purchase stock.';
  }
}
function TodoPanel({ data }: { data: EconomicsWorkspaceData }) {
  const lines = data.sourceLines ?? [];
  const numbers = voucherNumbers(data);
  const sales = costVerificationSaleLines(lines, data.attributionLines ?? []);
  const problems = data.exceptions.filter(row => row.status === 'import_rejected');
  return <div className="space-y-4">
    <section aria-label="Sales without purchase cost" className="rounded-2xl border border-sf-line-soft bg-white p-4 sm:p-6">
      <h2 className="text-lg font-extrabold">Sales without a matching Tally purchase ({sales.length})</h2>
      <p className="mt-1 text-sm text-sf-muted">Purchase cost is taken from Tally automatically. Fix these in Tally, then sync; the cost fills in by itself.</p>
      {sales.length ? <ul className="mt-3 divide-y divide-sf-soft">{sales.map(sale => <li key={sale.id} className="py-3"><p className="font-bold">{sale.productName || sale.productId} · {plainQuantity(sale.quantity)} {sale.unit} · {money(sale.netSalesPaise)}</p><p className="mt-1 text-xs text-sf-muted">{displayDate(sale.date)} · Tally {numbers.get(sale.id)} line {sale.lineKey}{sale.batchId ? ` · batch ${sale.batchId}` : ''}</p><p className="mt-1 text-sm text-amber-900">{missingPurchaseReason(sale, lines)}</p></li>)}</ul>
        : <p className="mt-3 text-sm text-emerald-800">Nothing to fix. Every counted sale has a Tally purchase cost.</p>}
    </section>
    <section aria-label="Tally import problems" className="rounded-2xl border border-sf-line-soft bg-white p-4 sm:p-6">
      <h2 className="text-lg font-extrabold">Tally documents needing review ({problems.length})</h2>
      {problems.length ? <>
        <p className="mt-1 text-sm text-sf-muted">Accounts needs to review these documents before their amounts can be used. This covers imported Tally data across instruments.</p>
        <details className="mt-3 rounded-xl bg-sf-soft p-3">
          <summary className="-m-3 list-item cursor-pointer p-3 text-sm font-bold">Show document details ({problems.length})</summary>
          <ul className="mt-2 max-h-80 divide-y divide-sf-soft overflow-y-auto">{problems.map((row, index) => <li key={`${row.sourceId}-${index}`} className="py-3"><p className="text-sm font-semibold">{row.reason}</p><p className="mt-1 break-all text-xs text-sf-muted">{displayDate(row.date)} · {row.sourceId}</p></li>)}</ul>
        </details>
      </>
        : <p className="mt-3 text-sm text-emerald-800">No import problems.</p>}
    </section>
  </div>;
}

function SetupStep({ number, title, body, children }: { number: number; title: string; body: string; children: ReactNode }) {
  return <section aria-label={`Step ${number}: ${title}`} className="rounded-2xl border border-sf-line-soft bg-white p-4 sm:p-6"><h2 className="text-lg font-extrabold"><span className="mr-2 inline-flex size-7 items-center justify-center rounded-full bg-sf-brand text-sm text-white">{number}</span>{title}</h2><p className="mt-1 text-sm text-sf-muted">{body}</p>{children}</section>;
}
function SetupSteps({ data, disabled, busy, onSubmit }: { data: EconomicsWorkspaceData; disabled: boolean; busy: boolean; onSubmit: SubmitCommand }) {
  const proposed = data.targets.filter(row => row.approval === 'proposed');
  if (!data.canManage) return <Empty title="Administrator access required" body="Your role can view instrument economics but cannot set up instruments." />;
  return <div className="space-y-4">
    <SetupStep number={1} title="Choose the instrument" body="Instruments delivered through Orders are already listed; go to step 2. For an instrument installed earlier, register it from its Tally invoice.">
      <details className="mt-3 rounded-xl bg-sf-soft p-3"><summary className="-m-3 list-item cursor-pointer p-3 text-sm font-bold">Register an existing instrument</summary><CommandForm action="register_historical_instrument" data={data} disabled={disabled} busy={busy} onSubmit={onSubmit} /></details>
    </SetupStep>
    <SetupStep number={2} title="Investment and approval" body="Record the instrument purchase, link the customer billing, then approve. Investment = purchase cost − instrument billing.">
      <details className="mt-3 rounded-xl bg-sf-soft p-3"><summary className="-m-3 list-item cursor-pointer p-3 text-sm font-bold">a. Record the instrument purchase</summary><CommandForm action="create_target" data={data} disabled={disabled} busy={busy} onSubmit={onSubmit} label="Save purchase" /></details>
      <details className="mt-3 rounded-xl bg-sf-soft p-3"><summary className="-m-3 list-item cursor-pointer p-3 text-sm font-bold">b. Link the customer billing</summary><CommandForm action="link_instrument_billing" data={data} disabled={disabled} busy={busy} onSubmit={onSubmit} label="Link billing" /></details>
      <div className="mt-3 rounded-xl bg-sf-soft p-3"><h3 className="text-sm font-bold">c. Approve</h3>{proposed.length ? proposed.map(row => <ProposedTargetReview key={`${row.id}:${data.generation}`} target={row} data={data} disabled={disabled} onSubmit={event => void onSubmit(event, 'approve_target')} />) : <p className="mt-2 text-sm text-sf-muted">No instruments are waiting for approval.</p>}</div>
    </SetupStep>
    <SetupStep number={3} title="Choose reagent items" body="Pick a Tally item group and/or single items. New items in the group are included automatically after a Tally sync. Each item counts once.">
      <details className="mt-3 rounded-xl bg-sf-soft p-3"><summary className="-m-3 list-item cursor-pointer p-3 text-sm font-bold">Add a Tally item group</summary><CommandForm action="set_item_group_mapping" data={data} disabled={disabled} busy={busy} onSubmit={onSubmit} label="Add item group" /></details>
      <details className="mt-3 rounded-xl bg-sf-soft p-3"><summary className="-m-3 list-item cursor-pointer p-3 text-sm font-bold">Add a single item</summary><CommandForm action="set_mapping" data={data} disabled={disabled} busy={busy} onSubmit={onSubmit} label="Add item" simpleMapping /></details>
    </SetupStep>
  </div>;
}

export function InstrumentEconomicsWorkspace({ embedded = false }: { embedded?: boolean } = {}) {
  const [data, setData] = useState<EconomicsWorkspaceData | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('Instruments'); const [advancedTab, setAdvancedTab] = useState<AdvancedTab>('Reports'); const [selectedId, setSelectedId] = useState(''); const [expandedId, setExpandedId] = useState(''); const [command, setCommand] = useState<EconomicAction>('create_target');
  const [portfolioFilters, setPortfolioFilters] = useState<EconomicPortfolioFilters>({ query: '', health: 'all', kind: 'all' });
  const [notice, setNotice] = useState(''); const retryKey = useRef<{ signature: string; key: string } | null>(null);
  const pendingCommand = useRef<{ action: EconomicAction; payload: Record<string, unknown>; key: string; form: HTMLFormElement | null } | null>(null);
  const [unresolved, setUnresolved] = useState(false); const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [savedCommandActor, setSavedCommandActor] = useState<string | null>(null);
  const recoveryReference = useRef<EconomicRecoveryReference | null>(null);
  const [hasSavedPayload, setHasSavedPayload] = useState(false);
  const measurementElement = useRef<HTMLElement>(null);
  const readView = useRef<'summary' | 'full'>('summary');
  const readSequence = useRef(0);
  const loadMeasurement = useRef<{ data: EconomicsWorkspaceData; startedAt: number; parsedAt: number; signal?: AbortSignal; details: { serverTiming: string | null; responseBytes: number | null; targetCount: number; sourceLineCount: number | null } } | null>(null);
  const load = useCallback(async (signal?: AbortSignal, view = readView.current) => {
    const sequence = ++readSequence.current;
    setLoading(true);
    loadMeasurement.current = null;
    try { measurementElement.current?.removeAttribute('data-load-sample'); } catch { /* optional */ }
    const startedAt = startLoadMeasurement();
    try {
      const response = await fetch('/api/instrument-economics', { cache: 'no-store', signal, headers: { 'x-stockflow-economics-view': view } });
      if (signal?.aborted || sequence !== readSequence.current) return false;
      if (response.status === 401 || response.status === 403) {
        setData(null); setSelectedId(''); setExpandedId(''); setNotice('');
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || 'Financial access is no longer available. Sign in and refresh.');
      }
      const body = await readJsonBody<EconomicsWorkspaceData & { error?: string }>(response);
      if (signal?.aborted || sequence !== readSequence.current) return false;
      if (!response.ok) throw new Error(body.error || 'Unable to load instrument economics.');
      readView.current = body.readView === 'summary' ? 'summary' : 'full';
      if (startedAt !== null && !signal?.aborted) {
        try {
          const bytes = response.headers.get('x-stockflow-response-bytes');
          loadMeasurement.current = { data: body, startedAt, parsedAt: performance.now(), signal, details: {
            serverTiming: response.headers.get('server-timing')?.slice(0, 1024) ?? null,
            responseBytes: bytes && /^\d+$/.test(bytes) && Number.isSafeInteger(Number(bytes)) ? Number(bytes) : null,
            targetCount: body.targets.length, sourceLineCount: body.sourceLineCount ?? null,
          } };
        } catch { /* optional */ }
      }
      setData(body);
      try { recoveryReference.current = readEconomicRecoveryReference(window.sessionStorage); } catch (cause) { setUnresolved(true); throw cause; }
      if (recoveryReference.current) { setUnresolved(true); setSavedCommandActor(recoveryReference.current.actorEmail); }
      const savedActor = pendingCommand.current?.payload.expectedActorEmail ?? recoveryReference.current?.actorEmail;
      setError(savedActor && savedActor !== body.actorEmail ? 'A saved command belongs to another account. Sign in with the original account and refresh before retrying.' : '');
      setSelectedId(current => body.targets.some(row => row.id === current) ? current : body.targets[0]?.id ?? '');
      if (body.readView !== 'summary' && view === 'summary' && body.targets.length === 1) setExpandedId(body.targets[0].id);
      return true;
    }
    catch (cause) { if (signal?.aborted || sequence !== readSequence.current) return false; setError(cause instanceof Error ? cause.message : 'Unable to load instrument economics.'); return false; }
    finally { if (!signal?.aborted && sequence === readSequence.current) setLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); const timer = window.setTimeout(() => void load(controller.signal), 0); return () => { window.clearTimeout(timer); controller.abort(); }; }, [load]);
  useEffect(() => {
    const sample = loadMeasurement.current;
    if (!sample || sample.data !== data) return;
    const frame = requestAnimationFrame(() => {
      if (loadMeasurement.current !== sample || sample.signal?.aborted) return;
      loadMeasurement.current = null;
      try {
        const renderedAt = performance.now();
        performance.mark('sf-economics-fetch-start', { startTime: sample.startedAt });
        performance.mark('sf-economics-parsed', { startTime: sample.parsedAt });
        performance.mark('sf-economics-rendered', { startTime: renderedAt });
        performance.measure('sf-economics-load', 'sf-economics-fetch-start', 'sf-economics-rendered');
        measurementElement.current?.setAttribute('data-load-sample', JSON.stringify({ ...sample.details,
          durationMs: renderedAt - sample.startedAt, fetchParseMs: sample.parsedAt - sample.startedAt,
          renderAfterParseMs: renderedAt - sample.parsedAt,
        }));
      } catch { /* optional */ }
    });
    return () => cancelAnimationFrame(frame);
  }, [data]);
  const visibleTargets = useMemo(() => filterEconomicTargets(data?.targets ?? [], portfolioFilters), [data, portfolioFilters]);
  const selected = useMemo(() => visibleTargets.find(row => row.id === selectedId) ?? visibleTargets[0] ?? null, [visibleTargets, selectedId]);
  const expanded = visibleTargets.find(row => row.id === expandedId) ?? null;
  async function openTab(name: Tab) {
    if (loading) return;
    if (name !== 'Instruments' && data?.readView === 'summary' && !await load(undefined, 'full')) return;
    setTab(name);
  }
  async function toggleTarget(targetId: string) {
    if (loading) return;
    if (expandedId === targetId) { setExpandedId(''); return; }
    if (data?.readView === 'summary' && !await load(undefined, 'full')) return;
    setExpandedId(targetId);
  }
  async function sendCommand(commandToSend: { action: EconomicAction; payload: Record<string, unknown>; key: string; form: HTMLFormElement | null }) {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setHasSavedPayload(true); setNotice(''); setError('');
    try {
      const reference = { action: commandToSend.action, key: commandToSend.key, actorEmail: String(commandToSend.payload.expectedActorEmail) };
      writeEconomicRecoveryReference(window.sessionStorage, reference);
      recoveryReference.current = reference;
      const response = await fetch('/api/instrument-economics', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: commandToSend.action, payload: { ...commandToSend.payload, idempotencyKey: commandToSend.key } }) });
      if (response.status === 401 || response.status === 403) {
        setData(null); setSelectedId(''); setExpandedId(''); setNotice('');
        pendingCommand.current = commandToSend; setUnresolved(true);
        const body = await response.json().catch(() => ({})) as { error?: string };
        setError(body.error || 'Financial access is no longer available. Sign in with the original account and refresh.');
        return;
      }
      let body: { error?: string; autoApproved?: { paybackMonths?: number | string; attractiveMonths?: number } };
      try { body = await response.json() as { error?: string; autoApproved?: { paybackMonths?: number | string; attractiveMonths?: number } }; }
      catch { pendingCommand.current = commandToSend; setUnresolved(true); setError('The server response could not be read, so the result is unknown. Retry the saved command with the same request key.'); return; }
      if (!response.ok) {
        const transient = response.status === 429 || response.status >= 500;
        if (transient) { pendingCommand.current = commandToSend; setUnresolved(true); setError(body.error || `The result for ${commandToSend.action} is unknown. Retry the saved command with the same request key.`); }
        else { clearEconomicRecoveryReference(window.sessionStorage); recoveryReference.current = null; pendingCommand.current = null; setHasSavedPayload(false); retryKey.current = null; setSavedCommandActor(null); setUnresolved(false); setError(body.error || `Unable to complete ${commandToSend.action}.`); }
        return;
      }
      clearEconomicRecoveryReference(window.sessionStorage); recoveryReference.current = null;
      pendingCommand.current = null; setHasSavedPayload(false); retryKey.current = null; setSavedCommandActor(null); setUnresolved(false); setNotice(economicCommandNotice(body)); if (commandToSend.form?.isConnected) commandToSend.form.reset(); await load();
    } catch (cause) {
      pendingCommand.current = commandToSend; setUnresolved(true); setError(`${cause instanceof Error ? cause.message : 'Network error'} The result is unknown. Retry the saved command with the same request key.`);
    } finally { busyRef.current = false; setBusy(false); }
  }
  async function recoverCommand(closeUnresolved: boolean) {
    const reference = recoveryReference.current;
    if (!reference || busyRef.current || reference.actorEmail !== data?.actorEmail) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/instrument-economics', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'recover_economic_command', payload: { commandAction: reference.action, commandKey: reference.key, expectedActorEmail: reference.actorEmail, closeUnresolved } }) });
      if (response.status === 401 || response.status === 403) { setData(null); setSelectedId(''); setExpandedId(''); setNotice(''); }
      const body = await readJsonBody<{ status?: string; error?: string }>(response);
      if (!response.ok) throw new Error(body.error || 'Unable to check the saved command.');
      if (body.status !== 'accepted' && body.status !== 'not_saved') { setError('The result is still unknown. Check again, or close the unresolved request to block any late save before entering another command.'); return; }
      clearEconomicRecoveryReference(window.sessionStorage); recoveryReference.current = null; pendingCommand.current = null; setHasSavedPayload(false); retryKey.current = null;
      setSavedCommandActor(null); setUnresolved(false); setNotice(body.status === 'accepted' ? 'The original command was saved. Workspace refreshed.' : 'The request was closed before saving. Late delivery is blocked; you can enter a new command.'); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to check the saved command.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function submit(event: SubmitEvent<HTMLFormElement>, action: EconomicAction, targetCase?: LeakageCase, opportunity?: EconomicsWorkspaceData['leakage'][number]) {
    event.preventDefault(); if (!data || busyRef.current || (unresolved && !pendingCommand.current)) return; const form = event.currentTarget; const raw: Record<string, unknown> = {};
    for (const [key, value] of new FormData(form).entries()) raw[key] = value;
    const payload: Record<string, unknown> = { ...raw, expectedActorEmail: data.actorEmail };
    try {
      if (!data.actorEmail) throw new Error('Refresh instrument economics before saving.');
      if (action === 'set_item_group_mapping') {
        const target = data.targets.find(row => row.id === raw.targetId && row.kind === 'placement');
        const catalog = target ? (data.itemGroupCatalogs ?? []).find(row => row.id === raw.expectedCatalogId && row.current && row.companyId === target.companyId) : undefined;
        if (!target || !catalog || typeof raw.groupId !== 'string' || !catalog.groups.some(group => group.id === raw.groupId)) throw new Error('Select an instrument and a group from its current Tally item catalog. Sync Tally and refresh if no current catalog is available.');
      }
      if (action === 'create_case' || action === 'update_case') Object.assign(payload, buildLeakageClassification(new FormData(form)));
      if (action === 'review_acquisition' && !(data.acquisitionReviewItems ?? []).some(item => item.targetId === payload.targetId && item.changed && item.proposedAmountPaise != null)) throw new Error('The acquisition source is missing or incompatible. Investigate its Tally evidence before reviewing capital.');
      for (const key of ['capitalPaise', 'monthlyRevenuePaise', 'monthlyGpPaise', 'amountPaise', 'expectedUnitPricePaise', 'expectedUnitCostPaise']) if (typeof payload[key] === 'string' && payload[key] !== '') payload[key] = rupeesToPaise(String(payload[key]));
      if (action === 'set_expectation') {
        const items: Record<string, string>[] = [];
        const itemValue = (key: string) => typeof raw[key] === 'string' ? raw[key] as string : '';
        for (let index = 0; index < 5; index++) {
          const productId = itemValue(`itemProductId${index}`).trim(); const units = itemValue(`itemUnits${index}`).trim();
          const baseUnit = itemValue(`itemBaseUnit${index}`).trim(); const price = itemValue(`itemPrice${index}`).trim(); const cost = itemValue(`itemCost${index}`).trim();
          if (![productId, units, baseUnit, price, cost].some(Boolean)) continue;
          if (!productId || !units || !baseUnit || !price || !cost) throw new Error(`Complete every field in product row ${index + 1}, or leave the row empty.`);
          items.push({ productId, baseUnit, expectedMonthlyUnits: units, expectedUnitPricePaise: rupeesToPaise(price), expectedUnitCostPaise: rupeesToPaise(cost) });
        }
        if (new Set(items.map(item => item.productId)).size !== items.length) throw new Error('Each expectation row must use a different product.');
        if (items.length) payload.items = items;
        for (const key of Object.keys(payload)) if (/^item(?:ProductId|Units|BaseUnit|Price|Cost)\d+$/.test(key)) delete payload[key];
      }
      if (action === 'set_group_members') { payload.members = [{ placementId: payload.placementId, effectiveFrom: payload.effectiveFrom, effectiveTo: payload.effectiveTo || null }]; delete payload.placementId; }
      if (action === 'set_allocation') {
        payload.shares = buildAllocationShares(raw);
        for (const key of Object.keys(payload)) if (/^allocation(?:TargetId|Percent)\d+$/.test(key)) delete payload[key];
      }
      if (action === 'verify_cost') {
        payload.purchaseAllocations = buildPurchaseAllocations(raw, data.sourceLines ?? []);
        for (const key of Object.keys(payload)) if (/^purchase(?:LineId|Quantity)\d+$/.test(key)) delete payload[key];      }
      if (action === 'claim_recovery' && raw.shareBasisPoints && (!Number.isInteger(Number(raw.shareBasisPoints)) || Number(raw.shareBasisPoints) < 1 || Number(raw.shareBasisPoints) > 10000)) throw new Error('Recovery share must be a whole number from 1 to 10000 basis points.');
      if (action === 'record_observation') {
        const count = Number(raw.testCount); const perUnit = Number(raw.testsPerUnit);
        if (!Number.isSafeInteger(count) || count < 0 || !Number.isFinite(perUnit) || perUnit <= 0) throw new Error('Enter a nonnegative whole test count and positive tests per unit.');
        const opening = raw.openingStock; const closing = raw.closingStock;
        if (Boolean(opening) !== Boolean(closing)) throw new Error('Enter both opening and closing stock, or leave both blank.');
        for (const key of ['qcUnits', 'openingStock', 'closingStock', 'externalSupply']) if (raw[key] !== undefined && (!Number.isFinite(Number(raw[key])) || Number(raw[key]) < 0)) throw new Error(`${key} must be a nonnegative number.`);
        if (raw.netTransfers !== undefined && !Number.isFinite(Number(raw.netTransfers))) throw new Error('Net transfers must be a signed number.');
      }
      if (action === 'create_target' && typeof payload.capitalPaise === 'string' && BigInt(payload.capitalPaise) > BigInt(0) && !(typeof raw.capitalEvidence === 'string' && raw.capitalEvidence.trim())) throw new Error('Add purchase or approval evidence for nonzero capital exposure.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Check the entered values.'); return; }
    if (payload.directorException === 'on') payload.directorException = true;
    if (payload.confirmCancellation === 'on') payload.confirmCancellation = true;
    if (targetCase) { payload.caseId = targetCase.id; payload.expectedVersion = targetCase.version; }
    if (opportunity) Object.assign(payload, { expectedGeneration: data.generation, targetId: opportunity.targetId, opportunityProductId: opportunity.productId, windowFrom: opportunity.windowFrom, windowTo: opportunity.windowTo });
    const signature = JSON.stringify({ action, payload });
    if (pendingCommand.current && pendingCommand.current.key && signature !== JSON.stringify({ action: pendingCommand.current.action, payload: pendingCommand.current.payload })) { setError('A previous command has an unknown result. Retry that saved command before starting or changing another command.'); return; }
    if (unresolved && pendingCommand.current) { await sendCommand(pendingCommand.current); return; }
    if (!retryKey.current || retryKey.current.signature !== signature) retryKey.current = { signature, key: crypto.randomUUID() };
    const next = { action, payload, key: retryKey.current.key, form }; pendingCommand.current = next; setSavedCommandActor(data.actorEmail); await sendCommand(next);
  }
  const canRetrySavedCommand = !!data?.canManage && savedCommandActor === data.actorEmail && hasSavedPayload;
  const visibleTabs: Tab[] = data?.canManage ? ['Instruments', 'To do', 'Set up', 'Advanced'] : ['Instruments', 'To do'];
  const todoCount = data?.readView === 'summary' ? data.todoCount ?? 0 : data ? costVerificationSaleLines(data.sourceLines ?? [], data.attributionLines ?? []).length + data.exceptions.filter(row => row.status === 'import_rejected').length : 0;

  return <main ref={measurementElement} data-economics-workspace="" className={`${embedded ? 'h-full min-h-0' : 'h-dvh'} overflow-y-auto bg-sf-page text-sf-strong`}><div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-8">
    <PageHeader
      back={embedded ? undefined : <Link href="/" className="inline-flex min-h-10 items-center px-1 text-sm font-bold text-sf-accent">← Back to workspace</Link>}
      title="Instrument economics"
      description="Investment, capital recovered and balance to recover for each instrument."
      actions={<button type="button" disabled={loading || busy || (unresolved && canRetrySavedCommand)} onClick={() => void load()} className={pageActionClass}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />Refresh</button>}
    />
    {error || unresolved ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error || 'A saved command is waiting for confirmation. Retry it with the original request key before making another change.'}{unresolved && canRetrySavedCommand ? <button type="button" disabled={busy} onClick={() => { const pending = pendingCommand.current; if (pending) void sendCommand(pending); }} className="ml-3 min-h-11 rounded-lg bg-red-800 px-3 font-bold text-white disabled:opacity-50">{busy ? 'Retrying…' : 'Retry saved command'}</button> : null}{unresolved && savedCommandActor && savedCommandActor === data?.actorEmail ? <span className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void recoverCommand(false)} className="min-h-10 rounded-lg border border-red-300 px-3 font-bold disabled:opacity-50">Check saved command</button>{data?.canManage ? <button type="button" disabled={busy} onClick={() => void recoverCommand(true)} className="min-h-10 rounded-lg bg-red-800 px-3 font-bold text-white disabled:opacity-50">Close unresolved request</button> : null}<span className="basis-full text-xs">Closing checks the receipt first. A completed save is retained; otherwise any late delivery of this request is blocked.</span></span> : null}</div> : null}{notice ? <output className="block rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</output> : null}
    {data ? <p className="-mt-2 text-xs text-sf-muted">Business date {data.businessDate ? displayDate(data.businessDate) : 'unavailable'} · Tally data from {economicTimestamp(data.sourceImportedAt)}</p> : null}
    <nav aria-label="Economics sections" className="flex gap-1 overflow-x-auto rounded-2xl border border-sf-line-soft bg-white p-1.5 [scrollbar-width:none]">{visibleTabs.map(name => <button key={name} type="button" onClick={() => void openTab(name)} disabled={loading} aria-current={tab === name ? 'page' : undefined} className={`min-h-11 flex-1 shrink-0 whitespace-nowrap rounded-xl px-2.5 py-2 text-sm font-bold ${tab === name ? 'bg-sf-brand text-white' : 'text-sf-body hover:bg-sf-soft'}`}>{name}{name === 'To do' && todoCount ? ` (${todoCount})` : ''}</button>)}</nav>
    {loading && data ? <output className="block text-sm text-sf-muted">Loading economics details…</output> : null}
    {loading && !data ? <div className="rounded-2xl bg-white p-8 text-sm text-sf-muted">Loading economics data…</div> : null}
    {data && tab === 'Instruments' ? <>{data.targets.length > 2 ? <InstrumentEconomicsPortfolioFilters filters={portfolioFilters} onChange={setPortfolioFilters} total={data.targets.length} matching={visibleTargets.length} /> : null}<section aria-label="Economic targets" className="grid gap-4 xl:grid-cols-2">{visibleTargets.length ? visibleTargets.map(target => <EconomicTargetCard key={target.id} target={target} pooledInName={data.targets.find(row => row.id === target.pooledIn)?.name} selected={expanded?.id === target.id} expanded={expanded?.id === target.id} onToggle={() => void toggleTarget(target.id)} lifetime={target.reagentLifetime ?? (data.attributionLines ? reagentLifetime(target.id, data.attributionLines) : undefined)} period={reportingPeriodLabel(data.reportingFrom, data.reportingTo)} onReviewCosts={() => void openTab('To do')}>{target.kind === 'placement' && !target.pooledIn ? <InstrumentItems key={`${target.id}:${data.generation}`} target={target} data={data} disabled={unresolved || busy} onSubmit={submit} /> : null}<ReagentSalesList target={target} data={data} /></EconomicTargetCard>) : <Empty title={data.targets.length ? "No matching instruments" : "No instruments yet"} body={data.targets.length ? "Change the search, status or type filters to see more instruments." : "Add an instrument in Set up."} />}</section></> : null}
    {data && tab === 'To do' ? <TodoPanel data={data} /> : null}
    {data && tab === 'Set up' ? <SetupSteps data={data} disabled={unresolved || busy} busy={busy} onSubmit={submit} /> : null}
    {data && tab === 'Advanced' && data.canManage ? <nav aria-label="Advanced sections" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">{advancedTabs.map(name => <button key={name} type="button" onClick={() => setAdvancedTab(name)} aria-current={advancedTab === name ? 'page' : undefined} className={`shrink-0 whitespace-nowrap min-h-10 rounded-lg border px-3 text-sm font-bold ${advancedTab === name ? 'border-sf-brand bg-sf-brand text-white' : 'border-sf-line bg-white text-sf-body'}`}>{name}</button>)}</nav> : null}
    {data && tab === 'Advanced' && data.canManage && advancedTab === 'All actions' ? <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,.75fr)]"><details id="economic-setup" open={command === 'verify_cost' || !data.targets.some(row => row.approval === 'proposed')} className="scroll-mt-4 self-start rounded-2xl border border-sf-line-soft bg-white p-4 sm:p-6"><summary className="min-h-10 cursor-pointer py-2 font-extrabold"><h2 className="inline text-lg font-extrabold">All actions</h2></summary><p className="mt-1 text-sm text-sf-muted">Add a versioned target, source mapping, expectation, usage observation, group, allocation, cost evidence or capital entry.</p>{data.canManage ? <><label className="mt-4 grid gap-1.5 text-xs font-semibold text-sf-body">Action<select aria-label="Action" value={command} disabled={unresolved || busy} onChange={event => setCommand(event.target.value as EconomicAction)} className="min-h-10 rounded-lg border border-sf-line bg-white px-3 text-sm"><EconomicActionOptions data={data} /></select></label>{command === 'record_capital' ? <p className="mt-3 rounded-lg bg-sf-soft p-3 text-xs leading-5 text-sf-muted">Record actual capital or eligible contributions dated today or earlier. Capital increases on approved placements use the original approved expected GP and current payback limits; payback beyond the review band requires explicit administrator approval.</p> : null}{command === 'record_observation' ? <p className="mt-3 rounded-lg bg-sf-soft p-3 text-xs leading-5 text-sf-muted">Expected supply = tests ÷ tests per unit + QC units + closing stock − opening stock − net transfers. External supply is recorded as separate evidence and is not subtracted from the sales opportunity.</p> : null}{command === 'close_group_membership' ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">Closing membership also closes the member’s logical economic placement on this date; its physical installation remains active. Create a new dated placement and review residual capital before regrouping or moving the instrument.</p> : null}<CommandForm key={command} action={command} data={data} disabled={unresolved || busy} busy={busy} onSubmit={submit} /></> : <Empty title="Management access required" body="Your role can view verified economics but cannot change target setup." />}</details><section className="rounded-2xl border border-sf-line-soft bg-white p-4 sm:p-6"><h2 className="text-lg font-extrabold">Proposed targets</h2>{data.targets.filter(row => row.approval === 'proposed').length ? data.targets.filter(row => row.approval === 'proposed').map(row => <ProposedTargetReview key={`${row.id}:${data.generation}`} target={row} data={data} disabled={unresolved || busy} onSubmit={event => void submit(event, 'approve_target')} />) : <p className="mt-3 text-sm text-sf-muted">No proposed targets.</p>}</section></div> : null}
    {data && tab === 'Advanced' && data.canManage && advancedTab === 'Exceptions' ? <section className="overflow-hidden rounded-2xl border border-sf-line-soft bg-white"><div className="p-4 sm:p-6"><h2 className="text-lg font-extrabold">Attribution and cost exceptions</h2><p className="mt-1 text-sm text-sf-muted">Unattributed sales remain outside target revenue. Missing cost evidence leaves attributed revenue visible while GP stays unavailable; reviewed FOC rows can carry negative known GP. Connector import errors are shown as source evidence and may affect the completeness of this reporting generation.</p></div>{data.exceptions.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-sf-soft text-xs text-sf-muted"><tr><th className="p-3">Source</th><th className="p-3">Product</th><th className="p-3">Date</th><th className="p-3">Sales</th><th className="p-3">Status</th><th className="p-3">Reason</th></tr></thead><tbody>{data.exceptions.map((row, i) => <tr key={`${row.sourceId}-${i}`} className="border-t border-sf-soft"><td className="p-3">{row.sourceId}</td><td className="p-3">{row.productId}</td><td className="p-3">{row.date}</td><td className="p-3">{money(row.netSalesPaise)}</td><td className="p-3">{row.status}</td><td className="p-3">{row.reason}</td></tr>)}</tbody></table></div> : <Empty title="No current exceptions" body="The current workspace has no unresolved attribution or cost exception rows." />}</section> : null}
    {data && tab === 'Advanced' && data.canManage && advancedTab === 'Reagent leakage' ? <div className="space-y-5"><section className="rounded-2xl border border-sf-line-soft bg-white p-4 sm:p-6"><h2 className="text-lg font-extrabold">Reagent leakage opportunities</h2><p className="mt-1 text-sm text-sf-muted">Potential values are estimates labeled by their evidence tier; they are not realized sales or GP.</p>{data.leakage.length ? <div className="mt-4 grid gap-3 lg:grid-cols-2">{data.leakage.map((row, i) => <article key={`${row.targetId}-${row.productId}-${row.windowFrom}-${row.windowTo}-${i}`} className="rounded-xl border border-sf-line-soft p-4"><div className="flex flex-wrap justify-between gap-2"><strong>{data.targets.find(t => t.id === row.targetId)?.name ?? row.targetId}</strong><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-800">Estimate · {economicCodeLabel(row.evidenceTier)}</span></div><p className="mt-2 text-xs text-sf-muted" title={row.productId}>{data.sourceLines?.find(line => line.productId === row.productId)?.productName ?? 'Reagent'} · {reportingPeriodLabel(row.windowFrom, row.windowTo)}</p><dl className="mt-3 grid grid-cols-2 gap-2"><Metric label="Expected units" value={row.expectedUnits} /><Metric label="Actual units" value={row.actualUnits} /><Metric label="Shortfall" value={row.shortfallUnits} /><Metric label="Potential revenue" value={money(row.potentialRevenuePaise)} /><Metric label="Potential GP" value={money(row.potentialGpPaise)} /><Metric label="Evaluation" value={economicCodeLabel(row.status)} />{row.actualConsumptionUnits != null ? <Metric label="Observed consumption" value={row.actualConsumptionUnits} /> : null}{row.externalSupplyUnits != null ? <Metric label="External supply (separate)" value={row.externalSupplyUnits} /> : null}</dl>{row.financialVarianceStatus ? <LeakageEconomicsVariance {...row} /> : null}{row.attributionComplete === false ? <p role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">Unattributed sales exist for this customer and product in the period. Resolve mappings before valuing the supply gap.</p> : null}{row.observationId || row.evidenceReference ? <p className="mt-2 text-xs text-sf-muted">Observation evidence{row.observationId ? ` · ${row.observationId}` : ''}{row.evidenceReference ? ` · ${row.evidenceReference}` : ''}</p> : null}{data.canAct ? <form onSubmit={event => void submit(event, 'create_case', undefined, row)} className="mt-3 grid gap-2"><fieldset disabled={unresolved || busy} className="grid gap-2"><LeakageClassificationFields /><label className="grid gap-1 text-xs font-semibold">Case title<input name="title" required className="min-h-10 rounded-lg border px-3 text-sm" /></label><label className="grid gap-1 text-xs font-semibold">Reason<input name="reason" required className="min-h-10 rounded-lg border px-3 text-sm" /></label><label className="grid gap-1 text-xs font-semibold">Owner<input name="owner" required className="min-h-10 rounded-lg border px-3 text-sm" /></label><label className="grid gap-1 text-xs font-semibold">Due date<input name="dueDate" type="date" className="min-h-10 rounded-lg border px-3 text-sm" /></label><label className="grid gap-1 text-xs font-semibold">Follow-up action<input name="action" required className="min-h-10 rounded-lg border px-3 text-sm" /></label><button disabled={unresolved || busy} className="min-h-10 rounded-lg bg-sf-brand px-3 text-sm font-bold text-white disabled:opacity-50">Create case</button></fieldset></form> : null}</article>)}</div> : <Empty title="No leakage opportunities" body="No current reagent consumption or supply proxy evaluations are available." />}</section>
      <section className="rounded-2xl border border-sf-line-soft bg-white p-4 sm:p-6"><h2 className="text-lg font-extrabold">Leakage cases</h2>{data.cases.length ? <div className="mt-3 grid gap-3 lg:grid-cols-2">{data.cases.map(row => <div key={row.id} className="space-y-2"><CaseCard row={row} canAct={data.canAct} busy={busy} unresolved={unresolved} sourceLines={data.sourceLines ?? []} submit={submit} /><LeakageCaseHistory caseId={row.id} history={data.caseHistory ?? []} truncated={data.caseHistoryTruncated} /></div>)}</div> : <p className="mt-3 text-sm text-sf-muted">No cases have been opened.</p>}</section></div> : null}
    {data && tab === 'Advanced' && data.canManage && advancedTab === 'Reports' ? <div className="space-y-5"><section aria-label="Economics data coverage" className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Instruments tracked" value={data ? String(data.targets.length) : '—'} /><Metric label="Tally lines imported" value={data ? String(data.sourceLineCount) : '—'} /><Metric label="Sales not linked to an instrument" value={data ? money(data.unattributedPaise) : '—'} /><Metric label="Last Tally import" value={economicTimestamp(data?.sourceImportedAt)} hint={data?.lastRebuiltAt ? `Figures recalculated ${economicTimestamp(data.lastRebuiltAt)}` : 'Figures not yet calculated'} /></section>{data ? <EconomicDocumentExclusions documents={data.sourceDocumentExclusions ?? []} total={data.sourceDocumentExclusionCount ?? 0} /> : null}{data?.reportingSummary ? <details className="rounded-xl border border-sf-line-soft bg-white p-4"><summary className="min-h-10 cursor-pointer py-2 text-sm font-bold">Monthly sales reconciliation<span className="ml-2 font-normal text-sf-muted">· Net {money(data.reportingSummary.netSalesPaise)}{Number(data.reportingSummary.missingCostLines ?? 0) > 0 ? ` · ${data.reportingSummary.missingCostLines} missing cost` : ''}</span></summary><dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric label="Net Tally sales" value={money(data.reportingSummary.netSalesPaise)} /><Metric label="Attributed sales" value={money(data.reportingSummary.attributedSalesPaise)} /><Metric label="Unattributed sales" value={money(data.reportingSummary.unattributedSalesPaise)} /><Metric label="Excluded sales" value={money(data.reportingSummary.excludedSalesPaise)} /><Metric label="Instrument billing" value={money(data.reportingSummary.instrumentBillingSalesPaise ?? '0')} /><Metric label="Verified reagent cost" value={money(data.reportingSummary.verifiedCostPaise)} /><Metric label="Known reagent GP" value={money(data.reportingSummary.knownGpPaise)} hint="Verified-cost lines only; may be partial" /><Metric label="Lines missing cost" value={data.reportingSummary.missingCostLines == null ? 'Unavailable' : String(data.reportingSummary.missingCostLines)} /></dl><p className="mt-3 text-xs text-sf-muted">Reagent-attributed, unattributed, excluded and instrument billing sales reconcile to net Tally sales. Instrument billing reduces placement investment and is excluded from reagent GP. {money(data.reportingSummary.missingCostSalesPaise)} of attributed sales still needs verified purchase costs. Zero-revenue FOC lines can also lack cost; use the missing-line count, not the sales amount, to assess completeness.</p></details> : null}{data.targets.length ? <label className="grid max-w-md gap-1 text-xs font-semibold">Instrument<select aria-label="Report instrument" value={selected?.id ?? ''} onChange={event => setSelectedId(event.target.value)} className="min-h-10 rounded-lg border border-sf-line bg-white px-3 text-sm">{visibleTargets.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label> : null}{selected ? <><section aria-label="Selected target details" className="rounded-2xl border border-sf-line-soft bg-white p-5"><h2 className="text-lg font-extrabold">{selected.name} · coverage and recovery</h2><p className="mt-1 text-sm text-sf-muted">{selected.customerName} · {selected.attributedLines} attributed lines · {selected.missingCostLines} lines without verified cost.</p><p className="mt-3 text-sm text-sf-muted">Capital source: {selected.capitalSource === 'tally_purchase' ? 'Verified Tally purchase' : selected.capitalSource === 'pooled_capital' ? 'Pooled member capital' : 'Manual value with evidence'}.</p>{selected.kind === 'placement' ? <ItemGroupMappingSummary target={selected} data={data} /> : null}{selected.instrumentBillingCurrent === false ? <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Instrument selling invoice evidence is missing or incompatible. Upfront recovery and investment need review.</p> : null}{selected.capitalEvidenceCurrent === false ? <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Tally acquisition evidence has changed. Historical capital is retained; approval and payback forecast require review.</p> : null}{selected.pooledIn ? <p className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">This placement is pooled into {data.targets.find(row => row.id === selected.pooledIn)?.name ?? 'an approved group'}. Capital recovery and payback are reported on the group summary.</p> : null}<details className="mt-3 rounded-xl border border-sf-line-soft p-3"><summary className="-m-3 list-item cursor-pointer p-3 text-sm font-bold">Full financial breakdown</summary><dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{!selected.pooledIn ? <><Metric label="Capital exposure" value={money(selected.capitalPaise)} />{selected.netInvestmentPaise !== undefined ? <><Metric label="Instrument billing" value={money(selected.instrumentBillingPaise)} hint="Net invoiced recovery; not cash receipts" /><Metric label="Placement investment" value={money(selected.netInvestmentPaise)} hint="Capital less net instrument billing" /></> : null}<Metric label="Recovery" value={money(selected.recoveryPaise)} hint="Recorded GP and eligible contributions; not cash receipts" /><RecoverySurplus target={selected} /><Metric label="Outstanding" value={money(selected.outstandingPaise)} /><Metric label="Recovery forecast" value={forecastLabel(selected)} /></> : null}<Metric label="Attributed revenue" value={reagentAmount(selected, selected.revenuePaise)} /><Metric label="Known GP" value={reagentAmount(selected, selected.knownGpPaise)} /><Metric label="Status" value={healthLabel[selected.health]} /><Metric label="Current expectation" value={selected.expectation ? `${money(selected.expectation.monthlyRevenuePaise)} revenue / month` : 'Unavailable'} /></dl></details></section><section className="rounded-2xl border border-sf-line-soft bg-white p-4 sm:p-6"><h2 className="text-lg font-extrabold">Planning and payback</h2><EconomicTargetAdvancedDetails target={selected} /></section><ItemGpBreakdown target={selected} reportingFrom={data.reportingFrom} reportingTo={data.reportingTo} /><AttributionDrilldown targetId={selected.id} lines={data.attributionLines ?? []} /></> : null}<EvidenceHistory data={data} /></div> : null}
  </div></main>;
}
function CaseEstimateEvidence({ row }: { row: LeakageCase }) {
  const evidence = row.evaluation;
  if (!evidence?.expectationId) return null;
  return <details className="mt-3 rounded-lg border border-sf-line-soft p-3"><summary className="-m-3 list-item cursor-pointer p-3 text-sm font-bold">Original estimate evidence</summary><p className="mt-2 text-xs leading-5 text-sf-muted">Captured {evidence.evaluatedAt ? economicTimestamp(evidence.evaluatedAt) : 'at case creation'} · {economicCodeLabel(evidence.evidenceTier)} · {evidence.status ? economicCodeLabel(evidence.status) : 'Review required'}. Later baseline changes do not rewrite this estimate.</p><dl className="mt-2 grid grid-cols-2 gap-2"><Metric label="Expected units at creation" value={evidence.expectedUnits ?? 'Unavailable'} /><Metric label="Mapped units at creation" value={evidence.actualUnits ?? 'Unavailable'} /><Metric label="Original shortfall" value={evidence.shortfallUnits ?? 'Unavailable'} /></dl><p className="mt-2 break-words text-xs text-sf-muted">Baseline reference: {evidence.expectationId} · Source generation: {evidence.generationId ?? 'Unavailable'}{evidence.observationId ? ` · Observation: ${evidence.observationId}` : ''}</p></details>;
}
function CaseCard({ row, canAct, busy, unresolved, sourceLines, submit }: { row: LeakageCase; canAct: boolean; busy: boolean; unresolved: boolean; sourceLines: NonNullable<EconomicsWorkspaceData['sourceLines']>; submit: (event: SubmitEvent<HTMLFormElement>, action: EconomicAction, targetCase?: LeakageCase) => Promise<void> }) {
  const saleLines = sourceLines.filter(line => line.kind === 'sale');
  return <article className="rounded-xl border border-sf-line-soft p-4"><div className="flex flex-wrap justify-between gap-2"><strong>{row.title}</strong><LeakageCaseStatus status={row.status} /></div><p className="mt-1 text-sm text-sf-muted">{row.reason} · owner {row.owner || 'Unassigned'}{row.dueDate ? ` · due ${row.dueDate}` : ''}</p><p className="mt-2 text-xs text-sf-muted">{leakageReasonLabels[row.primaryReason ?? 'unknown']} · Confidence: {row.confidence ?? 'unknown'}{row.evidenceReference ? ` · ${row.evidenceReference}` : ''}</p>{row.recoveryReviewRequired ? <p role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">Review required: a source correction has removed positive recovery evidence from this closed case.</p> : null}<dl className="mt-3 grid grid-cols-2 gap-2"><Metric label="Potential revenue" value={money(row.potentialRevenuePaise)} /><Metric label="Potential GP" value={money(row.potentialGpPaise)} /><Metric label="Recovered revenue" value={money(row.recoveredRevenuePaise)} /><Metric label="Recovered GP" value={money(row.recoveredGpPaise)} /></dl><CaseEstimateEvidence row={row} />{canAct ? <><form onSubmit={event => void submit(event, 'update_case', row)} className="mt-3 grid gap-2 sm:grid-cols-2"><fieldset disabled={unresolved || busy} className="contents"><LeakageClassificationFields classification={row} /><label className="grid gap-1 text-xs font-semibold">Case status<select name="status" defaultValue={row.status} className="min-h-10 rounded-lg border px-3 text-sm">{['detected', 'qualified', 'in_progress', 'recovered', 'partially_recovered', 'no_recovery', 'dismissed'].map(status => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select></label><label className="grid gap-1 text-xs font-semibold">Reason<input name="reason" defaultValue={row.reason} required className="min-h-10 rounded-lg border px-3 text-sm" /></label><label className="grid gap-1 text-xs font-semibold">Owner<input name="owner" defaultValue={row.owner} className="min-h-10 rounded-lg border px-3 text-sm" /></label><label className="grid gap-1 text-xs font-semibold">Due date<input name="dueDate" type="date" defaultValue={row.dueDate ?? ''} className="min-h-10 rounded-lg border px-3 text-sm" /></label><label className="grid gap-1 text-xs font-semibold">Action<input name="action" defaultValue={row.action} className="min-h-10 rounded-lg border px-3 text-sm" /></label><label className="grid gap-1 text-xs font-semibold">Outcome<input name="outcome" defaultValue={row.outcome} className="min-h-10 rounded-lg border px-3 text-sm" /></label><button disabled={unresolved || busy} className="min-h-10 rounded-lg bg-sf-brand px-3 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2">Update case</button></fieldset></form>{row.status === 'dismissed' || row.status === 'no_recovery' ? <p className="mt-3 text-sm text-sf-muted">Reopen this case before recording new recovery evidence.</p> : null}<form onSubmit={event => void submit(event, 'claim_recovery', row)} className="mt-3 grid gap-2 sm:grid-cols-2"><fieldset disabled={unresolved || busy || row.status === 'dismissed' || row.status === 'no_recovery'} className="grid gap-2 sm:grid-cols-2"><label className="grid gap-1 text-xs font-semibold">Follow-up sale source line<select name="sourceLineId" required defaultValue="" className="min-h-10 rounded-lg border px-3 text-sm"><option value="" disabled>Select a sale source…</option>{saleLines.map(line => <option key={line.id} value={line.id}>{line.date} · {line.productId} · {line.quantity} {line.unit} · {line.voucherId}</option>)}</select></label><label className="grid gap-1 text-xs font-semibold">Recovery share (basis points)<input name="shareBasisPoints" type="number" min="1" max="10000" step="1" required className="min-h-10 rounded-lg border px-3 text-sm" /></label><label className="grid gap-1 text-xs font-semibold sm:col-span-2">Recovery evidence<input name="reason" required className="min-h-10 rounded-lg border px-3 text-sm" /></label><button disabled={unresolved || busy} className="min-h-10 rounded-lg border border-sf-accent px-3 text-sm font-bold text-sf-brand disabled:opacity-50 sm:col-span-2">Claim recovery</button></fieldset></form></> : null}</article>;
}
function recordText(record: Record<string, unknown>, ...keys: string[]) { for (const key of keys) { const value = record[key]; if (typeof value === 'string' || typeof value === 'number') return String(value); } return ''; }
function EvidenceHistory({ data }: { data: EconomicsWorkspaceData }) {
  const [showAll, setShowAll] = useState(false);
  const instrumentBillings = data.instrumentBillings ?? []; const acquisitionReviews = data.acquisitionReviews ?? []; const memberships = data.groupMemberships ?? []; const ledger = data.ledger ?? []; const expectations = data.expectationHistory ?? []; const observations = data.observations ?? []; const sourceLines = data.sourceLines ?? [];
  const showRows = <T,>(rows: T[]) => showAll ? rows : rows.slice(0, 10);
  const hasLongHistory = [instrumentBillings, acquisitionReviews, ledger, expectations, observations, sourceLines].some(rows => rows.length > 10);
  return <section className="rounded-2xl border border-sf-line-soft bg-white p-4 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-extrabold">Evidence and history</h2><p className="mt-1 text-sm text-sf-muted">Readable source, group, capital, usage and expectation records for review.</p></div>{hasLongHistory ? <button type="button" onClick={() => setShowAll(value => !value)} className="min-h-10 rounded-lg border border-sf-line px-3 text-sm font-bold text-sf-brand">{showAll ? 'Show first 10 records' : 'Show all evidence records'}</button> : null}</div>{hasLongHistory && !showAll ? <p className="mt-2 text-xs text-sf-muted">Showing the first 10 records in longer lists.</p> : null}<div className="mt-4 grid gap-3 lg:grid-cols-2">
    <details className="rounded-xl bg-sf-soft p-3"><summary className="-m-3 list-item cursor-pointer p-3 text-sm font-bold">Group memberships ({memberships.length})</summary><ul className="mt-3 space-y-2 text-sm">{memberships.length ? showRows(memberships).map(row => <li key={row.id} className="border-t border-sf-line-soft pt-2"><strong>{data.targets.find(target => target.id === row.groupId)?.name ?? row.groupId}</strong> includes {data.targets.find(target => target.id === row.placementId)?.name ?? row.placementId}<p className="text-xs text-sf-muted">{row.effectiveFrom}{row.effectiveTo ? ` through ${row.effectiveTo}` : ' · active'}</p></li>) : <li>No group memberships are recorded.</li>}</ul></details>
    <details className="rounded-xl bg-sf-soft p-3"><summary className="-m-3 list-item cursor-pointer p-3 text-sm font-bold">Recent economic events (latest 500 · {ledger.length} shown)</summary><ul className="mt-3 space-y-2 text-sm">{ledger.length ? showRows(ledger).map((row, index) => <li key={recordText(row, 'id') || index} className="border-t border-sf-line-soft pt-2"><strong>{recordText(row, 'kind').replaceAll('_', ' ')}</strong> · {money(recordText(row, 'amount_paise', 'amountPaise'))}<p className="text-xs text-sf-muted">{recordText(row, 'effective_date', 'effectiveDate')} · {recordText(row, 'reason')}</p></li>) : <li>No posted events are recorded.</li>}</ul></details>
    <details className="rounded-xl bg-sf-soft p-3"><summary className="-m-3 list-item cursor-pointer p-3 text-sm font-bold">Expectation history ({expectations.length})</summary><ul className="mt-3 space-y-2 text-sm">{expectations.length ? showRows(expectations).map((row, index) => { const items = Array.isArray(row.items) ? row.items.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item)) : []; return <li key={recordText(row, 'id') || index} className="border-t border-sf-line-soft pt-2"><strong>{data.targets.find(target => target.id === recordText(row, 'targetId', 'target_id'))?.name ?? 'Economic target'}</strong> · from {recordText(row, 'effectiveFrom', 'effective_from')}<p className="text-xs text-sf-muted">Monthly revenue {money(recordText(row, 'monthlyRevenuePaise', 'monthly_revenue_paise'))} · monthly GP {money(recordText(row, 'monthlyGpPaise', 'monthly_gp_paise'))} · {recordText(row, 'reason')}</p>{items.length ? <p className="mt-1 text-xs text-sf-muted">{items.map(item => `${recordText(item, 'productName', 'product_name', 'productId', 'product_id')} · ${recordText(item, 'expectedMonthlyUnits', 'expected_monthly_units')} ${recordText(item, 'baseUnit', 'base_unit')}`).join(' ; ')}</p> : null}</li>; }) : <li>No expectation revisions are recorded.</li>}</ul></details>
    <details className="rounded-xl bg-sf-soft p-3"><summary className="-m-3 list-item cursor-pointer p-3 text-sm font-bold">Usage observations ({observations.length})</summary><ul className="mt-3 space-y-2 text-sm">{observations.length ? showRows(observations).map((row, index) => <li key={recordText(row, 'id') || index} className="border-t border-sf-line-soft pt-2"><strong>{recordText(row, 'product_id', 'productId')}</strong> · {recordText(row, 'base_unit', 'baseUnit')}<p className="text-xs text-sf-muted">{recordText(row, 'window_from', 'windowFrom')} to {recordText(row, 'window_to', 'windowTo')} · {recordText(row, 'test_count', 'testCount')} tests / {recordText(row, 'tests_per_unit', 'testsPerUnit')} tests per unit · QC {recordText(row, 'qc_units', 'qcUnits') || '0'}</p><p className="text-xs text-sf-muted">{recordText(row, 'evidence_reference', 'evidenceReference')} · stock {recordText(row, 'opening_stock', 'openingStock') || 'not supplied'} to {recordText(row, 'closing_stock', 'closingStock') || 'not supplied'} · transfers {recordText(row, 'net_transfers', 'netTransfers') || '0'} · external supply {recordText(row, 'external_supply', 'externalSupply') || '0'}</p></li>) : <li>No usage observations are recorded.</li>}</ul></details>
    <details className="rounded-xl bg-sf-soft p-3"><summary className="-m-3 list-item cursor-pointer p-3 text-sm font-bold">Instrument selling invoices ({instrumentBillings.length})</summary><ul className="mt-3 space-y-2 text-sm">{instrumentBillings.length ? showRows(instrumentBillings).map(row => <li key={row.target_id} className="border-t border-sf-line-soft pt-2"><strong>{data.targets.find(target => target.id === row.target_id)?.name ?? row.target_id}</strong><p>{row.source_id} / line {row.line_key}</p><p className="text-xs text-sf-muted">{row.actor} · {row.reason}{!row.current ? ' · Source evidence needs review' : ''}</p></li>) : <li>No instrument selling invoices linked.</li>}</ul></details>
    <details className="rounded-xl bg-sf-soft p-3"><summary className="-m-3 list-item cursor-pointer p-3 text-sm font-bold">Acquisition reviews ({acquisitionReviews.length})</summary><ul className="mt-3 space-y-2 text-sm">{acquisitionReviews.length ? showRows(acquisitionReviews).map(row => <li key={recordText(row, 'id')} className="border-t border-sf-line-soft pt-2"><strong>{data.targets.find(target => target.id === recordText(row, 'target_id'))?.name ?? recordText(row, 'target_id')}</strong> · review {recordText(row, 'revision')}<p>{money(recordText(row, 'previous_amount_paise'))} → {money(recordText(row, 'amount_paise'))}</p><p className="text-xs text-sf-muted">{recordText(row, 'actor')} · {recordText(row, 'recorded_at')} · {recordText(row, 'reason')}</p></li>) : <li>No acquisition reviews recorded.</li>}</ul></details>
    <details className="rounded-xl bg-sf-soft p-3"><summary className="-m-3 list-item cursor-pointer p-3 text-sm font-bold">Current source line evidence ({sourceLines.length})</summary><ul className="mt-3 space-y-2 text-sm">{sourceLines.length ? showRows(sourceLines).map(row => <li key={row.id} className="border-t border-sf-line-soft pt-2"><strong>{row.kind}</strong> · {row.productName ? `${row.productName} (${row.productId})` : row.productId}<p className="text-xs text-sf-muted">{row.date} · {row.quantity} {row.unit} · {money(row.netSalesPaise)} · {row.voucherId} revision {row.revision}</p></li>) : <li>No source line details are available.</li>}</ul></details>
  </div></section>;
}
export function ItemGpBreakdown({ target, reportingFrom, reportingTo }: { target: EconomicTarget; reportingFrom: string; reportingTo: string }) {
  if (target.approval === 'proposed') return <section aria-label="Item sales and GP breakdown" className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-900 sm:p-6"><h2 className="text-lg font-extrabold">Item sales and GP breakdown</h2><p className="mt-2 text-sm">Reagent sales and GP are pending approval. Imported invoices remain available in source evidence; pending totals do not mean no items were billed.</p></section>;
  const rows = target.itemBreakdown;
  const itemCount = new Set(rows?.map(row => row.productId)).size;
  const lineCount = rows?.reduce((total, row) => total + row.sourceLines, 0) ?? 0;
  const missing = rows?.reduce((total, row) => total + row.missingCostLines, 0) ?? 0;
  return <section aria-label="Item sales and GP breakdown" className="min-w-0 overflow-hidden rounded-2xl border border-sf-line-soft bg-white">
    <div className="p-4 sm:p-6">
      <h2 className="text-lg font-extrabold">Item sales and GP breakdown</h2>
      <p className="mt-1 text-sm text-sf-muted">{reportingPeriodLabel(reportingFrom, reportingTo)}. Only attributed reagent items; quantities and amounts include returns, credits and FOC.</p>
      {rows ? <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Unique billed items" value={String(itemCount)} hint="Canonical Tally items counted once" />
        <Metric label="Invoice lines" value={String(lineCount)} />
        <Metric label="Net sales" value={reagentAmount(target, target.revenuePaise)} />
        <Metric label="Known GP" value={reagentAmount(target, target.knownGpPaise)} hint={missing ? `Partial · ${missing} ${missing === 1 ? 'line' : 'lines'} missing cost` : 'Verified purchase costs'} />
      </dl> : null}
      {missing > 0 ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Known cost and GP include verified lines only. Missing costs remain unavailable.</p> : null}
      {rows && rows.length > 0 ? <p className="mt-3 text-xs text-sf-muted sm:hidden">Swipe the item table to see purchase cost, GP and cost status.</p> : null}
    </div>
    {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to focus this horizontally scrollable table. */}
    {rows === undefined ? <p className="px-5 pb-5 text-sm text-sf-muted">Refresh to load the item breakdown.</p> : rows.length ? <section className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-sf-accent" tabIndex={0} aria-label="Scrollable item breakdown"><table aria-label="Monthly item sales and GP" className="w-full min-w-[720px] text-left text-sm">
      <thead className="bg-sf-soft text-xs text-sf-muted"><tr>{['Item', 'Net quantity', 'Net sales', 'Known purchase cost', 'Known GP', 'Cost status'].map(label => <th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={JSON.stringify([row.productId, row.unit])} className="border-t border-sf-soft">
        <th scope="row" className="max-w-64 break-words p-3 font-semibold">{row.productName || row.productId}<div className="mt-1 break-all text-xs font-normal text-sf-muted">{row.productId} · {row.sourceLines} invoice {row.sourceLines === 1 ? 'line' : 'lines'}</div></th>
        <td className="whitespace-nowrap p-3">{row.quantity.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')} {row.unit}</td>
        <td className="whitespace-nowrap p-3">{money(row.revenuePaise)}</td>
        <td className="whitespace-nowrap p-3">{money(row.knownCostPaise)}</td>
        <td className={`whitespace-nowrap p-3 font-bold ${row.knownGpPaise == null ? 'text-slate-600' : row.knownGpPaise.startsWith('-') ? 'text-red-800' : 'text-emerald-800'}`}>{money(row.knownGpPaise)}</td>
        <td className="p-3"><span className={`inline-block rounded-lg px-2 py-1 text-xs font-semibold ${row.missingCostLines ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>{row.missingCostLines ? `${row.knownCostPaise == null ? 'Unavailable' : 'Partial'} · ${row.missingCostLines} ${row.missingCostLines === 1 ? 'line' : 'lines'} missing cost` : 'Verified'}</span></td>
      </tr>)}</tbody>
    </table></section> : <p className="px-5 pb-5 text-sm text-sf-muted">No attributed reagent items were billed in this reporting month.</p>}
  </section>;
}

function AttributionDrilldown({ targetId, lines }: { targetId: string; lines: NonNullable<EconomicsWorkspaceData['attributionLines']> }) {
  const rows = lines.filter(line => line.targetId === targetId);
  if (rows.length === 0) return null;
  return <section className="overflow-hidden rounded-2xl border border-sf-line-soft bg-white"><div className="p-4 sm:p-6"><h2 className="text-lg font-extrabold">Attributed source and GP evidence ({rows.length})</h2><p className="mt-1 text-sm text-sf-muted">Every current-generation line attributed to this target, including its cost evidence and exclusion reason when applicable.</p></div>{rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-sm"><thead className="bg-sf-soft text-xs text-sf-muted"><tr>{['Date / source revision', 'Product', 'Status / reason', 'Share', 'Quantity', 'Revenue', 'Cost', 'Known GP', 'Cost evidence'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t border-sf-soft"><td className="p-3">{row.date}<div className="text-xs text-sf-muted">{row.voucherId} · rev {row.revision}</div></td><td className="p-3">{row.productName || row.productId}<div className="text-xs text-sf-muted">{row.productId}</div></td><td className="p-3">{row.status}<div className="text-xs text-sf-muted">{row.reason}</div></td><td className="p-3">{row.shareBasisPoints} bps</td><td className="p-3">{row.quantity} {row.unit}</td><td className="p-3">{money(row.revenuePaise)}</td><td className="p-3">{money(row.costPaise)}</td><td className="p-3">{money(row.gpPaise)}</td><td className="p-3">{row.costEvidence || 'Unavailable'}</td></tr>)}</tbody></table></div> : <p className="px-5 pb-5 text-sm text-sf-muted">No attributed line-level evidence is available for this target.</p>}</section>;
}
function Empty({ title, body }: { title: string; body: string }) { return <div className="rounded-2xl border border-dashed border-sf-line bg-white p-8 text-center sm:col-span-2"><CircleDollarSign className="mx-auto text-sf-muted" aria-hidden="true" /><h2 className="mt-3 text-lg font-extrabold">{title}</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-sf-muted">{body}</p></div>; }
