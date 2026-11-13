'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { GrowthData } from '@/lib/growth-types';
import { normalizeGrowthMargin, normalizeGrowthBilledBelow, type GrowthBilledBelow, type GrowthMarginData, type GrowthMarginView, type GrowthMarginSort, type GrowthMarginFilter } from '@/lib/growth-margin-types';
import { formatPaise } from '@/lib/wallet-format';
import type { GrowthNavigation, GrowthSelection } from './growth-drilldown';
import { chartTipText, useChartTip } from './growth-chart-tip';
import { GrowthMarginDetail, GrowthBilledBelowDetail, type MarginSelection } from './growth-margin-detail';

const card = 'min-w-0 space-y-3 rounded-xl border border-sf-line-soft bg-white p-4 lg:p-5';
const muted = 'text-xs text-sf-muted';
const button = 'min-h-9 rounded-lg border border-sf-line px-3 text-xs text-sf-brand';
const lakh = (n: number) => `₹${(n / 1e7).toFixed(1)} L`;
const pct = (n: number | null) => n === null ? '—' : `${n.toFixed(1)}%`;
const monthLabel = (s: string, full = false) => new Date(`${s}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', ...(full ? { year: 'numeric' } : {}), timeZone: 'UTC' });
const instrumentRule = 'Any item whose average purchase cost is ₹25,000 or more counts as an instrument, wherever it is invoiced.';
const tone = (n: number | null, threshold: number) => n === null ? 'text-sf-muted' : n < 0 ? 'text-sf-danger' : n < threshold ? 'text-sf-warning' : '';

function BilledBelowCheck({ navigation }: { navigation: GrowthNavigation }) {
  const [data, setData] = useState<GrowthBilledBelow | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    void fetch('/api/growth/margin?billedBelow=1&page=1', { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const value = normalizeGrowthBilledBelow(await response.json());
      if (!value || value.page !== 1) throw new Error();
      if (!controller.signal.aborted) setData(value);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [revision]);
  return <li><div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_160px]"><div><strong>Billed below approved price.</strong>
    {error ? <p role="alert">Couldn&apos;t load this check <button className={button} onClick={() => setRevision(n => n + 1)}>Retry</button></p> : !data ? <p role="status">Loading this check…</p> : data.approvedPricesInUse === 0 ? <p>No approved customer prices yet. Once prices are approved through Review prices, invoices billed below them appear here.</p> : <p>{data.lines} invoice lines billed under the approved price.{data.unitMismatchLines > 0 && ` · ${data.unitMismatchLines} skipped: unit looks different`}</p>}
    </div>{!error && data && data.approvedPricesInUse > 0 && <div className="space-y-2 lg:text-right"><strong className="block">{formatPaise(data.gapPaise)} so far</strong><button className={button} onClick={() => setOpen(true)}>See lines</button></div>}</div>
    {open && <GrowthBilledBelowDetail navigation={navigation} onClose={() => setOpen(false)} />}
  </li>;
}

function ProfitMonths({ data, onDrill, scope }: { data: GrowthData; scope: string; onDrill: (selection: GrowthSelection) => void }) {
  const [table, setTable] = useState(false);
  const { tipProps, tip, containerProps } = useChartTip();
  const gp = data.gp;
  if (!gp || !gp.consumables || !gp.instruments || !gp.months.every(m => m.consumablesKnownSalesPaise !== undefined && m.consumablesGpPaise !== undefined && m.instrumentsKnownSalesPaise !== undefined && m.instrumentsGpPaise !== undefined)) return null;
  const rows = gp.months.map(m => ({ ...m, consumables: m.consumablesGpPaise!, instruments: m.instrumentsGpPaise!, margin: m.consumablesKnownSalesPaise ? m.consumablesGpPaise! / m.consumablesKnownSalesPaise * 100 : null }));
  const margins = rows.flatMap(m => m.margin === null ? [] : [m.margin]);
  const high = Math.max(1, ...rows.flatMap(m => [m.consumables, m.instruments]));
  const low = Math.min(-high / 3, ...rows.flatMap(m => [m.consumables, m.instruments]));
  const y = (n: number) => 32 + (high - n) / (high - low) * 220;
  const open = (i: number) => onDrill({ list: 'month_buying', month: rows[i].month, count: data.months[i].labsBuying, title: `Labs buying, ${monthLabel(rows[i].month, true)}`, explanation: 'Labs with sales in this month.' });
  return <section className={card} aria-labelledby="gp-month-title">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="gp-month-title" className="text-base font-bold">Gross profit by month</h2><button className="min-h-11 text-xs text-sf-brand underline" aria-expanded={table} aria-controls={table ? 'gp-month-table' : 'gp-month-chart'} onClick={() => setTable(!table)}>{table ? 'View as chart' : 'View as table'}</button></div>
    <p className={muted}>{scope} · average purchase cost · consumables and instruments shown apart</p>
    <p className="text-sm font-bold">{margins.length ? `Consumables earn ${Math.min(...margins).toFixed(1)}–${Math.max(...margins).toFixed(1)}% a month` : 'Consumables margin is not known yet'}{gp.instruments.gpPaise < 0 ? `; instrument sales ran ${lakh(-gp.instruments.gpPaise)} below cost, to be recovered through reagents.` : '.'}</p>
    <p className="text-xs text-sf-brand">Tap a bar to see that month&apos;s labs.</p>
    {table ? <table id="gp-month-table" className="w-full table-fixed text-xs tabular-nums [&_th]:p-1 [&_td]:p-1 [&_th]:font-normal [&_td]:text-right"><caption className="text-left text-sf-muted">Gross profit by month · {scope} · average purchase cost</caption><thead><tr>{['Month', 'Consumables GP', 'Consumables %', 'Instruments GP'].map(t => <th key={t} scope="col">{t}</th>)}</tr></thead><tbody>{rows.map((m, i) => <tr key={m.month}><th scope="row"><button className="min-h-11 text-left text-sf-brand underline" onClick={() => open(i)}>{monthLabel(m.month, true)}</button></th><td>{formatPaise(m.consumables)}</td><td>{pct(m.margin)}</td><td>{formatPaise(m.instruments)}</td></tr>)}</tbody></table> : <div id="gp-month-chart" {...containerProps}>
      <svg className="block h-[306px] w-full" role="group" aria-labelledby="gp-svg-title gp-svg-desc"><title id="gp-svg-title">Gross profit by month</title><desc id="gp-svg-desc">Consumables and instruments gross profit in ₹ thousand, above and below zero. {rows.map(m => `${monthLabel(m.month, true)}: consumables ${formatPaise(m.consumables)}, ${pct(m.margin)}; instruments ${formatPaise(m.instruments)}`).join('; ')}</desc><text x="0" y="14" className="fill-sf-muted text-[10px]">₹ thousand</text>
        {[low, 0, high / 3, high * 2 / 3, high].map((v, i) => <g key={i}><line x1="9%" x2="99%" y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--sf-line-strong)' : 'var(--sf-line-soft)'} /><text x="8%" y={y(v) + 4} textAnchor="end" className="fill-sf-label text-[10px]">{v < 0 ? '−' : ''}{(Math.abs(v) / 1e5).toFixed(0)}</text></g>)}
        {rows.map((m, i) => <g key={m.month}>{[m.consumables, m.instruments].map((v, j) => { const label = `${monthLabel(m.month)}: ${j ? 'instruments and bulk' : 'consumables'} gross profit ${formatPaise(v)}${j ? '' : `, ${pct(m.margin)}`}, open labs`; return <rect key={j} role="button" tabIndex={0} aria-label={label} {...tipProps(chartTipText(label))} onClick={() => open(i)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(i); } }} className="cursor-pointer focus:stroke-sf-ink focus:stroke-2" x={`${10 + i * 7.35 + j * 4.5}%`} width={`${j ? 1.8 : 4.2}%`} y={y(Math.max(v, 0))} height={Math.max(2, Math.abs(y(v) - y(0)))} rx="1" fill={`var(--sf-${j ? 'warning' : 'brand'})`} />; })}<text x={`${12.1 + i * 7.35}%`} y={y(Math.max(m.consumables, 0)) - 7} textAnchor="middle" className="hidden fill-sf-label text-[9px] sm:block">{pct(m.margin)}</text><text x={`${13 + i * 7.35}%`} y="290" textAnchor="middle" className="fill-sf-label text-[10px]">{monthLabel(m.month)}</text></g>)}
      </svg><div className="flex flex-wrap gap-3 text-xs text-sf-muted">{['Consumables', 'Instruments & bulk'].map((label, i) => <span key={label} className="inline-flex items-center gap-1"><i className={`size-2 rounded-sm ${i ? 'bg-sf-warning' : 'bg-sf-brand'}`} />{label}</span>)}</div>{tip}
    </div>}
    <p className={muted}>Cost is known for {gp.window.coveragePct ?? '—'}% of sales; {gp.window.unreliableLines ?? 0} lines are left out where sale and cost units look different.</p>
  </section>;
}

export function GrowthProfit({ data, scope, onDrill, navigation }: { data: GrowthData; scope: string; onDrill: (selection: GrowthSelection) => void; navigation: GrowthNavigation }) {
  const formId = useId();
  const [levers, setLevers] = useState<GrowthMarginData | null>(null);
  const [leverError, setLeverError] = useState(false);
  const [leverRevision, setLeverRevision] = useState(0);
  const [query, setQuery] = useState({ view: 'labs' as GrowthMarginView, sort: 'sales' as GrowthMarginSort, filter: 'all' as GrowthMarginFilter, q: '' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<GrowthMarginData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState<MarginSelection | null>(null);
  const explorer = useRef<HTMLElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLeverError(false);
    void fetch('/api/growth/margin?view=items&page=1', { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const value = normalizeGrowthMargin(await response.json());
      if (!value || value.view !== 'items' || value.page !== 1) throw new Error();
      if (!controller.signal.aborted) setLevers(value);
    }).catch(() => { if (!controller.signal.aborted) setLeverError(true); });
    return () => controller.abort();
  }, [leverRevision]);
  const update = (next: Partial<typeof query>) => { setQuery(current => ({ ...current, ...next })); setPage(1); setResult(null); };
  useEffect(() => {
    if (query.q === search.trim()) return;
    const timer = setTimeout(() => { setQuery(current => ({ ...current, q: search.trim() })); setPage(1); setResult(null); }, 300);
    return () => clearTimeout(timer);
  }, [search, query.q]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false);
    const params = new URLSearchParams({ view: query.view, page: String(page), sort: query.sort, filter: query.filter, ...(query.q ? { q: query.q } : {}) });
    void fetch(`/api/growth/margin?${params}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const value = normalizeGrowthMargin(await response.json());
      if (!value || value.view !== query.view || value.sort !== query.sort || value.filter !== query.filter || value.q !== (query.q || null) || value.page !== page) throw new Error();
      if (!controller.signal.aborted) setResult(previous => ({ ...value, rows: page === 1 ? value.rows : [...(previous?.view === value.view ? previous.rows : []), ...value.rows] }) as GrowthMarginData);
    }).catch(() => { if (!controller.signal.aborted) setError(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, page, revision]);
  const jump = (kind: 'spread' | 'low') => { setSearch(''); update({ view: 'items', sort: kind === 'spread' ? 'spread' : 'sales', filter: kind === 'low' ? 'low' : 'all', q: '' }); explorer.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  const l = levers?.levers;
  const sorts: [GrowthMarginSort, string][] = [['sales', 'Sales'], ['gp', 'Gross profit'], ['margin', 'Margin %'], ['margin_asc', 'Margin % low first'], ...(query.view === 'items' ? [['spread', 'Price spread ₹'] as [GrowthMarginSort, string]] : [])];
  const filters: [GrowthMarginFilter, string][] = [['all', 'All'], ['low', 'Low margin'], ...(query.view === 'labs' ? [['unlinked', 'Unlinked'] as [GrowthMarginFilter, string]] : [['below_cost', 'Below cost'] as [GrowthMarginFilter, string], ['spread', 'Price spread'] as [GrowthMarginFilter, string]])];
  const sortHeader = (sort: GrowthMarginSort, label: string) => <th scope="col" aria-sort={query.sort === sort || sort === 'margin' && query.sort === 'margin_asc' ? query.sort === 'margin_asc' ? 'ascending' : 'descending' : 'none'} className="p-1 text-right font-normal"><button className="min-h-9 text-sf-brand" aria-label={`Sort ${query.view} by ${label}`} onClick={() => update({ sort: sort === 'margin' && query.sort === 'margin' ? 'margin_asc' : sort })}>{label}</button></th>;
  return <>
    <ProfitMonths data={data} scope={scope} onDrill={onDrill} />
    <section className={card} aria-labelledby="margin-grow-title"><h2 id="margin-grow-title" className="text-base font-bold">Where margin can grow</h2><p className={muted}>Consumables · 12 months · ranked by ₹ a year</p><p className="text-sm font-bold">The biggest lever is price consistency: some labs pay far less than others for the same item.</p><p className={muted}>Instruments excluded by item · average purchase cost ≥ ₹25,000</p>
      {leverError ? <div role="alert" className="text-xs">Margin opportunities are unavailable. <button className={button} onClick={() => setLeverRevision(n => n + 1)}>Retry</button></div> : !l && <p role="status" className="animate-pulse rounded bg-sf-soft-0 p-4 text-xs">Loading margin opportunities…</p>}
      <ol className="list-decimal space-y-3 pl-5 text-sm [&>li]:border-t [&>li]:border-sf-line-soft [&>li]:pt-3 [&_p]:mt-1 [&_p]:text-xs [&_p]:text-sf-muted">
        {l && <>
        <li><div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_160px]"><div><strong>Same item, different prices.</strong><p>{l.priceSpread.items} items where some labs pay under 90% of the typical price · {l.priceSpread.pairs} lab–item pairs.</p><p>Some low prices may be deliberate volume rates; check the quantity before changing a price.</p></div><div className="space-y-2 lg:text-right"><strong className="block">up to {lakh(l.priceSpread.paise)} a year</strong><button className={button} onClick={() => jump('spread')} aria-label="See items with different prices by lab">See items</button></div></div></li>
        <li><div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_160px]"><div><strong>Low-margin consumables.</strong><p>{l.lowMargin.items} items. {l.lowMargin.examples.map(e => `${e.name ?? 'Unnamed item'} ${pct(e.marginPct)} on ${lakh(e.salesPaise)} across ${e.labs} labs`).join('; ')}. Reprice, or ask the principal for a better rate.</p></div><div className="space-y-2 lg:text-right"><strong className="block">{lakh(l.lowMargin.paiseToThreshold)} a year</strong><p>to reach {levers.thresholdPct}%</p><button className={button} onClick={() => jump('low')} aria-label="See low-margin consumable items">See items</button></div></div></li>
        </>}
        <BilledBelowCheck navigation={navigation} />
        {l && <>
        <li><div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_160px]"><div><strong>Free goods in regular invoices.</strong><p>{l.freeGoods.lines} lines given free.</p></div><div className="space-y-2 lg:text-right"><strong className="block text-sm">₹{(l.freeGoods.costPaise / 1e7).toFixed(2)} L a year</strong><p>Lines are listed in a later step</p></div></div></li>
        <li><div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_160px]"><div><strong>Instruments below cost.</strong><p>{l.instrumentsGpPaise < 0 ? `Instrument sales ran ${lakh(-l.instrumentsGpPaise)} below cost; recovered only if the lab buys reagents.` : `Instrument gross profit ${lakh(l.instrumentsGpPaise)}.`}</p></div>{navigation.onOpenEconomics && <div className="lg:text-right"><button className={button} onClick={navigation.onOpenEconomics}>Open Economics</button></div>}</div></li>
        <li className="text-sf-muted"><strong>Not measurable yet</strong><p>Principal mix and terms, which need Brand setup; discounts, since Tally lines carry no discount; cost to serve.</p></li>
        </>}
      </ol><p className={muted}>{instrumentRule}</p><p className={muted}>Price changes are made by people in Pricing; nothing changes automatically. Accepted reviews can become Action inbox cards in a later step.</p>
      <p className={muted}>Tally invoices aren&apos;t changed by StockFlow; this check finds lines billed below an approved price so billing can correct them.</p>
    </section>
    <section ref={explorer} id="margin-explorer" className={`${card} scroll-mt-4`} aria-labelledby="margin-explorer-title"><h2 id="margin-explorer-title" className="text-base font-bold">Margin by lab and item</h2><p className={muted}>Consumables only · 12 months · average purchase cost · instruments excluded by item</p><p className={muted}>Instruments: average purchase cost ≥ ₹25,000, wherever invoiced · consumables margin {pct(result?.consumablesMarginPct ?? levers?.consumablesMarginPct ?? null)} · low margin &lt; {result?.thresholdPct ?? levers?.thresholdPct ?? '—'}%</p>
      <div role="tablist" aria-label="Margin by lab or item" className="flex gap-2 border-b border-sf-line">{(['labs', 'items'] as const).map(view => <button key={view} id={`margin-tab-${view}`} role="tab" aria-selected={query.view === view} aria-controls="margin-panel" tabIndex={query.view === view ? 0 : -1} className={`min-h-11 border-b-2 px-4 text-sm font-bold ${query.view === view ? 'border-sf-brand text-sf-brand' : 'border-transparent text-sf-muted'}`} onClick={() => { setSearch(''); update({ view, sort: 'sales', filter: 'all', q: '' }); }} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 'labs' : e.key === 'End' ? 'items' : view === 'labs' ? 'items' : 'labs'; setSearch(''); update({ view: next, sort: 'sales', filter: 'all', q: '' }); document.getElementById(`margin-tab-${next}`)?.focus(); } }}>{view === 'labs' ? 'Labs' : 'Items'}</button>)}</div>
      <div id="margin-panel" role="tabpanel" aria-labelledby={`margin-tab-${query.view}`}><div className="my-3 flex flex-wrap gap-2"><div className="min-w-0 flex-[1_1_180px] text-xs"><label htmlFor={`${formId}-search`}>Search {query.view}</label><input id={`${formId}-search`} type="search" maxLength={60} value={search} onChange={e => setSearch(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-sf-line px-2 text-sm" /></div><div className="grid min-w-0 gap-1 text-xs"><label htmlFor={`${formId}-sort`}>Sort</label><select id={`${formId}-sort`} className="min-h-11 max-w-full rounded-lg border border-sf-line bg-white px-2" value={query.sort} onChange={e => update({ sort: e.target.value as GrowthMarginSort })}>{sorts.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div role="group" aria-label={`Filter ${query.view} by margin`} className="flex basis-full flex-wrap gap-1">{filters.map(([filter, label]) => <button key={filter} className={`min-h-9 rounded-full border border-sf-line px-2 text-xs ${query.filter === filter ? 'bg-sf-ink text-white' : 'bg-white'}`} aria-label={`${label} ${query.view}`} aria-pressed={query.filter === filter} onClick={() => update({ filter })}>{label}</button>)}</div></div>
      {loading && <p role="status" className="animate-pulse rounded bg-sf-soft-0 p-4 text-xs">Loading margins…</p>}{error && <div role="alert" className="text-xs">Margins are unavailable. <button className={button} onClick={() => setRevision(n => n + 1)}>Retry</button></div>}
      {result && <><table className="w-full table-fixed text-xs tabular-nums [&_td]:p-1 [&_td]:text-right"><caption className="sr-only">{query.view === 'labs' ? 'Lab' : 'Item'} consumables margin · 12 months · average purchase cost</caption><thead className="hidden sm:table-header-group"><tr><th scope="col" className={`${query.view === 'labs' ? 'w-[41%]' : 'w-[30%]'} text-left font-normal`}>{query.view === 'labs' ? 'Lab' : 'Item'}</th>{sortHeader('sales', 'Sales')}{sortHeader('gp', 'Gross profit')}{sortHeader('margin', 'Margin %')}{query.view === 'items' && <><th className="text-right font-normal">Labs</th>{sortHeader('spread', 'Price range')}</>}</tr></thead><tbody>{result.rows.map(row => { const item = 'itemKey' in row; const label = row.name ?? (item ? 'Unnamed item' : '(unlinked ledger)'); const open = () => setSelection(item ? { itemKey: row.itemKey } : { labKey: row.labKey }); return <tr key={item ? row.itemKey : row.labKey} className="border-b border-sf-line-soft hover:bg-sf-soft-0" onClick={open}><th scope="row" className="py-2 text-left font-normal [overflow-wrap:anywhere]"><button className="min-h-9 w-full text-left text-sm font-medium focus-visible:outline-offset-[-2px]" onClick={e => { e.stopPropagation(); open(); }} aria-label={`${label}: open ${item ? 'labs and prices' : 'items bought'}`}>{label}</button>{!item && row.town && <span className={muted}> · {row.town}</span>}<span className="block text-xs text-sf-muted sm:hidden">Sales {formatPaise(row.salesPaise)} · GP {formatPaise(row.gpPaise)} · <span className={tone(row.marginPct, result.thresholdPct)}>{pct(row.marginPct)}</span></span></th><td className="hidden sm:table-cell">{formatPaise(row.salesPaise)}</td><td className="hidden sm:table-cell">{formatPaise(row.gpPaise)}</td><td className={`hidden sm:table-cell ${tone(row.marginPct, result.thresholdPct)}`}>{pct(row.marginPct)}</td>{item && <><td className="hidden sm:table-cell">{row.labs}</td><td className="hidden sm:table-cell">{row.priceLowPaise === null || row.priceHighPaise === null ? '—' : `${formatPaise(row.priceLowPaise)}–${formatPaise(row.priceHighPaise)}`}<span className="block text-[11px] text-sf-muted">typical {row.typicalPricePaise === null ? '—' : formatPaise(row.typicalPricePaise)}</span></td></>}</tr>; })}</tbody></table>{!result.rows.length && <p className="py-3 text-xs text-sf-muted">No matching {query.view}.</p>}<div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p role="status" className={muted}>Showing {result.rows.length} of {result.total} {query.view}</p>{result.rows.length < result.total && <button className={button} disabled={loading || error} onClick={() => setPage(p => p + 1)}>Load more</button>}</div></>}
      </div><p className={muted}>{instrumentRule} Margin uses average purchase cost. Prices are reviewed by people; nothing changes automatically.</p>
    </section>
    {selection && <GrowthMarginDetail key={'itemKey' in selection ? selection.itemKey : selection.labKey} selection={selection} navigation={navigation} onClose={() => setSelection(null)} />}
  </>;
}
