'use client';

import { useRef, useState } from 'react';
import { GSTIN_PATTERN, normalizeGstin, parseLetterhead, validateLetterheadCommand, type Letterhead } from '@/lib/letterhead';
import { readJsonResponse } from '@/lib/http-json';

const inputClass = 'mt-2 min-h-11 w-full rounded-xl border border-sf-line px-3 font-normal';
const primaryClass = 'min-h-11 rounded-xl bg-sf-ink px-5 font-bold text-white disabled:opacity-50';
const gstinMessage = 'Enter a 15-character GSTIN, for example 29ABCDE1234F1Z5';

export function CompanyDetailsCard() {
  const [loaded, setLoaded] = useState<Letterhead | null>(null);
  const [draft, setDraft] = useState({ companyName: '', address: '', gstin: '', phone: '', deliveryAddress: '' });
  const [sameDelivery, setSameDelivery] = useState(true);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [busy, setBusy] = useState(false);
  const [pendingBody, setPendingBody] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [gstinChecked, setGstinChecked] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);
  const normalizedGstin = normalizeGstin(draft.gstin);
  const invalidGstin = normalizedGstin !== null && !GSTIN_PATTERN.test(normalizedGstin);
  const invalidDelivery = !sameDelivery && !draft.deliveryAddress.trim();

  function replaceValues(value: Letterhead) {
    setLoaded(value);
    setDraft({ companyName: value.companyName, address: value.address, gstin: value.gstin ?? '', phone: value.phone, deliveryAddress: value.deliveryAddress });
    setSameDelivery(value.deliveryAddress.trim() === '');
    setGstinChecked(false);
    setSubmitted(false);
  }

  async function load() {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoadState('loading');
    setMessage('');
    try {
      replaceValues(parseLetterhead(await readJsonResponse(await fetch('/api/letterhead', { cache: 'no-store', signal: AbortSignal.timeout(15000) }))));
      setConflict(false);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    } finally {
      inFlight.current = false;
    }
  }

  async function save() {
    if (inFlight.current || !loaded || conflict) return;
    setGstinChecked(true);
    setSubmitted(true);
    const command = pendingBody ? null : validateLetterheadCommand({
      action: 'set_letterhead',
      payload: { idempotencyKey: crypto.randomUUID(), expectedVersion: loaded.version, ...draft, gstin: normalizedGstin, deliveryAddress: sameDelivery ? '' : draft.deliveryAddress },
    });
    if (!pendingBody && (!command || invalidDelivery)) {
      setMessage('Check the highlighted fields');
      return;
    }
    const body = pendingBody ?? JSON.stringify(command);
    inFlight.current = true;
    setBusy(true);
    setPendingBody(body);
    setMessage('');
    try {
      const response = await fetch('/api/letterhead', { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(15000) });
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!response.ok && !retryable) setPendingBody(null);
      if (response.status === 409) {
        setConflict(true);
        setMessage('Someone else changed these details. Reload to see them.');
        return;
      }
      const value = await readJsonResponse(response, 'Company details could not be saved');
      replaceValues(parseLetterhead(value));
      setPendingBody(null);
      setMessage('Company details saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Company details could not be saved');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function field(name: keyof typeof draft, value: string) {
    setDraft(current => ({ ...current, [name]: value }));
    setMessage('');
  }

  return <details className="mt-4 rounded-xl border bg-white p-4" onToggle={event => { if (event.currentTarget.open && loadState === 'idle') void load(); }}>
    <summary className="cursor-pointer font-bold text-sf-label">Company details <span className="block text-sm font-normal text-sf-subtle">Printed on purchase order PDFs</span></summary>
    {loadState === 'loading' && <output className="mt-3 block text-sm">Loading company details…</output>}
    {loadState === 'error' && <div className="mt-3"><p role="alert">Company details could not load</p><button type="button" className={primaryClass} onClick={() => void load()}>Retry</button></div>}
    {loadState === 'ready' && loaded && <form noValidate className="mt-4 grid min-w-0 gap-3" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy || pendingBody !== null || conflict} className="grid min-w-0 gap-3 text-sm font-bold text-sf-label disabled:opacity-70">
        <legend className="sr-only">Company details</legend>
        <div><label htmlFor="company-name" className="font-bold">Company name</label><input id="company-name" required maxLength={120} value={draft.companyName} onChange={event => field('companyName', event.target.value)} aria-invalid={submitted && !draft.companyName.trim()} className={inputClass} /></div>
        <div><label htmlFor="company-address" className="font-bold">Address</label><textarea id="company-address" maxLength={400} value={draft.address} onChange={event => field('address', event.target.value)} className={inputClass} /></div>
        <div><label htmlFor="company-gstin" className="font-bold">GSTIN</label><input id="company-gstin" maxLength={15} autoCapitalize="characters" spellCheck={false} value={draft.gstin} onChange={event => field('gstin', event.target.value)} onBlur={() => setGstinChecked(true)} aria-invalid={gstinChecked && invalidGstin} aria-describedby={gstinChecked && invalidGstin ? 'company-gstin-error' : undefined} className={inputClass} />
          {gstinChecked && invalidGstin && <p id="company-gstin-error" className="mt-1 font-normal text-sf-danger">{gstinMessage}</p>}</div>
        <div><label htmlFor="company-phone" className="font-bold">Phone</label><input id="company-phone" maxLength={40} inputMode="tel" value={draft.phone} onChange={event => field('phone', event.target.value)} className={inputClass} /></div>
        <label htmlFor="company-delivery-same" className="flex min-h-11 items-center gap-2 font-normal"><input type="checkbox" id="company-delivery-same" checked={sameDelivery} onChange={event => { setSameDelivery(event.target.checked); setMessage(''); }} className="size-4 accent-sf-accent" />Delivery address same as company address</label>
        {!sameDelivery && <div><label htmlFor="company-delivery-address" className="font-bold">Delivery address</label><textarea id="company-delivery-address" maxLength={400} value={draft.deliveryAddress} onChange={event => field('deliveryAddress', event.target.value)} aria-invalid={submitted && invalidDelivery} aria-describedby={submitted && invalidDelivery ? 'company-delivery-error' : undefined} className={inputClass} />
          {submitted && invalidDelivery && <p id="company-delivery-error" className="mt-1 font-normal text-sf-danger">Enter the delivery address, or tick &quot;same as company address&quot;</p>}</div>}
      </fieldset>
      <p className="text-sm text-sf-subtle">Last saved {new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(loaded.updatedAt))}</p>
      {message && (message === 'Company details saved' ? <output className="text-sm">{message}</output> : <p role="alert" className="text-sm [overflow-wrap:anywhere]">{message}</p>)}
      {conflict ? <button type="button" className={primaryClass} onClick={() => void load()}>Reload</button> : <button type="submit" disabled={busy} className={primaryClass}>{busy ? 'Saving…' : pendingBody ? 'Retry' : 'Save company details'}</button>}
    </form>}
  </details>;
}
