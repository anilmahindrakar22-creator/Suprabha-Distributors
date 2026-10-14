'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type SubmitEvent } from 'react';
import { isInsideMarketArea, MARKET_AREA, parseLocationInput, powerAlerts, socialStyles, styleCues, withAccountContacts, type ContactStyle, type SocialStyle, type StyleCue, type AppContact, type ContactAssessment, type PowerAlert, type AccountRow, type AccountsResponse, type VisitOutcome } from '@/lib/account-types';
import { readJsonBody } from '@/lib/http-json';

type Mode = 'mine' | 'all';
type FormKind = 'visit' | 'location' | 'owner';
const inputClass = 'min-h-11 w-full min-w-0 max-w-full rounded-xl border border-sf-line bg-sf-soft-0 px-3 text-sm text-sf-body outline-none focus:border-sf-mint';
const buttonClass = 'min-h-11 rounded-xl border border-sf-line px-3 text-sm font-bold text-sf-body disabled:opacity-50';
const primaryClass = 'min-h-11 rounded-xl bg-sf-ink-hover px-4 text-sm font-bold text-sf-soft disabled:opacity-50';
const actionClass = 'min-h-11 rounded-xl px-3 text-sm font-bold text-sf-brand disabled:opacity-50';
const contactActionClass = 'inline-flex min-h-11 items-center px-1 text-xs text-sf-brand/80 disabled:opacity-50';
const outcomes: Record<VisitOutcome, string> = { met: 'Met', not_available: 'Not available', order_taken: 'Order taken', issue_raised: 'Issue raised', other: 'Other' };
const pinError = 'Paste a Google Maps link or two numbers like 18.52, 73.85';
const roleLabels = { unknown: 'Unknown', decision_maker: 'Decision maker', influencer: 'Influencer', user: 'User', gatekeeper: 'Gatekeeper' };
const stanceLabels = { unknown: 'Unknown', supporter: 'Supporter', neutral: 'Neutral', sceptical: 'Sceptical', blocker: 'Blocker' };
const influenceLabels = { unknown: 'Unknown', high: 'High', medium: 'Medium', low: 'Low' };
const styleLabels: Record<SocialStyle, string> = { analytical: 'Analytical', driving: 'Driving', expressive: 'Expressive', amiable: 'Amiable' };
export function styleTip(styleKey: ContactStyle['state']) {
  if (styleKey === 'not_enough' || styleKey === 'not_clear') return null;
  return {
    analytical: "Bring the data: cost per test, validation papers, a written comparison. Don't rush.",
    driving: 'Lead with the result: savings, uptime, a clear recommendation. Keep it short.',
    expressive: 'Demo it, name reference labs, tell the bigger story.',
    amiable: 'Build trust: service plan, training, reliability. Reduce the risk of switching.',
  }[styleKey];
}
export function styleLine(style: ContactStyle) {
  if (style.override) return `${styleLabels[style.override.style]} (set by ${style.override.actor})`;
  if (style.state === 'not_enough') return `Style: not enough information (${style.distinctDates} of 3 meetings)`;
  if (style.state === 'not_clear') return 'Style: not clear yet. Keep rating after visits.';
  return `${styleLabels[style.state]} · ${style.confidence} confidence`;
}
const cueLabels: Record<StyleCue, string> = {
  cost_per_test: 'Cost per test or comparison', validation_data: 'Validation or QC papers', uptime_tat: 'Uptime or turnaround time',
  price_fast_decision: 'Price or a fast decision', new_tech_demo: 'New technology or demos', reference_labs: 'Reference labs',
  service_training: 'Service and training', stay_current_supplier: 'Staying with current supplier',
};
const behaviours = [
  ['Speaks slowly and carefully', 'Speaks quickly and firmly'],
  ['Asks questions, holds back opinions', 'States opinions'],
  ['Follows our agenda', 'Takes control of the meeting'],
  ['Wants time and consults others', 'Decides on the spot'],
  ['Talks tasks, facts, numbers', 'Talks people, stories'],
  ['Formal, reserved', 'Warm, animated'],
  ['Strict on time, straight to business', 'Relaxed, enjoys small talk'],
  ['Asks for proof and data', 'Goes by trust and peer labs'],
] as const;

