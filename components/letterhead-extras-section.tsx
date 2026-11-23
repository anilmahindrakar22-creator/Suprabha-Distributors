'use client';

import { useEffect, useRef, useState } from 'react';
import { parseLetterheadExtras, validateLetterheadExtrasCommand, type LetterheadExtras } from '@/lib/letterhead-extras';
import { readJsonResponse } from '@/lib/http-json';
import { prepareLogo } from '@/lib/logo-resize';

const termInputClass = 'min-h-11 w-full min-w-0 rounded-xl border border-sf-line px-3 font-normal';
const primaryClass = 'min-h-11 rounded-xl bg-sf-ink px-5 font-bold text-white disabled:opacity-50';
const buttonClass = 'min-h-11 rounded-xl border border-sf-line px-3 font-bold disabled:opacity-50';

export function LetterheadExtrasSection() {
  const [draft, setDraft] = useState<LetterheadExtras | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [pendingBody, setPendingBody] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function load() {
    if (inFlight.current) return;
    inFlight.current = true;
    void fetch('/api/letterhead/extras', { cache: 'no-store', signal: AbortSignal.timeout(15000) })
      .then(async response => parseLetterheadExtras(await readJsonResponse(response)))
      .then(value => {
        setDraft(value);
        setConflict(false);
        setPendingBody(null);
        setLoadState('ready');
      }).catch(() => { setLoadState('error'); })
      .finally(() => { inFlight.current = false; });
  }
  useEffect(() => { load(); }, []);

  function reload() {
    if (inFlight.current) return;
    setLoadState('loading');
    setMessage('');
    load();
  }

  async function chooseLogo(file: File) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPreparing(true);
    setMessage('');
    try {
      const { type, base64 } = await prepareLogo(file);
      setDraft(current => current && { ...current, logo: { type, base64 } });
    } catch (error) { setMessage(error instanceof Error ? error.message : 'This image could not be read'); }
    finally { inFlight.current = false; setPreparing(false); }
  }

  async function save() {
    if (inFlight.current || !draft || conflict) return;
    const command = pendingBody ? null : validateLetterheadExtrasCommand({ action: 'set_letterhead_extras', payload: {
      idempotencyKey: crypto.randomUUID(), expectedVersion: draft.version, logo: draft.logo,
      terms: draft.terms.map(term => term.trim()).filter(Boolean),
    } });
    if (!pendingBody && !command) { setMessage('Check the terms (up to 5, each up to 200 characters)'); return; }
    const body = pendingBody ?? JSON.stringify(command);
    inFlight.current = true;
    setBusy(true);
    setPendingBody(body);
    setMessage('');
    try {
      const response = await fetch('/api/letterhead/extras', { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(15000) });
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!response.ok && !retryable) setPendingBody(null);
      if (response.status === 409) {
        setConflict(true);
        setMessage('Someone else changed the logo or terms. Reload to see them.');
        return;
      }
      setDraft(parseLetterheadExtras(await readJsonResponse(response, 'Logo and terms could not be saved')));
      setPendingBody(null);
      setMessage('Logo and terms saved');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Logo and terms could not be saved'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  function change(values: Partial<LetterheadExtras>) {
    setDraft(current => current && { ...current, ...values });
    setMessage('');
  }

  return <section className="mt-6 min-w-0 border-t border-sf-line pt-4" aria-labelledby="letterhead-extras-heading">
    <h3 id="letterhead-extras-heading" className="font-bold text-sf-label">Logo and PO terms</h3>
    {loadState === 'loading' && <p className="mt-3 text-sm">Loading logo and terms…</p>}
    {loadState === 'error' && <div className="mt-3"><p role="alert">Logo and terms could not load</p><button type="button" className={primaryClass} onClick={reload}>Retry</button></div>}
    {loadState === 'ready' && draft && <form className="mt-4 grid min-w-0 gap-3" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy || preparing || pendingBody !== null || conflict} className="grid min-w-0 gap-3 text-sm text-sf-label disabled:opacity-70">
        <legend className="sr-only">Logo and PO terms</legend>
        {draft.logo && <div className="w-fit max-w-full rounded-xl border border-sf-line bg-white p-2">
          {/* oxlint-disable-next-line next/no-img-element -- Local data URL preview requires no image optimization. */}
          <img alt="Company logo" src={`data:${draft.logo.type};base64,${draft.logo.base64}`} className="max-h-16 max-w-full object-contain" />
        </div>}
        <input ref={fileInput} type="file" accept="image/png,image/jpeg" aria-label="Choose logo file" className="hidden" onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void chooseLogo(file);
        }} />
        <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} onClick={() => fileInput.current?.click()}>{draft.logo ? 'Change logo' : 'Choose logo'}</button>
          {draft.logo && <button type="button" className={buttonClass} onClick={() => change({ logo: null })}>Remove logo</button>}</div>
        <p className="text-sf-subtle">PNG or JPEG. It is resized to fit; a white or transparent background looks best.</p>
        <p className="text-sf-subtle">“Please quote the PO number on your invoice and delivery challan” is always printed first.</p>
        {draft.terms.map((term, index) => <div key={index} className="min-w-0">
          <label htmlFor={`po-term-${index + 1}`} className="font-bold">Term {index + 1}</label>
          <div className="mt-2 flex min-w-0 items-center gap-2"><input id={`po-term-${index + 1}`} maxLength={200} value={term} className={termInputClass} onChange={event => change({ terms: draft.terms.map((value, i) => i === index ? event.target.value : value) })} />
            <button type="button" aria-label={`Remove term ${index + 1}`} className={buttonClass} onClick={() => change({ terms: draft.terms.filter((_, i) => i !== index) })}>Remove</button></div>
        </div>)}
        {draft.terms.length < 5 && <button type="button" className={buttonClass} onClick={() => change({ terms: [...draft.terms, ''] })}>Add term</button>}
      </fieldset>
      {message && (message === 'Logo and terms saved' ? <output className="text-sm">{message}</output> : <p role="alert" className="text-sm [overflow-wrap:anywhere]">{message}</p>)}
      {conflict ? <button type="button" className={primaryClass} onClick={reload}>Reload</button> : <button type="submit" disabled={busy || preparing} className={primaryClass}>{busy ? 'Saving…' : pendingBody ? 'Retry' : 'Save logo and terms'}</button>}
    </form>}
  </section>;
}
