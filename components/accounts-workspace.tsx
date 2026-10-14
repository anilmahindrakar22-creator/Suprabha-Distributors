'use client';

import { useCallback, useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import { isInsideMarketArea, MARKET_AREA, parseLocationInput, withAccountContacts, type AccountRow, type AccountsResponse, type VisitOutcome } from '@/lib/account-types';
import { readJsonBody } from '@/lib/http-json';

type Mode = 'mine' | 'all';
type FormKind = 'visit' | 'location' | 'owner';
const inputClass = 'min-h-11 w-full min-w-0 max-w-full rounded-xl border border-sf-line bg-sf-soft-0 px-3 text-sm text-sf-body outline-none focus:border-sf-mint';
const buttonClass = 'min-h-11 rounded-xl border border-sf-line px-3 text-sm font-bold text-sf-body disabled:opacity-50';
const primaryClass = 'min-h-11 rounded-xl bg-sf-ink-hover px-4 text-sm font-bold text-sf-soft disabled:opacity-50';
const outcomes: Record<VisitOutcome, string> = { met: 'Met', not_available: 'Not available', order_taken: 'Order taken', issue_raised: 'Issue raised', other: 'Other' };
const pinError = 'Paste a Google Maps link or two numbers like 18.52, 73.85';

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
    row.lastVisit ? `Last visit ${accountDate(row.lastVisit.visitedOn)} · ${outcomes[row.lastVisit.outcome]}` : null,
    row.lastOrderOn ? `Last order ${accountDate(row.lastOrderOn)}` : null,
    row.class?.state === 'not_linked' ? 'Not linked to Tally sales' : null].filter(Boolean).join(' · ');
}
export function contactSummary(row: Pick<AccountRow, 'contacts'>) {
  const contacts = row.contacts ?? [];
  return { first: contacts[0] ?? null, rest: contacts.slice(1) };
}
function ContactLine({ contact }: { contact: AccountRow['contacts'][number] }) {
  return <p className="flex flex-wrap items-center gap-2 break-words text-sm text-sf-body"><span>{contact.name}</span>
    {contact.phone ? <a className="inline-flex min-h-11 items-center text-sf-brand" href={`tel:${contact.phone.replace(/\D/g, '')}`} aria-label={`Call ${contact.name}`}>{contact.phone}</a> : null}
    {contact.email ? <a className="inline-flex min-h-11 max-w-full items-center break-all text-sf-brand" href={`mailto:${contact.email}`} aria-label={`Email ${contact.name}`}>{contact.email}</a> : null}
  </p>;
}
export function AccountDetails({ row, mode, today }: { row: AccountRow; mode: Mode; today: string }) {
  const [contactsExpanded, setContactsExpanded] = useState(false);
  const contactsId = useId();
  const { first, rest } = contactSummary(row);
  const chip = visitChip(row, today);
  const accountClass = classChip(row);
  return <>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h3 className="min-w-0 flex-1 break-words font-bold text-sf-strong">{row.name}</h3>
      {accountClass ? <span title={accountClass.title} aria-label={accountClass.title} className={`max-w-full shrink-0 text-xs ${accountClass.className}`}>{accountClass.text}</span> : null}
      {chip ? <span className={`max-w-full shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${chip.className}`}>{chip.text}</span> : null}
    </div>
    <p className="mt-2 break-words text-xs text-sf-muted">{accountMetaLine(row, mode)}</p>
    <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-sf-body">{row.location?.precision === 'pin' ? <><span>📍 Pin set{!isInsideMarketArea(Number(row.location.latitude), Number(row.location.longitude)) ? <span className="text-sf-muted"> · outside market area</span> : null}</span><a className="inline-flex min-h-11 items-center font-semibold text-sf-brand" href={`https://www.google.com/maps?q=${row.location.latitude},${row.location.longitude}`} target="_blank" rel="noopener">Open map</a></> : row.location?.precision === 'town' ? `Town: ${row.location.town}` : 'No location'}</p>
    <div className="mt-2">
      {first ? <ContactLine contact={first} /> : <p className="text-xs text-sf-muted">No contact in Tally</p>}
      {rest.length ? <button type="button" className="min-h-11 text-sm font-semibold text-sf-brand" aria-label={`${contactsExpanded ? 'Hide' : `+${rest.length} more`} contacts for ${row.name} (${row.id})`} aria-expanded={contactsExpanded} aria-controls={contactsId} onClick={() => setContactsExpanded(value => !value)}>{contactsExpanded ? 'Hide' : `+${rest.length} more`}</button> : null}
      {contactsExpanded ? <div id={contactsId}>{rest.map((contact, index) => <ContactLine key={index} contact={contact} />)}<p className="mt-2 text-xs text-sf-muted">Contacts come from Tally. Update contacts in Tally.</p></div> : null}
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
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState<{ id: string; kind: FormKind } | null>(null);
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
  }, [mode, page, search, owner, territory, accountClass]);
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
        <AccountDetails row={row} mode={mode} today={data.today} />
        <div className="mt-3 flex flex-wrap gap-2">{(['visit', 'location', ...(data.canAssign ? ['owner' as const] : [])] as FormKind[]).map(kind => <button key={kind} type="button" disabled={busy} aria-expanded={open?.id === row.id && open.kind === kind} onClick={event => { origin.current = event.currentTarget; setNotice(''); setOpen({ id: row.id, kind }); }} className={kind === 'visit' ? primaryClass : 'min-h-11 rounded-xl px-3 text-sm font-bold text-sf-brand disabled:opacity-50'}>{kind === 'visit' ? 'Log visit' : kind === 'location' ? 'Location' : 'Owner'}</button>)}</div>
        {open?.id === row.id ? <AccountForm key={`${row.id}-${open.kind}`} row={row} kind={open.kind} data={data} onCancel={cancel} onSaved={saved} onConflict={conflict} onBusy={setBusy} /> : null}
      </li>)}</ul>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-sf-muted"><span>Showing {from}–{to} of {data.page.total}</span><div className="flex gap-2">
        {page > 1 ? <button type="button" disabled={loading || busy} className={buttonClass} onClick={() => { setPage(page - 1); setOpen(null); }}>Previous</button> : null}
        {page * data.page.pageSize < data.page.total ? <button type="button" disabled={loading || busy} className={buttonClass} onClick={() => { setPage(page + 1); setOpen(null); }}>Next</button> : null}
      </div></div>
    </> : null}
  </section></div>;
}

function AccountForm({ row, kind, data, onCancel, onSaved, onConflict, onBusy }: {
  row: AccountRow; kind: FormKind; data: AccountsResponse; onCancel: () => void;
  onSaved: (keepOpen: boolean) => Promise<AccountsResponse | null>; onConflict: () => Promise<void>; onBusy: (value: boolean) => void;
}) {
  const prefix = useId();
  const form = useRef<HTMLFormElement>(null);
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [visitedOn, setVisitedOn] = useState(data.today);
  const [outcome, setOutcome] = useState<VisitOutcome>('met');
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
      const result = await readJsonBody<{ error?: string }>(response);
      if (!response.ok) {
        setError(result.error || 'Not saved. Please try again.');
        // A gateway failure can arrive after the database committed. Retrying
        // the same form must recover its stored result, not create another visit.
        if (response.status < 500 && response.status !== 408 && response.status !== 429) pending.current = null;
        return;
      }
      pending.current = null;
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
    if (kind === 'visit') void post({ action: 'log_visit', customerId: row.id, visitedOn, outcome, ...(note.trim() ? { note: note.trim() } : {}), ...(nextVisitOn ? { nextVisitOn } : {}) });
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
