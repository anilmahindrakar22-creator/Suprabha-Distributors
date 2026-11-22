'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GrowthData } from '@/lib/growth-types';
import { formatPaise } from '@/lib/wallet-format';

const sections = [
  { key: 'act', title: 'Act now' },
  { key: 'revenue', title: 'Revenue' },
  { key: 'labs', title: 'Labs' },
  { key: 'profit', title: 'Profit' },
  { key: 'brands', title: 'Brands & items' },
  { key: 'health', title: 'Data health' },
] as const;
export type GrowthSection = typeof sections[number]['key'];
type LabFilter = 'top' | 'lapsing' | 'declining';
type SectionState = { growthSection: GrowthSection; filter?: LabFilter };
const isSection = (value: unknown): value is GrowthSection => sections.some(section => section.key === value);
const readState = (state: unknown): SectionState | null => {
  if (!state || typeof state !== 'object' || !('growthSection' in state) || !isSection(state.growthSection)) return null;
  const filter = 'filter' in state && (state.filter === 'lapsing' || state.filter === 'declining') ? state.filter : 'top';
  return { growthSection: state.growthSection, filter };
};

export function usePhoneLayout() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setPhone(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return phone;
}

export function GrowthSections({ data, children }: {
  data: GrowthData;
  children: (section: GrowthSection, filter: LabFilter, open: (key: GrowthSection, filter?: LabFilter) => void) => ReactNode;
}) {
  const [current, setCurrent] = useState<SectionState | null>(() => {
    const key = location.hash.startsWith('#growth-') ? location.hash.slice('#growth-'.length) : '';
    const saved = readState(history.state);
    return isSection(key) ? saved?.growthSection === key ? saved : { growthSection: key } : null;
  });
  const container = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const pop = (event: PopStateEvent) => setCurrent(readState(event.state));
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    container.current?.closest('[data-growth-scroller]')?.scrollTo({ top: 0 });
  }, [current]);
  const open = (key: GrowthSection, filter?: LabFilter) => {
    const state = { growthSection: key, filter };
    history.pushState(state, '', '#growth-' + key);
    setCurrent(state);
  };
  const back = () => {
    if (readState(history.state)) history.back();
    else setCurrent(null);
  };
  const gp = data.gp?.window.gpPct;
  const figures: Partial<Record<GrowthSection, string>> = {
    revenue: formatPaise(data.tree.revenuePaise, true),
    labs: `${data.tree.labsBuying} labs buying`,
    profit: gp === null || gp === undefined ? '' : `${gp.toFixed(1)}%`,
  };
  return <div ref={container} className="min-w-0 space-y-4">
    {current ? <>
      <div className="flex items-center gap-3">
        <button type="button" className="min-h-11 text-sf-brand underline" onClick={back}>‹ Back to Growth</button>
        <h2 ref={heading} tabIndex={-1} className="text-base font-bold focus:outline-sf-accent">{sections.find(section => section.key === current.growthSection)?.title}</h2>
      </div>
      <div id="growth-panel" className="min-w-0 space-y-4">{children(current.growthSection, current.filter ?? 'top', open)}</div>
    </> : <nav aria-label="Growth sections" className="space-y-3">
      {sections.map(section => <button key={section.key} type="button" onClick={() => open(section.key)} className="flex min-h-14 w-full min-w-0 items-center gap-2 rounded-xl border border-sf-line-soft bg-white p-4 text-left lg:p-5">
        <span className="min-w-0 flex-1 font-bold">{section.title}</span>
        {figures[section.key] && <span className="text-xs text-sf-muted">{figures[section.key]}</span>}
        <span aria-hidden="true">›</span>
      </button>)}
    </nav>}
  </div>;
}
