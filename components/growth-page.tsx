'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { normalizeGrowth, plainReason, type GrowthData, type GrowthMeasures } from '@/lib/growth-types';
import { GrowthDrilldown, type GrowthNavigation, type GrowthSelection } from './growth-drilldown';
import { formatPaise } from '@/lib/wallet-format';
import { GrowthInbox } from './growth-inbox';
import { GrowthProfit, type ProfitPeriod } from './growth-profit';
import { GrowthLabMonths } from './growth-lab-months';
import { GrowthCohorts } from './growth-cohorts';
import { GrowthBrands } from './growth-brands';
import { GrowthSections, usePhoneLayout } from './growth-sections';
import { chartTipText, useChartTip } from './growth-chart-tip';
import { formatGrowthPeriodParam, type GrowthPeriodData } from '@/lib/growth-period-types';
import { normalizeGrowthPeriodGp, type GrowthPeriodGp } from '@/lib/growth-period-profit-types';
import { GrowthPeriodPicker, GrowthPeriodRevenue, GrowthPeriodBridge, useGrowthPeriodSelection, useGrowthPeriodData, todayIst, periodChangeLabel, comparisonNote } from './growth-period';

export const lakh = (n: number) => `₹${(n / 1e7).toFixed(1)} L`;
export const rupees = (n: number) => formatPaise(Math.round(n / 100) * 100);
/** Chart labels: amounts under ₹1 L in rupees so small months never read "₹0.0 L". */
const chartMoney = (n: number) => n === 0 ? '₹0' : Math.abs(n) >= 1e7 ? lakh(n) : rupees(n);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const months = (m: GrowthMeasures) => m.labsBuying ? m.buyingMonths / m.labsBuying : 0;
const change = (a: number | null, b: number | null) => a === null || b === null || a === 0 ? null : (b - a) / Math.abs(a) * 100;
export const changeLabel = (a: number | null, b: number | null) => { const n = change(a, b); return n === null ? '—' : `${n >= 0 ? '+' : '−'}${Math.round(Math.abs(n))}%`; };
const month = (s: string) => new Date(s).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
const monthYear = (s: string | number) => new Date(s).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const previousDay = (s: string) => new Date(Date.parse(s) - 86400000).toISOString().slice(0, 10);
export const card = 'min-w-0 space-y-3 rounded-xl border border-sf-line-soft bg-white p-4 lg:p-5';
const muted = 'text-xs text-sf-muted';
const growthTabs = [{ id: 'revenue', label: 'Revenue' }, { id: 'bridge', label: 'H1 → H2' }, { id: 'monthly', label: 'Monthly' }, { id: 'profit', label: 'Profit' }] as const;
type GrowthTab = typeof growthTabs[number]['id'];
const toggleClass ='min-h-11 shrink-0 text-xs text-sf-brand underline';
/** Waits for a tab panel to mount, then scrolls the target into view. */
const scrollToWhenReady = (id: string, tries = 20) => {
  const el = document.getElementById(id);
  if (!el) { if (tries > 0) setTimeout(() => scrollToWhenReady(id, tries - 1), 50); return; }
  el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  // Sections above may still be loading and push the target down; re-align while they settle.
  for (const delay of [400, 900, 1600]) setTimeout(() => { const top = el.getBoundingClientRect().top; if (el.isConnected && (top < -8 || top > 120)) el.scrollIntoView({ block: 'start' }); }, delay);
};

function RevenueMonths({ data, onDrill }: { data: GrowthData; onDrill: (s: GrowthSelection) => void }) {
  const { tipProps, tip, containerProps } = useChartTip();
  const ms = data.months, max = Math.max(1, ...ms.map(m => m.salesPaise)), total = ms.reduce((n, m) => n + m.salesPaise, 0);
  const first = data.health.history.firstSaleOn, w = 92 / Math.max(1, ms.length);
  return <section id="revenue-months" className={`${card} scroll-mt-4`} aria-labelledby="revenue-months-title">
    <h2 id="revenue-months-title" className="text-base font-bold">Revenue by month</h2>
    <p className={muted}>{ms.length} months · {lakh(total)} · all sales · hover a bar for its value, tap for that month&apos;s labs</p>
    <div {...containerProps}><svg className="block h-[220px] w-full" aria-label="Revenue by month chart">
      {[0, 1, 2, 3, 4].map(n => <g key={n}><line x1="6%" x2="99%" y1={190 - n * 42.5} y2={190 - n * 42.5} stroke="var(--color-sf-chart-grid)" /><text x="5%" y={194 - n * 42.5} textAnchor="end" className="fill-sf-muted text-[10px]">{(max / 1e7 * n / 4).toFixed(0)}</text></g>)}
      {ms.map((m, i) => { const x = 7 + i * w, h = m.salesPaise / max * 170, label = `${monthYear(m.month + '-01')}: revenue ${chartMoney(m.salesPaise)}, ${plural(m.labsBuying, 'lab', 'labs')} buying`; return <g key={m.month}><rect {...tipProps(chartTipText(label))} {...barButton(`${label}, open list`, () => onDrill({ list: 'month_buying', month: m.month, count: m.labsBuying, title: `Labs buying in ${monthYear(m.month + '-01')}`, explanation: 'Labs with sales in this month.' }))} x={`${x}%`} y={190 - h} width={`${w * 0.7}%`} height={Math.max(2, h)} rx="1" fill="var(--color-sf-chart-1)" /><text x={`${x + w * 0.35}%`} y="208" textAnchor="middle" className="fill-sf-label text-[10px]">{month(m.month + '-01')}</text></g>; })}
    </svg>{tip}</div>
    <p className={muted}>₹ L. Last 12 months. StockFlow holds sales from {first ? monthYear(first) : '—'}; a longer trend comes with the Tally history load.</p>
  </section>;
}

export function Table({ caption, headings, rows }: { caption: string; headings: string[]; rows: ReactNode[][] }) {
  return <table className="w-full table-fixed border-collapse text-xs tabular-nums [&_th]:font-normal [&_th]:text-sf-muted [&_td]:text-right [&_td]:text-[15px] [&_td]:leading-5 [&_th]:p-1.5 [&_td]:p-1.5 [&_th]:border-b [&_td]:border-b [&_th]:border-sf-line-soft [&_td]:border-sf-line-soft [&_th]:align-top [&_td]:align-top [&_td]:break-words"><caption className="mb-2 text-left text-xs text-sf-muted">{caption}</caption><thead><tr>{headings.map((v, i) => <th key={v} scope="col" className={i ? 'text-right' : 'w-[34%] text-left'}>{v}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((v, j) => j ? <td key={j}>{v}</td> : <th key={j} scope="row" className="text-left">{v}</th>)}</tr>)}</tbody></table>;
}
function Node({ label, value, note, hero = false, onOpen }: { label: string; value: string; note: string; hero?: boolean; onOpen?: () => void }) {
  return <div {...(onOpen ? barButton(`${label}: ${value}, open list`, onOpen) : {})} className={`min-w-0 rounded-[10px] border p-3 ${hero ? 'border-sf-brand bg-sf-brand text-white' : 'border-sf-line bg-sf-soft-0'}`}><span className={`block text-xs ${hero ? '' : 'text-sf-label'}`}>{label}</span><strong className={`block tabular-nums ${hero ? 'text-xl' : 'text-base'}`}>{value}</strong><p className={`text-xs ${hero ? '' : 'text-sf-muted'}`}>{note}</p></div>;
}
function Toggle({ name, table, onClick }: { name: string; table: boolean; onClick: () => void }) {
  return <button type="button" className={toggleClass} aria-expanded={table} aria-controls={`${name}-${table ? 'table' : 'chart'}`} onClick={onClick}>{table ? 'View as chart' : 'View as table'}</button>;
}