function ContactSocial({ contact, canSeeStyle, visitId, attribution, prompt = false, busy = false, onBusy, onSaved }: {
  contact: AppContact; canSeeStyle?: boolean; visitId?: string; attribution?: ReactNode; prompt?: boolean;
} & ContactCallbacks) {
  const prefix = useId();
  const [rating, setRating] = useState(false);
  const [done, setDone] = useState(false);
  const [ratings, setRatings] = useState<number[]>(Array(8).fill(0));
  const [cues, setCues] = useState<StyleCue[]>([]);
  const [history, setHistory] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const [override, setOverride] = useState<SocialStyle | ''>(contact.style?.override?.style ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const inFlight = useRef(false);
  const origin = useRef<HTMLButtonElement | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const who = `${contact.name} (${contact.id})${prompt ? ` after visit ${visitId}` : ''}`;
  useEffect(() => { if (rating || overriding) form.current?.querySelector<HTMLElement>('input, select')?.focus(); }, [rating, overriding]);
  function cancel() { setRating(false); setOverriding(false); setError(''); origin.current?.focus(); }
  async function post(body: Record<string, unknown>) {
    if (busy || inFlight.current) return;
    inFlight.current = true; onBusy?.(true); setError(''); setNotice('');
    const fingerprint = JSON.stringify(body);
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const response = await fetch('/api/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, idempotencyKey: pending.current.key }) });
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) pending.current = null;
      const result = await readJsonBody<{ error?: string; code?: string }>(response);
      if (response.status === 409 && body.action === 'record_style_observation' && (result.code === 'PT409' || result.error?.includes('Already rated for this visit'))) {
        setNotice('Already rated for this visit'); setRating(false); setDone(true); return;
      }
      if (!response.ok) { setError(result.error || 'Not saved. Please try again.'); return; }
      pending.current = null; setRating(false); setOverriding(false);
      if (body.action === 'record_style_observation') setDone(true);
      await onSaved?.(false);
    } catch { setError('Not saved. Check the connection and try again.'); }
    finally { inFlight.current = false; onBusy?.(false); }
  }
  const style = canSeeStyle ? contact.style : undefined;
  const tipKey = style?.override?.style ?? (style && socialStyles.includes(style.state as SocialStyle) ? style.state as SocialStyle : null);
  const rateButton = <button type="button" disabled={busy} className={contactActionClass} aria-label={`${prompt ? 'Rate' : 'Rate behaviour for'} ${who}`} aria-expanded={rating} onClick={event => { origin.current = event.currentTarget; setRating(true); setOverriding(false); setError(''); }}>{prompt ? 'Rate' : 'Rate behaviour'}</button>;
  return <div className="min-w-0 space-y-1 break-words">
    {attribution ? <p className="break-all text-xs text-sf-muted">{attribution}{visitId && !done ? <>{' · '}{rateButton}</> : null}</p> : null}
    {!prompt && style ? <>
      <p className={`text-xs ${tipKey ? 'text-sf-body' : 'text-sf-muted'}`}>{styleLine(style)}</p>
      {tipKey ? <p className="text-xs text-sf-muted">{styleTip(tipKey)}</p> : null}
      {style.override ? <p className="text-xs text-sf-muted">Observed: {style.computedStyle ? styleLabels[style.computedStyle] : 'not enough information'}</p> : null}
    </> : null}
    {prompt && visitId && !done ? <div className="flex flex-wrap items-center gap-x-2">
      {prompt ? <p className="text-sm text-sf-body">How did {contact.name} behave? (optional, 30 seconds)</p> : null}
      {rateButton}
      {prompt ? <button type="button" disabled={busy} className={contactActionClass} aria-label={`Skip rating ${who}`} onClick={() => { setDone(true); setRating(false); }}>Skip</button> : null}
    </div> : null}
    {!prompt && canSeeStyle && contact.styleObservations ? <div className="flex flex-wrap gap-x-2">
      <button type="button" className={contactActionClass} aria-label={`Ratings for ${who}`} aria-expanded={history} onClick={() => setHistory(value => !value)}>Ratings ({contact.styleObservations.length})</button>
      <button type="button" disabled={busy} className={contactActionClass} aria-label={`Override style for ${who}`} aria-expanded={overriding} onClick={event => { origin.current = event.currentTarget; setOverride(contact.style?.override?.style ?? ''); setReason(''); setOverriding(true); setRating(false); setError(''); }}>Override style</button>
    </div> : null}
    {!prompt && canSeeStyle && history ? <ul aria-label={`Ratings for ${who}`} className="space-y-1 text-xs text-sf-muted">{contact.styleObservations?.map((entry, index) => <li key={`${entry.recordedAt}-${index}`}>
      {accountDate(entry.recordedAt.slice(0, 10))} · {entry.observer} · A {(entry.a.reduce((sum, value) => sum + value, 0) / 4).toFixed(2)} · R {(entry.r.reduce((sum, value) => sum + value, 0) / 4).toFixed(2)}{entry.cues.length ? ` · ${entry.cues.map(cue => cueLabels[cue]).join(', ')}` : ''}
    </li>)}</ul> : null}
    {rating ? <form ref={form} aria-label={`Rate behaviour for ${who}`} className="min-w-0 space-y-3 border-t border-sf-line-soft py-3" onSubmit={event => { event.preventDefault(); void post({ action: 'record_style_observation', contactId: contact.id, visitId, a: ratings.slice(0, 4), r: ratings.slice(4), cues }); }}>
      {!prompt ? <p className="text-sm text-sf-body">How did {contact.name} behave? (optional, 30 seconds)</p> : null}
      <fieldset disabled={busy} className="min-w-0 space-y-3">
        {behaviours.map(([left, right], index) => <div key={left} className="min-w-0">
          {index === 0 || index === 4 ? <h4 className="text-xs font-semibold text-sf-muted">{index === 0 ? 'Pace and control' : 'Warmth and focus'}</h4> : null}
          <fieldset className="min-w-0"><legend className="sr-only">{left} → {right}</legend>
            <div className="grid min-w-0 grid-cols-2 items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
              <span aria-hidden="true" className="order-1 min-w-0 text-xs text-sf-muted">{left}</span>
              <div className="order-3 col-span-2 grid min-w-0 grid-cols-4 gap-1 sm:order-2 sm:col-span-1">{[1, 2, 3, 4].map(value => <input key={value} type="radio" required name={`${prefix}-${index}`} aria-label={`${value} of 4`} className="min-h-11 w-full min-w-0 cursor-pointer appearance-none rounded-lg border border-sf-line bg-sf-soft-0 checked:border-sf-brand checked:bg-sf-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-brand disabled:cursor-default disabled:opacity-50" value={value} checked={ratings[index] === value} onChange={() => setRatings(previous => previous.map((old, position) => position === index ? value : old))} />)}</div>
              <span aria-hidden="true" className="order-2 min-w-0 text-right text-xs text-sf-muted sm:order-3">{right}</span>
            </div>
          </fieldset>
        </div>)}
        <fieldset className="min-w-0" aria-label={`They asked for — ${who}`}><legend className="text-sm text-sf-body">They asked for</legend><div className="grid grid-cols-2 gap-x-3 gap-y-1">{styleCues.map(cue => <label key={cue} className="flex min-h-11 items-center gap-2 text-sm text-sf-body"><input type="checkbox" aria-label={`${cueLabels[cue]} for ${who}`} checked={cues.includes(cue)} onChange={event => setCues(previous => event.target.checked ? [...previous, cue] : previous.filter(value => value !== cue))} />{cueLabels[cue]}</label>)}</div></fieldset>
      </fieldset>
      <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy} className={primaryClass} aria-label={`Save rating for ${who}`}>Save</button><button type="button" disabled={busy} className={buttonClass} aria-label={`Cancel rating for ${who}`} onClick={cancel}>Cancel</button></div>
    </form> : null}
    {overriding ? <form ref={form} aria-label={`Override style for ${who}`} className="min-w-0 space-y-3" onSubmit={event => { event.preventDefault(); if (reason.trim().length < 3) { setError('Enter a reason with 3–300 characters.'); return; } void post({ action: 'set_style_override', contactId: contact.id, style: override || null, reason: reason.trim() }); }}>
      <fieldset disabled={busy} className="min-w-0 space-y-3">
        <div><label htmlFor={`${prefix}-style`} className="text-sm text-sf-body">Style</label><select id={`${prefix}-style`} aria-label={`Style for ${who}`} className={inputClass} value={override} onChange={event => setOverride(event.target.value as SocialStyle | '')}><option value="">None</option>{socialStyles.map(key => <option key={key} value={key}>{styleLabels[key]}</option>)}</select></div>
        <div><label htmlFor={`${prefix}-reason`} className="text-sm text-sf-body">Reason</label><input id={`${prefix}-reason`} aria-label={`Override reason for ${who}`} required minLength={3} maxLength={300} className={inputClass} value={reason} onChange={event => setReason(event.target.value)} /></div>
      </fieldset>
      <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy} className={primaryClass} aria-label={`Save override for ${who}`}>Save</button><button type="button" disabled={busy} className={buttonClass} aria-label={`Cancel override for ${who}`} onClick={cancel}>Cancel</button></div>
    </form> : null}
    {notice ? <p role="status" className="text-xs text-sf-muted">{notice}</p> : null}
    {error ? <p role="alert" className="text-sm text-sf-danger">{error}</p> : null}
  </div>;
}
export function assessmentSummary(contact: AppContact) {
  const value = contact.assessment;
  return value ? [value.decisionRole !== 'unknown' ? roleLabels[value.decisionRole] : null,
    value.stance !== 'unknown' ? stanceLabels[value.stance] : null,
    value.influence !== 'unknown' ? `${influenceLabels[value.influence]} influence` : null].filter(Boolean).join(' · ') || 'Role not set' : 'Role not set';
}
export function alertLabel(alert: PowerAlert) {
  return { no_decision_maker: 'No decision maker known', decision_maker_not_met: 'Decision maker not met in 60 days', influential_blocker: 'Influential blocker' }[alert];
}

