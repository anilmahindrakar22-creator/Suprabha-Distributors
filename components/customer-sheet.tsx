'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Crown, MapPin, Phone, User, Wallet, ClipboardList, Microscope, Lock } from 'lucide-react';
import { MeterBar, StatusChip, ToneIcon } from '@/components/ui/glance';
import { constraintIcons, stageIcons } from '@/lib/glance-icons';
import { isInsideMarketArea, MARKET_AREA } from '@/lib/account-types';
import { formatPaise } from '@/lib/wallet-format';
import { parseCustomerSheet, readCustomerMap, type CustomerSheetData, type SheetOrder } from '@/lib/customer-map';

const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/20 px-3 text-xs font-semibold disabled:opacity-50';
const input = 'min-h-11 w-full rounded-xl border border-white/20 bg-[#262d30] px-3 text-base';
function Section({ title, children }: { title: string; children: ReactNode }) { return <section aria-label={title} className="space-y-2"><h4 className="text-xs text-white/60">{title}</h4>{children}</section>; }
function Tile({ label, value, danger }: { label: string; value: ReactNode; danger?: boolean }) { return <div className="min-w-0 rounded-xl bg-[#262d30] p-3"><p className={`break-words text-base tabular-nums ${danger ? 'text-[#E24B4A]' : ''}`}>{value}</p><p className="text-xs text-white/60">{label}</p></div>; }
export type CustomerSheetProps = { customerId: string; financial: boolean; onClose: () => void; onOpenOrder?: (order: { orderId: string; orderNumber: string }) => void; onPlan: (id: string) => void; onOrder?: (id: string) => void; onContacts: (id: string, name: string) => void; onLocationSaved: () => void };

