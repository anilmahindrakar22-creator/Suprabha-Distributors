'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Crown, MapPin, MapPinCheck, Phone, User, Wallet, ClipboardList, Microscope, Lock } from 'lucide-react';
import { MeterBar, StatusChip, ToneIcon } from '@/components/ui/glance';
import { constraintIcons } from '@/lib/glance-icons';
import { orderStageStyle } from '@/components/order-list';
import { isInsideMarketArea, MARKET_AREA } from '@/lib/account-types';
import { formatPaise } from '@/lib/wallet-format';
import { checkinMessage, parseCheckinResult, parseSheetCheckin } from '@/lib/checkin';
import type { CheckinResult, VisitCheckin } from '@/lib/account-types';
import { customerMapDayDifference, formatActionDue, formatCustomerDate, formatLastVisit, parseCustomerSheet, readCustomerMap, type CustomerSheetData, type SheetOrder } from '@/lib/customer-map';

const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-sf-line px-3 text-xs font-bold text-sf-ink disabled:opacity-50';
const input = 'min-h-11 w-full rounded-xl border border-sf-line bg-sf-soft-0 px-3 text-base';
const actionButton = `${button} min-w-0 flex-1 flex-col gap-0.5 px-1 py-1 whitespace-nowrap`;
function Section({ title, children }: { title: string; children: ReactNode }) { return <section aria-label={title} className="space-y-2"><h4 className="text-xs text-sf-muted">{title}</h4>{children}</section>; }
function Tile({ label, value, danger }: { label: string; value: ReactNode; danger?: boolean }) { return <div className="min-w-0 rounded-xl bg-sf-soft-0 p-3"><p className={`break-words text-base tabular-nums ${danger ? 'text-sf-danger' : ''}`}>{value}</p><p className="text-xs text-sf-muted">{label}</p></div>; }
export type MapPlacement = { name: string; location: CustomerSheetData['location']; save: (lat: number, lng: number) => Promise<string | null> };
export type CustomerSheetProps = { customerId: string; financial: boolean; onClose: () => void; onOpenOrder?: (order: { orderId: string; orderNumber: string }) => void; onPlan: (id: string) => void; onOrder?: (id: string) => void; onContacts: (id: string, name: string) => void; onLocationSaved: () => void; placing?: boolean; onPlaceOnMap?: (placement: MapPlacement) => void };

