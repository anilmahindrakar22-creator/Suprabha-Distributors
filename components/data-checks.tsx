'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { CircleCheck } from 'lucide-react';
import { normalizeDataChecks, type DataChecksResponse } from '@/lib/data-check-types';

function clearLine(children: ReactNode) {
  return <p className="flex items-start gap-2 text-sm text-sf-muted"><CircleCheck aria-hidden="true" size={18} className="shrink-0" /><span>{children}</span></p>;
}
function day(value: string | null) {
  return value ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(new Date(value)) : 'unavailable';
}
function readAt(value: string | null) {
  if (!value) return 'unavailable';
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
  return `${day(value)} ${time}`;
}
export function DataChecks({ onOpenLinks }: { onOpenLinks: () => void }) {
  const [data, setData] = useState<DataChecksResponse | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/data-checks', { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) return;
        const result = normalizeDataChecks(await response.json());
        if (!controller.signal.aborted) setData(result);
      } catch { /* Optional card: Accounts stays usable when checks are unavailable. */ }
    })();
    return () => controller.abort();
  }, []);
  if (!data) return null;
  const { unlinkedLedgers: ledgers, noPinCode: pins, itemsNotInStockFlow: items } = data;
  const toFix = [ledgers, pins, items].filter(check => check.count > 0).length;
  return <details className="min-w-0 rounded-2xl border border-sf-line-soft bg-white p-4">
    <summary className="cursor-pointer text-sm"><strong>Data checks</strong> {toFix ? <span className="text-sf-warning font-bold">· {toFix} to fix</span> : <span className="text-sf-muted">· all clear</span>}</summary>
    <div className="mt-3 space-y-4 break-words text-sm text-sf-body">
      {ledgers.count ? <div>
        <p>{ledgers.count} of {ledgers.ofBuying} Tally ledgers that bought in the last 90 days aren&apos;t linked to a customer. Their sales are missing from Growth, the map and Pricing checks.</p>
        <button type="button" className="my-2 min-h-11 rounded-xl border border-sf-line px-3 text-sm font-bold text-sf-brand" onClick={onOpenLinks}>Link to Tally</button>
        <p className="text-xs text-sf-muted">{ledgers.top.map(row => row.name ?? 'Unknown ledger').join(', ')}</p>
      </div> : clearLine(`All ${ledgers.ofBuying} Tally ledgers that bought in the last 90 days are linked to a customer.`)}
      {pins.count ? <div>
        <p>{pins.count} of {pins.ofBuying} buying customers have no PIN code, so they&apos;re missing from the map and district totals.</p>
        <p className="mt-1 text-sf-muted">Add the PIN code to the ledger&apos;s address in Tally; StockFlow picks it up on the next sync.</p>
        <details className="mt-2"><summary className="min-h-11 cursor-pointer py-3">Show customers ({pins.count})</summary>
          <ul className="space-y-1 text-sf-muted">{pins.top.map(row => <li key={row.customerId}>{row.name}{row.town ? ` · ${row.town}` : ''}</li>)}</ul>
        </details>
      </div> : clearLine(`All ${pins.ofBuying} buying customers have a PIN code on the map.`)}
      {items.count ? <p>{items.count} items sold in the last 90 days aren&apos;t in StockFlow&apos;s item list.</p>
        : clearLine(`All ${items.ofSold} items sold in the last 90 days are in StockFlow.`)}
      <p className="text-xs text-sf-muted">Sales up to {day(data.freshness.salesThrough)} · Tally item list read {readAt(data.freshness.itemListReadAt)}</p>
    </div>
  </details>;
}
