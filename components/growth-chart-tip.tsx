'use client';

import { useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react';

type Tip = { text: string; left: number; top: number };

/** Turns a bar's aria-label into short tooltip text: "Mar: 72 labs buying, open list" -> "Mar · 72 labs buying". */
export function chartTipText(label: string) {
  return label.replace(/, open (?:list|labs)$/, '').replace(': ', ' · ');
}

/** One instance per chart. Spread `containerProps` on the chart wrapper and `tipProps(text)` on each bar. */
export function useChartTip() {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<Tip | null>(null);
  const hide = () => setState(null);
  const place = (text: string, x: number, y: number) => {
    const width = container.current?.getBoundingClientRect().width ?? 0;
    const left = width > 128 ? Math.min(Math.max(x, 64), width - 64) : x;
    setState(current => current && current.text === text && current.left === left && current.top === y ? current : { text, left, top: y });
  };
  const atPointer = (text: string) => (e: PointerEvent<SVGElement>) => {
    if (e.pointerType !== 'mouse') return;
    const box = container.current?.getBoundingClientRect();
    if (box) place(text, e.clientX - box.left, Math.max(e.clientY - box.top, 28));
  };
  const tipProps = (text: string) => ({
    onPointerEnter: atPointer(text),
    onPointerMove: atPointer(text),
    onFocus: (e: FocusEvent<SVGElement>) => {
      const box = container.current?.getBoundingClientRect();
      if (!box) return;
      const bar = e.currentTarget.getBoundingClientRect();
      place(text, bar.left + bar.width / 2 - box.left, Math.max(bar.top - box.top, 28));
    },
    onBlur: hide,
  });
  const tip: ReactNode = state && <div aria-hidden="true" data-chart-tip className="pointer-events-none absolute z-10 max-w-[16rem] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-sf-line-soft bg-white px-2 py-1 text-xs tabular-nums text-sf-ink shadow-sm" style={{ left: state.left, top: state.top - 8 }}>{state.text}</div>;
  return { tipProps, tip, containerProps: { ref: container, className: 'relative', onPointerLeave: hide } };
}
