'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { buildGrowthDecision, growthActionLabels, growthInboxFilters, growthReasonLabels, growthReasonLine, inboxDate, inboxRupees, inboxStake, normalizeGrowthDecision, normalizeGrowthInboxResponse, ruleLever, ruleTitle, type GrowthActionType, type GrowthCard, type GrowthDoneRow, type GrowthInboxResponse as InboxData, type GrowthInboxFilter } from '@/lib/growth-inbox-types';
import type { GrowthNavigation } from './growth-drilldown';

const button = 'min-h-9 rounded-lg border border-sf-line px-3 text-xs text-sf-brand disabled:opacity-50';
const field = 'min-h-9 w-full min-w-0 rounded-lg border border-sf-line bg-white p-2 text-sm';
const muted = 'text-xs text-sf-muted';
const responseMessage = (value: unknown) => value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : 'Could not save. Try again.';
type Mode = 'accept' | 'snooze' | 'reject';
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function futureDate(days: number) { const d = new Date(); d.setDate(d.getDate() + days); return localDate(d); }

function DecisionForm({ mode, card, owners, email, runMonth, onCancel, onSuccess, onConflict, announce }: { mode: Mode; card: GrowthCard; owners: InboxData['owners']; email?: string; runMonth: string; onCancel: () => void; onSuccess: (payload: Record<string, unknown>) => void; onConflict: (message: string) => void; announce: (message: string) => void }) {
  const form = useRef<HTMLFormElement>(null);
  const id = useId();
  const [requestId] = useState(() => crypto.randomUUID());
  const [owner, setOwner] = useState(owners.find(o => o.email === email)?.email ?? owners[0]?.email ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const name = card.customerId ? card.name ?? 'Lab not named' : 'Tally ledger not linked';
  useEffect(() => { form.current?.querySelector<HTMLElement>('select, input, textarea')?.focus(); }, []);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    const note = String(values.get('note') ?? '').trim();
    const payload = buildGrowthDecision({ requestId, cardKey: card.cardKey, decision: mode,
      ...(mode === 'accept' ? { actionType: values.get('actionType'), ownerEmail: owner, dueOn: values.get('dueOn'), detail: String(values.get('detail') ?? '').trim() }
        : mode === 'snooze' ? { until: values.get('until'), ...(values.get('category') ? { category: values.get('category') } : {}), ...(note ? { note } : {}) }
        : { category: values.get('category'), ...(note ? { note } : {}) }) });
    if (!payload) { setError('Check the fields and try again.'); return; }
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/growth/inbox', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await response.json();
      if (response.status === 409 || (response.status === 400 && responseMessage(json) === 'Card is no longer current')) { onConflict(responseMessage(json)); return; }
      const result = normalizeGrowthDecision(json);
      if (!response.ok || !result || result.cardKey !== card.cardKey || result.decision !== mode) throw new Error();
      onSuccess({ ...payload, ...(result.decision === 'snooze' ? { snoozeUntil: result.snoozeUntil } : {}) }); announce(`${name}: ${mode === 'accept' ? 'Already in progress' : mode === 'snooze' ? 'Snoozed' : 'Rejected'}.`);
    } catch { setError('Could not save. Try again with this form.'); }
    finally { setBusy(false); }
  };
  return <form ref={form} onSubmit={submit} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); onCancel(); } }} className="mt-3 grid min-w-0 gap-3 rounded-lg border border-sf-line-soft bg-sf-soft-0 p-3 text-xs">
    {mode === 'accept' ? <>
      <label htmlFor={`${id}-action`}>Action</label><select id={`${id}-action`} name="actionType" className={field} defaultValue="visit">{Object.entries(growthActionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <label htmlFor={`${id}-owner`}>Owner</label><select id={`${id}-owner`} name="ownerEmail" className={field} value={owner} onChange={event => setOwner(event.target.value)} required>{owners.map(o => <option key={o.email} value={o.email}>{o.email === email ? 'You' : o.email}</option>)}</select>
      <label htmlFor={`${id}-due`}>Due date</label><input id={`${id}-due`} name="dueOn" type="date" className={field} defaultValue={futureDate(7)} required />
      <label htmlFor={`${id}-detail`}>Note to owner</label><textarea id={`${id}-detail`} className={field} name="detail" rows={3} minLength={3} maxLength={500} required defaultValue={growthReasonLine(card, runMonth)} />
      <p className={muted}>Creates a visit in {owner}&apos;s My actions. Only the sales figures above are shared with the owner.</p>
    </> : <>
      {mode === 'snooze' && <><label htmlFor={`${id}-until`}>Snooze for</label><select id={`${id}-until`} className={field} name="until"><option value="2w">2 weeks</option><option value="1m">1 month</option><option value="next_run">Next month&apos;s run</option></select></>}
      <label htmlFor={`${id}-category`}>{mode === 'snooze' ? 'Reason (optional)' : 'Reason'}</label><select id={`${id}-category`} className={field} name="category" defaultValue="" required={mode === 'reject'}><option value="">Choose a reason</option>{Object.entries(growthReasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <label htmlFor={`${id}-note`}>Note</label><textarea id={`${id}-note`} className={field} name="note" rows={2} maxLength={500} />
    </>}
    {error && <p role="alert">{error}</p>}
    <div className="flex gap-2"><button disabled={busy} className={button} aria-label={`${mode === 'accept' ? 'Create action' : mode === 'snooze' ? 'Snooze' : 'Reject'}: ${name}`}>{busy ? 'Saving…' : mode === 'accept' ? 'Create action' : mode === 'snooze' ? 'Snooze' : 'Reject'}</button><button type="button" disabled={busy} className={button} onClick={onCancel} aria-label={`Cancel: ${name}`}>Cancel</button></div>
  </form>;
}

function InboxCard({ card, data, email, navigation, refreshCounts, refresh, announce }: { card: GrowthCard; data: InboxData; email?: string; navigation: Pick<GrowthNavigation, 'onOpenCustomer' | 'onLinkLedger'>; refreshCounts: () => void; refresh: (message?: string) => void; announce: (s: string) => void }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [why, setWhy] = useState(false);
  const [decided, setDecided] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [undoBusy, setUndoBusy] = useState(false);
  const undoRequest = useRef<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const article = useRef<HTMLElement>(null);
  const name = card.customerId ? card.name ?? 'Lab not named' : 'Tally ledger not linked';
  const reason = growthReasonLine(card, data.runMonth);
  const close = () => { setMode(null); requestAnimationFrame(() => opener.current?.focus()); };
  const open = (m: Mode, target: HTMLButtonElement) => { opener.current = target; setMode(m); setError(''); };
  const undo = async () => {
    if (undoBusy) return;
    undoRequest.current ??= crypto.randomUUID();
    setUndoBusy(true); setError('');
    try {
      const response = await fetch('/api/growth/inbox', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: undoRequest.current, cardKey: card.cardKey, decision: 'undo' }) });
      const json = await response.json();
      if (response.status === 409 || (response.status === 400 && responseMessage(json) === 'Card is no longer current')) { setError(responseMessage(json)); refresh(responseMessage(json)); return; }
      const result = normalizeGrowthDecision(json);
      if (!response.ok || !result || result.cardKey !== card.cardKey || result.decision !== 'undo') throw new Error();
      setDecided(null); undoRequest.current = null; refreshCounts(); announce(`${name}: restored to review.`);
      requestAnimationFrame(() => article.current?.querySelector<HTMLButtonElement>('button')?.focus());
    } catch { setError('Could not undo. Try Undo again.'); }
    finally { setUndoBusy(false); }
  };
  const progress = decided?.decision === 'accept' ? { actionType: decided.actionType as GrowthActionType, ownerEmail: String(decided.ownerEmail), dueOn: String(decided.dueOn) } : card.action;
  return <article ref={article} aria-label={name} className="min-w-0 space-y-2 border-b border-sf-line-soft py-4 text-sm [overflow-wrap:anywhere]">
    <p><strong>{name}</strong>{card.town && <span className="text-sf-muted"> · {card.town}</span>}</p>
    <p className="text-xs leading-relaxed"><span className="rounded bg-sf-soft-0 px-1.5 py-1 font-bold">{ruleTitle[card.rule]} · {ruleLever[card.rule]}</span> <span>{reason}</span></p>
    <p className={muted}>{inboxRupees(card.stakePaise)} a month at stake{!card.lastReason && <> · <span className="text-sf-warning">no reason recorded</span></>}</p>
    {card.lastReason && <p className={muted}>Last reason: {growthReasonLabels[card.lastReason.category]} ({card.lastReason.source === 'lab_said' ? 'lab said' : 'our view'}), {inboxDate(card.lastReason.on)}</p>}
    {!card.customerId && <p className={muted}>Link it to a customer to create an action</p>}
    {progress ? <div className="space-y-1 text-xs"><p><strong>Already in progress</strong> · {growthActionLabels[progress.actionType]} · {progress.ownerEmail} · due {inboxDate(progress.dueOn)}</p>{card.customerId && <button className={button} aria-label={`View action: ${name}`} onClick={() => navigation.onOpenCustomer(card.customerId!)}>View action</button>}</div>
      : decided ? <div className="text-xs"><p>{decided.decision === 'snooze' ? `Snoozed until ${inboxDate(String(decided.snoozeUntil))}` : `Rejected · ${growthReasonLabels[decided.category as keyof typeof growthReasonLabels]}`}</p><button className={button} disabled={undoBusy} onClick={undo} aria-label={`Undo: ${name}`}>Undo</button></div>
        : <div className="flex items-center gap-1.5"><button className={button} disabled={mode !== null} aria-label={`${card.customerId ? 'Accept' : 'Link'}: ${name}`} onClick={event => card.customerId ? open('accept', event.currentTarget) : navigation.onLinkLedger()}>{card.customerId ? 'Accept' : 'Link'}</button><button className={button} disabled={mode !== null} aria-label={`Snooze: ${name}`} onClick={event => open('snooze', event.currentTarget)}>Snooze</button><button className={button} disabled={mode !== null} aria-label={`Reject: ${name}`} onClick={event => open('reject', event.currentTarget)}>Reject</button><button className="min-h-9 min-w-0 text-xs text-sf-brand underline" aria-label={`Why this card: ${name}`} aria-expanded={why} onClick={() => setWhy(v => !v)}>Why this card</button></div>}
    {(progress || decided) && <button className="min-h-9 min-w-0 text-xs text-sf-brand underline" aria-label={`Why this card: ${name}`} aria-expanded={why} onClick={() => setWhy(v => !v)}>Why this card</button>}
    {why && <div className="space-y-1 rounded-lg bg-sf-soft-0 p-3 text-xs"><p><strong>Rule {card.rule} v{card.ruleVersion}</strong></p><p>{reason}.</p><p>{card.rule === 'R3' ? 'Monthly loss' : 'Typical month'}: {inboxRupees(Number(card.inputs.typicalPaise ?? (card.rule === 'R4' ? card.inputs.firstPaise : card.stakePaise)))} (repeat purchases only; instrument and bulk invoices excluded).</p>{card.alsoMatches.length > 0 && <p>Also matches: {card.alsoMatches.map(r => ruleTitle[r]).join(', ')}</p>}</div>}
    {mode && <DecisionForm mode={mode} card={card} owners={data.owners} email={email} runMonth={data.runMonth} onCancel={close} onSuccess={payload => { setDecided(payload); setMode(null); refreshCounts(); requestAnimationFrame(() => article.current?.querySelector<HTMLButtonElement>('button')?.focus()); }} onConflict={message => { setError(message); setMode(null); refresh(message); }} announce={announce} />}
    {error && <p role="alert" className="text-xs">{error}</p>}
  </article>;
}