function Revenue({ data, scope, comparison, onDrill }: { data: GrowthData; scope: string; comparison: string; onDrill: (s: GrowthSelection) => void }) {
  const [table, setTable] = useState(false);
  const t = data.tree, [a, b] = data.halves, pct = data.health.gp.costedPct;
  const gpNote = pct === null ? 'Not measured yet · cost not computed yet' : `${pct < 50 ? 'Not measured yet · c' : 'C'}ost known for ${pct}% of sales`;
  const drivers = [
    { n: change(a.labsBuying, b.labsBuying), text: 'Growth came from more labs buying.' },
    { n: change(months(a), months(b)), text: 'Growth came from labs buying more often.' },
    { n: change(a.perBuyingMonthPaise, b.perBuyingMonthPaise), text: 'Growth came from labs spending more each time, not from more labs.' },
  ].filter(v => v.n !== null && v.n > 0).sort((x, y) => y.n! - x.n!);
  const headline = b.repeatPaise < a.repeatPaise ? 'Repeat sales fell; see the bridge for where.' : drivers[0]?.text;
  const rows = [
    ['Revenue', lakh(t.revenuePaise), 'Repeat sales + instrument & bulk'],
    ['Repeat sales', lakh(t.repeatPaise), 'invoices under ₹2 L'],
    ['Labs buying', String(t.labsBuying), 'Bought in this period'],
    ['Buying months per lab', months(t).toFixed(1), 'Average per lab'],
    ['₹ per buying month', t.perBuyingMonthPaise === null ? '—' : rupees(t.perBuyingMonthPaise), 'Repeat sales per buying month'],
    ['Instrument & bulk', lakh(t.bulkPaise), `${t.bulkInvoices} invoices of ₹2 L or more`],
    ['Gross profit', pct === null || pct < 50 ? 'Not measured yet' : 'Unknown', gpNote],
  ];
  const selectionFor = (label: string, half?: 'H1' | 'H2'): GrowthSelection => {
    const measures = half ? data.halves[half === 'H1' ? 0 : 1] : t;
    const bulk = label === 'Instrument & bulk';
    const sort = label === '₹ per buying month' ? 'per_month' : label === 'Labs buying' || label === 'Buying months per lab' ? 'months' : 'value';
    const from = half === 'H2' ? data.window.h2From : data.window.from;
    const to = half === 'H1' ? data.window.h2From : data.window.to;
    return { list: bulk ? 'bulk_invoices' : 'window_labs', half, sort: bulk ? 'value' : sort, count: bulk ? measures.bulkInvoices : measures.labsBuying, title: `${bulk ? 'Instrument & bulk' : 'Labs by sales'}, ${monthYear(from)} – ${monthYear(previousDay(to))}`, explanation: bulk ? 'Sales invoices of ₹2 L or more in this period.' : 'Labs with sales in this period.' };
  };
  const periodCell = (value: string, label: string, half: 'H1' | 'H2') => <button type="button" className="min-h-11 text-sf-brand underline" aria-label={`${half}: ${value} ${label.toLowerCase()}, open list`} onClick={() => onDrill(selectionFor(label, half))}>{value}</button>;
  const formula = t.perBuyingMonthPaise === null ? null : `${t.labsBuying} × ${months(t).toFixed(1)} × ${rupees(t.perBuyingMonthPaise)} = ${lakh(t.repeatPaise)}`;
  const comparisonRows = [
    ['Labs buying', String(a.labsBuying), String(b.labsBuying), changeLabel(a.labsBuying, b.labsBuying)],
    ['Buying months per lab', months(a).toFixed(1), months(b).toFixed(1), changeLabel(months(a), months(b))],
    ['₹ per buying month', a.perBuyingMonthPaise === null ? '—' : rupees(a.perBuyingMonthPaise), b.perBuyingMonthPaise === null ? '—' : rupees(b.perBuyingMonthPaise), changeLabel(a.perBuyingMonthPaise, b.perBuyingMonthPaise)],
    ['Repeat sales', lakh(a.repeatPaise), lakh(b.repeatPaise), changeLabel(a.repeatPaise, b.repeatPaise)],
    ['Instrument & bulk', lakh(a.bulkPaise), lakh(b.bulkPaise), changeLabel(a.bulkPaise, b.bulkPaise)],
  ];
  return <section className={card} aria-labelledby="revenue-title"><div className="flex items-center justify-between gap-2"><h2 id="revenue-title" className="text-base font-bold">Where revenue comes from</h2><Toggle name="tree" table={table} onClick={() => setTable(!table)} /></div>{headline && <p className="text-xs font-bold text-sf-ink">{headline}</p>}<p className={muted}>{scope} · all sales</p>
    {table ? <div id="tree-table"><Table caption={`Revenue tree · ${scope}`} headings={['Measure', 'Value', 'Note']} rows={rows.map(row => row[0] === 'Gross profit' ? row : [<button key="label" className="min-h-11 text-left text-sf-brand underline" onClick={() => onDrill(selectionFor(row[0]))}>{row[0]}</button>, <button key="value" className="min-h-11 text-sf-brand underline" onClick={() => onDrill(selectionFor(row[0]))}>{row[1]}</button>, row[2]])} /></div> : (
      <div id="tree-chart" aria-label="Revenue growth tree" className="grid gap-4 lg:grid-cols-[minmax(100px,.8fr)_minmax(0,2.4fr)]">
        <div className="relative after:absolute after:top-full after:left-3 after:h-[17px] after:border-l after:border-sf-line-strong lg:after:top-[27px] lg:after:left-full lg:after:h-0 lg:after:w-[17px] lg:after:border-l-0 lg:after:border-t">
          <Node label={rows[0][0]} value={rows[0][1]} note={rows[0][2]} onOpen={() => onDrill(selectionFor(rows[0][0]))} />
        </div>
        <div className="ml-3 space-y-3 border-l border-sf-line-strong pl-4 lg:ml-0">
          <div className="relative before:absolute before:top-[27px] before:-left-[17px] before:w-4 before:border-t before:border-sf-line-strong"><Node label={rows[1][0]} value={rows[1][1]} note={rows[1][2]} onOpen={() => onDrill(selectionFor(rows[1][0]))} /></div>
          <div className="ml-3 grid gap-3 border-l border-sf-line-strong pl-4 sm:ml-0 sm:grid-cols-3 sm:border-l-0 sm:border-t sm:pl-0 sm:pt-3">
            {rows.slice(2, 5).map(row => <div key={row[0]} className="relative before:absolute before:top-[27px] before:-left-[17px] before:w-4 before:border-t before:border-sf-line-strong sm:before:-top-[13px] sm:before:left-1/2 sm:before:h-3 sm:before:w-0 sm:before:border-t-0 sm:before:border-l"><Node label={row[0]} value={row[1]} note={row[2]} onOpen={() => onDrill(selectionFor(row[0]))} /></div>)}
          </div>
          {formula !== null && <p className="rounded-lg bg-sf-accent-soft p-2 text-xs tabular-nums text-sf-brand">{formula}</p>}
          <div className="relative before:absolute before:top-[27px] before:-left-[17px] before:w-4 before:border-t before:border-sf-line-strong"><Node label={rows[5][0]} value={rows[5][1]} note={rows[5][2]} onOpen={() => onDrill(selectionFor(rows[5][0]))} /></div>
        </div>
      </div>
    )}
    {table && formula !== null && <p className="rounded-lg bg-sf-accent-soft p-2 text-xs tabular-nums text-sf-brand">{formula}</p>}<div className="rounded-[10px] border border-dashed border-sf-line p-3 text-xs"><strong>Gross profit</strong><p className={muted}>{gpNote}</p><a className="inline-flex min-h-9 items-center text-sf-brand underline" href="#data-health">Why?</a></div>
    <div className="space-y-2 border-t border-sf-line-soft pt-4"><h3 className="text-xs font-bold">{comparison}</h3><Table caption={`${data.companyCount === 1 ? 'One Tally company' : `${data.companyCount} Tally companies`} · half-year comparison`} headings={['Measure', 'H1', 'H2', 'Change']} rows={comparisonRows.map(row => ['Labs buying', 'Repeat sales', '₹ per buying month', 'Instrument & bulk'].includes(row[0]) ? [row[0], periodCell(row[1], row[0], 'H1'), periodCell(row[2], row[0], 'H2'), row[3]] : row)} /><p className={muted}>Instrument &amp; bulk is lumpy: {a.bulkInvoices} invoices in H1, {b.bulkInvoices} in H2.</p></div>
  </section>;
}