export function accountDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
export function addAccountDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}
export function visitChip(row: AccountRow, today: string) {
  if (row.nextVisitOn) return row.nextVisitOn <= today
    ? { text: `Visit overdue · due ${accountDate(row.nextVisitOn)}`, className: 'bg-sf-warning-soft text-sf-warning' }
    : { text: `Next visit ${accountDate(row.nextVisitOn)}`, className: 'bg-sf-soft-2 text-sf-label' };
  return !row.lastVisit ? { text: 'Never visited', className: 'bg-sf-soft-0 text-sf-muted' } : null;
}
export function classChip(row: AccountRow) {
  const value = row.class;
  if (!value || !['A', 'B', 'below_b'].includes(value.state) || value.monthlyPaise === null || !/^-?\d+$/.test(value.monthlyPaise)) return null;
  const from = new Date(`${value.window?.from}T00:00:00Z`);
  const to = new Date(`${value.window?.to}T00:00:00Z`);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from.toISOString().slice(0, 10) !== value.window.from || to.toISOString().slice(0, 10) !== value.window.to || from > to) return null;
  const paise = BigInt(value.monthlyPaise);
  const zero = BigInt(0), ten = BigInt(10), lakhPaise = BigInt(10000000), thousandPaise = BigInt(100000);
  const magnitude = paise < zero ? -paise : paise;
  const divisor = magnitude >= lakhPaise ? lakhPaise : magnitude >= thousandPaise ? thousandPaise : BigInt(100);
  const suffix = divisor === lakhPaise ? ' L' : divisor === thousandPaise ? ' K' : '';
  // Round the display to one decimal with integer arithmetic; keep the source paise exact.
  const tenths = (magnitude * ten + divisor / BigInt(2)) / divisor;
  const formatted = `${paise < zero ? '-' : ''}${new Intl.NumberFormat('en-IN').format(tenths / ten)}${tenths % ten ? `.${tenths % ten}` : ''}${suffix}`;
  const month = (date: Date) => date.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }).replace(/^Sept$/, 'Sep');
  const title = `${value.state} · ₹${formatted} a month, ${month(from)}–${month(to)}`;
  return {
    text: value.state === 'below_b' ? 'Below B' : value.state, title,
    className: value.state === 'A' ? 'rounded-full bg-sf-brand px-2 py-1 font-semibold text-sf-soft-0' : value.state === 'B' ? 'rounded-full border border-sf-brand px-2 py-1 font-semibold text-sf-brand' : 'rounded-full bg-sf-soft-0 px-2 py-1 text-sf-muted',
  };
}
export function accountClassesNote(rows: AccountRow[]) {
  const value = rows.find(row => row.class?.state === 'not_available')?.class;
  if (!value) return null;
  const month = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }).replace(/^Sept$/, 'Sep');
  return `Account classes appear once full Tally sales for ${month(value.window.from)}–${month(value.window.to)} are imported.`;
}
export function accountMetaLine(row: AccountRow, mode: Mode) {
  return [row.city, row.owner?.territoryName, mode === 'all' ? row.owner?.email : null,
    row.lastVisit ? `Last visit ${accountDate(row.lastVisit.visitedOn)} · ${outcomes[row.lastVisit.outcome]}${row.lastVisit.metContacts?.length ? ` · with ${row.lastVisit.metContacts.slice(0, 2).map(contact => contact.name).join(', ')}${row.lastVisit.metContacts.length > 2 ? ` +${row.lastVisit.metContacts.length - 2}` : ''}` : ''}` : null,
    row.lastOrderOn ? `Last order ${accountDate(row.lastOrderOn)}` : null,
    row.class?.state === 'not_linked' ? 'Not linked to Tally sales' : null].filter(Boolean).join(' · ');
}
type ContactCallbacks = { busy?: boolean; onSaved?: (duplicatePhone: boolean) => Promise<unknown>; onConflict?: () => Promise<void>; onBusy?: (busy: boolean) => void };
type ContactActions = { renderActions?: (addContact: ReactNode) => ReactNode; canSeePowerMap?: boolean };
function AppContacts({ row, today, busy = false, onSaved, onConflict, onBusy, renderActions, canSeePowerMap = false }: { row: AccountRow; today: string } & ContactCallbacks & ContactActions) {
  const [contactsExpanded, setContactsExpanded] = useState(false);
  const contactsId = useId();
  const [editing, setEditing] = useState<AccountRow['appContacts'][number] | 'new' | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [assessing, setAssessing] = useState<string | null>(null);
  const [decisionRole, setDecisionRole] = useState<ContactAssessment['decisionRole']>('unknown');
  const [stance, setStance] = useState<ContactAssessment['stance']>('unknown');
  const [influence, setInfluence] = useState<ContactAssessment['influence']>('unknown');
  const [reason, setReason] = useState('');
  const [name, setName] = useState('');
  const [businessRole, setBusinessRole] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const prefix = useId();
  const form = useRef<HTMLFormElement>(null);
  const origin = useRef<HTMLButtonElement | null>(null);
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const inFlight = useRef(false);
  useEffect(() => { if (editing) form.current?.querySelector<HTMLInputElement>('input')?.focus(); }, [editing]);
  function open(contact: AccountRow['appContacts'][number] | 'new', button: HTMLButtonElement) {
    origin.current = button;
    setEditing(contact); setRemoving(null); setAssessing(null); setError('');
    setName(contact === 'new' ? '' : contact.name);
    setBusinessRole(contact === 'new' ? '' : contact.businessRole ?? '');
    setPhone(contact === 'new' ? '' : contact.phone ?? '');
    setEmail(contact === 'new' ? '' : contact.email ?? '');
  }
  function cancel() { setEditing(null); setRemoving(null); setAssessing(null); setError(''); origin.current?.focus(); }
  async function post(body: Record<string, unknown>) {
    if (inFlight.current || busy) return;
    inFlight.current = true; onBusy?.(true); setError('');
    const fingerprint = JSON.stringify(body);
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const response = await fetch('/api/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, idempotencyKey: pending.current.key }) });
      if (response.status === 409) { pending.current = null; setEditing(null); setRemoving(null); setAssessing(null); await onConflict?.(); return; }
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) pending.current = null;
      const result = await readJsonBody<{ error?: string; duplicatePhone?: boolean }>(response);
      if (!response.ok) {
        setError(result.error || 'Not saved. Please try again.'); return;
      }
      pending.current = null; setEditing(null); setRemoving(null); setAssessing(null);
      await onSaved?.(result.duplicatePhone === true);
    } catch { setError('Not saved. Check the connection and try again.'); }
    finally { inFlight.current = false; onBusy?.(false); }
  }
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    if (name.trim().length < 2) { setError('Enter a contact name with at least 2 characters.'); return; }
    void post({ ...(editing === 'new' ? { action: 'add_contact', customerId: row.id } : { action: 'update_contact', contactId: editing.id, expectedVersion: editing.version }), name: name.trim(), businessRole: businessRole.trim() || null, phone: phone.trim() || null, email: email.trim() || null });
  }
  const accountLabel = `${row.name} (${row.id})`;
  const contacts = row.appContacts ?? [];
  const moreCount = Math.max(0, contacts.length - 2);
  const addContact = <button type="button" disabled={busy} className={actionClass} aria-label={`Add contact for ${row.name}`} aria-expanded={editing === 'new'} onClick={event => open('new', event.currentTarget)}>Add contact</button>;
  return <>
    <div id={contactsId} className="space-y-2">
    {!contacts.length ? <p className="text-xs text-sf-muted">No contacts yet</p> : null}
    {(contactsExpanded ? contacts : contacts.slice(0, 2)).map(contact => <div key={contact.id} className="min-w-0">
      <p className="flex flex-wrap items-center gap-x-2 break-words text-sm text-sf-body"><span>{contact.name}{contact.businessRole ? ` · ${contact.businessRole}` : ''}</span>{contact.phone ? <a className="inline-flex min-h-11 items-center text-sf-brand" href={`tel:${contact.phone.replace(/\D/g, '')}`} aria-label={`Call ${contact.name} for ${accountLabel}`}>{contact.phone}</a> : null}
        {contact.email ? <a className="inline-flex min-h-11 max-w-full items-center break-all text-sf-brand" href={`mailto:${contact.email}`} aria-label={`Email ${contact.name} for ${accountLabel}`}>{contact.email}</a> : null}
      </p>
      {canSeePowerMap ? <p className="break-words text-xs text-sf-muted">{assessmentSummary(contact)} · {contact.lastMetOn ? `Last met ${accountDate(contact.lastMetOn)}` : 'Not met yet'}</p> : null}
      <ContactSocial key={`${contact.id}-${row.lastVisit?.id ?? 'unvisited'}`} attribution={<><span>added by {contact.addedBy}</span>{contact.canEdit ? <span className="inline-flex items-center whitespace-nowrap">{' · '}
          <button type="button" disabled={busy} className={contactActionClass} aria-label={`Edit ${contact.name}`} onClick={event => open(contact, event.currentTarget)}>Edit</button>
          {' · '}<button type="button" disabled={busy} className={contactActionClass} aria-label={`Remove ${contact.name}`} onClick={event => { origin.current = event.currentTarget; setRemoving(contact.id); setEditing(null); setAssessing(null); setError(''); }}>Remove</button>
        </span> : null}
        {canSeePowerMap ? <>{' · '}<button type="button" disabled={busy} className={contactActionClass} aria-label={`Set role for ${contact.name}`} aria-expanded={assessing === contact.id} onClick={event => {
          origin.current = event.currentTarget; setAssessing(contact.id); setEditing(null); setRemoving(null); setError('');
          setDecisionRole(contact.assessment?.decisionRole ?? 'unknown'); setStance(contact.assessment?.stance ?? 'unknown'); setInfluence(contact.assessment?.influence ?? 'unknown'); setReason(contact.assessment?.reason ?? '');
        }}>Set role</button></> : null}
      </>} contact={contact} canSeeStyle={row.canSeeStyle} busy={busy} onBusy={onBusy} onSaved={onSaved}
        visitId={row.lastVisit?.id && row.lastVisit.visitedOn >= addAccountDays(today, -30) && row.lastVisit.visitedOn <= today && row.lastVisit.metContacts.some(met => met.id === contact.id) ? row.lastVisit.id : undefined} />
      {canSeePowerMap && assessing === contact.id ? <form aria-label={`Set role for ${contact.name} at ${accountLabel}`} onSubmit={event => { event.preventDefault(); void post({ action: 'set_assessment', contactId: contact.id, decisionRole, stance, influence, reason: reason.trim() || null }); }} className="min-w-0 space-y-3 border-t border-sf-line-soft py-3">
        <fieldset disabled={busy} className="min-w-0 space-y-3">
          <div><label htmlFor={`${prefix}-decision`} className="text-sm text-sf-body">Decision role</label><select id={`${prefix}-decision`} aria-label={`Decision role for ${contact.name} at ${accountLabel}`} value={decisionRole} onChange={event => setDecisionRole(event.target.value as ContactAssessment['decisionRole'])} className={inputClass}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <div><label htmlFor={`${prefix}-stance`} className="text-sm text-sf-body">Stance</label><select id={`${prefix}-stance`} aria-label={`Stance for ${contact.name} at ${accountLabel}`} value={stance} onChange={event => setStance(event.target.value as ContactAssessment['stance'])} className={inputClass}>{Object.entries(stanceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <div><label htmlFor={`${prefix}-influence`} className="text-sm text-sf-body">Influence</label><select id={`${prefix}-influence`} aria-label={`Influence for ${contact.name} at ${accountLabel}`} value={influence} onChange={event => setInfluence(event.target.value as ContactAssessment['influence'])} className={inputClass}>{Object.entries(influenceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <div><label htmlFor={`${prefix}-reason`} className="text-sm text-sf-body">Reason</label><input id={`${prefix}-reason`} aria-label={`Reason for ${contact.name} at ${accountLabel}`} maxLength={300} placeholder="Business reason, e.g. chose competitor in tender" value={reason} onChange={event => setReason(event.target.value)} className={inputClass} /></div>
        </fieldset>
        <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy} className={primaryClass} aria-label={`Save role for ${contact.name} at ${accountLabel}`}>{busy ? 'Saving…' : 'Save'}</button><button type="button" disabled={busy} className={buttonClass} aria-label={`Cancel role for ${contact.name} at ${accountLabel}`} onClick={cancel}>Cancel</button></div>
      </form> : null}
      {contact.canEdit && removing === contact.id ? <p className="flex flex-wrap items-center gap-x-2 text-sm text-sf-body"><span>Remove {contact.name}?</span><button type="button" disabled={busy} className={contactActionClass} aria-label={`Confirm remove ${contact.name} for ${accountLabel}`} onClick={() => void post({ action: 'remove_contact', contactId: contact.id, expectedVersion: contact.version })}>Remove</button><button type="button" disabled={busy} className={contactActionClass} aria-label={`Keep ${contact.name} for ${accountLabel}`} onClick={cancel}>Keep</button></p> : null}
    </div>)}
    </div>
    {moreCount ? <button type="button" className="min-h-11 text-sm font-semibold text-sf-brand" aria-label={`${contactsExpanded ? 'Hide' : `${moreCount} more`} contacts for ${row.name}`} aria-expanded={contactsExpanded} aria-controls={contactsId} onClick={() => setContactsExpanded(value => !value)}>{contactsExpanded ? 'Hide' : `+${moreCount} more`}</button> : null}
    {renderActions ? renderActions(addContact) : <div className="mt-3 flex flex-wrap gap-2">{addContact}</div>}
    {editing ? <form ref={form} aria-label={`${editing === 'new' ? 'Add contact' : `Edit ${editing.name}`} for ${accountLabel}`} onSubmit={submit} className="space-y-3 border-t border-sf-line-soft pt-4">
      <fieldset disabled={busy} className="min-w-0 space-y-3">
        <div><label htmlFor={`${prefix}-name`} className="text-sm text-sf-body">Name</label><input id={`${prefix}-name`} aria-label={`Contact name for ${accountLabel}`} required minLength={2} maxLength={120} value={name} onChange={event => setName(event.target.value)} className={inputClass} /></div>
        <div><label htmlFor={`${prefix}-role`} className="text-sm text-sf-body">Role</label><input id={`${prefix}-role`} aria-label={`Contact role for ${accountLabel}`} maxLength={80} placeholder="e.g. Lab head, Purchase" value={businessRole} onChange={event => setBusinessRole(event.target.value)} className={inputClass} /></div>
        <div><label htmlFor={`${prefix}-phone`} className="text-sm text-sf-body">Phone</label><input id={`${prefix}-phone`} aria-label={`Contact phone for ${accountLabel}`} type="tel" maxLength={40} value={phone} onChange={event => setPhone(event.target.value)} className={inputClass} /></div>
        <div><label htmlFor={`${prefix}-email`} className="text-sm text-sf-body">Email</label><input id={`${prefix}-email`} aria-label={`Contact email for ${accountLabel}`} type="email" maxLength={160} value={email} onChange={event => setEmail(event.target.value)} className={inputClass} /></div>
      </fieldset>
      <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy} className={primaryClass} aria-label={`Save contact for ${accountLabel}`}>{busy ? 'Saving…' : 'Save'}</button><button type="button" disabled={busy} className={buttonClass} aria-label={`Cancel contact for ${accountLabel}`} onClick={cancel}>Cancel</button></div>
    </form> : null}
    {error ? <p role="alert" className="text-sm text-sf-danger">{error}</p> : null}
  </>;
}
export function AccountDetails({ row, mode, today, renderActions, canSeePowerMap = false, ...contactCallbacks }: { row: AccountRow; mode: Mode; today: string } & ContactCallbacks & ContactActions) {
  const chip = visitChip(row, today);
  const accountClass = classChip(row);
  return <>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h3 className="min-w-0 flex-1 break-words font-bold text-sf-strong">{row.name}</h3>
      {accountClass ? <span title={accountClass.title} aria-label={accountClass.title} className={`max-w-full shrink-0 text-xs ${accountClass.className}`}>{accountClass.text}</span> : null}
      {chip ? <span className={`max-w-full shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${chip.className}`}>{chip.text}</span> : null}
    </div>
    <p className="mt-2 break-words text-xs text-sf-muted">{accountMetaLine(row, mode)}</p>
    {canSeePowerMap && row.powerAlerts?.length ? <div className="mt-2 flex flex-wrap gap-2">{row.powerAlerts.map(alert => <span key={alert} className="max-w-full rounded-full bg-sf-warning-soft px-2 py-1 text-xs font-semibold text-sf-warning">{alertLabel(alert)}</span>)}</div> : null}
    <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-sf-body">{row.location?.precision === 'pin' ? <><span>📍 Pin set{!isInsideMarketArea(Number(row.location.latitude), Number(row.location.longitude)) ? <span className="text-sf-muted"> · outside market area</span> : null}</span><a className="inline-flex min-h-11 items-center font-semibold text-sf-brand" href={`https://www.google.com/maps?q=${row.location.latitude},${row.location.longitude}`} target="_blank" rel="noopener" aria-label={`Open map for ${row.name} (${row.id})`}>Open map</a></> : row.location?.precision === 'town' ? `Town: ${row.location.town}` : 'No location'}</p>
    <div className="mt-2">
      <AppContacts row={row} today={today} canSeePowerMap={canSeePowerMap} renderActions={renderActions} {...contactCallbacks} />
    </div>
  </>;
}

export function AccountsWorkspace() {
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [mode, setMode] = useState<Mode>('mine');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [owner, setOwner] = useState('');
  const [territory, setTerritory] = useState('');
  const [accountClass, setAccountClass] = useState('');
  const [powerAlert, setPowerAlert] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState<{ id: string; kind: FormKind } | null>(null);
  const [visitPrompts, setVisitPrompts] = useState<Record<string, { visitId: string; contacts: AppContact[] }>>({});
  const [busy, setBusy] = useState(false);
  const origin = useRef<HTMLButtonElement | null>(null);
  const request = useRef(0);
  const prefix = useId();
  const load = useCallback(async (signal?: AbortSignal) => {
    const current = ++request.current;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ scope: mode, page: String(page) });
      if (search) params.set('search', search);
      if (accountClass) params.set('class', accountClass);
      if (powerAlert) params.set('alert', powerAlert);
      if (mode === 'all') {
        if (owner) params.set('owner', owner);
        if (territory) params.set('territory', territory);
      }
      const response = await fetch(`/api/accounts?${params}`, { cache: 'no-store', signal });
      const body = await readJsonBody<AccountsResponse & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error || 'Accounts could not be loaded. Please try again.');
      if (current !== request.current || signal?.aborted) return null;
      const normalized = withAccountContacts(body);
      setData(normalized);
      return normalized;
    } catch (cause) {
      if (current === request.current && !signal?.aborted) setError(cause instanceof Error ? cause.message : 'Accounts could not be loaded. Please try again.');
      return null;
    } finally { if (current === request.current && !signal?.aborted) setLoading(false); }
  }, [mode, page, search, owner, territory, accountClass, powerAlert]);
  useEffect(() => {
    if (query === search) return;
    const timer = setTimeout(() => { setSearch(query); setPage(1); setOpen(null); }, 300);
    return () => clearTimeout(timer);
  }, [query, search]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [load]);
  function changeMode(next: Mode) { setMode(next); setPage(1); setOpen(null); }
  function cancel() { setOpen(null); origin.current?.focus(); }
  async function saved(keepOpen: boolean) {
    if (!keepOpen) setOpen(null);
    setNotice('Saved.');
    return load();
  }
  async function conflict() {
    setOpen(null);
    setNotice('Someone else changed this account. The list has been refreshed.');
    await load();
  }
  const from = data && data.accounts.length ? (data.page.page - 1) * data.page.pageSize + 1 : 0;
  const to = data ? Math.min(data.page.total, from ? from + data.accounts.length - 1 : 0) : 0;
  const classesNote = accountClassesNote(data?.accounts ?? []);
  return <div className="h-full overflow-y-auto bg-sf-page"><section aria-label="Accounts" className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
    <header className="flex items-baseline gap-3"><h2 className="text-xl font-bold text-sf-strong">Accounts</h2>{data ? <span className="text-xs text-sf-muted">{countLabel(data.page.total, 'account', 'accounts')} · {countLabel(data.accounts.filter(row => row.nextVisitOn && row.nextVisitOn <= data.today).length, 'visit due', 'visits due')} on this page</span> : null}</header>
    <div className="flex flex-wrap items-end gap-3">
      <div aria-label="Account scope" className="inline-flex rounded-xl border border-sf-line-soft bg-sf-soft-0 p-1">{(['mine', 'all'] as const).map(value => <button key={value} type="button" disabled={busy} aria-pressed={mode === value} onClick={() => changeMode(value)} className={`${buttonClass} ${mode === value ? 'bg-sf-brand text-sf-soft-0' : ''}`}>{value === 'mine' ? 'Mine' : 'All'}</button>)}</div>
      <div className="min-w-0 flex-1 basis-44"><label htmlFor={`${prefix}-search`} className="text-xs text-sf-muted">Search accounts</label><input id={`${prefix}-search`} value={query} disabled={busy} onChange={event => setQuery(event.target.value)} maxLength={120} placeholder="Name or town" className={inputClass} /></div>
      <div className="min-w-0 flex-1 basis-40"><label htmlFor={`${prefix}-class`} className="text-xs text-sf-muted">Class</label><select id={`${prefix}-class`} disabled={busy} value={accountClass} onChange={event => { setAccountClass(event.target.value); setPage(1); setOpen(null); }} className={inputClass}><option value="">Any</option><option value="A">A</option><option value="B">B</option><option value="below_b">Below B</option><option value="not_available">Not available</option><option value="not_linked">Not linked</option></select></div>
      {data?.canSeePowerMap ? <div className="min-w-0 flex-1 basis-40"><label htmlFor={prefix + '-power'} className="text-xs text-sf-muted">Power Map</label><select id={prefix + '-power'} disabled={busy} value={powerAlert} onChange={event => { setPowerAlert(event.target.value); setPage(1); setOpen(null); }} className={inputClass}><option value="">Any</option>{powerAlerts.map(alert => <option key={alert} value={alert}>{alert === 'decision_maker_not_met' ? 'Decision maker not met' : alertLabel(alert)}</option>)}</select></div> : null}
      {data?.canAssign && mode === 'all' ? <>
        <div className="min-w-0 flex-1 basis-40"><label htmlFor={`${prefix}-owner`} className="text-xs text-sf-muted">Owner</label><select id={`${prefix}-owner`} disabled={busy} value={owner} onChange={event => { setOwner(event.target.value); setPage(1); setOpen(null); }} className={inputClass}><option value="">Any</option>{data.owners.map(item => <option key={item.email} value={item.email}>{item.name || item.email}</option>)}</select></div>
        <div className="min-w-0 flex-1 basis-40"><label htmlFor={`${prefix}-territory`} className="text-xs text-sf-muted">Territory</label><select id={`${prefix}-territory`} disabled={busy} value={territory} onChange={event => { setTerritory(event.target.value); setPage(1); setOpen(null); }} className={inputClass}><option value="">Any</option>{data.territories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      </> : null}
    </div>
    {classesNote ? <p className="text-xs text-sf-muted">{classesNote}</p> : null}
    <output aria-live="polite" className="block text-sm text-sf-body">{notice}</output>
    {loading ? <p className="text-sm text-sf-muted">Loading accounts…</p> : null}
    {error ? <div role="alert" className="text-sm text-sf-danger"><p>{error}</p><button type="button" className={buttonClass} onClick={() => void load()}>Retry</button></div> : null}
    {data && !error ? <>
      {!loading && !data.accounts.length ? <div className="rounded-xl border border-sf-line-soft bg-sf-soft-0 p-4 text-sm text-sf-body"><p>{mode === 'mine' ? 'No accounts are assigned to you yet.' : 'No accounts match.'}</p>{mode === 'mine' ? <button type="button" className={`${buttonClass} mt-3`} onClick={() => changeMode('all')}>Show all accounts</button> : null}</div> : null}
      <ul aria-label="Accounts" className="space-y-3">{data.accounts.map(row => <li key={row.id} className="min-w-0 rounded-xl border border-sf-line-soft bg-sf-soft-0 p-4">
        <AccountDetails row={row} mode={mode} today={data.today} canSeePowerMap={data.canSeePowerMap} busy={busy} onBusy={setBusy} onConflict={conflict} onSaved={async duplicatePhone => { setNotice(duplicatePhone ? 'Saved. This phone is already on the account.' : 'Saved.'); await load(); }} renderActions={addContact => <div className="mt-3 flex flex-wrap gap-2">{(['visit', 'location'] as FormKind[]).map(kind => <button key={kind} type="button" disabled={busy} aria-label={`${kind === 'visit' ? 'Log visit' : 'Location'} for ${row.name} (${row.id})`} aria-expanded={open?.id === row.id && open.kind === kind} onClick={event => { origin.current = event.currentTarget; setNotice(''); setOpen({ id: row.id, kind }); }} className={kind === 'visit' ? primaryClass : actionClass}>{kind === 'visit' ? 'Log visit' : 'Location'}</button>)}{addContact}{data.canAssign ? <button type="button" disabled={busy} aria-label={`Owner for ${row.name} (${row.id})`} aria-expanded={open?.id === row.id && open.kind === 'owner'} onClick={event => { origin.current = event.currentTarget; setNotice(''); setOpen({ id: row.id, kind: 'owner' }); }} className={actionClass}>Owner</button> : null}</div>} />
        {open?.id === row.id ? <AccountForm key={`${row.id}-${open.kind}`} row={row} kind={open.kind} data={data} onCancel={cancel} onSaved={saved} onConflict={conflict} onBusy={setBusy} onVisitLogged={(visitId, contactIds) => setVisitPrompts(current => ({ ...current, [row.id]: { visitId, contacts: row.appContacts.filter(contact => contactIds.includes(contact.id)) } }))} /> : null}
        {visitPrompts[row.id]?.contacts.map(contact => <ContactSocial key={`${visitPrompts[row.id].visitId}-${contact.id}`} contact={contact} visitId={visitPrompts[row.id].visitId} prompt busy={busy} onBusy={setBusy} onSaved={async () => { await saved(false); }} />)}
      </li>)}</ul>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-sf-muted"><span>Showing {from}–{to} of {data.page.total}</span><div className="flex gap-2">
        {page > 1 ? <button type="button" disabled={loading || busy} className={buttonClass} onClick={() => { setPage(page - 1); setOpen(null); }}>Previous</button> : null}
        {page * data.page.pageSize < data.page.total ? <button type="button" disabled={loading || busy} className={buttonClass} onClick={() => { setPage(page + 1); setOpen(null); }}>Next</button> : null}
      </div></div>
    </> : null}
  </section></div>;
}