function DoneRow({ row }: { row: GrowthDoneRow }) {
  const o = row.outcome;
  return <article className="space-y-1 border-b border-sf-line-soft py-4 text-xs"><strong className="text-sm">{row.customerId ? row.name ?? 'Lab not named' : 'Tally ledger not linked'}</strong>{row.town && <> · {row.town}</>}<p>{ruleTitle[row.rule]}</p><p>{growthActionLabels[row.action.actionType]} · {row.action.result} {inboxDate(row.action.closedOn)} · note: {row.action.note}</p><p>{o.status === 'bought' ? `Bought again ${inboxDate(o.on!)} (${inboxRupees(o.valuePaise!)})` : o.status === 'not_bought' ? 'Not bought in 30 days' : `Waiting · ${o.daysLeft} days left`}</p></article>;
}

export function GrowthInbox({ onOpenCustomer, onLinkLedger }: Pick<GrowthNavigation, 'onOpenCustomer' | 'onLinkLedger'>) {
  const [data, setData] = useState<InboxData | null>(null);
  const [filter, setFilter] = useState<GrowthInboxFilter>('all');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [live, setLive] = useState('');
  const generation = useRef(0);
  const summaryRevision = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    setLoading(true); setError('');
    void fetch(`/api/growth/inbox?filter=${filter}&page=${page}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const result = normalizeGrowthInboxResponse(await response.json());
      if (!result || result.filter !== filter || result.page !== page) throw new Error();
      if (!controller.signal.aborted && generation.current === current) setData(previous => ({ ...result, rows: page === 1 ? result.rows : [...(previous?.rows ?? []), ...result.rows.filter(row => !previous?.rows.some(p => p.cardKey === row.cardKey))] }));
    }).catch(() => { if (!controller.signal.aborted) setError('Could not load the action inbox. Try again.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filter, page, revision]);
  const refresh = (message?: string) => { if (message) setLive(message); setPage(1); setRevision(v => v + 1); };
  // Refresh summary only after decisions, retaining the local card and its Undo.
  const refreshCounts = async () => {
    const current = generation.current;
    const summary = ++summaryRevision.current;
    try {
      const response = await fetch(`/api/growth/inbox?filter=${filter}&page=1`, { cache: 'no-store' });
      const result = response.ok ? normalizeGrowthInboxResponse(await response.json()) : null;
      if (result && result.filter === filter && current === generation.current && summary === summaryRevision.current) setData(previous => previous ? { ...previous, counts: result.counts, stakeToReviewPaise: result.stakeToReviewPaise } : previous);
    } catch { setLive('Saved. Counts will update on the next refresh.'); }
  };
  return <section aria-labelledby="growth-inbox-title" className="min-w-0 space-y-3 rounded-xl border border-sf-line-soft bg-white p-4 lg:p-5 [overflow-wrap:anywhere]">
    <h2 id="growth-inbox-title" className="text-base font-bold">Action inbox</h2>
    {data && <><p className={muted}>Rules run on sales to {inboxDate(data.salesTo)} · reviewed weekly</p>{!data.confirmed && <p className={muted}>Sales not confirmed against Tally: {data.confirmedReason ?? 'Unknown'}</p>}<p className="text-sm"><strong>{data.counts.toReview} to review</strong> · {inboxStake(data.stakeToReviewPaise)} a month at stake · {data.counts.inProgress} in progress</p><div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter action inbox">{growthInboxFilters.map(f => <button key={f} className={button} aria-pressed={filter === f} onClick={() => { if (filter !== f) { setData(null); setFilter(f); setPage(1); } }}>{f === 'done' ? 'Done & outcomes' : `${{ all: 'All', R1: 'Skipped', R2: 'Stopped', R3: 'Falling', R4: 'New, not back' }[f]} ${data.counts[f]}`}</button>)}</div>
      <div>{data.rows.map(row => 'outcome' in row ? <DoneRow key={row.cardKey} row={row} /> : <InboxCard key={row.cardKey} card={row} data={data} email={data.viewerEmail} navigation={{ onOpenCustomer, onLinkLedger }} refreshCounts={() => { void refreshCounts(); }} refresh={refresh} announce={setLive} />)}</div>
      {filter === 'done' && <p className={muted}>Outcomes are what happened afterwards, not proof the visit caused it.</p>}
      {!loading && data.rows.length === 0 && <p className={muted}>No cards in this view.</p>}
      <p className={muted}>Showing {data.rows.length} of {data.total}{data.rows.length < data.total && <> · <button className={button} disabled={loading || !!error} onClick={() => setPage(n => n + 1)}>Load more</button></>}</p>
    </>}
    {loading && <div role="status" className="animate-pulse rounded-lg bg-sf-soft-0 p-4 text-xs">Loading action inbox…</div>}
    {error && <p role="alert" className="text-xs">{error} <button className={button} onClick={() => setRevision(n => n + 1)}>Retry</button></p>}
    <p className={muted}>₹ at stake: Skipped, Stopped and New, not back use average repeat spend per buying month; Falling uses (first-half repeat − second-half repeat) ÷ 6. Instrument and bulk invoices excluded.</p>
    <p className={muted}>Not yet: Deepen (cross-sell) cards need items mapped to principals in Brand setup; call logging comes later.</p>
    <p aria-live="polite" className="text-xs">{live}</p>
  </section>;
}
