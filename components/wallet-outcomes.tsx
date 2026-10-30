'use client';

import { useState } from 'react';
import { formatPaise } from '@/lib/wallet-format';
import { isOpportunityOutcomeResponse, type OpportunityOutcomeRow } from '@/lib/wallet-diagnosis-types';
import type { ActionType } from '@/lib/wallet-action-types';
import { walletActionLabels } from '@/lib/wallet-labels';

function shortDate(value: string | undefined) {
  if (!value || Number.isNaN(Date.parse(value))) return '';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(value));
}
function titleCase(value: string) { return value ? value[0].toUpperCase() + value.slice(1) : ''; }
function percentage(value: number) {
  const amount = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(Math.abs(value) / 10);
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${amount}%`;
}

export function WalletOutcomes({ customerId, count }: { customerId: string; count: number | null }) {
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<OpportunityOutcomeRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const actualCount = count ?? rows?.length ?? null;

  async function toggle() {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (rows !== null || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/wallet/diagnosis?${new URLSearchParams({ action: 'get_opportunity_outcomes', customerId })}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load outcomes');
      const value: unknown = await response.json();
      if (!isOpportunityOutcomeResponse(value)) throw new Error('Invalid outcomes response');
      setRows(value);
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }

  if (actualCount === 0 && !expanded) return null;
  const label = actualCount === null ? 'Past opportunities' : `Past opportunities (${actualCount})`;
  return <div className="space-y-2 border-t border-sf-line-soft pt-2">
    {actualCount !== 0 ? <button type="button" className="min-h-9 text-sm text-sf-muted underline" aria-expanded={expanded} onClick={() => void toggle()}>{label}</button> : null}
    {expanded ? loading ? <p className="text-sm text-sf-muted">Loading past opportunities…</p> : failed ? <p className="text-sm text-sf-muted">Couldn&apos;t load past opportunities.</p> : rows?.length === 0 ? <p className="text-sm text-sf-muted">No past opportunities</p> : rows ? <ul className="space-y-3">{rows.map((item, index) => <OutcomeItem key={item.opportunityId ?? index} item={item} />)}</ul> : null : null}
  </div>;
}

function OutcomeItem({ item }: { item: OpportunityOutcomeRow }) {
  const kind = item.kind ? titleCase(item.kind) : 'Opportunity';
  const outcome = item.outcome ? titleCase(item.outcome) : '';
  const date = shortDate(item.closedAt);
  const division = item.divisionName ?? 'Whole lab';
  const action = item.lastActionType ? walletActionLabels[item.lastActionType as ActionType] ?? item.lastActionType : null;
  const result = item.lastActionResult ? titleCase(item.lastActionResult) : null;
  const isDivision = item.divisionName !== null && item.divisionName !== undefined;
  const validSales = typeof item.salesBeforePaise === 'number' && typeof item.salesNowPaise === 'number';
  const up = typeof item.changePermille === 'number' && typeof item.changePaise === 'number' && item.changePaise > 0;
  const down = typeof item.changePermille === 'number' && typeof item.changePaise === 'number' && item.changePaise < 0;
  const tone = up ? 'text-sf-success' : down ? 'text-sf-danger' : 'text-sf-muted';
  return <li className="min-w-0 space-y-1 text-sm">
    <p className="font-medium">{kind} · {division}{outcome ? ` · ${outcome}` : ''}{date ? ` · ${date}` : ''}</p>
    <p className="break-words">Reason: {item.closedReason ?? ''}{action && result ? ` · Last action: ${action} (${result})` : ''}</p>
    {item.measurable && validSales
      ? <p className={`break-words ${tone}`}>Sales/month {formatPaise(item.salesBeforePaise!)} → {formatPaise(item.salesNowPaise!)}{typeof item.changePermille === 'number' ? ` (${percentage(item.changePermille)})` : ''}{isDivision ? <span className="text-sf-muted"> · whole-lab sales</span> : null}</p>
      : <p className="break-words text-sf-muted">Not measurable yet: {item.notMeasurableReason ?? 'Sales coverage is not certified.'}{isDivision ? ' · whole-lab sales' : ''}</p>}
  </li>;
}
