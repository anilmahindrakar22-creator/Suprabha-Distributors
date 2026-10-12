'use client';

import type { KeyboardEvent } from 'react';
import type { OrderSummary } from '@/lib/order-types';
import { orderStage } from '@/lib/order-types';
import { orderListFlag, orderProgressIndex, orderProgressSteps, orderStageKey, type StageKey } from '@/lib/order-list-groups';

// One colour per stage, used everywhere on the Orders screens. Red is reserved for problems.
export const stageStyles: Record<StageKey, { bar: string; chip: string; label: string }> = {
  confirm: { bar: 'bg-[#2f6fb3]', chip: 'bg-[#e8f1fb] text-[#2f6fb3]', label: 'Confirm' },
  pack: { bar: 'bg-[#7a4fb0]', chip: 'bg-[#f2ecfa] text-[#7a4fb0]', label: 'Pack' },
  bill: { bar: 'bg-[#9a6412]', chip: 'bg-[#fff4dc] text-[#9a6412]', label: 'Bill' },
  dispatch: { bar: 'bg-[#0f7b6c]', chip: 'bg-[#e3f6f1] text-[#0f7b6c]', label: 'Dispatch' },
  done: { bar: 'bg-[#2e7d32]', chip: 'bg-[#e9f6ea] text-[#2e7d32]', label: 'Delivered' },
  cancelled: { bar: 'bg-[#9aa8aa]', chip: 'bg-[#eef1f1] text-[#5f7174]', label: 'Cancelled' },
  other: { bar: 'bg-[#9aa8aa]', chip: 'bg-[#eef1f1] text-[#5f7174]', label: 'Other' },
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
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${flag.tone === 'alert' ? 'bg-[#fdeceb] text-[#a23b33]' : 'bg-[#fff4dc] text-[#8a5a0a]'}`}>{flag.label}</span>;
}

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
      className={`group relative flex min-h-15 w-full items-stretch gap-3 border-b border-[#edf1f0] bg-white py-2.5 pl-4 pr-3 text-left outline-none transition hover:bg-[#f6f9f8] focus-visible:bg-[#f1f8f6] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3aa585] aria-current:bg-[#eef7f4] ${finished ? 'opacity-70' : ''}`}
    >
      <span aria-hidden="true" className={`absolute inset-y-2 left-1.5 w-1 rounded-full ${style.bar}`} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <strong className="truncate text-[15px] font-bold text-[#092f36]">{order.customerName}</strong>
          <span className="shrink-0 text-xs font-semibold tabular-nums text-[#7a8c8f]" title="Time since order capture">{compactAge(order.createdAt)}</span>
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-[#6b7e81]">
          {isNew ? <span className="shrink-0 rounded-full bg-[#092f36] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">New</span> : null}
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
  if (current < 0) return <p className="text-xs font-bold text-[#5f7174]">{orderStage(status)}</p>;
  return (
    <ol aria-label="Order progress" className="grid grid-cols-5 gap-1">
      {orderProgressSteps.map((step, index) => (
        <li key={step} aria-current={index === current ? 'step' : undefined} className="min-w-0">
          <span className={`block h-1.5 rounded-full ${index < current ? 'bg-[#2e7d32]' : index === current ? stageStyles[(['confirm', 'pack', 'bill', 'dispatch', 'done'] as const)[index]].bar : 'bg-[#dfe7e6]'}`} />
          <span className={`mt-1 block truncate text-[10px] font-bold ${index === current ? 'text-[#092f36]' : 'text-[#8a9a9c]'}`}>{step}</span>
        </li>
      ))}
    </ol>
  );
}

export type StageFilter = { status: string; label: string; count?: number; tone?: StageKey | 'alert' };

/** Horizontal stage chips that replace the queue strip and the common status choices. */
export function OrderStageChips({ filters, active, onSelect }: { filters: readonly StageFilter[]; active: string; onSelect: (status: string) => void }) {
  return (
    <nav aria-label="Order stages" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
      {filters.map((filter) => {
        const selected = filter.status === active;
        const dot = filter.tone === 'alert' ? 'bg-[#a23b33]' : filter.tone ? stageStyles[filter.tone].bar : 'bg-[#092f36]';
        return (
          <button key={filter.status} type="button" aria-pressed={selected} onClick={() => onSelect(filter.status)} className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-bold transition ${selected ? 'border-[#092f36] bg-[#092f36] text-white' : 'border-[#d6e1df] bg-white text-[#31585d] hover:border-[#9fb9b5]'}`}>
            <span aria-hidden="true" className={`size-2 rounded-full ${selected ? 'bg-white' : dot}`} />
            {filter.label}
            {filter.count ? <span className={`rounded-full px-1.5 text-[11px] font-black tabular-nums ${selected ? 'bg-white/20 text-white' : filter.tone === 'alert' ? 'bg-[#fdeceb] text-[#a23b33]' : 'bg-[#eef3f2] text-[#31585d]'}`}>{filter.count.toLocaleString('en-IN')}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}
