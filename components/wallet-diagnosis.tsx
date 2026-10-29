'use client';

import { useEffect, useRef, useState } from 'react';
import type { ConstraintCategory, ConstraintConfidence, OpportunityKind, OpportunityOutcome, WalletOpportunity } from '@/lib/wallet-diagnosis-types';

const button = 'min-h-11 rounded-xl border border-sf-line px-3 text-sm font-bold text-sf-body disabled:opacity-50';
const primary = 'min-h-11 rounded-xl bg-sf-brand px-4 text-sm font-bold text-white disabled:opacity-50';
const input = 'min-h-11 w-full min-w-0 rounded-xl border border-sf-line bg-sf-soft-0 px-3 text-sm text-sf-body';
const formText = (form: FormData, key: string) => { const value = form.get(key); return typeof value === 'string' ? value.trim() : ''; };
const labels: Record<ConstraintCategory, string> = { price: 'Price', portfolio: 'Portfolio gap', instrument: 'Instrument', service: 'Service', relationship: 'Relationship', credit: 'Credit', availability: 'Availability', clinical: 'Clinical', contract_tender: 'Contract / tender', competitor_lock_in: 'Competitor lock-in', unknown: 'Unknown' };
const categories = Object.keys(labels) as ConstraintCategory[];
const isCategory = (value: string): value is ConstraintCategory => categories.includes(value as ConstraintCategory);
type Command = { action: 'open_opportunity'; payload: { requestId: string; customerId: string; kind: OpportunityKind; reason: string } } | { action: 'record_constraint'; payload: { requestId: string; opportunityId: string; category: ConstraintCategory; evidence: string; confidence: ConstraintConfidence; expectedCurrentConstraintId: string | null } } | { action: 'close_opportunity'; payload: { requestId: string; opportunityId: string; outcome: OpportunityOutcome; reason: string } };
class DiagnosisError extends Error { constructor(message: string, readonly status: number) { super(message); } }
async function request<T>(url: string, options?: RequestInit): Promise<T> { const response = await fetch(url, { cache: 'no-store', ...options }); const body = await response.json() as T & { error?: string }; if (!response.ok) throw new DiagnosisError(body.error ?? 'Wallet is temporarily unavailable', response.status); return body as T; }
function validOpportunity(value: unknown): value is WalletOpportunity[] { return Array.isArray(value) && value.every(item => !!item && typeof item === 'object' && typeof item.id === 'string' && typeof item.customerId === 'string' && ['capture', 'defend', 'recover'].includes(item.kind) && typeof item.openedReason === 'string' && Array.isArray(item.history) && (item.closure === null || typeof item.closure === 'object') && (item.constraint === null || typeof item.constraint === 'object')); }
const titleCase = (value: string) => value[0].toUpperCase() + value.slice(1);
const dateLabel = (value: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(value));

