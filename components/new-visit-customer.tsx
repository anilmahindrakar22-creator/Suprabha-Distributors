'use client';

import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import { CircleAlert, UserPlus } from 'lucide-react';
import { accountUuidPattern } from '@/lib/account-types';
import { readJsonBody } from '@/lib/http-json';

const inputClass = 'min-h-11 w-full min-w-0 rounded-xl border border-sf-line bg-white px-3 text-sm text-sf-body';
export function NewVisitCustomer({ onCancel, onCreated, onBusy }: {
  onCancel: () => void; onCreated: (customer: { customerId: string; name: string }) => void; onBusy: (busy: boolean) => void;
}) {
  const prefix = useId();
  const firstInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);
  const pending = useRef<{ key: string; body: { action: 'create_customer'; name: string; city: string | null; phone: string | null } } | null>(null);
  useEffect(() => { firstInput.current?.focus(); }, []);
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || name.trim().length < 2) return;
    inFlight.current = true; setBusy(true); onBusy(true); setError('');
    pending.current ??= { key: crypto.randomUUID(), body: { action: 'create_customer', name: name.trim(), city: city.trim() || null, phone: phone.trim() || null } };
    let unresolved = true;
    try {
      const response = await fetch('/api/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...pending.current.body, idempotencyKey: pending.current.key }) });
      const result = await readJsonBody<{ ok?: boolean; customerId?: string; name?: string; error?: string }>(response);
      if (!response.ok) {
        const definite = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429;
        if (definite) pending.current = null;
        unresolved = !definite;
        setUncertain(!definite); setError(result.error || 'Customer was not saved. Try again.'); return;
      }
      if (result.ok !== true || !result.customerId || !accountUuidPattern.test(result.customerId) || result.name !== pending.current.body.name) throw new Error('Invalid customer receipt');
      pending.current = null; setUncertain(false);
      unresolved = false;
      onCreated({ customerId: result.customerId, name: result.name });
    } catch {
      setUncertain(true); setError('The result could not be confirmed. Retry to check the same save.');
    } finally { inFlight.current = false; setBusy(false); onBusy(unresolved); }
  }
  return <form aria-label="Add customer for visits" className="min-w-0 space-y-3 rounded-xl border border-sf-line bg-white p-4" onSubmit={submit}>
    <h3 className="font-bold text-sf-strong">Add customer</h3>
    <p className="text-sm text-sf-muted">No Tally ledger needed. Save the customer, then log a visit. Management can link the ledger once it exists.</p>
    <label className="grid gap-1 text-sm text-sf-body" htmlFor={`${prefix}-name`}>Customer name<input ref={firstInput} id={`${prefix}-name`} required minLength={2} maxLength={160} disabled={busy || uncertain} className={inputClass} value={name} onChange={event => setName(event.target.value)} /></label>
    <label className="grid gap-1 text-sm text-sf-body" htmlFor={`${prefix}-city`}>Town (optional)<input id={`${prefix}-city`} maxLength={160} disabled={busy || uncertain} className={inputClass} value={city} onChange={event => setCity(event.target.value)} /></label>
    <label className="grid gap-1 text-sm text-sf-body" htmlFor={`${prefix}-phone`}>Phone (optional)<input id={`${prefix}-phone`} type="tel" maxLength={80} disabled={busy || uncertain} className={inputClass} value={phone} onChange={event => setPhone(event.target.value)} /></label>
    {error ? <p role="alert" className="flex items-start gap-2 break-words text-sm text-sf-danger"><CircleAlert aria-hidden="true" size={18} className="shrink-0" />{error}</p> : null}
    <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy || name.trim().length < 2} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-sf-brand px-4 text-sm font-bold text-white disabled:opacity-50"><UserPlus aria-hidden="true" size={18} />{busy ? 'Saving…' : uncertain ? 'Retry same save' : 'Save customer'}</button><button type="button" disabled={busy || uncertain} onClick={onCancel} className="min-h-11 rounded-xl border border-sf-line px-4 text-sm font-semibold text-sf-brand disabled:opacity-50">Cancel</button></div>
  </form>;
}
