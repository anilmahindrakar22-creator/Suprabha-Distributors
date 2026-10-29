'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { isPowerMap, validatePowerMapCommand, type InfluenceStrength, type PowerMap, type PowerMapCommand } from '@/lib/power-map-types';
import { walletRoleLabels } from '@/lib/wallet-labels';
import { readJsonBody } from '@/lib/http-json';

const inputClass = 'min-h-11 w-full min-w-0 max-w-full rounded-xl border border-sf-line bg-white px-3 text-sm';
const buttonClass = 'min-h-11 rounded-xl border border-sf-line px-3 text-sm text-sf-brand disabled:opacity-50';
const strengths: Record<InfluenceStrength, string> = { strong: 'Strong', medium: 'Medium', low: 'Low' };

export function PowerMapInfluence({ customerId, customerName, refreshOn, busy = false, onBusy }: {
  customerId: string; customerName: string; refreshOn?: unknown; busy?: boolean; onBusy?: (busy: boolean) => void;
}) {
  const prefix = useId();
  const [map, setMap] = useState<PowerMap | null>(null);
  const [readError, setReadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [strength, setStrength] = useState<InfluenceStrength | ''>('');
  const [evidence, setEvidence] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const origin = useRef<HTMLButtonElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    const current = ++generation.current;
    try {
      const response = await fetch(`/api/power-map?action=get_power_map&customerId=${encodeURIComponent(customerId)}`, { cache: 'no-store', signal });
      const result = await readJsonBody<unknown>(response);
      if (!response.ok) throw new Error(result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : 'Unable to load influence.');
      if (!isPowerMap(result)) throw new Error('Unable to load influence. Please retry.');
      if (!signal?.aborted && current === generation.current) { setMap(result); setReadError(''); }
    } catch (failure) {
      if (!signal?.aborted && current === generation.current) { setMap(null); setReadError(failure instanceof Error ? failure.message : 'Unable to load influence.'); }
    }
  }, [customerId]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [load, refreshOn]);
  useEffect(() => {
    if (form && !saving) formRef.current?.querySelector<HTMLElement>('select, textarea')?.focus();
    else if (!form && !saving) origin.current?.focus();
  }, [form, saving]);
  function close() { setForm(null); setError(''); origin.current?.focus(); }
  async function save(command: { action: 'set_influence' | 'end_influence'; payload: Record<string, unknown> }) {
    if (inFlight.current || busy) return;
    const fingerprint = JSON.stringify(command);
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, requestId: crypto.randomUUID() };
    let validated: PowerMapCommand;
    try { validated = validatePowerMapCommand({ ...command, payload: { ...command.payload, requestId: pending.current.requestId } }); }
    catch { setError('Choose two different contacts and a strength; evidence and end reasons need 3–300 characters.'); return; }
    inFlight.current = true; setSaving(true); onBusy?.(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/power-map', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(validated) });
      if (response.status === 409) {
        pending.current = null; close(); await load(); setNotice('Someone else changed this power map. The list has been refreshed.'); return;
      }
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) pending.current = null;
      const result = await readJsonBody<{ error?: string }>(response);
      if (!response.ok) { setError(result?.error || 'Not saved. Please try again.'); return; }
      pending.current = null; close(); await load(); setNotice('Saved.');
    } catch { setError('Not saved. Check the connection and try again.'); }
    finally { inFlight.current = false; setSaving(false); onBusy?.(false); }
  }
  const decider = map?.contacts.filter(c => c.decisionRole === 'decision_maker').sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))[0];
  const steps = map?.route?.steps;
  const disabled = busy || saving;
  return <section aria-label={`Influence for ${customerName}`} className="min-w-0 space-y-1 break-words pt-2 text-sm text-sf-body [overflow-wrap:anywhere]">
    <p>{readError ? 'Influence unavailable' : !map ? 'Loading influence…' : steps ? <>Route to decider: {steps.map((step, index) => <span key={step.contactId}>{index ? ' → ' : ''}{index === steps.length - 1 ? <strong>{step.name}</strong> : step.name}</span>)}</> : !map.contacts.some(c => c.stance === 'supporter') ? 'No supporter yet: find a champion' : !decider ? 'No decision maker known' : `No known route to ${decider.name}: ask who they listen to`}</p>
    {readError ? <div><p role="alert">{readError}</p><button type="button" className={buttonClass} onClick={() => void load()}>Retry influence</button></div> : null}
    {map ? <>
      <button type="button" className="inline-flex min-h-11 items-center gap-1 text-xs text-sf-muted" aria-expanded={expanded} aria-controls={`${prefix}-details`} onClick={() => setExpanded(value => !value)}>Influence ({map.links.length})<ChevronDown aria-hidden="true" size={16} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} /></button>
      {expanded ? <div id={`${prefix}-details`} className="min-w-0 space-y-3">
        <ul className="space-y-3" aria-label="Influence links">{map.links.map(link => <li key={link.id} className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2"><span className="min-w-0 break-words [overflow-wrap:anywhere]">{map.contacts.find(c => c.id === link.fromContactId)?.name ?? 'Removed contact'} → {map.contacts.find(c => c.id === link.toContactId)?.name ?? 'Removed contact'}</span><span className="rounded-full bg-sf-soft-0 px-2 py-1 text-xs">{strengths[link.strength]}</span><button type="button" disabled={disabled} className="min-h-11 text-xs text-sf-muted" aria-label={`End influence from ${map.contacts.find(c => c.id === link.fromContactId)?.name ?? 'removed contact'} to ${map.contacts.find(c => c.id === link.toContactId)?.name ?? 'removed contact'}`} onClick={event => { origin.current = event.currentTarget; setForm(link.id); setReason(''); setError(''); setNotice(''); }}>End</button></div>
          <p className="break-words text-xs text-sf-muted [overflow-wrap:anywhere]">{link.evidence}</p>
        </li>)}</ul>
        <button type="button" hidden={!!form} disabled={disabled} className={buttonClass} onClick={event => { origin.current = event.currentTarget; setFrom(''); setTo(''); setStrength(''); setEvidence(''); setError(''); setNotice(''); setForm('add'); }}>Add influence</button>
        {form ? <form ref={formRef} aria-label={form === 'add' ? 'Add influence' : 'End influence'} className="min-w-0 space-y-3" onSubmit={event => { event.preventDefault(); void save(form === 'add' ? { action: 'set_influence', payload: { customerId, fromContactId: from, toContactId: to, strength, evidence: evidence.trim() } } : { action: 'end_influence', payload: { influenceId: form, reason: reason.trim() } }); }}>
          <fieldset disabled={disabled} className="min-w-0 space-y-3">
            {form === 'add' ? <>
              {(['From', 'To'] as const).map(label => <div key={label} className="min-w-0"><label htmlFor={`${prefix}-${label}`}>{label}</label><select id={`${prefix}-${label}`} required className={inputClass} value={label === 'From' ? from : to} onChange={event => (label === 'From' ? setFrom : setTo)(event.target.value)}><option value="">Choose contact</option>{map.contacts.map(c => <option key={c.id} value={c.id} disabled={c.id === (label === 'From' ? to : from)}>{c.name} · {walletRoleLabels[c.decisionRole as keyof typeof walletRoleLabels] ?? walletRoleLabels.unknown}</option>)}</select></div>)}
              <div><label htmlFor={`${prefix}-strength`}>Strength</label><select id={`${prefix}-strength`} required className={inputClass} value={strength} onChange={event => setStrength(event.target.value as InfluenceStrength | '')}><option value="">Choose strength</option>{Object.entries(strengths).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
              <div><label htmlFor={`${prefix}-evidence`}>Evidence</label><textarea id={`${prefix}-evidence`} required minLength={3} maxLength={300} className={inputClass} aria-describedby={`${prefix}-hint`} value={evidence} onChange={event => setEvidence(event.target.value)} /><p id={`${prefix}-hint`} className="text-xs text-sf-muted">What you saw; don&apos;t write personal details</p></div>
            </> : <div><label htmlFor={`${prefix}-reason`}>Reason</label><textarea id={`${prefix}-reason`} required minLength={3} maxLength={300} className={inputClass} value={reason} onChange={event => setReason(event.target.value)} /></div>}
            <div className="flex flex-wrap gap-2"><button className={buttonClass} type="submit">{saving ? 'Saving…' : form === 'add' ? 'Save influence' : 'End influence'}</button><button className={buttonClass} type="button" onClick={close}>Cancel</button></div>
          </fieldset>
        </form> : null}
      </div> : null}
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <output className="block">{notice}</output> : null}
  </section>;
}