function Bridge({ data, scope, comparison, onDrill }: { data: GrowthData; scope: string; comparison: string; onDrill: (selection: GrowthSelection) => void }) {
  const b = data.bridge;
  const onDrillIndex = (i: number) => {
    const list = ['', 'bridge_new', 'bridge_stopped', 'bridge_grew', 'bridge_fell'][i];
    if (list) onDrill({ list, count: i === 2 ? b.stoppedRegular.labs : [0, b.new.labs, 0, b.grew.labs, b.fell.labs][i], title: ['','New labs','Labs that stopped','Existing labs that grew','Existing labs that fell'][i], explanation: 'H1 against H2. Regular = bought in 3 or more of the 6 months before.' });
  };
  return <BridgeChart bridge={b} startLabel="H1" endLabel="H2" caption={`${comparison} · ${scope} · all sales`} tableCaption={`Revenue bridge · ${scope}`} footnote={`Regular = bought in 3 or more of the 6 months before. ${b.stopped.labs - b.stoppedRegular.labs} of the labs that stopped had bought only once or twice.`} onDrillIndex={onDrillIndex} />;
}

export function BridgeChart({ bridge: b, startLabel, endLabel, caption, tableCaption, footnote, onDrillIndex }: { bridge: GrowthData['bridge']; startLabel: string; endLabel: string; caption: ReactNode; tableCaption?: string; footnote: string; onDrillIndex?: (i: number) => void }) {
  const [table, setTable] = useState(false);
  const { tipProps, tip, containerProps } = useChartTip();
  const bridgeHeadline = b.stoppedRegular.labs * 2 < b.stopped.labs
    ? `Most labs that stopped were occasional buyers; ${b.stoppedRegular.labs} regular labs stopped (${lakh(b.stoppedRegular.paise)}). Growth came from ${b.grew.labs} existing labs.`
    : b.new.paise <= b.stopped.paise
      ? `New labs only replaced the labs we lost; growth came from ${b.grew.labs} existing labs.`
      : 'New labs added more than we lost.';
  const totalLines = (label: string) => {
    if (onDrillIndex) return [label, 'total'];
    const lines: string[] = [];
    for (const word of label.split(' ')) {
      if (lines.length && lines[lines.length - 1].length + word.length < 9) lines[lines.length - 1] += ' ' + word;
      else lines.push(word);
    }
    return [...lines, 'total'];
  };
  const bars = [
    { label: `${startLabel} total`, lines: totalLines(startLabel), value: b.h1Paise, kind: 'total' },
    { label: `+ New labs (${b.new.labs})`, lines: ['New labs', `(${b.new.labs})`], value: b.new.paise, kind: 'up' },
    { label: `− Labs that stopped (${b.stopped.labs}) · ${b.stoppedRegular.labs} regular`, lines: ['Stopped', `(${b.stopped.labs})`], value: -b.stopped.paise, kind: 'down' },
    { label: `+ Existing labs that grew (${b.grew.labs})`, lines: ['Existing', `grew (${b.grew.labs})`], value: b.grew.paise, kind: 'up' },
    { label: `− Existing labs that fell (${b.fell.labs})`, lines: ['Existing', `fell (${b.fell.labs})`], value: -b.fell.paise, kind: 'down' },
    ...(b.other.paise !== 0 ? [{ label: `Other (${b.other.labs})`, lines: ['Other', `(${b.other.labs})`], value: b.other.paise, kind: b.other.paise > 0 ? 'up' : 'down' }] : []),
    { label: `${endLabel} total`, lines: totalLines(endLabel), value: b.h2Paise, kind: 'total' },
  ];
  let running = 0;
  const geometry = bars.map(bar => { const start = bar.kind === 'total' ? 0 : running; const end = bar.kind === 'total' ? bar.value : running + bar.value; running = end; return { ...bar, start, end }; });
  const low = Math.min(0, ...geometry.flatMap(v => [v.start, v.end])), high = Math.max(0, ...geometry.flatMap(v => [v.start, v.end]));
  const y = (n: number) => 30 + (high - n) / (high - low || 1) * 175;
  const width = 100 / bars.length;
  const canDrill = (i: number) => !!onDrillIndex && i > 0 && i < 5;
  const identity = `${(b.h1Paise / 1e7).toFixed(1)} + ${(b.new.paise / 1e7).toFixed(1)} − ${(b.stopped.paise / 1e7).toFixed(1)} + ${(b.grew.paise / 1e7).toFixed(1)} − ${(b.fell.paise / 1e7).toFixed(1)}${b.other.paise ? ` ${b.other.paise > 0 ? '+' : '−'} ${(Math.abs(b.other.paise) / 1e7).toFixed(1)}` : ''} = ${(b.h2Paise / 1e7).toFixed(1)}.`;
  return <section className={card} aria-labelledby="bridge-title"><div className="flex items-center justify-between gap-2"><h2 id="bridge-title" className="text-base font-bold">Where growth came from</h2><Toggle name="bridge" table={table} onClick={() => setTable(!table)} /></div><p className="text-xs font-bold text-sf-ink">{bridgeHeadline}</p><p className={muted}>{caption}</p>
    {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve existing desktop status markup and accessible SVG chart roles. */}
    {table ? <div id="bridge-table"><Table caption={tableCaption ?? 'Revenue bridge'} headings={['Contribution', 'Revenue']} rows={bars.map((bar, i) => { const drill = canDrill(i); return [drill ? <button key="label" className="min-h-11 text-left text-sf-brand underline" onClick={() => onDrillIndex?.(i)}>{bar.label}</button> : bar.label, drill ? <button key="value" className="min-h-11 text-sf-brand underline" onClick={() => onDrillIndex?.(i)}>{lakh(Math.abs(bar.value))}</button> : lakh(Math.abs(bar.value))]; })} /></div> : <div id="bridge-chart" {...containerProps} className={onDrillIndex ? containerProps.className : `${containerProps.className} min-w-0 overflow-hidden`}><svg className={onDrillIndex ? "block h-[270px] w-full overflow-visible" : "block h-[340px] w-full overflow-visible"} role="group" aria-labelledby="bridge-svg-title bridge-svg-desc"><title id="bridge-svg-title">{startLabel} to {endLabel} revenue bridge in ₹ lakh</title><desc id="bridge-svg-desc">{bars.map(bar => `${bar.label} ${lakh(Math.abs(bar.value))}`).join('; ')}. {identity}</desc><line x1="0" x2="100%" y1={y(0)} y2={y(0)} stroke="var(--color-sf-chart-axis)" />{geometry.map((bar, i) => { const x = i * width + 2; const top = y(Math.max(bar.start, bar.end)); return <g key={bar.label}>{i < bars.length - 1 && <line x1={`${x + width - 4}%`} x2={`${(i + 1) * width + 2}%`} y1={y(bar.end)} y2={y(bar.end)} stroke="var(--color-sf-chart-axis)" strokeDasharray="3 3" />}<rect {...tipProps(`${bar.label} · ${chartMoney(Math.abs(bar.value))}`)} {...(canDrill(i) ? barButton(`${bar.lines.join(" ")}: open list`, () => onDrillIndex?.(i)) : {})} data-growth-bar={bar.kind} x={`${x}%`} width={`${width - 4}%`} y={top} height={Math.max(2, Math.abs(y(bar.start) - y(bar.end)))} rx="2" fill={`var(--color-sf-chart-${bar.kind === 'total' ? '3' : bar.kind === 'up' ? 'up' : 'down'})`} /><text x={`${(i + .5) * width}%`} y={top - 20} textAnchor="middle" className="fill-sf-label text-[15px]"><tspan x={`${(i + .5) * width}%`}>{lakh(Math.abs(bar.value)).replace(/ L$/, '')}</tspan><tspan x={`${(i + .5) * width}%`} dy="14" className="text-xs">L</tspan></text><text x={`${(i + .5) * width}%`} y="230" textAnchor="middle" className={onDrillIndex ? "fill-sf-label text-xs" : "fill-sf-label text-[10px]"}>{bar.lines.map((line, j) => <tspan key={j} x={`${(i + .5) * width}%`} dy={j ? 16 : 0}>{line}</tspan>)}</text></g>; })}</svg><div className="flex flex-wrap gap-3 text-xs text-sf-muted">{['Total', 'Increase', 'Decrease'].map((v, i) => <span key={v} className="inline-flex items-center gap-1"><i className={`size-2 rounded-sm ${['bg-sf-chart-3', 'bg-sf-chart-up', 'bg-sf-chart-down'][i]}`} />{v}</span>)}<span>Values in ₹ L</span></div>{tip}</div>}
    <p className="text-xs tabular-nums text-sf-muted" aria-label="Bridge identity">{identity}</p><p className={muted}>{footnote}</p></section>;
}


