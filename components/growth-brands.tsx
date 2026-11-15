'use client';

import { useEffect, useId, useState } from 'react';
import type { BrandAreaCode } from '@/lib/brand-mapping';
import { normalizeGrowthBrands, type GrowthBrandLine, type GrowthBrandRow, type GrowthBrandsData } from '@/lib/growth-brand-types';
import { formatPaise } from '@/lib/wallet-format';

const card = 'min-w-0 space-y-3 rounded-xl border border-sf-line-soft bg-white p-4 lg:p-5';
const muted = 'text-xs text-sf-muted';
const button = 'min-h-9 rounded-lg border border-sf-line px-3 text-xs text-sf-brand';
const linkButton = 'min-h-9 text-left text-xs text-sf-brand underline';
const grid = 'sm:grid sm:grid-cols-[minmax(0,1fr)_6.5rem_5.5rem_6.5rem_4.5rem] sm:items-baseline sm:gap-2';
const cell = 'hidden text-right tabular-nums sm:block';
const defaultShown = 10;
const areaNames: Record<BrandAreaCode, string> = {
  HAEM: 'Haematology', BIOCHEM: 'Biochemistry', IMMUNO: 'Hormones / immunoassay', HBA1C: 'HbA1c',
  URINE: 'Urine', COAG: 'Coagulation', RAPID: 'Rapid tests / serology', CULTURE: 'Culture',
};
const pct = (n: number | null) => n === null ? '—' : `${n.toFixed(1)}%`;
const change = (h1: number, h2: number) => {
  if (h1 > 0) {
    const n = Math.round((h2 - h1) / h1 * 100);
    return n > 0 ? `+${n}%` : n < 0 ? `−${Math.abs(n)}%` : '0%';
  }
  return h2 > 0 ? 'New' : '—';
};
const lineLabel = (line: GrowthBrandLine) => {
  if (line.kind === 'individual') return 'Set individually';
  const group = line.group?.trim() ? line.group : null;
  if (line.kind === 'direct') return group === null ? 'No group' : `Directly under ${group}`;
  const base = group ?? 'No group';
  return line.areaCode ? `${base} · ${areaNames[line.areaCode]}` : base;
};
const metaLine = (m: GrowthBrandRow | GrowthBrandLine) => `Sales ${formatPaise(m.salesPaise)} · H2 vs H1 ${change(m.h1Paise, m.h2Paise)} · GP ${formatPaise(m.gpPaise)} · ${pct(m.marginPct)}`;

function Measures({ item }: { item: GrowthBrandRow | GrowthBrandLine }) {
  return <>
    <span aria-hidden="true" className={cell}>{formatPaise(item.salesPaise)}</span>
    <span aria-hidden="true" className={cell}>{change(item.h1Paise, item.h2Paise)}</span>
    <span aria-hidden="true" className={cell}>{formatPaise(item.gpPaise)}</span>
    <span aria-hidden="true" className={cell}>{pct(item.marginPct)}</span>
  </>;
}

function LineRow({ line }: { line: GrowthBrandLine }) {
  return <li className={`${grid} py-1 pl-4`}>
    <span className="min-w-0 break-words">{lineLabel(line)}</span>
    <Measures item={line} />
    <span className={`${muted} block sm:sr-only`}>{metaLine(line)}</span>
  </li>;
}

function BrandRow({ row, onOpenBrandSetup }: { row: GrowthBrandRow; onOpenBrandSetup: () => void }) {
  const [open, setOpen] = useState(false);
  const linesId = useId();
  return <li data-brand-row className="border-t border-sf-line-soft py-2 text-xs">
    <div className={grid}>
      <span className="min-w-0 break-words text-sm font-bold sm:text-xs">{row.name}</span>
      <Measures item={row} />
      <span className={`${muted} block sm:sr-only`}>{metaLine(row)}</span>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      {row.lines.length > 0 && <button type="button" className={button} aria-expanded={open} aria-controls={linesId} onClick={() => setOpen(v => !v)}>Lines ({row.lines.length})</button>}
      {row.kind === 'unmapped' && row.salesPaise !== 0 && <button type="button" className={linkButton} onClick={onOpenBrandSetup}>Map in Brand setup</button>}
    </div>
    {open && row.lines.length > 0 && <ul id={linesId} className="mt-1 space-y-1">{row.lines.map((line, i) => <LineRow key={`${line.kind}:${line.group ?? ''}:${line.areaCode ?? ''}:${i}`} line={line} />)}</ul>}
  </li>;
}

function BrandTable({ data, onOpenBrandSetup }: { data: GrowthBrandsData; onOpenBrandSetup: () => void }) {
  const [all, setAll] = useState(false);
  const brands = data.rows.filter(r => r.kind === 'brand');
  const others = data.rows.filter(r => r.kind !== 'brand');
  const shown = all ? brands : brands.slice(0, defaultShown);
  return <>
    <div aria-hidden="true" className={`${grid} hidden border-b border-sf-line pb-1 text-xs text-sf-muted sm:grid [&>span:not(:first-child)]:text-right`}>
      <span>Principal</span><span>Sales</span><span>H2 vs H1</span><span>Gross profit</span><span>Margin %</span>
    </div>
    <ul className="space-y-0">
      {shown.map(row => <BrandRow key={row.key} row={row} onOpenBrandSetup={onOpenBrandSetup} />)}
      {brands.length > defaultShown && !all && <li className="border-t border-sf-line-soft py-2"><button type="button" className={button} onClick={() => setAll(true)}>Show all {brands.length} principals</button></li>}
      {others.map(row => <BrandRow key={row.key} row={row} onOpenBrandSetup={onOpenBrandSetup} />)}
    </ul>
    <p className={muted}>Total {formatPaise(data.totals.salesPaise)} · instruments {formatPaise(data.totals.instrumentSalesPaise)} · consumables margin {pct(data.totals.marginPct)}. Same 12 months as Gross profit.</p>
  </>;
}

export function GrowthBrands({ onOpenBrandSetup }: { onOpenBrandSetup: () => void }) {
  const [data, setData] = useState<GrowthBrandsData | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/growth/brands', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const next = response.ok ? normalizeGrowthBrands(await response.json()) : null;
      if (!next) throw new Error('Principals are unavailable');
      if (!controller.signal.aborted) setData(next);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [revision]);
  return <section className={card} aria-labelledby="growth-brands-title">
    <h2 id="growth-brands-title" className="text-base font-bold">Sales by principal</h2>
    <p className={muted}>12 months · sales include instruments · margin is consumables only, average purchase cost</p>
    {error ? <div role="alert" className="text-xs">Principals are unavailable. <button type="button" className={button} onClick={() => { setError(false); setRevision(n => n + 1); }}>Retry</button></div>
      : !data ? <output className="block animate-pulse rounded bg-sf-soft-0 p-4 text-xs">Loading principals…</output>
      : <BrandTable data={data} onOpenBrandSetup={onOpenBrandSetup} />}
  </section>;
}
