'use client';

import { useEffect, useRef, useState } from 'react';
import { readJsonBody } from '@/lib/http-json';
import { parseUnlinkedReceipts, type UnlinkedReceipts as ReceiptPage } from '@/lib/po-unlinked-receipts';

const button = 'min-h-11 rounded-lg border border-sf-line bg-sf-soft-0 px-3 text-sm font-semibold text-sf-body disabled:opacity-50';
const quantity = (value: number) => Math.round(value * 1000) / 1000;

export function UnlinkedReceipts({ refreshKey, onOpenPo }: { refreshKey: number; onOpenPo: (poId: string, poNumber: string) => void }) {
  const [data, setData] = useState<ReceiptPage | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    const timer = setTimeout(() => {
      setData(null); setExpanded(false); setLoading(true);
      void (async () => {
        try {
          const response = await fetch('/api/purchase-orders?unlinked=1&page=1', { cache: 'no-store', signal: controller.signal });
          if (!response.ok) return;
          const body = parseUnlinkedReceipts(await readJsonBody<unknown>(response));
          if (!controller.signal.aborted) setData(body);
        } catch { /* Advisory receipts never interrupt the panel. */ }
        finally { if (!controller.signal.aborted) setLoading(false); }
      })();
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); request.current?.abort(); };
  }, [refreshKey]);

  async function showMore() {
    if (!data || loading) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const response = await fetch(`/api/purchase-orders?unlinked=1&page=${data.page + 1}`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) return;
      const body = parseUnlinkedReceipts(await readJsonBody<unknown>(response));
      if (!controller.signal.aborted) setData({ ...body, rows: [...data.rows, ...body.rows] });
    } catch { /* Keep the loaded rows available for retry. */ }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }

  if (!data || data.total === 0) return null;
  return <section className="min-w-0 space-y-2" aria-label="Received without PO">
    <button type="button" className={button} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{data.total} received without PO</button>
    {expanded ? <>
      <p className="text-sm text-sf-muted">Tally purchases in the last 30 days not linked to a purchase order.</p>
      <ul className="min-w-0 divide-y divide-sf-line-soft">{data.rows.map((row) => <li key={JSON.stringify([row.sourceId, row.lineKey])} className="min-w-0 break-words py-2 [overflow-wrap:anywhere]">
        <p className="text-sm font-semibold">{row.itemName}</p>
        <p className="text-sm">{quantity(row.unlinkedQuantity)}{row.linkedQuantity === 0 ? '' : ` of ${quantity(row.quantity)}`}{row.unit ? ` ${row.unit}` : ''} not on a PO</p>
        <p className="text-sm text-sf-muted">{new Date(`${row.date}T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })} · Tally {row.reference}</p>
        {row.openPo ? <>
          <button type="button" className={`${button} max-w-full whitespace-normal [overflow-wrap:anywhere]`} onClick={() => onOpenPo(row.openPo!.id, row.openPo!.poNumber)}>Mark received on {row.openPo.poNumber}</button>
          <p className="text-sm text-sf-muted">{quantity(row.openPo.stillDue)} still due on that PO</p>
        </> : null}
      </li>)}</ul>
      {data.page * data.pageSize < data.total ? <button type="button" className={button} disabled={loading} onClick={() => void showMore()}>Show more</button> : null}
    </> : null}
  </section>;
}