function barButton(label: string, open: () => void) {
  return { role: 'button' as const, tabIndex: 0, 'aria-label': label, style: { cursor: 'pointer' }, onClick: open, onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } } };
}

function Scorecard({ data, onDrill, onOpen }: { data: GrowthData; onDrill: (s: GrowthSelection) => void; onOpen: (tab: GrowthTab, target: string) => void }) {
  const onOpenProfit = () => onOpen('profit', 'growth-panel');
  const [a, b] = data.halves, t = data.tree, s = data.scorecard, gp = data.health.gp.costedPct;
  const compare = (a: number | null, b: number | null, format: (n: number) => string) => a === null || b === null || a === 0 ? '—' : `${changeLabel(a, b)} (${format(a)} → ${format(b)})`;
  const profit = data.gp;
  const profitChange = profit && profit.halves[0].gpPct !== null && profit.halves[1].gpPct !== null
    ? `${profit.halves[1].gpPct - profit.halves[0].gpPct >= 0 ? '+' : '−'}${Math.abs(profit.halves[1].gpPct - profit.halves[0].gpPct).toFixed(1)} pts (${profit.halves[0].gpPct}% → ${profit.halves[1].gpPct}%)`
    : '—';
  const profitNote = profit ? `₹${(profit.window.gpPaise / 1e7).toFixed(1)} L on sales with known cost · cost known for ${profit.window.coveragePct ?? '—'}% of sales` : gp === null ? 'cost not computed yet' : `Cost known for ${gp}% of sales`;
  const tiles = [
    ['Revenue', lakh(t.revenuePaise), compare(a.revenuePaise, b.revenuePaise, lakh)],
    ['Labs buying', String(t.labsBuying), compare(a.labsBuying, b.labsBuying, String)],
    ['₹ per buying month', t.perBuyingMonthPaise === null ? '—' : rupees(t.perBuyingMonthPaise), compare(a.perBuyingMonthPaise, b.perBuyingMonthPaise, rupees)],
    ['Regular labs', String(s.regularLabs), `bought in 10+ months · ${s.regularPct === null ? '—' : s.regularPct + '%'} of revenue`],
    ["Top 10 labs' share", s.top10Pct === null ? '—' : `${s.top10Pct}%`, 'of revenue'],
    ['Gross profit', profit ? (profit.window.gpPct === null ? '—' : `${profit.window.gpPct}%`) : gp === null || gp < 50 ? 'Not measured yet' : 'Unknown', profit ? profitChange : profitNote],
  ];
  const period = `${monthYear(data.window.from)} – ${monthYear(previousDay(data.window.to))}`;
  const windowLabs = (sort: 'value' | 'months' | 'per_month', title: string): GrowthSelection => ({ list: 'window_labs', sort, count: t.labsBuying, title: `${title}, ${period}`, explanation: 'Labs with sales in this period.' });
  const tileOpen: Array<[string, () => void]> = [
    [`Revenue: ${tiles[0][1]}, open revenue by month`, () => onOpen('revenue', 'revenue-months')],
    [`Labs buying: ${t.labsBuying}, open labs with sales, gross profit and margin`, () => onOpen('profit', 'margin-explorer')],
    [`₹ per buying month: ${tiles[2][1]}, open labs by spend per month`, () => onDrill(windowLabs('per_month', 'Labs by spend per buying month'))],
    [`Regular labs: ${s.regularLabs}, open list`, () => onDrill({ list: 'regular_labs', count: s.regularLabs, title: 'Regular labs', explanation: 'Bought in 10+ of 12 months.' })],
    [`Top 10 labs' share: ${tiles[4][1]}, open labs by sales`, () => onDrill(windowLabs('value', 'Top labs by sales'))],
    [`Gross profit: ${tiles[5][1]}, open Profit`, onOpenProfit],
  ];
  return <section className={card} aria-labelledby="scorecard-title"><h2 id="scorecard-title" className="text-base font-bold">Scorecard</h2><p className={muted}>{period} · change is H2 against H1 · tap a tile for details</p><div className="grid grid-cols-2 gap-3 lg:grid-cols-3">{tiles.map(([label, value, note], i) => <div key={label} data-scorecard-tile className="min-w-0 rounded-lg border border-sf-line-soft bg-sf-soft-0 p-3 hover:border-sf-brand" {...(i === 5 ? { style: { cursor: 'pointer' }, onClick: (event: React.MouseEvent) => { if (!(event.target as Element).closest('a,button')) onOpenProfit(); } } : barButton(tileOpen[i][0], tileOpen[i][1]))}><p className="text-xs text-sf-label">{label}</p><strong className={`my-1 block tabular-nums ${i === 0 ? 'text-xl' : 'text-base'}`}>{value}</strong><p className={muted}>{note}</p>{i === 5 && profit && <p className={muted}>{profitNote}</p>}{i === 5 && <span className="flex flex-wrap gap-3"><button type="button" className="inline-flex min-h-9 items-center text-sf-brand underline" aria-label={tileOpen[5][0]} onClick={onOpenProfit}>See profit</button><a className="inline-flex min-h-9 items-center text-sf-brand underline" href="#data-health">Why?</a></span>}</div>)}</div></section>;
}

function usePeriodGp(param: string | undefined) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ param: string; revision: number; data: GrowthPeriodGp | null; error: boolean } | null>(null);
  useEffect(() => {
    if (!param) return;
    const controller = new AbortController();
    void fetch(`/api/growth/margin?period=${encodeURIComponent(param)}&gp=1`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const data = response.ok ? normalizeGrowthPeriodGp(await response.json()) : null;
      if (!data) throw new Error();
      if (!controller.signal.aborted) setResult({ param, revision, data, error: false });
    }).catch(() => { if (!controller.signal.aborted) setResult({ param, revision, data: null, error: true }); });
    return () => controller.abort();
  }, [param, revision]);
  const state = result?.param === param && result?.revision === revision ? result : { data: null, error: false };
  return { data: state.data, error: state.error, retry: () => setRevision(n => n + 1) };
}