function AccountForm({ row, kind, data, onCancel, onSaved, onConflict, onBusy, onVisitLogged }: {
  row: AccountRow; kind: FormKind; data: AccountsResponse; onCancel: () => void;
  onSaved: (keepOpen: boolean) => Promise<AccountsResponse | null>; onConflict: () => Promise<void>; onBusy: (value: boolean) => void;
  onVisitLogged: (visitId: string, contactIds: string[]) => void;
}) {
  const prefix = useId();
  const form = useRef<HTMLFormElement>(null);
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [visitedOn, setVisitedOn] = useState(data.today);
  const [outcome, setOutcome] = useState<VisitOutcome>('met');
  const [metContactIds, setMetContactIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [nextVisitOn, setNextVisitOn] = useState('');
  const [precision, setPrecision] = useState<'pin' | 'town'>(row.location?.precision ?? 'pin');
  const [pin, setPin] = useState(row.location?.precision === 'pin' ? `${row.location.latitude}, ${row.location.longitude}` : '');
  const [town, setTown] = useState(row.location?.town ?? '');
  const [ownerEmail, setOwnerEmail] = useState(row.owner?.email ?? data.owners[0]?.email ?? '');
  const [territoryId, setTerritoryId] = useState(row.owner?.territoryId ?? data.territories[0]?.id ?? '');
  const [newTerritory, setNewTerritory] = useState('');
  const parsed = parseLocationInput(pin);
  useEffect(() => { form.current?.querySelector<HTMLElement>('input, select, textarea')?.focus(); }, []);
  async function post(body: Record<string, unknown>, keepOpen = false) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); onBusy(true); setError('');
    const fingerprint = JSON.stringify(body);
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const response = await fetch('/api/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, idempotencyKey: pending.current.key }) });
      if (response.status === 409) { pending.current = null; await onConflict(); return; }
      const result = await readJsonBody<{ error?: string; visitId?: string }>(response);
      if (!response.ok) {
        setError(result.error || 'Not saved. Please try again.');
        // A gateway failure can arrive after the database committed. Retrying
        // the same form must recover its stored result, not create another visit.
        if (response.status < 500 && response.status !== 408 && response.status !== 429) pending.current = null;
        return;
      }
      pending.current = null;
      if (body.action === 'log_visit' && result.visitId && metContactIds.length) onVisitLogged(result.visitId, metContactIds);
      const refreshed = await onSaved(keepOpen);
      if (keepOpen) {
        const created = refreshed?.territories.find(item => item.name === newTerritory.trim());
        if (created) setTerritoryId(created.id);
        setNewTerritory('');
      }
    } catch { setError('Not saved. Check the connection and try again.'); }
    finally { inFlight.current = false; setBusy(false); onBusy(false); }
  }
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (kind === 'visit') void post({ action: 'log_visit', customerId: row.id, visitedOn, outcome, ...(row.appContacts.length ? { metContactIds } : {}), ...(note.trim() ? { note: note.trim() } : {}), ...(nextVisitOn ? { nextVisitOn } : {}) });
    if (kind === 'location') {
      if (precision === 'pin' && !parsed.ok) { setError(pinError); return; }
      void post({ action: 'set_location', customerId: row.id, expectedVersion: row.location?.version ?? null,
        ...(precision === 'pin' && parsed.ok ? { precision, latitude: parsed.latitude, longitude: parsed.longitude, source: parsed.source } : { precision: 'town', town: town.trim(), source: 'town' }) });
    }
    if (kind === 'owner') void post({ action: 'assign_account', customerId: row.id, ownerEmail, territoryId, expectedVersion: row.owner?.version ?? null });
  }
  return <form ref={form} aria-label={kind === 'visit' ? 'Log visit' : kind === 'location' ? 'Account location' : 'Account owner'} onSubmit={submit} className="mt-4 space-y-3 border-t border-sf-line-soft pt-4">
    <fieldset disabled={busy} className="min-w-0 space-y-3">
      {kind === 'visit' ? <>
        <div className="block"><label htmlFor={`${prefix}-date`} className="text-sm text-sf-body">Date</label><input id={`${prefix}-date`} type="date" required value={visitedOn} min={addAccountDays(data.today, -30)} max={data.today} onChange={event => setVisitedOn(event.target.value)} className={inputClass} /></div>
        {row.appContacts.length ? <fieldset className="min-w-0"><legend className="text-sm text-sf-body">Who did you meet?</legend><div className="flex flex-wrap gap-x-4">{row.appContacts.map(contact => <label key={contact.id} className="flex min-h-11 min-w-0 items-center gap-2 break-words text-sm text-sf-body"><input type="checkbox" aria-label={`Met ${contact.name} for ${row.name} (${contact.id})`} checked={metContactIds.includes(contact.id)} onChange={event => setMetContactIds(ids => event.target.checked ? [...ids, contact.id] : ids.filter(id => id !== contact.id))} />{contact.name}{contact.businessRole ? ` · ${contact.businessRole}` : ''}</label>)}</div></fieldset> : null}
        <fieldset><legend className="text-sm text-sf-body">Outcome</legend><div className="flex flex-wrap gap-x-4">{(Object.entries(outcomes) as [VisitOutcome, string][]).map(([value, label]) => <label key={value} className="flex min-h-11 items-center gap-2 text-sm text-sf-body"><input type="radio" name={`${prefix}-outcome`} value={value} checked={outcome === value} onChange={() => setOutcome(value)} />{label}</label>)}</div></fieldset>
        <div className="block"><label htmlFor={`${prefix}-note`} className="text-sm text-sf-body">Note</label><textarea id={`${prefix}-note`} maxLength={500} value={note} onChange={event => setNote(event.target.value)} className={`${inputClass} py-2`} /></div>
        <div className="block"><label htmlFor={`${prefix}-next`} className="text-sm text-sf-body">Next visit</label><input id={`${prefix}-next`} type="date" min={visitedOn ? addAccountDays(visitedOn, 1) : undefined} value={nextVisitOn} onChange={event => setNextVisitOn(event.target.value)} className={inputClass} /></div>
        <div className="flex flex-wrap gap-2">{[7, 14, 30].map(days => <button key={days} type="button" disabled={!visitedOn} className={`${buttonClass} rounded-full`} onClick={() => setNextVisitOn(addAccountDays(visitedOn, days))}>+{days} days</button>)}</div>
      </> : null}
      {kind === 'location' ? <>
        <fieldset><legend className="text-sm text-sf-body">Location</legend><div className="flex gap-4">{(['pin', 'town'] as const).map(value => <label key={value} className="flex min-h-11 items-center gap-2 text-sm text-sf-body"><input type="radio" name={`${prefix}-precision`} checked={precision === value} onChange={() => { setPrecision(value); setError(''); }} />{value === 'pin' ? 'Pin' : 'Town'}</label>)}</div></fieldset>
        {precision === 'pin' ? <><div className="block"><label htmlFor={`${prefix}-pin`} className="text-sm text-sf-body">Google Maps link or lat, long</label><input id={`${prefix}-pin`} value={pin} onChange={event => { setPin(event.target.value); setError(''); }} className={inputClass} /></div>{parsed.ok ? <><p className="text-sm text-sf-muted">{parsed.latitude}, {parsed.longitude}</p>{!isInsideMarketArea(Number(parsed.latitude), Number(parsed.longitude)) ? <p className="text-sm text-sf-warning">This pin is outside the five-district market area ({MARKET_AREA.name}). Check the link before saving.</p> : null}</> : pin ? <p className="text-sm text-sf-danger">{pinError}</p> : null}</> : <div className="block"><label htmlFor={`${prefix}-town`} className="text-sm text-sf-body">Town</label><input id={`${prefix}-town`} required minLength={2} maxLength={80} value={town} onChange={event => setTown(event.target.value)} className={inputClass} /></div>}
      </> : null}
      {kind === 'owner' ? <>
        <div className="block"><label htmlFor={`${prefix}-owner`} className="text-sm text-sf-body">Owner</label><select id={`${prefix}-owner`} required value={ownerEmail} onChange={event => setOwnerEmail(event.target.value)} className={inputClass}><option value="">Select owner</option>{data.owners.map(item => <option key={item.email} value={item.email}>{item.name || item.email}</option>)}</select></div>
        <div className="block"><label htmlFor={`${prefix}-territory`} className="text-sm text-sf-body">Territory</label><select id={`${prefix}-territory`} required value={territoryId} onChange={event => setTerritoryId(event.target.value)} className={inputClass}><option value="">Select territory</option>{data.territories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="flex flex-wrap items-end gap-2"><div className="min-w-0 flex-1 basis-40"><label htmlFor={`${prefix}-new`} className="text-xs text-sf-muted">New territory</label><input id={`${prefix}-new`} maxLength={80} value={newTerritory} onChange={event => setNewTerritory(event.target.value)} className={inputClass} /></div><button type="button" disabled={newTerritory.trim().length < 2} className={buttonClass} onClick={() => void post({ action: 'create_territory', name: newTerritory.trim() }, true)}>New territory</button></div>
      </> : null}
    </fieldset>
    {error ? <p role="alert" className="text-sm text-sf-danger">{error}</p> : null}
    <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy} className={primaryClass}>{busy ? 'Saving…' : 'Save'}</button><button type="button" disabled={busy} className={buttonClass} onClick={onCancel}>Cancel</button></div>
  </form>;
}
