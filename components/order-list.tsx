'use client';

import type { KeyboardEvent } from 'react';
import { ArrowUp, Flame, Hourglass, PackageCheck, PackageX, ShieldAlert, TriangleAlert, Truck, Wrench, type LucideIcon } from 'lucide-react';
import type { OrderSummary } from '@/lib/order-types';
import { orderStage } from '@/lib/order-types';
import { orderListFlag, orderProgressIndex, orderProgressSteps, orderStageKey, type StageKey } from '@/lib/order-list-groups';

// One colour per stage, used everywhere on the Orders screens. Red is reserved for problems.
export const stageStyles: Record<StageKey, { bar: string; chip: string; label: string }> = {
  confirm: { bar: 'bg-sf-stage-confirm', chip: 'bg-sf-stage-confirm-soft text-sf-stage-confirm', label: 'Confirm' },
  pack: { bar: 'bg-sf-stage-pack', chip: 'bg-sf-stage-pack-soft text-sf-stage-pack', label: 'Pack' },
  bill: { bar: 'bg-sf-stage-bill', chip: 'bg-sf-stage-bill-soft text-sf-stage-bill', label: 'Bill' },
  dispatch: { bar: 'bg-sf-accent', chip: 'bg-sf-accent-soft text-sf-accent', label: 'Dispatch' },
  done: { bar: 'bg-sf-success', chip: 'bg-sf-success-soft text-sf-success', label: 'Delivered' },
  cancelled: { bar: 'bg-sf-faint', chip: 'bg-sf-soft-2 text-sf-muted', label: 'Cancelled' },
  other: { bar: 'bg-sf-faint', chip: 'bg-sf-soft-2 text-sf-muted', label: 'Other' },
};