export function WalletDiagnosis({ customerId, onConflict, onForbidden }: { customerId: string; onConflict: () => Promise<void>; onForbidden: () => void }) {
  const [items, setItems] = useState<WalletOpportunity[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [mode, setMode] = useState<'open' | 'record' | 'close' | null>(null);
  const [category, setCategory] = useState<ConstraintCategory | ''>('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<Command | null>(null);
  const inFlight = useRef(false);
  const reload = async () => { const data = await request<unknown>(`/api/wallet/diagnosis?${new URLSearchParams({ action: 'get_account_opportunities', customerId })}`); if (!validOpportunity(data)) throw new Error('Invalid diagnosis response'); setItems(data); setLoadFailed(false); };
  useEffect(() => { let alive = true; void request<unknown>(`/api/wallet/diagnosis?${new URLSearchParams({ action: 'get_account_opportunities', customerId })}`).then(data => { if (alive) { if (validOpportunity(data)) { setItems(data); setLoadFailed(false); } else { setLoadFailed(true); } } }).catch(() => { if (alive) setLoadFailed(true); }); return () => { alive = false; }; }, [customerId]);
  async function save(command: Command) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    const cmd = pending.current ?? command;
    pending.current = cmd;
    try {
      await request('/api/wallet/diagnosis', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
      pending.current = null; setUncertain(false); setMode(null); setCategory(''); await reload();
    } catch (failure) {
      if (failure instanceof DiagnosisError && failure.status >= 400 && failure.status < 500) {
        pending.current = null; setUncertain(false);
        if (failure.status === 403) onForbidden();
        else if (failure.status === 409) { await reload().catch(() => {}); setError('Someone else just updated this. Reloaded.'); await onConflict(); }
        else setError(failure.message);
      } else { setUncertain(true); setError('Save could not be confirmed. Check the connection and retry the same save.'); }
    } finally { inFlight.current = false; setBusy(false); }
  }
  const open = items?.find(item => item.closure === null);
  const evidenceHint = category === 'price' ? 'Competitor, product and their price' : category === 'unknown' ? 'What we need to find out' : 'What we saw or were told';
  function cancel() { if (busy) return; setMode(null); setError(''); setCategory(''); }
  return <section aria-label="Why we&apos;re not winning" className="min-w-0 space-y-3 border-t border-sf-line-soft pt-3"><h3 className="font-bold">Why we&apos;re not winning</h3>{loadFailed ? <p className="text-sm text-sf-muted">Couldn&apos;t load the diagnosis.</p> : items === null ? null : open ? <>
    <div className="space-y-2 text-sm"><h4 className="font-semibold">{open.constraint && open.constraint.category !== 'unknown' ? labels[open.constraint.category] : 'Not diagnosed yet'}</h4>{open.constraint ? <><p>Confidence: {titleCase(open.constraint.confidence)}</p><p>{open.constraint.evidence}</p><p className="text-sf-muted">Recorded by {open.constraint.recordedBy} · {dateLabel(open.constraint.recordedAt)}</p></> : null}<p>{titleCase(open.kind)} opportunity · {open.openedReason}</p></div>
    <div className="flex flex-wrap gap-2"><button className={button} onClick={() => { setMode('record'); setError(''); }}>Record constraint</button><button className="min-h-11 px-2 text-sm text-sf-muted underline" onClick={() => { setMode('close'); setError(''); }}>Close opportunity</button></div>
    {open.history.length > 0 ? <details><summary className="flex min-h-11 cursor-pointer items-center">Constraint history ({open.history.length})</summary><ul className="space-y-2">{open.history.map(entry => <li key={entry.id} className="text-sm">{labels[entry.category]} · {titleCase(entry.confidence)}: {entry.evidence}</li>)}</ul></details> : null}
  </> : <button className={button} onClick={() => { setMode('open'); setError(''); }}>Start diagnosis</button>}
  {mode ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); if (mode === 'open') { const kind = form.get('kind'); if (kind === 'capture' || kind === 'defend' || kind === 'recover') void save({ action: 'open_opportunity', payload: { requestId: crypto.randomUUID(), customerId, kind, reason: formText(form, 'reason') } }); } else if (mode === 'record' && open) { const confidence = form.get('confidence'); if (category && categories.includes(category) && (confidence === 'high' || confidence === 'medium' || confidence === 'low')) void save({ action: 'record_constraint', payload: { requestId: crypto.randomUUID(), opportunityId: open.id, category, evidence: formText(form, 'evidence'), confidence, expectedCurrentConstraintId: open.constraint?.id ?? null } }); } else if (mode === 'close' && open) { const outcome = form.get('outcome'); if (outcome === 'won' || outcome === 'lost' || outcome === 'dropped') void save({ action: 'close_opportunity', payload: { requestId: crypto.randomUUID(), opportunityId: open.id, outcome, reason: formText(form, 'reason') } }); } }}>
    {mode === 'open' ? <><label className="block">Kind<select disabled={busy || uncertain} className={input} name="kind" defaultValue="capture"><option value="capture">Capture</option><option value="defend">Defend</option><option value="recover">Recover</option></select></label><label className="block">Reason<textarea disabled={busy || uncertain} className={input} name="reason" required minLength={3} maxLength={500} /></label></> : mode === 'record' ? <><label className="block">Category<select disabled={busy || uncertain} className={input} name="category" required value={category} onChange={event => { const value = event.target.value; setCategory(isCategory(value) ? value : ''); }}><option value="">Choose…</option>{categories.map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label><label className="block">Evidence<textarea disabled={busy || uncertain} className={input} name="evidence" required minLength={3} maxLength={1000} /><span className="text-xs text-sf-muted">{evidenceHint}</span></label><label className="block">Confidence<select disabled={busy || uncertain} className={input} name="confidence" defaultValue="medium"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label></> : <><label className="block">Outcome<select disabled={busy || uncertain} className={input} name="outcome"><option value="won">Won</option><option value="lost">Lost</option><option value="dropped">Dropped</option></select></label><label className="block">Reason<textarea disabled={busy || uncertain} className={input} name="reason" required minLength={3} maxLength={500} /></label></>}
    {error ? <p role="alert" className="text-sm text-sf-danger">{error}</p> : null}{uncertain ? <button type="button" className={primary} disabled={busy} onClick={() => pending.current && void save(pending.current)}>Retry same save</button> : <button className={primary} disabled={busy || (mode === 'record' && !category)}>{busy ? 'Saving…' : 'Save'}</button>}<button type="button" className={button} disabled={busy} onClick={cancel}>Cancel</button>
  </form> : null}</section>;
}
