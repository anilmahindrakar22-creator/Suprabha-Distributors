'use client';

import { useEffect, useState } from 'react';
import { readJsonResponse } from '@/lib/http-json';
import { formatRupees } from '@/lib/billing-sheet';
import { rateCheckSummary, rateLineLabel, type RateCheck } from '@/lib/rate-check';

type State = { orderId: string; check: RateCheck | null; error: string; forbidden: boolean };

export function RateCheckPanel({ orderId }: { orderId: string }) {
  const [state, setState] = useState<State>({ orderId: '', check: null, error: '', forbidden: false });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/pricing?orderId=${encodeURIComponent(orderId)}&view=rate_check`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (response.status === 403) {
          if (!controller.signal.aborted) setState({ orderId, check: null, error: '', forbidden: true });
          return;
        }
        const check = await readJsonResponse<RateCheck>(response, 'Rate check could not load');
        if (!controller.signal.aborted) setState({ orderId, check, error: '', forbidden: false });
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setState({ orderId, check: null, error: cause instanceof Error ? cause.message : 'Rate check could not load', forbidden: false }); });
    return () => controller.abort();
  }, [orderId, version]);
  const current = state.orderId === orderId ? state : { check: null, error: '', forbidden: false };
  if (current.forbidden) return null;
  const check = current.check;
  const differences = check?.lines.filter((line) => line.state !== 'matches') ?? [];
  return <section aria-label="Rate check" className="mt-3 min-w-0 rounded-xl border border-sf-line bg-white p-4 [overflow-wrap:anywhere]">
    <h3 className="text-xs font-extrabold uppercase tracking-wide text-sf-label">Rate check · Tally vs approved price</h3>
    {current.error ? <div className="mt-3"><p role="alert" className="text-sm text-sf-danger">{current.error}</p><button type="button" onClick={() => { setState({ orderId, check: null, error: '', forbidden: false }); setVersion((value) => value + 1); }} className="min-h-11 rounded-lg border border-sf-line px-3 text-sm font-bold text-sf-body hover:bg-sf-soft">Retry</button></div>
      : !check ? <p className="mt-3 text-sm text-sf-muted">Loading rate check…</p>
      : <>
        <p className="mt-3 text-sm"><span className={check.state === 'different' ? 'rounded-full bg-sf-danger-soft px-2 py-0.5 font-bold text-sf-danger' : check.state === 'matches' ? 'rounded-full bg-sf-accent-soft px-2 py-0.5 font-bold text-sf-success' : 'text-sf-muted'}>{rateCheckSummary(check)}</span></p>
        {differences.length ? <ul className="mt-3 space-y-3 text-sm">{differences.map((line, index) => <li key={`${line.tallyKey}:${line.lineId ?? index}`} className="min-w-0 border-t border-sf-line-soft pt-2">
          <p className="font-bold text-sf-strong">{line.itemName}</p>
          <p className="text-sf-label">Approved {line.approvedRate === null ? '—' : formatRupees(line.approvedRate)}</p>
          <p className="text-sf-label">Tally {line.invoiceRates.length ? line.invoiceRates.map(formatRupees).join(' / ') : '—'}</p>
          <p className={line.state === 'different' ? 'font-bold text-sf-danger' : 'text-sf-muted'}>{rateLineLabel(line)}</p>
        </li>)}</ul> : null}
        {differences.length && check.lines.some((line) => line.state === 'matches') ? <p className="mt-3 text-xs text-sf-muted">All other items match</p> : null}
        {check.limitations?.length ? <p className="mt-3 text-xs text-sf-muted">{check.limitations.join(' · ')}</p> : null}
      </>}
  </section>;
}