function PeriodScorecard({ data, comparisonKey, param, periodGp, onDrill, onOpen }: { data: GrowthPeriodData; comparisonKey: 'last_year' | 'previous'; param: string; periodGp: ReturnType<typeof usePeriodGp>; onDrill: (s: GrowthSelection) => void; onOpen: (tab: GrowthTab, target: string) => void }) {
  const comparison = data.comparisons.find(c => c.key === comparisonKey) ?? data.comparisons[0];
  const cur = data.current.tree, cmp = comparison.tree, b = comparison.bridge;
  const base = b ? b.stopped.labs + b.grew.labs + b.fell.labs + b.same.labs : 0;
  const retained = b ? base - b.stopped.labs : 0;
  const change = (before: number | null | undefined, now: number | null) => periodChangeLabel(comparison.check.state, before ?? null, now);
  const gp = periodGp.data;
  const tiles: { label: string; value: string; note: string; action?: () => void; actionLabel?: string }[] = [
    { label: 'Revenue', value: lakh(cur.revenuePaise), note: change(cmp?.revenuePaise, cur.revenuePaise), action: () => onOpen('revenue', 'revenue-months'), actionLabel: 'open revenue by month' },
    { label: 'Repeat share', value: cur.revenuePaise > 0 ? `${Math.round(100 * cur.repeatPaise / cur.revenuePaise)}%` : '—', note: `repeat sales ${lakh(cur.repeatPaise)}` },
    { label: 'Labs buying', value: String(cur.labsBuying), note: change(cmp?.labsBuying, cur.labsBuying), actionLabel: 'open labs with sales', action: () => onDrill({ list: 'window_labs', period: param, count: cur.labsBuying, title: 'Labs with sales (incl. instrument & bulk)', explanation: `Every lab with sales in ${data.current.label}, including instrument and bulk invoices, so this can be more than Labs buying.` }) },
    { label: 'Retention', value: base ? `${Math.round(100 * retained / base)}%` : '—', note: base ? `${retained} of ${base} labs from ${comparison.label} still buying` : `No sales history for ${comparison.label} yet`, actionLabel: 'open labs that stopped', action: b ? () => onDrill({ list: 'bridge_stopped', period: param, comparison: comparison.key, count: b.stoppedRegular.labs, title: 'Labs that stopped', explanation: `${comparison.label} against ${data.current.label}. Regular = bought in 3 or more months of ${comparison.label}.` }) : undefined },
    { label: '₹ per buying month', value: cur.perBuyingMonthPaise === null ? '—' : rupees(cur.perBuyingMonthPaise), note: change(cmp?.perBuyingMonthPaise, cur.perBuyingMonthPaise) },
    { label: 'Gross profit', value: gp ? gp.window.gpPct === null ? '—' : `${gp.window.gpPct}%` : periodGp.error ? 'Could not load' : 'Loading…', note: `cost known for ${gp?.window.coveragePct ?? '—'}% of sales`, action: () => onOpen('profit', 'gp-month-title'), actionLabel: 'open Profit' },
  ];
  return <section className={card} aria-labelledby="scorecard-title"><h2 id="scorecard-title" className="text-base font-bold">Scorecard</h2><p className={muted}>{data.current.label} vs {comparison.label}</p><div className="grid grid-cols-2 gap-3 lg:grid-cols-3">{tiles.map(({ label, value, note, action, actionLabel }) => <div key={label} data-scorecard-tile className="min-w-0 rounded-lg border border-sf-line-soft bg-sf-soft-0 p-3"><p className="text-xs text-sf-label">{label}</p>{action ? <button type="button" className={`my-1 block min-h-11 text-left font-bold tabular-nums ${label === 'Revenue' ? 'text-xl' : 'text-base'}`} aria-label={`${label}: ${value}, ${actionLabel}`} onClick={action}>{value}</button> : <strong className="my-1 block text-base tabular-nums">{value}</strong>}<p className={muted}>{note}</p>{label === 'Gross profit' && periodGp.error && <button type="button" className="min-h-11 text-sf-brand underline" onClick={periodGp.retry}>Retry</button>}</div>)}</div>{comparison.check.state !== 'confirmed' && <p className={muted}>{comparisonNote(comparison.check, comparison.label)}</p>}</section>;
}