export function CustomerSheet({ customerId, financial, onClose, onOpenOrder, onPlan, onOrder, onContacts, onLocationSaved }: CustomerSheetProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<CustomerSheetData | null>(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [manual, setManual] = useState(false); const [pinText, setPinText] = useState('');
  const [moving, setMoving] = useState(false); const [completing, setCompleting] = useState(false);
  const [revision, setRevision] = useState(0);
  const pending = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);
  const flight = useRef(false); const alive = useRef(true);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal(); alive.current = true;
    return () => { alive.current = false; previous?.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void readCustomerMap(`/api/customer-map?customer=${encodeURIComponent(customerId)}`, parseCustomerSheet, controller.signal).then(value => {
      if (value.customerId !== customerId) throw new Error('Unexpected customer');
      if (!controller.signal.aborted) { setData(value); setError(''); }
    }).catch(() => { if (!controller.signal.aborted) setError('Customer details could not load. Try again.'); });
    return () => controller.abort();
  }, [customerId, revision]);
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
    if (!data || flight.current) return;
    if (!isInsideMarketArea(lat, lng)) { setError(`This pin is outside the five-district market area (${MARKET_AREA.name}). Check the link before saving.`); return; }
    flight.current = true; setBusy(true); setError('');
    try {
      let expectedVersion = data.location?.version ?? null;
      // The map gateway omits town-only locations. Obtain their existing write
      // version from Accounts before upgrading one to a pin, retaining it on retry.
      if (!data.location) {
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
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Pin save could not be confirmed. Retry the same position.'); }
    finally { flight.current = false; setBusy(false); }
  }
  function orders(rows: SheetOrder[]) { return rows.slice(0, 3).map(row => <button key={`${row.orderId}-${row.priceApproval ?? false}`} className={`${button} w-full flex-wrap justify-start bg-[#262d30] text-left`} disabled={!onOpenOrder} onClick={() => onOpenOrder?.(row)}>
    <StatusChip icon={stageIcons[row.stage as keyof typeof stageIcons] ?? ClipboardList} tone={row.priceApproval ? 'warning' : 'info'}>{row.priceApproval ? 'Price' : row.stage.replaceAll('_', ' ')}</StatusChip>
    <span className="text-base">{row.orderNumber}</span><span>{row.date}</span>{financial && row.amountPaise != null ? <span className="text-base">{row.priceApproval ? '≈ ' : ''}{formatPaise(row.amountPaise)}</span> : null}
  </button>); }
  const share = data?.sharePermille; const shareTone = share != null && share >= 800 ? 'success' : share != null && share >= 400 ? 'warning' : 'danger';
  return <dialog ref={dialog} aria-label="Customer details" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} className="fixed inset-x-0 bottom-0 top-auto z-[1000] m-0 mx-auto h-[88dvh] max-h-[88dvh] w-full max-w-xl overflow-hidden rounded-t-2xl border border-white/10 bg-[#1b2124] p-0 text-white backdrop:bg-black/50 [overflow-wrap:anywhere]">
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 justify-end border-b border-white/10 px-4"><button className={button} disabled={busy} onClick={onClose}>Close</button></div>
      <div data-testid="customer-sheet-scroll" className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4 text-xs">
        {error ? <p role="alert" className="text-[#EF9F27]">{error}</p> : null}{notice ? <output className="block text-white/60">{notice}</output> : null}
        {!data ? <p>{error ? <button className={button} onClick={() => setRevision(n => n + 1)}>Retry</button> : 'Loading customer…'}</p> : <>
          <header className="space-y-2"><h3 className="text-xl font-semibold">{data.name}</h3><p className="text-white/60">{[data.city, data.owner ? `Owner: ${data.owner}` : null, data.accountClass ? `Class ${data.accountClass}` : null].filter(Boolean).join(' · ')}</p>
            {financial && share !== undefined ? <><StatusChip icon={Wallet} tone={shareTone}><span className="text-base">{share === null ? 'Share unknown' : `${share / 10}% share`}</span></StatusChip><MeterBar value={share === null ? null : share / 1000} target={0.8} tone={shareTone} label="Wallet share" /></> : null}
          </header>
          {data.constraint ? <div className="flex items-center gap-2 text-[#EF9F27]"><ToneIcon icon={constraintIcons[data.constraint.category]} tone="warning" size="sm" /><p>Held back by: {data.constraint.label}{data.constraint.category === 'price' && !data.constraint.proven && !data.constraint.label.includes('(not proven)') ? ' (not proven)' : ''}</p></div> : null}
          {data.lastVisit || (financial ? data.walletPaise != null || data.salesPaise != null || data.gapPaise != null : data.openOrders !== null || data.overdue !== null || data.nextActionDue) ? <div aria-label="Customer figures" className="grid grid-cols-2 gap-2">
            {financial ? <>{data.walletPaise != null ? <Tile label="Wallet / month" value={formatPaise(data.walletPaise)} /> : null}{data.salesPaise != null ? <Tile label="Sales / month" value={formatPaise(data.salesPaise)} /> : null}{data.gapPaise != null ? <Tile label="Gap / month" value={formatPaise(data.gapPaise)} danger /> : null}</> : data.openOrders !== null ? <Tile label="Open orders" value={data.openOrders} /> : null}
            {data.lastVisit ? <Tile label="Last visit" value={data.lastVisit} /> : null}
            {!financial ? <>{data.nextActionDue ? <Tile label="Next action due" value={data.nextActionDue} /> : null}{data.overdue !== null ? <Tile label="Overdue" value={data.overdue} danger={data.overdue > 0} /> : null}</> : null}
          </div> : null}
          {data.nextAction ? <Section title="Next action"><p className="text-base">{data.nextAction.detail}</p><p>Due {data.nextAction.dueOn}</p>{financial ? <button className={button} onClick={() => onPlan(customerId)}>Plan</button> : data.nextAction.owned ? <button className={button} onClick={() => setCompleting(true)}>Done</button> : null}
            {completing ? <form className="space-y-2" onSubmit={async event => {
              event.preventDefault(); if (flight.current) return; flight.current = true; setBusy(true); setError('');
              const form = new FormData(event.currentTarget);
              try { const response = await fetch('/api/my-actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'close_my_action', payload: { requestId: crypto.randomUUID(), actionId: data.nextAction!.actionId, result: 'done', note: form.get('note'), visit: data.nextAction!.type === 'visit' ? { outcome: form.get('outcome'), nextVisitOn: null } : null } }) }); if (!response.ok) throw new Error('Action could not be saved.'); setCompleting(false); setRevision(n => n + 1); } catch { setError('Action could not be saved. Check its status before retrying.'); } finally { flight.current = false; setBusy(false); }
            }}><label className="block">Result note<textarea name="note" required minLength={3} maxLength={500} className={input} /></label>{data.nextAction.type === 'visit' ? <label className="block">Visit outcome<select name="outcome" className={input}><option value="met">Met</option><option value="not_available">Not available</option><option value="order_taken">Order taken</option><option value="issue_raised">Issue raised</option><option value="other">Other</option></select></label> : null}<button className={button} disabled={busy}>Save done</button></form> : null}
          </Section> : null}
          <Section title="Decision maker">{data.decider ? <div className="flex flex-wrap items-center gap-2"><ToneIcon icon={Crown} tone="info" size="sm" /><span className="text-base">{data.decider.name}</span>{data.decider.role ? <span>{data.decider.role}</span> : null}<StatusChip icon={User} tone={data.decider.stance === 'supportive' ? 'success' : data.decider.stance === 'opposed' ? 'danger' : 'warning'}>{data.decider.stance}</StatusChip></div> : <button className={`${button} text-[#EF9F27]`} onClick={() => onContacts(customerId, data.name)}>No decider known · Add contact</button>}
            {data.route.length ? <p className="flex flex-wrap items-center gap-1">Reach via {data.route.map((person, i) => <span key={`${person.name}-${i}`}>{i ? ' → ' : ''}<StatusChip icon={person.decider ? Crown : User} tone={person.champion ? 'success' : 'info'}>{person.decider ? <strong>{person.name}</strong> : person.name}{person.champion ? ' · Champion' : ''}</StatusChip></span>)}</p> : null}
          </Section>
{data.instruments.ours.length + data.instruments.theirs.length > 0 ? <Section title="Instruments">{(['ours', 'theirs'] as const).map(kind => data.instruments[kind].length ? <div key={kind} className="space-y-2"><p>{kind === 'ours' ? 'Ours' : 'Theirs'}</p>{data.instruments[kind].slice(0, 3).map((item, index) => <div key={index} className="space-y-1 rounded-xl bg-[#262d30] p-3"><div className="flex items-center gap-2"><ToneIcon icon={Microscope} tone="info" size="sm" /><span className="text-base">{item.name}</span></div>{item.placedOn ? <p>Placed {item.placedOn}</p> : null}{item.serial ? <p>Serial {item.serial}</p> : null}{financial && item.payback ? <StatusChip icon={Wallet} tone={item.payback === 'paying_back' ? 'success' : item.payback === 'behind' ? 'danger' : 'neutral'}>{item.payback === 'paying_back' ? 'Paying back' : item.payback === 'behind' ? 'Behind' : 'Awaiting data'}</StatusChip> : null}{item.closedSystem ? <p>Closed system</p> : null}{item.lockInDays != null ? <StatusChip icon={Lock} tone={item.lockInDays < 0 ? 'danger' : 'warning'}><span className="text-base">{item.lockInDays < 0 ? `Ended ${Math.abs(item.lockInDays)} days ago` : `${item.lockInDays} days left`}</span></StatusChip> : null}</div>)}{data.instruments[kind].length > 3 ? <p>+{data.instruments[kind].length - 3} more</p> : null}</div> : null)}{data.instruments.moreCount > 0 ? <p>+{data.instruments.moreCount} more</p> : null}</Section> : null}
          {data.openWork.length ? <Section title="Open work">{orders(data.openWork)}</Section> : null}
          {data.recentOrders.length ? <Section title="Recent orders">{orders(data.recentOrders)}</Section> : null}
          {data.contacts.count > 0 ? <Section title="Contacts"><button className={button} onClick={() => onContacts(customerId, data.name)}>{data.contacts.count} contacts · {data.contacts.champions} champions</button></Section> : null}
          {gps ? <section aria-label="Confirm pin" className="space-y-2 rounded-xl bg-[#262d30] p-3"><p className="text-base">±{Math.round(gps.accuracy)} m</p><p>Save this position for {data.name}?</p><button className={button} disabled={busy} onClick={() => void savePin(gps.lat, gps.lng)}>Confirm pin</button><button className={button} disabled={busy} onClick={() => setGps(null)}>Cancel pin</button></section> : null}
          {manual ? <form aria-label="Manual pin" className="space-y-2" onSubmit={async event => { event.preventDefault(); const { parseLocationInput } = await import('@/lib/account-types'); const parsed = parseLocationInput(pinText); if (!parsed.ok) { setError('Paste a Google Maps link or latitude, longitude.'); return; } void savePin(Number(parsed.latitude), Number(parsed.longitude), parsed.source); }}><label>Google Maps link or lat, long<input className={input} value={pinText} onChange={event => setPinText(event.target.value)} /></label><button className={button} disabled={busy}>Save manual pin</button></form> : null}
        </>}
      </div>
      {data ? <footer className="shrink-0 space-y-2 border-t border-white/10 bg-[#1b2124] p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        {moving || !data.location || data.location.precision !== 'pin' ? <button className={`${button} w-full`} disabled={busy} onClick={() => setManual(n => !n)}>Paste link / manual pin</button> : null}
        <div className="flex gap-2">{data.phone ? <a className={`${button} flex-1`} href={`tel:${data.phone.replace(/[^+\d]/g, '')}`}><Phone size={16} aria-hidden="true" />Call</a> : null}{data.location?.precision === 'pin' && !moving ? <button className={`${button} flex-1`} disabled={busy} onClick={() => setMoving(true)}>Move pin…</button> : <button className={`${button} flex-1`} disabled={busy} onClick={locate}><MapPin size={16} aria-hidden="true" />{busy ? 'Locating…' : 'Pin here'}</button>}<button className={`${button} flex-1`} disabled={!onOrder || busy} onClick={() => onOrder?.(customerId)}>Order</button></div>
      </footer> : null}
    </div>
  </dialog>;
}
