'use client';

import { useState } from 'react';

type RequestPayload = { productName: string; customerId?: string; details: string; idempotencyKey: string };

export function ProductRequest({ productName, customerId, visible }: { productName: string; customerId?: string; visible: boolean }) {
  const [opened, setOpened] = useState(false);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<RequestPayload | null>(null);

  async function send() {
    if (busy) return;
    const command = pending ?? { productName: productName.trim(), customerId, details: details.trim(), idempotencyKey: crypto.randomUUID() };
    setPending(command);
    setBusy(true);
    setMessage('');
    let uncertain = true;
    try {
      const response = await fetch('/api/product-requests', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create_product_request', payload: command }),
      });
      const result = await response.json() as { error?: string; requestId?: string };
      if ([400, 401, 403, 404, 422].includes(response.status)) { setPending(null); uncertain = false; }
      if (!response.ok || !result.requestId) throw new Error(result.error || 'Request could not be confirmed. Retry the same request.');
      setPending(null);
      setOpened(false);
      setDetails('');
      setMessage('Product request saved for office review. No product was added to Tally.');
    } catch (error) {
      const failure = error instanceof Error ? error.message : 'Connection unavailable.';
      setMessage(uncertain ? `${failure} Retry keeps the same request reference; do not send it again elsewhere.` : failure);
    } finally { setBusy(false); }
  }

  if (!visible && !pending && !message) return null;
  return <section aria-label="Request new product" className="mt-2 rounded-xl border border-[#dce7e5] p-3">
    {!opened && !pending ? <button type="button" onClick={() => { setOpened(true); setMessage(''); }} className="min-h-10 text-sm font-bold text-[#31585d]">Request new product</button> : <>
      <p className="text-sm font-bold text-[#31585d]">Request: {pending?.productName || productName}</p>
      <p className="mt-1 text-xs text-[#718487]">Office staff will review this request. It will not create a catalog item.</p>
      <label className="mt-2 block text-sm">Product request details<textarea maxLength={1000} disabled={busy || Boolean(pending)} value={details} onChange={(event) => setDetails(event.target.value)} className="mt-1 w-full rounded-lg border border-[#cedfdd] p-2" /></label>
      <button type="button" disabled={busy || (!pending && productName.trim().length < 2)} onClick={() => void send()} className="mt-2 min-h-10 rounded-lg bg-[#073e46] px-3 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Sending request…' : pending ? 'Retry product request' : 'Send product request'}</button>
      {!pending && !busy ? <button type="button" onClick={() => setOpened(false)} className="ml-3 min-h-10 text-sm">Cancel</button> : null}
    </>}
    {message ? <output className="mt-2 block text-sm text-[#31585d]">{message}</output> : null}
  </section>;
}

type OpenRequest = { id: string; product_name: string; details: string; created_by_email: string; version: number };

export function ProductRequestInbox() {
  const [open, setOpen] = useState(false);
  const [requests, setRequests] = useState<OpenRequest[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/product-requests', { cache: 'no-store' });
      const result = await response.json() as { requests?: OpenRequest[]; error?: string };
      if (!response.ok || !Array.isArray(result.requests)) throw new Error(result.error || 'Requests unavailable');
      setRequests(result.requests);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Requests unavailable'); }
    finally { setBusy(false); }
  }
  return <section className="mt-3 rounded-xl border border-[#dce7e5] bg-white p-3" aria-label="Product request review">
    <button type="button" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) void load(); }} className="min-h-10 text-sm font-bold text-[#31585d]">Product requests</button>
    {open ? <>
      <p className="text-xs text-[#718487]">Review missing catalog items. Maintain products in Tally, then sync; resolving a request creates no product.</p>
      <button type="button" disabled={busy} onClick={() => void load()} className="min-h-10 text-sm font-bold">{busy ? 'Loading…' : 'Refresh requests'}</button>
      {requests.map((request) => <ProductRequestReview key={`${request.id}:${request.version}`} request={request} onReviewed={() => setRequests((current) => current.filter((row) => row.id !== request.id))} />)}
      {!busy && !requests.length && !message ? <p className="text-sm">No open product requests.</p> : null}
      {message ? <output className="block text-sm">{message}</output> : null}
    </> : null}
  </section>;
}

function ProductRequestReview({ request, onReviewed }: { request: OpenRequest; onReviewed: () => void }) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function review(status: 'resolved' | 'rejected') {
    if (busy) return;
    const payload = pending ?? { requestId: request.id, expectedVersion: request.version, resolution: reason.trim(), status, idempotencyKey: crypto.randomUUID() };
    setPending(payload); setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/product-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'review_product_request', payload }) });
      const result = await response.json() as { error?: string; requestId?: string };
      if ([400, 401, 403, 404, 422].includes(response.status)) setPending(null);
      if (!response.ok || !result.requestId) throw new Error(result.error || 'Review could not be confirmed; retry or refresh.');
      onReviewed();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Review unavailable'); }
    finally { setBusy(false); }
  }
  return <article className="mt-2 rounded-lg border border-[#dce7e5] p-3">
    <h3 className="text-sm font-bold">{request.product_name}</h3><p className="text-xs">{request.details} · {request.created_by_email}</p>
    <label className="mt-2 block text-sm">Review reason for {request.product_name}<input value={reason} maxLength={1000} disabled={busy || Boolean(pending)} onChange={(event) => setReason(event.target.value)} className="ml-2 min-h-10 rounded-lg border border-[#cedfdd] px-2" /></label>
    {pending ? <button type="button" disabled={busy} onClick={() => void review(pending.status as 'resolved' | 'rejected')} className="min-h-10 text-sm font-bold">Retry review</button> : <div className="flex gap-3"><button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void review('resolved')} className="min-h-10 text-sm font-bold">Resolve request</button><button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void review('rejected')} className="min-h-10 text-sm font-bold">Reject request</button></div>}
    {message ? <output className="block text-sm">{message}</output> : null}
  </article>;
}