function MonthlyChart({ data, onDrill, kind }: { data: GrowthData; onDrill: (s: GrowthSelection) => void; kind: 'labs' | 'purchases' }) {
  const [buyingTable, setBuyingTable] = useState(false), [purchaseTable, setPurchaseTable] = useState(false);
  const buyingTip = useChartTip(), purchaseTip = useChartTip();
  const ms = data.months, min = Math.min(...ms.map(m => m.labsBuying)), max = Math.max(...ms.map(m => m.labsBuying));
  const buyingMax = Math.max(1, ...ms.map(m => m.labsBuying + (m.skippedRegulars ?? 0)));
  const purchaseMax = Math.max(1, ...ms.flatMap(m => [m.salesPaise, m.purchasesRegularPaise + m.purchasesLargePaise]));
  const last = ms[11], above = ms.filter(m => m.purchasesRegularPaise > m.salesPaise).length;
  const purchaseHeadline = last.purchasesLargePaise > 0 ? `${month(last.month + '-01')}'s ${lakh(last.purchasesLargePaise)} of large purchases is mostly instrument capital, not stock build-up; track its payback in Economics.` : above <= 3 ? 'Purchases tracked sales this year.' : `Regular purchases ran above sales in ${above} months; check stock build-up.`;
  const select = (i: number, list: string): GrowthSelection => {
    const m = ms[i], label = monthYear(m.month + '-01');
    const definitions: Record<string, [string, number, string]> = {
      month_buying: [`Labs buying in ${label}`, m.labsBuying, 'Labs with sales this month.'],
      month_first: [`First-time labs buying in ${label}`, m.firstTime ?? 0, 'First purchase in the imported history.'],
      month_skipped: [`Regulars who skipped ${label}`, m.skippedRegulars ?? 0, 'Bought in 6 or more of the previous 11 months, nothing this month.'],
      month_large_purchases: [`Large purchases in ${label}`, m.largePurchaseInvoices, 'Purchase invoices of ₹2 L or more, mostly instruments.'],
    };
    const [title, count, explanation] = definitions[list];
    return { list, month: m.month, title, count, explanation };
  };
  const openCell = (i: number, list: string, value: ReactNode) => value === '—' ? value : <button className="min-h-11 w-full text-right text-sf-brand underline" onClick={() => onDrill(select(i, list))}>{value}</button>;
  const grid = (maximum: number, money = false) => [0, 1, 2, 3, 4].map(n => <g key={n}><line x1="7%" x2="99%" y1={224 - n * 48} y2={224 - n * 48} stroke="var(--color-sf-chart-grid)" /><text x="5%" y={228 - n * 48} textAnchor="end" className="fill-sf-muted text-[10px]">{money ? (maximum / 1e7 * n / 4).toFixed(0) : Math.ceil(maximum * n / 4)}</text></g>);
  const tick = (i: number, x: number) => <text x={`${x}%`} y="245" textAnchor="middle" className="fill-sf-label text-[10px]">{month(ms[i].month + '-01')}</text>;
  const rect = (tipProps: (text: string) => object, i: number, list: string | null, label: string, x: number, y: number, width: number, height: number, fill: string, dashed = false) => <rect {...tipProps(chartTipText(`${month(ms[i].month + '-01')}: ${label}`))} {...(list ? barButton(`${month(ms[i].month + '-01')}: ${label}, open list`, () => onDrill(select(i, list))) : { 'aria-label': `${month(ms[i].month + '-01')}: ${label}` })} data-growth-list={list ?? undefined} x={`${x}%`} y={y} width={`${width}%`} height={Math.max(2, height)} fill={fill} stroke={dashed ? 'var(--color-sf-chart-2)' : undefined} strokeDasharray={dashed ? '4 3' : undefined} />;
  const key = (labels: string[], colors: string[]) => <div className="flex flex-wrap gap-3 text-xs text-sf-muted">{labels.map((label, i) => <span key={label} className="inline-flex items-center gap-1"><i className="size-2 rounded-sm border" style={{ background: colors[i], borderColor: colors[i] === 'none' ? 'var(--color-sf-chart-2)' : colors[i], borderStyle: colors[i] === 'none' ? 'dashed' : 'solid' }} />{label}</span>)}</div>;
  return <>
    {kind === 'labs' && <section className={card} aria-labelledby="buying-title"><div className="flex flex-wrap items-center justify-between gap-2"><h2 id="buying-title" className="text-base font-bold">Labs buying each month</h2><Toggle name="buying" table={buyingTable} onClick={() => setBuyingTable(!buyingTable)} /></div><p className="text-xs font-bold">{max - min <= .2 * max ? `About ${min}–${max} labs buy in any month; reach is flat, so growth depends on spend per lab.` : `Labs buying ranged from ${min} to ${max} a month.`}</p><p className="text-xs text-sf-brand">Tap a bar to see the labs.</p>
    {buyingTable ? <div id="buying-table"><Table caption="Labs buying each month" headings={['Month', 'Labs buying', 'of which first time', 'Regulars who skipped']} rows={ms.map((m, i) => [<button key="month" className="min-h-11 text-left text-sf-brand underline" onClick={() => onDrill(select(i, 'month_buying'))}>{monthYear(m.month + '-01')}</button>, openCell(i, 'month_buying', m.labsBuying), openCell(i, 'month_first', m.firstTime ?? '—'), openCell(i, 'month_skipped', m.skippedRegulars ?? '—')])} /></div> : <div id="buying-chart" {...buyingTip.containerProps}><svg className="block h-[270px] w-full" aria-label="Labs buying each month chart">{grid(buyingMax)}{ms.map((m, i) => { const x = 9 + i * 7.5, scale = 192 / buyingMax, y = 224 - m.labsBuying * scale; return <g key={m.month}>{rect(buyingTip.tipProps, i, 'month_buying', `${plural(m.labsBuying, 'lab', 'labs')} buying`, x, y, 5, (m.labsBuying - (m.firstTime ?? 0)) * scale - 1.5, 'var(--color-sf-chart-1)')}{m.firstTime !== null && rect(buyingTip.tipProps, i, 'month_first', plural(m.firstTime, 'first-time lab', 'first-time labs'), x, 224 - m.firstTime * scale, 5, m.firstTime * scale, 'var(--color-sf-chart-3)')}{m.skippedRegulars !== null && rect(buyingTip.tipProps, i, 'month_skipped', plural(m.skippedRegulars, 'regular who skipped', 'regulars who skipped'), x, y - m.skippedRegulars * scale, 5, m.skippedRegulars * scale, 'transparent', true)}{tick(i, x + 2.5)}</g>; })}</svg>{key(['Labs buying', 'of which first time', 'Regulars who skipped'], ['var(--color-sf-chart-1)', 'var(--color-sf-chart-3)', 'none'])}{buyingTip.tip}</div>}
    <p className={muted}>&apos;First time&apos; counts from {data.health.history.firstSaleOn ? monthYear(data.health.history.firstSaleOn) : '—'}, where imported history starts. Regulars who skipped bought in 6 or more of the previous 11 months but not this month.</p></section>}
    {kind === 'purchases' && <section className={card} aria-labelledby="purchases-title"><div className="flex flex-wrap items-center justify-between gap-2"><h2 id="purchases-title" className="text-base font-bold">Purchases against sales</h2><Toggle name="purchases" table={purchaseTable} onClick={() => setPurchaseTable(!purchaseTable)} /></div><p className="text-xs font-bold">{purchaseHeadline}</p><p className="text-xs text-sf-brand">Tap a large-purchase bar to see the invoices.</p><p className={muted}>Values in ₹ L</p>
    {purchaseTable ? <div id="purchases-table"><Table caption="Purchases against sales · ₹ L" headings={['Month', 'Sales', 'Regular purchases', 'Large purchases']} rows={ms.map((m, i) => [monthYear(m.month + '-01'), (m.salesPaise / 1e7).toFixed(1), (m.purchasesRegularPaise / 1e7).toFixed(1), openCell(i, 'month_large_purchases', (m.purchasesLargePaise / 1e7).toFixed(1))])} /></div> : <div id="purchases-chart" {...purchaseTip.containerProps}><svg className="block h-[270px] w-full" aria-label="Purchases against sales chart">{grid(purchaseMax, true)}{ms.map((m, i) => { const x = 8.5 + i * 7.5, scale = 192 / purchaseMax; return <g key={m.month}>{rect(purchaseTip.tipProps, i, null, `sales ${chartMoney(m.salesPaise)}`, x, 224 - m.salesPaise * scale, 2.5, m.salesPaise * scale, 'var(--color-sf-chart-1)')}{rect(purchaseTip.tipProps, i, null, `regular purchases ${chartMoney(m.purchasesRegularPaise)}`, x + 3, 224 - m.purchasesRegularPaise * scale, 2.5, m.purchasesRegularPaise * scale, 'var(--color-sf-chart-3)')}{rect(purchaseTip.tipProps, i, 'month_large_purchases', `large purchases ${chartMoney(m.purchasesLargePaise)}`, x + 3, 224 - (m.purchasesRegularPaise + m.purchasesLargePaise) * scale, 2.5, m.purchasesLargePaise * scale - 1.5, 'var(--color-sf-chart-2)')}{tick(i, x + 2.75)}</g>; })}</svg>{key(['Sales', 'Regular purchases', 'Large purchases (₹2 L or more, mostly instruments)'], ['var(--color-sf-chart-1)', 'var(--color-sf-chart-3)', 'var(--color-sf-chart-2)'])}{purchaseTip.tip}</div>}
    <p className={muted}>Large = a purchase invoice of ₹2 L or more. Regular purchases above sales for several months would signal stock build-up.</p></section>}
  </>;
}

export function LabsBuyingCard(props: { data: GrowthData; onDrill: (s: GrowthSelection) => void }) {
  return <MonthlyChart {...props} kind="labs" />;
}

export function PurchasesCard(props: { data: GrowthData; onDrill: (s: GrowthSelection) => void }) {
  return <MonthlyChart {...props} kind="purchases" />;
}

function Health({ data, onOpenBrandSetup, onOpenMyActions }: { data: GrowthData } & Pick<GrowthNavigation, 'onOpenBrandSetup' | 'onOpenMyActions'>) {
  const h = data.health, pct = h.gp.costedPct;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const sync = () => { if (location.hash === '#data-health') setOpen(true); };
    sync(); window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const profit = data.gp;
  // oxlint-disable-next-line react/react-compiler -- Preserve the existing health freshness calculation.
  const age = h.catalog.observedAt === null ? null : Date.now() - Date.parse(h.catalog.observedAt);
  const rows = [
    { title: 'Gross profit', status: profit ? (profit.window.coveragePct !== null && profit.window.coveragePct >= 95 ? 'Current' : profit.window.coveragePct !== null && profit.window.coveragePct >= 80 ? 'Limited' : 'Blocked') : pct === null || pct < 50 ? 'Blocked' : pct < 90 ? 'Limited' : 'Current', text: profit ? `Cost known for ${profit.window.coveragePct ?? '—'}% of sales (average purchase cost)` : pct === null ? 'cost not computed yet' : `Cost known for ${pct}% of sales`, effect: profit ? profit.window.coveragePct !== null && profit.window.coveragePct < 100 ? 'The rest was bought before imported history; the 36-month load will fill it' : '' : pct === null || pct < 50 ? 'Profit side of the tree is blank' : '', detail: profit?.window.unreliableLines ? `${profit.window.unreliableLines} line${profit.window.unreliableLines === 1 ? '' : 's'} left out: sale and cost units look different` : '' },
    { title: 'History depth', status: h.history.monthsImported < 24 ? 'Limited' : 'Current', text: `${h.history.monthsImported} months imported`, effect: h.history.monthsImported < 24 ? 'No year-on-year yet' : '' },
    { title: 'Sales confirmation', status: data.confirmed ? 'Current' : 'Limited', text: data.confirmed ? 'Confirmed' : plainReason(data.confirmedReason) },
    { title: 'Item groups', status: h.itemGroups.unmappedPct === null ? 'Unknown' : h.itemGroups.unmappedPct > 10 ? 'Limited' : 'Current', text: h.itemGroups.unmappedPct === null ? 'Unknown' : `${h.itemGroups.unmappedPct}% of sales has no principal`, owner: 'Map items to principals in Brand setup' },
    { title: 'Reasons (qualitative)', status: h.reasons.visitReasons180 + h.reasons.constraints === 0 ? 'Blocked' : 'Current', text: `${h.reasons.visitReasons180} visit reasons, ${h.reasons.constraints} diagnoses, ${h.reasons.openActions} open actions, ${h.reasons.visits180} visits (180 days)`, effect: h.reasons.visitReasons180 + h.reasons.constraints === 0 ? 'We can see what changed, not why' : '' },
    { title: 'Item catalog', status: age !== null && age >= 0 && age <= 7 * 86400000 ? 'Current' : 'Limited', text: h.catalog.groups === null ? 'Unknown' : `${h.catalog.groups} groups` },
  ];
  const count = (status: string) => rows.filter(row => row.status === status).length;
  const summaryParts = [['limited', count('Limited')], ['blocked', count('Blocked')], ['unknown', count('Unknown')]].filter(([, n]) => n).map(([label, n]) => `${n} ${label}`);
  const summaryText = summaryParts.length ? summaryParts.join(' · ') : 'all current';
  // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The existing Health aside opens its details when a jump focuses it.
  return <aside id="data-health" tabIndex={-1} onFocus={event => { if (event.target === event.currentTarget) setOpen(true); }} className={`${card} scroll-mt-4 focus:outline-sf-accent`} aria-labelledby="health-title"><details open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary className="flex min-h-11 cursor-pointer items-center"><h2 id="health-title" className="text-xs font-bold">Data health<span className="font-normal text-sf-muted"> · {summaryText}</span></h2></summary><p className={muted}>What limits these numbers · {data.companyCount === 1 ? 'one Tally company' : `${data.companyCount} Tally companies`}</p><ul>{rows.map(row => <li key={row.title} className="grid grid-cols-[8px_minmax(0,1fr)] gap-2.5 border-b border-sf-line-soft py-3.5 text-xs last:border-0 last:pb-0"><span aria-hidden="true" className={`mt-1.5 size-2 rounded-full ${row.status === 'Current' ? 'bg-sf-success' : row.status === 'Blocked' ? 'bg-sf-danger' : 'bg-sf-warning'}`} /><div><strong>{row.title}</strong><span className="text-sf-muted"> · {row.status}</span><p className="mt-1">{row.text}</p>{row.effect && <p className="mt-1 text-sf-muted">{row.effect}</p>}{row.detail && <p className="mt-1 text-sf-muted">{row.detail}</p>}{row.owner && <p className="mt-1 text-sf-brand">{row.owner}</p>}{row.title === 'Item groups' && <button className="min-h-11 text-sf-brand underline" onClick={onOpenBrandSetup}>Open Brand setup</button>}{row.title === 'Reasons (qualitative)' && <button className="min-h-11 text-sf-brand underline" onClick={onOpenMyActions}>Open My actions</button>}</div></li>)}</ul></details></aside>;
}

