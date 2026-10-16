'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { WorkItem, WorkNotificationState, WorkQueueState } from '@/lib/work-notifications';
import type { PushState } from '@/lib/push-subscription';
import { BellIcon, orderStageStyle } from './order-list';

function checkedLabel(value: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
}

type PhoneAlertControl = { state: PushState; onEnable: () => void; onDisable: () => void };

const phoneText: Record<PushState, string> = {
  hidden: '',
  unsupported: 'This browser cannot show alerts.',
  'install-required': 'On iPhone, tap Share → Add to Home Screen, open StockFlow from the Home Screen, then turn alerts on.',
  off: 'Get an alert when work is handed to you, even when StockFlow is closed.',
  on: 'Alerts are on for this device.',
  blocked: 'Alerts are blocked for StockFlow. Allow notifications in your browser or phone settings, then try again.',
  working: 'Setting up…',
  error: 'Could not turn alerts on. Please try again.',
};

function PhoneAlerts({ phone }: { phone: PhoneAlertControl }) {
  const canToggle = phone.state === 'off' || phone.state === 'on' || phone.state === 'error';
  return (
    <div className="mt-3 rounded-xl border border-sf-line-soft p-3">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-sm text-sf-ink">Device alerts</strong>
        {canToggle ? <button type="button" role="switch" aria-checked={phone.state === 'on'} aria-label="Get alerts on this device" onClick={phone.state === 'on' ? phone.onDisable : phone.onEnable} className={`relative h-7 w-12 shrink-0 rounded-full transition ${phone.state === 'on' ? 'bg-sf-accent' : 'bg-sf-line'}`}><span aria-hidden="true" className={`absolute top-1 size-5 rounded-full bg-white shadow transition-all ${phone.state === 'on' ? 'left-6' : 'left-1'}`} /></button> : null}
      </div>
      <p className={`mt-1 text-xs ${phone.state === 'blocked' || phone.state === 'error' ? 'text-sf-danger' : 'text-sf-muted'}`}>{phoneText[phone.state]}</p>
    </div>
  );
}