export function BellIcon({ className = 'size-5' }: { className?: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>;
}

export function ChevronDownIcon({ className = 'size-4' }: { className?: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m6 9 6 6 6-6" /></svg>;
}

export function BackIcon({ className = 'size-5' }: { className?: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m15 18-6-6 6-6" /></svg>;
}

/** "Updated 1:04 am" today, otherwise "Updated 10 Oct, 6:30 pm" (IST). Raw values pass through unchanged. */
export function snapshotTimeLabel(value?: string) {
  const time = value ? new Date(value) : null;
  if (!time || !Number.isFinite(time.getTime())) return value || 'No Tally snapshot yet';
  const day = (date: Date) => date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
  const clock = time.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
  return day(time) === day(new Date()) ? `Updated ${clock}` : `Updated ${time.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })}, ${clock}`;
}

export function orderStageStyle(status: string) {
  return stageStyles[orderStageKey(status)];
}

export function OrderFlagBadge({ order }: { order: OrderSummary }) {
  const flag = orderListFlag(order);
  if (!flag) return null;
  const Icon = flagIcons[flag.label] ?? TriangleAlert;
  return <span className={`inline-flex items-center gap-1 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${flag.tone === 'alert' ? 'bg-sf-danger-soft text-sf-danger' : 'bg-sf-warning-soft text-sf-warning'}`}><Icon aria-hidden="true" className="shrink-0" size={12} />{flag.label}</span>;
}
/** One icon per flag, from the colour and icon registry (docs/DESIGN-COLOR-AND-ICONS.md). */
const flagIcons: Record<string, LucideIcon> = {
  Urgent: Flame, Overdue: Truck, 'Delivery issue': TriangleAlert, Stalled: Hourglass, 'Installation due': Wrench,
  'Back-order': PackageX, 'Dispatch details': Truck, 'Confirm delivery': PackageCheck, 'Check order': TriangleAlert, 'High priority': ArrowUp,
  'Price approval': ShieldAlert,
};

function compactAge(createdAt: string, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/** Two-line order row (about 60 px): customer and age, then stage, one flag, order number and quantity. */
export function CompactOrderRow({ order, onOpen, selected = false, isNew = false, id, onKeyDown }: { order: OrderSummary; onOpen: (order: OrderSummary) => void; selected?: boolean; isNew?: boolean; id?: string; onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void }) {
  const style = orderStageStyle(order.status);
  const finished = ['delivered', 'cancelled'].includes(order.status);
  return (
    <button
      id={id}
      type="button"
      aria-current={selected ? 'true' : undefined}
      aria-label={`${order.orderNumber}, ${order.customerName}, ${orderStage(order.status)}`}
      onClick={() => onOpen(order)}
      onKeyDown={onKeyDown}
      className={`group relative flex min-h-15 w-full items-stretch gap-3 border-b border-sf-soft-2 bg-white py-2.5 pl-4 pr-3 text-left outline-none transition hover:bg-sf-soft focus-visible:bg-sf-accent-soft focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sf-accent-bright aria-current:bg-sf-accent-soft ${finished ? 'opacity-70' : ''}`}
    >
      <span aria-hidden="true" className={`absolute inset-y-2 left-1.5 w-1 rounded-full ${style.bar}`} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <strong className="truncate text-[15px] font-bold text-sf-ink">{order.customerName}</strong>
          <span className="shrink-0 text-xs font-semibold tabular-nums text-sf-subtle" title="Time since order capture">{compactAge(order.createdAt)}</span>
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-sf-subtle">
          {isNew ? <span className="shrink-0 rounded-full bg-sf-ink px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">New</span> : null}
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${style.chip}`}>{style.label}</span>
          <OrderFlagBadge order={order} />
          <span className="truncate">{order.orderNumber} ·{Math.round(Number(order.totalQuantity || 0)).toLocaleString('en-IN')} qty</span>
        </span>
      </span>
    </button>
  );
}

/** Five-step progress: Confirm → Pack → Bill → Dispatch → Delivered. */
export function OrderProgress({ status }: { status: string }) {
  const current = orderProgressIndex(status);
  if (current < 0) return <p className="text-xs font-bold text-sf-muted">{orderStage(status)}</p>;
  return (
    <ol aria-label="Order progress" className="grid grid-cols-5 gap-1">
      {orderProgressSteps.map((step, index) => (
        <li key={step} aria-current={index === current ? 'step' : undefined} className="min-w-0">
          <span className={`block h-1.5 rounded-full ${index < current ? 'bg-sf-success' : index === current ? stageStyles[(['confirm', 'pack', 'bill', 'dispatch', 'done'] as const)[index]].bar : 'bg-sf-line-soft'}`} />
          <span className={`mt-1 block truncate text-[10px] font-bold ${index === current ? 'text-sf-ink' : 'text-sf-faint'}`}>{step}</span>
        </li>
      ))}
    </ol>
  );
}

export type StageFilter = { status: string; label: string; count?: number; tone?: StageKey | 'alert' | 'warning' };

/** Horizontal stage chips that replace the queue strip and the common status choices. */
export function OrderStageChips({ filters, active, onSelect }: { filters: readonly StageFilter[]; active: string; onSelect: (status: string) => void }) {
  return (
    <nav aria-label="Order stages" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
      {filters.map((filter) => {
        const selected = filter.status === active;
        const dot = filter.tone === 'alert' ? 'bg-sf-danger' : filter.tone === 'warning' ? 'bg-sf-warning' : filter.tone ? stageStyles[filter.tone].bar : 'bg-sf-ink';
        const Icon = filter.tone === 'warning' ? ShieldAlert : null;
        const className = selected ? 'border-sf-ink bg-sf-ink text-white' : filter.tone === 'warning' ? 'border-sf-warning-line bg-sf-warning-soft text-sf-warning hover:border-sf-warning' : 'border-sf-line bg-white text-sf-body hover:border-sf-line-strong';
        return (
          <button key={filter.status} type="button" aria-label={filter.tone === 'warning' ? `${filter.label}, ${filter.count} orders` : undefined} aria-pressed={selected} onClick={() => onSelect(filter.status)} className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-bold transition ${className}`}>
            {Icon ? <Icon aria-hidden="true" size={16} /> : <span aria-hidden="true" className={`size-2 rounded-full ${selected ? 'bg-white' : dot}`} />}
            {filter.label}
            {filter.count ? <span className={`rounded-full px-1.5 text-[11px] font-black tabular-nums ${selected ? 'bg-white/20 text-white' : filter.tone === 'alert' ? 'bg-sf-danger-soft text-sf-danger' : filter.tone === 'warning' ? 'bg-sf-warning-soft text-sf-warning' : 'bg-sf-soft-2 text-sf-body'}`}>{filter.count.toLocaleString('en-IN')}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}