export function GrowthPage(navigation: GrowthNavigation) {
  // usePhoneLayout uses (max-width: 767px); desktop retains its existing layout.
  const phone = usePhoneLayout();
  const [period, setPeriod, periodReady] = useGrowthPeriodSelection();
  const periodData = useGrowthPeriodData(period, periodReady);
  const [comparisonKey, setComparisonKey] = useState<'last_year' | 'previous'>('last_year');
  // oxlint-disable-next-line react/react-compiler -- The period owns the comparison choice; reset it when that period changes.
  useEffect(() => { setComparisonKey('last_year'); }, [period]);
  const periodMode = period !== 'rolling12';
  const param = formatGrowthPeriodParam(period);
  const periodGp = usePeriodGp(periodReady && periodMode ? param : undefined);
  const labPeriod = periodMode && periodData.data ? { param, label: periodData.data.period.label } : undefined;
  const profitPeriod: ProfitPeriod | undefined = periodMode && periodData.data ? { param, label: periodData.data.period.label, comparisonKey, comparisonLabel: (periodData.data.comparisons.find(c => c.key === comparisonKey) ?? periodData.data.comparisons[0]).label } : undefined;
  const profitCaption = (child: ReactNode) => profitPeriod ? child : rollingCaption(child);
  const rollingCaption = (child: ReactNode) => periodMode ? <div className="min-w-0 space-y-2"><p className={muted}>Last 12 months</p>{child}</div> : child;
  const [phoneRevenueTab, setPhoneRevenueTab] = useState<'revenue' | 'bridge'>('revenue');
  const [selection, setSelection] = useState<GrowthSelection | null>(null);
  const [data, setData] = useState<GrowthData | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<GrowthTab>('revenue');
  useEffect(() => {
    if (window.matchMedia('(max-width: 767px)').matches) return;
    // oxlint-disable-next-line react/react-compiler -- Restore the desktop tab from browser storage after mount.
    try { const saved = localStorage.getItem('sf-growth-tab'); const match = growthTabs.find(item => item.id === saved); if (match) setTab(match.id); } catch { /* storage unavailable */ }
  }, [phone]);
  const chooseTab = (id: GrowthTab) => { setTab(id); try { localStorage.setItem('sf-growth-tab', id); } catch { /* storage unavailable */ } };
  const onTabKey = (event: React.KeyboardEvent, id: GrowthTab) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = growthTabs.findIndex(item => item.id === id);
    const next = growthTabs[(index + (event.key === 'ArrowRight' ? 1 : growthTabs.length - 1)) % growthTabs.length].id;
    chooseTab(next);
    document.getElementById(`growth-tab-${next}`)?.focus();
  };
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/growth', { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (response.status === 403) throw new Error('Growth is for management only.');
      if (!response.ok) throw new Error('Growth is unavailable. Try again.');
      const parsed = normalizeGrowth(await response.json());
      if (!parsed) throw new Error('Growth is unavailable. Try again.');
      if (!controller.signal.aborted) setData(parsed);
    }).catch((failure: unknown) => { if (!controller.signal.aborted) setError(failure instanceof Error && failure.message === 'Growth is for management only.' ? failure.message : 'Growth is unavailable. Try again.'); });
    return () => controller.abort();
  }, [revision]);
  const scope = data ? `${monthYear(data.window.from)} – ${monthYear(previousDay(data.window.to))} · ${data.companyCount === 1 ? 'one Tally company' : `${data.companyCount} Tally companies`}` : '';
  const comparison = data ? `H1 (${month(data.window.h1From)}–${month(previousDay(data.window.h2From))}) → H2 (${month(data.window.h2From)}–${month(previousDay(data.window.to))})` : '';
  const inbox = <GrowthInbox onOpenCustomer={navigation.onOpenCustomer} onLinkLedger={navigation.onLinkLedger} onReviewPrices={card => { if (card.customerId) setSelection({ list: 'price_card', count: card.inputs.items, title: `${card.name ?? 'Lab not named'} · items under typical price`, explanation: 'Some low prices are agreed volume rates. Check the quantity before proposing a change.', priceCard: { customerId: card.customerId, name: card.name ?? 'Lab not named', inputs: card.inputs } }); }} />;
  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve existing desktop status markup and accessible SVG chart roles.
  const pageError = error ? <div role="alert"><p>{error}</p>{error !== 'Growth is for management only.' && <button className="mt-3 min-h-11 rounded-lg border border-sf-line px-3" onClick={() => { setData(null); setError(''); setRevision(n => n + 1); }}>Retry</button>}</div> : !data ? <p role="status">Loading growth…</p> : null;
  const periodStatus = (title: string, id: string) => <section className={card} aria-labelledby={id}><h2 id={id} className="text-base font-bold">{title}</h2>{periodData.error ? <><p role="alert">{periodData.error}</p><button type="button" className="min-h-11 rounded-lg border border-sf-line px-3" onClick={periodData.retry}>Retry</button></> : <output className="block">Loading period…</output>}</section>;
  const revenueCard = data && (periodMode ? periodData.data ? <GrowthPeriodRevenue data={periodData.data} comparisonKey={comparisonKey} onComparisonChange={setComparisonKey} onDrill={setSelection} param={param} /> : periodStatus('Where revenue comes from', 'revenue-period-status') : <Revenue data={data} scope={scope} comparison={comparison} onDrill={setSelection} />);
  const scorecard = (onOpen: (next: GrowthTab, target: string) => void) => data && (periodMode && periodData.data ? <PeriodScorecard data={periodData.data} comparisonKey={comparisonKey} param={param} periodGp={periodGp} onDrill={setSelection} onOpen={onOpen} /> : <Scorecard data={data} onDrill={setSelection} onOpen={onOpen} />);
  const bridgeCard = data && (periodMode ? periodData.data ? <GrowthPeriodBridge data={periodData.data} comparisonKey={comparisonKey} onDrill={setSelection} param={param} /> : periodStatus('Where growth came from', 'bridge-period-status') : <Bridge data={data} scope={scope} comparison={comparison} onDrill={setSelection} />);
  return <div data-growth-scroller className="h-full min-w-0 overflow-y-auto p-4 text-sm text-sf-strong sm:p-6 [overflow-wrap:break-word]">
    <header className="mb-5 space-y-2"><p className={muted}>More / Management</p><h1 className="text-xl font-bold">Growth</h1>{data && <p className={muted}>{periodMode && periodData.data ? `${periodData.data.period.label} · ${data.companyCount === 1 ? 'one Tally company' : `${data.companyCount} Tally companies`} · management only` : `${scope} · management only`}</p>}<GrowthPeriodPicker value={period} today={todayIst()} onChange={setPeriod} />{data && !data.confirmed && <p className="text-xs text-sf-warning">Not confirmed: {plainReason(data.confirmedReason)}</p>}</header>
    {phone ? <>{pageError}{data && <GrowthSections data={data}>{(section, filter, open) => <>
      {section === 'act' && <>{inbox}<section className={card} aria-labelledby="labs-call-title"><h2 id="labs-call-title" className="text-base font-bold">Labs to call</h2><div className="flex flex-wrap gap-3"><button type="button" className={toggleClass} onClick={() => open('labs', 'lapsing')}>Lapsing core labs ›</button><button type="button" className={toggleClass} onClick={() => open('labs', 'declining')}>Buying less ›</button></div></section></>}
      {section === 'revenue' && <>
        {scorecard((next, target) => {
          if (next === 'revenue' || next === 'bridge') setPhoneRevenueTab(next);
          open(next === 'monthly' ? 'labs' : next === 'profit' ? 'profit' : 'revenue');
          setTimeout(() => scrollToWhenReady(target), 0);
        })}
        <div role="tablist" aria-label="Revenue analysis" className="flex gap-1 rounded-lg border border-sf-line p-1">{growthTabs.slice(0, 2).map(item => <button key={item.id} id={`phone-growth-tab-${item.id}`} type="button" role="tab" aria-selected={phoneRevenueTab === item.id} aria-controls="phone-revenue-panel" tabIndex={phoneRevenueTab === item.id ? 0 : -1} className={`min-h-11 rounded-md px-3 text-sm ${phoneRevenueTab === item.id ? 'bg-sf-accent-soft font-bold text-sf-brand' : 'text-sf-muted'}`} onClick={() => setPhoneRevenueTab(item.id as 'revenue' | 'bridge')} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 'revenue' : event.key === 'End' ? 'bridge' : phoneRevenueTab === 'revenue' ? 'bridge' : 'revenue';
          setPhoneRevenueTab(next); document.getElementById(`phone-growth-tab-${next}`)?.focus();
        }}>{periodMode && item.id === 'bridge' ? 'Bridge' : item.label}</button>)}</div>
        <div id="phone-revenue-panel" role="tabpanel" aria-labelledby={`phone-growth-tab-${phoneRevenueTab}`} className="min-w-0 space-y-4">{phoneRevenueTab === 'revenue' ? <>{rollingCaption(<RevenueMonths data={data} onDrill={setSelection} />)}{revenueCard}</> : bridgeCard}</div>
        {rollingCaption(<PurchasesCard data={data} onDrill={setSelection} />)}
      </>}
      {section === 'labs' && <>
        {filter === 'top' && rollingCaption(<LabsBuyingCard data={data} onDrill={setSelection} />)}
        {labPeriod ? <GrowthLabMonths key={`${filter}:${param}`} period={labPeriod} onOpenCustomer={navigation.onOpenCustomer} initialFilter={filter} /> : rollingCaption(<GrowthLabMonths key={`${filter}:rolling`} onOpenCustomer={navigation.onOpenCustomer} initialFilter={filter} />)}
        {filter !== 'top' && rollingCaption(<LabsBuyingCard data={data} onDrill={setSelection} />)}
        {filter === 'top' && <GrowthCohorts onOpenCustomer={navigation.onOpenCustomer} />}
      </>}
      {section === 'profit' && profitCaption(<GrowthProfit key={param} period={profitPeriod} periodGp={periodGp} data={data} scope={scope} onDrill={setSelection} navigation={navigation} showBrands={false} />)}
      {section === 'brands' && profitCaption(<GrowthBrands key={`${param}:${comparisonKey}`} period={profitPeriod} onOpenBrandSetup={navigation.onOpenBrandSetup} />)}
      {section === 'health' && <Health data={data} onOpenBrandSetup={navigation.onOpenBrandSetup} onOpenMyActions={navigation.onOpenMyActions} />}
    </>}</GrowthSections>}</> : <div className="grid min-w-0 items-start gap-4 md:grid-cols-[minmax(0,2.2fr)_minmax(280px,1fr)] lg:gap-5">
      <div className="min-w-0 space-y-4">{pageError}{scorecard((next, target) => { chooseTab(next); setTimeout(() => scrollToWhenReady(target), 0); })}{inbox}{data && <>
        <div role="tablist" aria-label="Growth analysis" className="flex gap-1 overflow-x-auto rounded-lg border border-sf-line p-1">{growthTabs.map(item => <button key={item.id} type="button" role="tab" id={`growth-tab-${item.id}`} aria-selected={tab === item.id} aria-controls="growth-panel" tabIndex={tab === item.id ? 0 : -1} className={`min-h-11 shrink-0 rounded-md px-3 text-sm ${tab === item.id ? 'bg-sf-accent-soft font-bold text-sf-brand' : 'text-sf-muted'}`} onClick={() => chooseTab(item.id)} onKeyDown={event => onTabKey(event, item.id)}>{periodMode && item.id === 'bridge' ? 'Bridge' : item.label}</button>)}</div>
        <div id="growth-panel" role="tabpanel" aria-labelledby={`growth-tab-${tab}`} className="min-w-0 space-y-4">
          {tab === 'revenue' && rollingCaption(<RevenueMonths data={data} onDrill={setSelection} />)}
          {tab === 'revenue' && revenueCard}
          {tab === 'bridge' && bridgeCard}
          {tab === 'monthly' && <>{rollingCaption(<LabsBuyingCard data={data} onDrill={setSelection} />)}{labPeriod ? <GrowthLabMonths key={param} period={labPeriod} onOpenCustomer={navigation.onOpenCustomer} /> : rollingCaption(<GrowthLabMonths key="rolling" onOpenCustomer={navigation.onOpenCustomer} />)}{rollingCaption(<PurchasesCard data={data} onDrill={setSelection} />)}</>}
          {tab === 'profit' && (periodMode ? <>{profitCaption(<GrowthProfit key={param} period={profitPeriod} periodGp={periodGp} data={data} scope={scope} onDrill={setSelection} navigation={navigation} showBrands={false} />)}{profitCaption(<GrowthBrands key={`${param}:${comparisonKey}`} period={profitPeriod} onOpenBrandSetup={navigation.onOpenBrandSetup} />)}</> : <GrowthProfit key={param} period={profitPeriod} periodGp={periodGp} data={data} scope={scope} onDrill={setSelection} navigation={navigation} />)}
        </div></>}</div>
      <div className="min-w-0 space-y-4">{data && <Health data={data} onOpenBrandSetup={navigation.onOpenBrandSetup} onOpenMyActions={navigation.onOpenMyActions} />}</div>
    </div>}
    {selection && <GrowthDrilldown key={`${selection.list}:${selection.month ?? ""}:${selection.half ?? ""}:${selection.sort ?? ""}:${selection.period ?? ""}:${selection.comparison ?? ""}`} selection={selection} onClose={() => setSelection(null)} {...navigation} />}
  </div>;
}
