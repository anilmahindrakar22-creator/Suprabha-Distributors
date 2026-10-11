import type { ReactNode } from 'react';

/**
 * One compact page header for every StockFlow screen: the work starts within the first third of a phone screen.
 * Title 20–24 px; the small label and the one-line description show from tablet width up.
 */
export function PageHeader({ title, description, eyebrow, back, actions }: {
  title: string;
  description?: string;
  eyebrow?: string;
  back?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        {back ? <div className="-ml-1 mb-0.5">{back}</div> : null}
        {eyebrow ? <p className="hidden text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#277b69] sm:block">{eyebrow}</p> : null}
        <h1 className="text-xl font-black tracking-tight text-[#092f36] sm:text-2xl">{title}</h1>
        {description ? <p className="mt-0.5 hidden max-w-2xl text-sm text-[#61777a] sm:block">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export type SummaryItem = {
  label: string;
  /** `undefined` while loading: shows a placeholder, never a misleading zero or dash. */
  value: string | number | undefined;
  note?: string;
  tone?: 'normal' | 'attention' | 'alert' | 'good';
  icon?: ReactNode;
  /** Optional: makes the tile a filter/shortcut button. */
  onSelect?: () => void;
  selected?: boolean;
};

const toneStyles: Record<NonNullable<SummaryItem['tone']>, string> = {
  normal: 'border-[#dfe7e5] bg-white text-[#092f36]',
  attention: 'border-[#efd9a8] bg-[#fff8e8] text-[#8a5a0a]',
  alert: 'border-[#f0c9c4] bg-[#fdf1f0] text-[#a23b33]',
  good: 'border-[#cfe6d9] bg-[#f1f9f4] text-[#2e7d32]',
};

/** Compact summary numbers: one row of small tiles on phones (scrolls sideways if needed), a grid from tablet up. */
export function SummaryStrip({ items, label }: { items: readonly SummaryItem[]; label: string }) {
  return (
    <section aria-label={label} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:grid sm:overflow-visible sm:px-0" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item) => {
        const tone = toneStyles[item.tone ?? 'normal'];
        const body = (
          <>
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-[#61777a]">{item.icon}{item.label}</span>
            {item.value === undefined
              ? <span aria-label="Loading" className="mt-1.5 block h-6 w-12 animate-pulse rounded-md bg-[#e6eeec]" />
              : <strong className="mt-0.5 block text-xl font-black tabular-nums">{item.value}</strong>}
            {item.note ? <span className="hidden text-[11px] text-[#718487] sm:block">{item.note}</span> : null}
          </>
        );
        const className = `min-w-[8.5rem] shrink-0 rounded-xl border px-3 py-2 text-left sm:min-w-0 ${tone}`;
        return item.onSelect
          ? <button key={item.label} type="button" aria-pressed={item.selected} onClick={item.onSelect} className={`${className} transition hover:shadow-sm aria-pressed:ring-2 aria-pressed:ring-[#092f36]`}>{body}</button>
          : <article key={item.label} className={className}>{body}</article>;
      })}
    </section>
  );
}

/** Compact header action button (Refresh and similar). */
export const pageActionClass = 'inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#d6e1df] bg-white px-3 text-sm font-bold text-[#31585d] hover:bg-[#f1f6f4] disabled:opacity-50';