export function CustomerSheet({ customerId, financial, onClose, onOpenOrder, onPlan, onOrder, onContacts, onLocationSaved, placing = false, onPlaceOnMap }: CustomerSheetProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<CustomerSheetData | null>(null);
  const [lastCheckin, setLastCheckin] = useState<VisitCheckin | null>(null);
  type Reading = { lat: number; lng: number; accuracy: number };
  const [checkin, setCheckin] = useState<{ result: CheckinResult; reading: Reading } | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkinNotice, setCheckinNotice] = useState('');
  const checkinPending = useRef<{ requestId: string; reading: Reading } | null>(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [manual, setManual] = useState(false); const [pinText, setPinText] = useState('');
  const [pinChooser, setPinChooser] = useState(false);
  const manualInput = useRef<HTMLInputElement>(null);
  const [moving, setMoving] = useState(false); const [completing, setCompleting] = useState(false);
  const [revision, setRevision] = useState(0);
  const pending = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);
  const flight = useRef(false); const alive = useRef(true);
  useEffect(() => { if (manual) manualInput.current?.focus(); }, [manual]);
  useEffect(() => { if (placing) dialog.current?.close(); else dialog.current?.showModal(); }, [placing]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    alive.current = true;
    return () => { alive.current = false; previous?.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void readCustomerMap(`/api/customer-map?customer=${encodeURIComponent(customerId)}`, raw => ({ ...parseCustomerSheet(raw), checkin: parseSheetCheckin(raw) }), controller.signal).then(value => {
      if (value.customerId !== customerId) throw new Error('Unexpected customer');
      if (!controller.signal.aborted) { setData(value); setLastCheckin(value.checkin); setError(''); }
    }).catch(() => { if (!controller.signal.aborted) setError('Customer details could not load. Try again.'); });
    return () => controller.abort();
  }, [customerId, revision]);
  async function checkIn() {
    if (flight.current || busy) return;
    flight.current = true; setBusy(true); setChecking(true); setCheckinNotice('');
    try {
      if (!checkinPending.current) {
        const requestId = crypto.randomUUID();
        if (!navigator.geolocation) { setCheckinNotice('Location is unavailable on this device.'); return; }
        const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }));
        if (!alive.current) return;
        checkinPending.current = { requestId, reading: { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy } };
      }
      const { requestId, reading } = checkinPending.current;
      const response = await fetch('/api/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'check_in', customerId, latitude: reading.lat, longitude: reading.lng, accuracyM: Math.round(reading.accuracy), requestId }) });
      if (!alive.current) return;
      if (!response.ok) {
        const failure = await response.json().catch(() => null) as { error?: string; message?: string } | null;
        if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) checkinPending.current = null;
        throw new Error(failure?.message || failure?.error || 'Check-in could not be confirmed. Try again.');
      }
      const result = parseCheckinResult(await response.json());
      if (alive.current) { setCheckin({ result, reading }); checkinPending.current = null; }
    } catch (failure) {
      if (!alive.current) return;
      const code = failure && typeof failure === 'object' && 'code' in failure ? failure.code : null;
      setCheckinNotice(code === 1 ? 'Location permission denied. You can add a pin manually.' : code === 2 || code === 3 ? 'Location could not be found. Try again.' : failure instanceof Error && !(failure instanceof TypeError) ? failure.message : 'Check-in could not be confirmed. Try again.');
    } finally { flight.current = false; if (alive.current) { setBusy(false); setChecking(false); } }
  }
  function locate() {
    setNotice(''); setError(''); setGps(null);
    if (!navigator.geolocation) { setNotice('Location is unavailable on this device.'); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(position => {
      if (!alive.current) return; setBusy(false);
      if (!isInsideMarketArea(position.coords.latitude, position.coords.longitude)) {
        setError(`This pin is outside the five-district market area (${MARKET_AREA.name}). Check the link before saving.`); return;
      }
      setGps({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy });
    }, failure => { if (!alive.current) return; setBusy(false); setNotice(failure.code === 1 ? 'Location permission denied. You can add a pin manually.' : 'Location could not be found. Try again.'); }, { enableHighAccuracy: true, timeout: 10000 });
  }
  async function savePin(lat: number, lng: number, source: 'manual_pin' | 'pasted_link' = 'manual_pin') {
    if (!data || flight.current) return 'Pin save is unavailable. Try again.';
    if (!isInsideMarketArea(lat, lng)) { const message = `This pin is outside the five-district market area (${MARKET_AREA.name}). Check the link before saving.`; setError(message); return message; }
    flight.current = true; setBusy(true); setError('');
    try {
      let expectedVersion = data.location?.version ?? null;
      // Town-only and approximate locations omit the write version. Obtain it
      // from Accounts before upgrading to a pin, retaining it on retry.
      if (!data.location || data.location.approximate) {
        if (pending.current) expectedVersion = (JSON.parse(pending.current.fingerprint) as { expectedVersion: number | null }).expectedVersion;
        else {
          let page = 1;
          while (page <= 4000) {
            const response = await fetch(`/api/accounts?${new URLSearchParams({ scope: 'all', search: data.name.slice(0, 120), page: String(page) })}`, { cache: 'no-store' });
            if (!response.ok) throw new Error('Location could not be checked. Try again.');
            const accounts = await response.json() as { accounts: { id: string; location: { version: number } | null }[]; page: { total: number; pageSize: number } };
            const account = accounts.accounts.find(row => row.id === customerId);
            if (account) { expectedVersion = account.location?.version ?? null; break; }
            if (!accounts.accounts.length || page * accounts.page.pageSize >= accounts.page.total) break;
            page++;
          }
        }
      }
      const body = { action: 'set_location', customerId, expectedVersion, precision: 'pin', latitude: lat.toFixed(6), longitude: lng.toFixed(6), source };
      const fingerprint = JSON.stringify(body);
      if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, idempotencyKey: crypto.randomUUID() };
      const response = await fetch('/api/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, idempotencyKey: pending.current.idempotencyKey }) });
      if (response.status === 409) { pending.current = null; setRevision(n => n + 1); throw new Error('Someone else moved this pin. Details reloaded; check before saving again.'); }
      if (!response.ok) { if (response.status < 500 && response.status !== 408 && response.status !== 429) pending.current = null; throw new Error('Pin save could not be confirmed. Retry the same position.'); }
      pending.current = null; setGps(null); setManual(false); setMoving(false); setNotice('Pin saved.'); setRevision(n => n + 1); onLocationSaved();
      return null;
    } catch (failure) { const message = failure instanceof Error ? failure.message : 'Pin save could not be confirmed. Retry the same position.'; setError(message); return message; }
    finally { flight.current = false; setBusy(false); }
  }
  function placeOnMap() {
    if (!data || !onPlaceOnMap) return;
    setPinChooser(false); setGps(null); setManual(false); setError(''); setNotice('');
    // Resolve savePin from the mounted sheet at save time, including after a 409 reload.
    onPlaceOnMap({ name: data.name, location: data.location, save: (lat, lng) => saveCurrent.current(lat, lng) });
  }
  const saveCurrent = useRef(savePin);
  useEffect(() => { saveCurrent.current = savePin; });
  function orders(rows: SheetOrder[]) { return rows.slice(0, 3).map(row => {
    const stage = orderStageStyle(row.stage);
    return <button key={`${row.orderId}-${row.priceApproval ?? false}`} className={`${button} w-full flex-wrap justify-start bg-sf-soft-0 text-left`} disabled={!onOpenOrder} onClick={() => onOpenOrder?.(row)}>
      {row.priceApproval ? <StatusChip icon={ClipboardList} tone="warning">Price</StatusChip> : <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-extrabold ${stage.chip}`}>{stage.label}</span>}
      <span className="text-base">{row.orderNumber}</span><span>{formatCustomerDate(row.date)}</span>{financial && row.amountPaise != null ? <span className="text-base">{row.priceApproval ? '≈ ' : ''}{formatPaise(row.amountPaise)}</span> : null}
    </button>;
  }); }
  const share = data?.sharePermille; const shareTone = share != null && share >= 800 ? 'success' : share != null && share >= 400 ? 'warning' : 'danger';
  return <dialog ref={dialog} aria-label="Customer details" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} className="fixed inset-x-0 bottom-0 top-auto z-[1000] m-0 mx-auto h-[88dvh] max-h-[88dvh] w-full max-w-xl overflow-hidden rounded-t-2xl border border-sf-line bg-white shadow-xl p-0 text-sf-ink backdrop:bg-black/50 [overflow-wrap:anywhere]">
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 justify-end border-b border-sf-line-soft px-4"><button className={button} disabled={busy} onClick={onClose}>Close</button></div>
      <div data-testid="customer-sheet-scroll" className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4 text-xs">
        {error ? <p role="alert" className="text-sf-warm">{error}</p> : null}{notice ? <output className="block text-sf-muted">{notice}</output> : null}
        {!data ? <p>{error ? <button className={button} onClick={() => setRevision(n => n + 1)}>Retry</button> : 'Loading customer…'}</p> : <>
          <header className="space-y-2"><h3 className="text-xl font-semibold">{data.name}</h3><p className="text-sf-muted">{[data.city, data.owner ? `Owner: ${data.owner}` : null, data.accountClass ? `Class ${data.accountClass}` : null].filter(Boolean).join(' · ')}</p>
            {financial && share !== undefined ? <><StatusChip icon={Wallet} tone={shareTone}><span className="text-base">{share === null ? 'Share unknown' : `${share / 10}% share`}</span></StatusChip><MeterBar value={share === null ? null : share / 1000} target={0.8} tone={shareTone} label="Wallet share" /></> : null}
          </header>
          {checkinNotice ? <output className="block text-xs text-sf-muted">{checkinNotice}</output> : checkin ? <div className="text-xs"><output className={`block ${checkin.result.verified ? 'text-sf-success' : 'text-sf-warm'}`}>{checkinMessage(checkin.result, checkin.reading.accuracy)}</output>{!checkin.result.hasPin ? <button className={button} disabled={busy} onClick={() => { setPinChooser(false); setManual(false); setGps(checkin.reading); }}>Pin lab here too?</button> : null}</div> : null}
          {data.location?.approximate ? <p className="text-xs text-sf-muted">Approx location · PIN {data.location.approximate.pinCode} · <button className="min-h-11 underline" disabled={busy} aria-expanded={pinChooser} onClick={() => setPinChooser(value => !value)}>Pin here</button> to place exactly</p> : null}
          {data.constraint ? <div className="flex items-center gap-2 text-sf-warm"><ToneIcon icon={constraintIcons[data.constraint.category]} tone="warning" size="sm" /><p>Held back by: {data.constraint.label}{data.constraint.category === 'price' && !data.constraint.proven && !data.constraint.label.includes('(not proven)') ? ' (not proven)' : ''}</p></div> : null}
          <div aria-label="Customer figures" className="grid grid-cols-2 gap-2">
            {financial ? <>{data.walletPaise != null ? <Tile label="Wallet / month" value={formatPaise(data.walletPaise)} /> : null}{data.salesPaise != null ? <Tile label="Sales / month" value={formatPaise(data.salesPaise)} /> : null}{data.gapPaise != null ? <Tile label="Gap / month" value={formatPaise(data.gapPaise)} danger /> : null}</> : data.openOrders !== null ? <Tile label="Open orders" value={data.openOrders} /> : null}
            <Tile label="Last visit" value={<>{formatLastVisit(data.lastVisit)}{lastCheckin?.verified ? <span className="text-sf-success" aria-label="verified check-in"> ✓</span> : null}</>} />
            {!financial ? <>{data.nextActionDue ? <Tile label="Next action due" value={formatActionDue(data.nextActionDue)} danger={customerMapDayDifference(data.nextActionDue) < 0} /> : null}{data.overdue !== null ? <Tile label="Overdue" value={data.overdue} danger={data.overdue > 0} /> : null}</> : null}
          </div>
          {financial && data.wallet?.confidence && data.wallet.asOf && (data.walletPaise != null || data.salesPaise != null || data.gapPaise != null) ? <p className="text-xs text-sf-muted">Estimate · {data.wallet.confidence} confidence · {new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(new Date(`${data.wallet.asOf}T00:00:00+05:30`))}</p> : null}
          {data.nextAction ? <Section title="Next action"><p className="text-base">{data.nextAction.detail}</p><p>Due {formatCustomerDate(data.nextAction.dueOn)}</p>{financial ? <button className={button} onClick={() => onPlan(customerId)}>Plan</button> : data.nextAction.owned ? <button className={button} onClick={() => setCompleting(true)}>Done</button> : null}
            {completing ? <form className="space-y-2" onSubmit={async event => {
              event.preventDefault(); if (flight.current) return; flight.current = true; setBusy(true); setError('');
              const form = new FormData(event.currentTarget);
              try { const response = await fetch('/api/my-actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'close_my_action', payload: { requestId: crypto.randomUUID(), actionId: data.nextAction!.actionId, result: 'done', note: form.get('note'), visit: data.nextAction!.type === 'visit' ? { outcome: form.get('outcome'), nextVisitOn: null } : null } }) }); if (!response.ok) throw new Error('Action could not be saved.'); setCompleting(false); setRevision(n => n + 1); } catch { setError('Action could not be saved. Check its status before retrying.'); } finally { flight.current = false; setBusy(false); }
            }}><label className="block">Result note<textarea name="note" required minLength={3} maxLength={500} className={input} /></label>{data.nextAction.type === 'visit' ? <label className="block">Visit outcome<select name="outcome" className={input}><option value="met">Met</option><option value="not_available">Not available</option><option value="order_taken">Order taken</option><option value="issue_raised">Issue raised</option><option value="other">Other</option></select></label> : null}{checkin && customerMapDayDifference(checkin.result.checkedInAt) === 0 ? <p className="text-xs text-sf-muted">Checked in {new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }).format(new Date(checkin.result.checkedInAt))}{checkin.result.verified ? ' ✓' : ''}</p> : null}<button className={button} disabled={busy}>Save done</button></form> : null}
          </Section> : null}
          <Section title="Decision maker">{data.decider ? <div className="flex flex-wrap items-center gap-2"><ToneIcon icon={Crown} tone="info" size="sm" /><span className="text-base">{data.decider.name}</span>{data.decider.role ? <span>{data.decider.role}</span> : null}<StatusChip icon={User} tone={data.decider.stance === 'supportive' ? 'success' : data.decider.stance === 'opposed' ? 'danger' : 'warning'}>{data.decider.stance}</StatusChip></div> : <button className={`${button} text-sf-warm`} onClick={() => onContacts(customerId, data.name)}>No decider known · Add contact</button>}
            {data.route.length ? <p className="flex flex-wrap items-center gap-1">Reach via {data.route.map((person, i) => <span key={`${person.name}-${i}`}>{i ? ' → ' : ''}<StatusChip icon={person.decider ? Crown : User} tone={person.champion ? 'success' : 'info'}>{person.decider ? <strong>{person.name}</strong> : person.name}{person.champion ? ' · Champion' : ''}</StatusChip></span>)}</p> : null}
          </Section>
{data.instruments.ours.length + data.instruments.theirs.length > 0 ? <Section title="Instruments">{(['ours', 'theirs'] as const).map(kind => data.instruments[kind].length ? <div key={kind} className="space-y-2"><p>{kind === 'ours' ? 'Ours' : 'Theirs'}</p>{data.instruments[kind].slice(0, 3).map((item, index) => <div key={index} className="space-y-1 rounded-xl bg-sf-soft-0 p-3"><div className="flex items-center gap-2"><ToneIcon icon={Microscope} tone="info" size="sm" /><span className="text-base">{item.name}</span></div>{item.placedOn ? <p>Placed {formatCustomerDate(item.placedOn)}</p> : null}{item.serial ? <p>Serial {item.serial}</p> : null}{financial && item.payback ? <StatusChip icon={Wallet} tone={item.payback === 'paying_back' ? 'success' : item.payback === 'behind' ? 'danger' : 'neutral'}>{item.payback === 'paying_back' ? 'Paying back' : item.payback === 'behind' ? 'Behind' : 'Awaiting data'}</StatusChip> : null}{item.closedSystem ? <p>Closed system</p> : null}{item.lockInDays != null ? <StatusChip icon={Lock} tone={item.lockInDays < 0 ? 'danger' : 'warning'}><span className="text-base">{item.lockInDays < 0 ? `Ended ${Math.abs(item.lockInDays)} days ago` : `${item.lockInDays} days left`}</span></StatusChip> : null}</div>)}{data.instruments[kind].length > 3 ? <p>+{data.instruments[kind].length - 3} more</p> : null}</div> : null)}{data.instruments.moreCount > 0 ? <p>+{data.instruments.moreCount} more</p> : null}</Section> : null}
          {data.openWork.length ? <Section title="Open work">{orders(data.openWork)}</Section> : null}
          {data.recentOrders.length ? <Section title="Recent orders">{orders(data.recentOrders)}</Section> : null}
          {data.contacts.count > 0 ? <Section title="Contacts"><button className={button} onClick={() => onContacts(customerId, data.name)}>{data.contacts.count} {data.contacts.count === 1 ? 'contact' : 'contacts'} · {data.contacts.champions} {data.contacts.champions === 1 ? 'champion' : 'champions'}</button></Section> : null}
          {gps ? <section aria-label="Confirm pin" className="space-y-2 rounded-xl bg-sf-soft-0 p-3"><p className="text-base">±{Math.round(gps.accuracy)} m</p><p>Save this position for {data.name}?</p><button className={button} disabled={busy} onClick={() => void savePin(gps.lat, gps.lng)}>Confirm pin</button><button className={button} disabled={busy} onClick={() => setGps(null)}>Cancel pin</button></section> : null}
          {manual ? <form aria-label="Manual pin" className="space-y-2" onSubmit={async event => { event.preventDefault(); const { parseLocationInput } = await import('@/lib/account-types'); const parsed = parseLocationInput(pinText); if (!parsed.ok) { setError('Paste a Google Maps link or latitude, longitude.'); return; } void savePin(Number(parsed.latitude), Number(parsed.longitude), parsed.source); }}><label>Google Maps link or lat, long<input ref={manualInput} className={input} value={pinText} onChange={event => setPinText(event.target.value)} /></label><button className={button} disabled={busy}>Save manual pin</button></form> : null}
        </>}
      </div>
      {data ? <footer className="relative shrink-0 border-t border-sf-line-soft bg-white p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        {pinChooser ? <fieldset aria-label="Pin options" className="absolute bottom-full left-3 right-3 mb-2 grid min-w-0 gap-2 rounded-xl border border-sf-line bg-white p-2 shadow-xl">
          <button className={button} disabled={busy} onClick={() => { setPinChooser(false); setManual(false); locate(); }}>Use my location</button>
          <button className={button} disabled={busy} onClick={() => { setPinChooser(false); setGps(null); setManual(true); }}>Paste a map link or enter coordinates</button>
          {onPlaceOnMap ? <button className={button} disabled={busy} onClick={placeOnMap}>Place on map</button> : null}
        </fieldset> : null}
        <div className="flex gap-2">{data.phone ? <a className={actionButton} href={`tel:${data.phone.replace(/[^+\d]/g, '')}`}><Phone size={16} aria-hidden="true" />Call</a> : null}<button className={actionButton} disabled={busy} onClick={() => void checkIn()}><MapPinCheck size={16} aria-hidden="true" />{checking ? 'Checking in…' : 'Check in'}</button>{data.location?.precision === 'pin' && !moving ? <button className={actionButton} disabled={busy} onClick={() => onPlaceOnMap ? placeOnMap() : setMoving(true)}>Move pin…</button> : <button className={actionButton} disabled={busy} aria-expanded={pinChooser} onClick={() => setPinChooser(value => !value)}><MapPin size={16} aria-hidden="true" />Pin here</button>}<button className={actionButton} disabled={!onOrder || busy} onClick={() => onOrder?.(customerId)}>Order</button></div>
      </footer> : null}
    </div>
  </dialog>;
}