function waitingLabel(since: string, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000));
  if (!Number.isFinite(minutes) || minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function WorkRow({ item, onOpen }: { item: WorkItem; onOpen: (item: WorkItem) => void }) {
  const stage = orderStageStyle(item.status);
  return (
    <button type="button" aria-label={`${item.isNew ? 'New: ' : ''}${item.customerName}, ${item.orderNumber}, ${item.message}`} onClick={() => onOpen(item)} className="relative flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-sf-soft focus-visible:bg-sf-soft">
      <span aria-hidden="true" className={`h-9 w-1 shrink-0 rounded-full ${stage.bar}`} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <strong className="truncate text-sm text-sf-ink">{item.customerName}</strong>
          {item.isNew ? <span className="shrink-0 rounded-full bg-sf-ink px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">New</span> : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-sf-subtle">{item.orderNumber} · {item.message}{item.waitingSince ? <> · <span className="tabular-nums">waiting {waitingLabel(item.waitingSince)}</span></> : null}</span>
      </span>
    </button>
  );
}

/**
 * The one notification bell, in the app header: your current work (new first, then longest waiting). Seeing work
 * never completes it; it leaves when its stage is done. `updates` renders extra feed content only when supplied.
 */
export function NotificationBell({ state, onSeen, onOpenOrder, onOpenQueue, onRetry, updates, phone, ordersFilterFor }: {
  state: WorkNotificationState;
  /** The Orders filter that shows a queue. */
  ordersFilterFor: (queue: WorkQueueState) => string;
  /** Phone push control; omitted until the server reports push is enabled. */
  phone?: PhoneAlertControl;
  onSeen: () => void;
  onOpenOrder: (item: WorkItem) => void;
  onOpenQueue: (status: string, query?: string) => void;
  onRetry: () => void;
  updates?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDialogElement>(null);
  const freshCount = state.fresh.length;
  // Badge = distinct orders waiting for you (not unread history); red while any of them is new.
  const waiting = state.workTotal;
  const waitingText = `${waiting}${state.workMore ? '+' : ''}`;
  const problem = state.connection === 'offline' ? 'Offline · checks paused' : state.connection === 'unavailable' ? 'Could not check for new work' : state.connection === 'signed-out' ? 'Sign in again to receive notifications' : state.connection === 'forbidden' ? 'Notifications are not available for your access' : '';

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    function close(event: MouseEvent) {
      if (panelRef.current?.contains(event.target as Node) || buttonRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      onSeen();
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, onSeen]);

  // New items stay highlighted while the panel is open and count as seen once it closes.
  function toggle() {
    if (open) onSeen();
    setOpen(!open);
  }
  function closePanel() {
    setOpen(false);
    onSeen();
    buttonRef.current?.focus();
  }
  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  const label = waiting ? `Notifications, ${waitingText} waiting for you${freshCount ? `, ${freshCount} new` : ''}` : 'Notifications';
  return (
    <div className="relative">
      <button ref={buttonRef} type="button" aria-label={label} title={label} aria-expanded={open} aria-controls="work-notifications" onClick={toggle} className="relative grid min-h-11 min-w-11 place-items-center rounded-xl border border-sf-line-soft bg-white text-sf-body hover:bg-sf-soft aria-expanded:border-sf-ink">
        <BellIcon />
        {waiting ? <span aria-hidden="true" className={`absolute -right-1 -top-1 min-w-5 rounded-full px-1 text-center text-[11px] font-black leading-5 text-white tabular-nums ${freshCount ? 'bg-sf-danger' : 'bg-sf-accent'}`}>{waiting > 99 ? '99+' : waitingText}</span> : null}
        {problem ? <span aria-hidden="true" className="absolute bottom-1 right-1 size-2 rounded-full bg-sf-warning" /> : null}
      </button>
      {open ? (
        <dialog
          open
          ref={panelRef}
          id="work-notifications"
          tabIndex={-1}
          aria-label="Notifications"
          onKeyDown={(event) => { if (event.key === 'Escape') closePanel(); }}
          className="fixed inset-x-0 bottom-0 z-50 m-0 w-auto max-h-[80dvh] overflow-y-auto rounded-t-2xl border border-sf-line-soft bg-white p-3 shadow-2xl outline-none sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-13 sm:w-96 sm:rounded-2xl"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <div className="flex items-center justify-between gap-2 px-1">
            <h2 className="text-base font-black text-sf-ink">Notifications</h2>
            <button type="button" onClick={closePanel} className="min-h-11 rounded-lg px-3 text-sm font-bold text-sf-muted hover:bg-sf-soft">Close</button>
          </div>
          {problem ? <p className="mx-1 mt-1 flex items-center justify-between gap-2 rounded-xl bg-sf-warning-soft px-3 py-2 text-xs font-semibold text-sf-warning"><span>{problem}{state.checkedAt ? `. Showing ${checkedLabel(state.checkedAt)} results.` : '.'}</span>{state.connection === 'unavailable' ? <button type="button" onClick={onRetry} className="min-h-9 shrink-0 rounded-lg px-2 font-bold underline">Retry</button> : null}</p> : null}

          <div className="mt-2">
            <h3 className="px-1 text-[11px] font-extrabold uppercase tracking-wide text-sf-subtle">Your work · {state.workTotal}</h3>
            {state.work.length ? <div className="mt-1">{state.work.slice(0, 8).map((item) => <WorkRow key={item.orderId} item={item} onOpen={(chosen) => choose(() => onOpenOrder(chosen))} />)}</div>
              : <p className="px-1 py-2 text-sm text-sf-subtle">{state.connection === 'checking' ? 'Checking…' : 'Nothing is waiting for you right now.'}</p>}
            {state.workTotal > Math.min(8, state.work.length) ? <p className="px-1 pt-1 text-xs text-sf-subtle">Showing new first, then the longest waiting. Open a queue below to see everything.</p> : null}
          </div>

          {state.queues.length ? <div className="mt-3">
            <h3 className="px-1 text-[11px] font-extrabold uppercase tracking-wide text-sf-subtle">Your queues</h3>
            <div className="mt-1 grid gap-1">{state.queues.map((queue) => (
              <button key={queue.id} type="button" onClick={() => choose(() => onOpenQueue(ordersFilterFor(queue)))} className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-sf-soft px-3 text-left text-sm font-bold text-sf-body hover:bg-sf-soft-2">
                <span>{queue.label}</span>
                <span className="flex items-center gap-2">{queue.newCount ? <span className="rounded-full bg-sf-ink px-2 py-0.5 text-[11px] font-black text-white">+{queue.newCount} new</span> : null}<span className="tabular-nums text-sf-ink">{queue.total}</span></span>
              </button>
            ))}
            {state.work.some((item) => item.assignedToMe) ? <button type="button" onClick={() => choose(() => onOpenQueue('open', 'mine'))} className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-sf-soft px-3 text-left text-sm font-bold text-sf-body hover:bg-sf-soft-2"><span>Assigned to you</span><span className="tabular-nums text-sf-ink">{state.work.filter((item) => item.assignedToMe).length}</span></button> : null}
            </div>
          </div> : null}
          {state.reminders.length ? <div className="mt-3">
            <h3 className="px-1 text-[11px] font-extrabold uppercase tracking-wide text-sf-subtle">Also needs attention</h3>
            <div className="mt-1 grid gap-1">{state.reminders.map((item) => (
              <button key={item.id} type="button" onClick={() => choose(() => onOpenQueue(item.status))} className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-3 text-left text-sm font-semibold text-sf-body hover:bg-sf-soft"><span>{item.label}</span><span className="tabular-nums font-bold text-sf-warning">{item.count}</span></button>
            ))}</div>
          </div> : null}

          {updates}

          {phone ? <PhoneAlerts phone={phone} /> : null}

          <p className="mt-3 px-1 text-[11px] text-sf-subtle">{state.checkedAt ? `Checked ${checkedLabel(state.checkedAt)} · ` : ''}New work shows within about 15 seconds while StockFlow is open.</p>
        </dialog>
      ) : null}
    </div>
  );
}
