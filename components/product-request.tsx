'use client';

import { useEffect, useState } from 'react';
import { readPendingProductRequest, writePendingProductRequest, removePendingProductRequest, type ProductRequestPayload } from '@/lib/offline-order-drafts';
import { readJsonBody } from '@/lib/http-json';
import { Ban, ChevronDown, CircleAlert, CircleCheck, Inbox, PackagePlus, RefreshCw, RotateCcw, Send, TriangleAlert } from 'lucide-react';

export function ProductRequest({ productName, customerId, visible, actorEmail }: { productName: string; customerId?: string; visible: boolean; actorEmail: string }) {
  const [recovered] = useState(() => {
    try { return typeof window === 'undefined' ? null : readPendingProductRequest(localStorage, actorEmail); }
    catch { return null; }
  });
  const [opened, setOpened] = useState(false);
  const [details, setDetails] = useState(recovered?.details || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'success' | 'error'>('success');
  const [pending, setPending] = useState<ProductRequestPayload | null>(recovered);
  const [saveRetry, setSaveRetry] = useState(Boolean(recovered));

  async function send() {
    if (busy) return;
    const command = pending ?? { productName: productName.trim(), customerId, details: details.trim(), idempotencyKey: crypto.randomUUID() };
    setBusy(true);
    setMessage('');
    setTone('success');
    let uncertain = Boolean(pending);
    try {
      if (saveRetry && !writePendingProductRequest(localStorage, actorEmail, command)) throw new Error('This browser could not protect the request retry. Free device storage and retry; nothing new was sent.');
      setPending(command);
      uncertain = true;
      const response = await fetch('/api/product-requests', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create_product_request', payload: command }),
      });
      const result = await readJsonBody<{ error?: string; requestId?: string }>(response);
      if ([400, 401, 403, 404, 422].includes(response.status)) {
        if (saveRetry && !removePendingProductRequest(localStorage, actorEmail, command.idempotencyKey)) throw new Error('Local request recovery could not be cleared. Retry after fixing device storage.');
        setPending(null); uncertain = false;
      }
      if (!response.ok || !result.requestId) throw new Error(result.error || 'Request could not be confirmed. Retry the same request.');
      if (saveRetry && !removePendingProductRequest(localStorage, actorEmail, command.idempotencyKey)) throw new Error('Request saved, but local recovery could not be cleared. Retry the same reference to clear it.');
      setPending(null);
      setSaveRetry(false);
      setOpened(false);
      setDetails('');
      setMessage('Product request saved for office review. No product was added to Tally.');
      setTone('success');
    } catch (error) {
      const failure = error instanceof Error ? error.message : 'Connection unavailable.';
      setMessage(uncertain ? `${failure} Retry keeps the same request reference; do not send it again elsewhere.` : failure);
      setTone('error');
    } finally { setBusy(false); }
  }

  if (!visible && !pending && !message) return null;
  return <section aria-label="Request new product" className="mt-2 rounded-xl border border-sf-line-soft p-3">
    {!opened && !pending ? <button type="button" onClick={() => { setOpened(true); setMessage(''); setTone('success'); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-sf-line bg-white px-3 text-sm font-bold text-sf-brand"><PackagePlus aria-hidden="true" className="shrink-0" size={16} />Request new product</button> : <>
      <p className="text-sm font-bold text-sf-body">Request: {pending?.productName || productName}</p>
      <p className="mt-1 text-xs text-sf-subtle">Office staff will review this request. It will not create a catalog item.</p>
      <label className="mt-2 block text-sm">Product request details<textarea maxLength={1000} disabled={busy || Boolean(pending)} value={details} onChange={(event) => setDetails(event.target.value)} className="mt-1 w-full rounded-lg border border-sf-line p-2" /></label>
      <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={saveRetry} disabled={busy || Boolean(pending)} onChange={(event) => setSaveRetry(event.target.checked)} />Keep request retry on this trusted device</label>
      {recovered && pending ? <p className="mt-1 inline-flex items-start gap-1 text-xs text-sf-warning"><TriangleAlert aria-hidden="true" className="shrink-0" size={16} />Recovered request for this account. Retry uses its original reference; nothing is sent automatically.</p> : null}
      <button type="button" disabled={busy || (!pending && productName.trim().length < 2)} onClick={() => void send()} className="mt-2 inline-flex items-center gap-2 min-h-10 rounded-lg bg-sf-ink-hover px-3 text-sm font-bold text-white disabled:opacity-50">{pending ? <RotateCcw aria-hidden="true" className="shrink-0" size={16} /> : <Send aria-hidden="true" className="shrink-0" size={16} />}{busy ? 'Sending request…' : pending ? 'Retry product request' : 'Send product request'}</button>
      {!pending && !busy ? <button type="button" onClick={() => setOpened(false)} className="ml-3 min-h-10 rounded-lg border border-sf-line px-3 text-sm font-bold text-sf-body">Cancel</button> : null}
    </>}
    {message ? <output className={`mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${tone === 'success' ? 'border-sf-success-line bg-sf-success-soft text-sf-success' : 'border-sf-danger-line bg-sf-danger-soft text-sf-danger'}`}>{tone === 'success' ? <CircleCheck aria-hidden="true" className="shrink-0" size={16} /> : <CircleAlert aria-hidden="true" className="shrink-0" size={16} />}{message}</output> : null}
  </section>;
}

type OpenRequest = { id: string; product_name: string; details: string; created_by_email: string; version: number };

export function ProductRequestInbox() {
  const [open, setOpen] = useState(false);
  const [requests, setRequests] = useState<OpenRequest[]>([]);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'success' | 'error'>('success');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Count waiting requests once when the Requests page opens, so the closed row shows it.
  useEffect(() => {
    let live = true;
    fetch('/api/product-requests', { cache: 'no-store' })
      .then((response) => response.ok ? readJsonBody<{ requests?: OpenRequest[] }>(response) : null)
      .then((result) => { if (live && Array.isArray(result?.requests)) { setRequests(result.requests); setLoaded(true); } })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  async function load() {
    setBusy(true);
    setMessage('');
    setTone('success');
    try {
      const response = await fetch('/api/product-requests', { cache: 'no-store' });
      const result = await readJsonBody<{ requests?: OpenRequest[]; error?: string }>(response);
      if (!response.ok || !Array.isArray(result.requests)) throw new Error(result.error || 'Requests unavailable');
      setRequests(result.requests);
      setLoaded(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Requests unavailable'); setTone('error'); }
    finally { setBusy(false); }
  }
  return <section className="mt-3 rounded-xl border border-sf-line-soft bg-white p-3" aria-label="Product request review">
    <button type="button" aria-expanded={open} aria-label="Product requests" aria-describedby="product-request-count" onClick={() => { setOpen(!open); if (!open) void load(); }} className="flex min-h-10 w-full items-center gap-2 text-left text-sm font-bold text-sf-body"><Inbox aria-hidden="true" className="shrink-0" size={16} /><span className="flex-1">Product requests</span>{loaded && requests.length ? <span id="product-request-count" className="rounded-full bg-sf-warning-soft px-2 py-0.5 text-xs font-extrabold tabular-nums text-sf-warning">{requests.length} open</span> : loaded ? <span id="product-request-count" className="text-xs font-semibold text-sf-subtle">None open</span> : null}<ChevronDown aria-hidden="true" className={`shrink-0 transition ${open ? 'rotate-180' : ''}`} size={16} /></button>
    {open ? <>
      <p className="text-xs text-sf-subtle">Review missing catalog items. Maintain products in Tally, then sync; resolving a request creates no product.</p>
      <button type="button" disabled={busy} onClick={() => void load()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-sf-line bg-white px-3 text-sm font-bold text-sf-body"><RefreshCw aria-hidden="true" className="shrink-0" size={16} />{busy ? 'Loading…' : 'Refresh requests'}</button>
      {requests.map((request) => <ProductRequestReview key={`${request.id}:${request.version}`} request={request} onReviewed={() => setRequests((current) => current.filter((row) => row.id !== request.id))} />)}
      {!busy && !requests.length && !message ? <p className="text-sm">No open product requests.</p> : null}
      {message ? <output className={`mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${tone === 'success' ? 'border-sf-success-line bg-sf-success-soft text-sf-success' : 'border-sf-danger-line bg-sf-danger-soft text-sf-danger'}`}><CircleAlert aria-hidden="true" className="shrink-0" size={16} />{message}</output> : null}
    </> : null}
  </section>;
}

function ProductRequestReview({ request, onReviewed }: { request: OpenRequest; onReviewed: () => void }) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'success' | 'error'>('success');
  async function review(status: 'resolved' | 'rejected') {
    if (busy) return;
    const payload = pending ?? { requestId: request.id, expectedVersion: request.version, resolution: reason.trim(), status, idempotencyKey: crypto.randomUUID() };
    setPending(payload); setBusy(true); setMessage(''); setTone('success');
    try {
      const response = await fetch('/api/product-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'review_product_request', payload }) });
      const result = await readJsonBody<{ error?: string; requestId?: string }>(response);
      if ([400, 401, 403, 404, 422].includes(response.status)) setPending(null);
      if (!response.ok || !result.requestId) throw new Error(result.error || 'Review could not be confirmed; retry or refresh.');
      onReviewed();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Review unavailable'); setTone('error'); }
    finally { setBusy(false); }
  }
  return <article className="mt-2 rounded-lg border border-sf-line-soft p-3">
    <h3 className="text-sm font-bold">{request.product_name}</h3><p className="text-xs">{request.details} · {request.created_by_email}</p>
    <label className="mt-2 block text-sm">Review reason for {request.product_name}<input value={reason} maxLength={1000} disabled={busy || Boolean(pending)} onChange={(event) => setReason(event.target.value)} className="ml-2 min-h-10 rounded-lg border border-sf-line px-2" /></label>
    {pending ? <button type="button" disabled={busy} onClick={() => void review(pending.status as 'resolved' | 'rejected')} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-sf-line bg-white px-3 text-sm font-bold text-sf-body"><RotateCcw aria-hidden="true" className="shrink-0" size={16} />Retry review</button> : <div className="flex gap-3"><button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void review('resolved')} className="inline-flex items-center gap-2 border-sf-success-line text-sf-success bg-white rounded-lg px-3 min-h-10 text-sm font-bold"><CircleCheck aria-hidden="true" className="shrink-0" size={16} />Resolve request</button><button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void review('rejected')} className="inline-flex items-center gap-2 border-sf-danger-line text-sf-danger bg-white rounded-lg px-3 min-h-10 text-sm font-bold"><Ban aria-hidden="true" className="shrink-0" size={16} />Reject request</button></div>}
    {message ? <output className={`mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${tone === 'success' ? 'border-sf-success-line bg-sf-success-soft text-sf-success' : 'border-sf-danger-line bg-sf-danger-soft text-sf-danger'}`}><CircleAlert aria-hidden="true" className="shrink-0" size={16} />{message}</output> : null}
  </article>;
}
