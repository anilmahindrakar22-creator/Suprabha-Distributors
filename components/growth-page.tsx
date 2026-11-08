'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { normalizeGrowth, type GrowthData, type GrowthMeasures } from '@/lib/growth-types';
import { formatPaise } from '@/lib/wallet-format';

const lakh = (n: number) => `₹${(n / 1e7).toFixed(1)} L`;
const rupees = (n: number) => formatPaise(Math.round(n / 100) * 100);
const months = (m: GrowthMeasures) => m.labsBuying ? m.buyingMonths / m.labsBuying : 0;
const change = (a: number | null, b: number | null) => a === null || b === null || a === 0 ? null : (b - a) / Math.abs(a) * 100;
const changeLabel = (a: number | null, b: number | null) => { const n = change(a, b); return n === null ? '—' : `${n >= 0 ? '+' : '−'}${Math.round(Math.abs(n))}%`; };
const month = (s: string) => new Date(s).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
const monthYear = (s: string | number) => new Date(s).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const previousDay = (s: string) => new Date(Date.parse(s) - 86400000).toISOString().slice(0, 10);
const card = 'min-w-0 space-y-3 rounded-xl border border-sf-line-soft bg-white p-4 lg:p-5';
const muted = 'text-xs text-sf-muted';
const toggleClass = 'min-h-11 shrink-0 text-xs text-sf-brand underline';

function Table({ caption, headings, rows }: { caption: string; headings: string[]; rows: ReactNode[][] }) {
  return <table className="w-full table-fixed border-collapse text-xs tabular-nums [&_th]:font-normal [&_th]:text-sf-muted [&_td]:text-right [&_td]:text-[15px] [&_td]:leading-5 [&_th]:p-1.5 [&_td]:p-1.5 [&_th]:border-b [&_td]:border-b [&_th]:border-sf-line-soft [&_td]:border-sf-line-soft [&_th]:align-top [&_td]:align-top [&_td]:break-words"><caption className="mb-2 text-left text-xs text-sf-muted">{caption}</caption><thead><tr>{headings.map((v, i) => <th key={v} scope="col" className={i ? 'text-right' : 'w-[34%] text-left'}>{v}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((v, j) => j ? <td key={j}>{v}</td> : <th key={j} scope="row" className="text-left">{v}</th>)}</tr>)}</tbody></table>;
}
function Node({ label, value, note, hero = false }: { label: string; value: string; note: string; hero?: boolean }) {
  return <div className={`min-w-0 rounded-[10px] border p-3 ${hero ? 'border-sf-brand bg-sf-brand text-white' : 'border-sf-line bg-sf-soft-0'}`}><span className={`block text-xs ${hero ? '' : 'text-sf-label'}`}>{label}</span><strong className={`block tabular-nums ${hero ? 'text-xl' : 'text-base'}`}>{value}</strong><p className={`text-xs ${hero ? '' : 'text-sf-muted'}`}>{note}</p></div>;
}
function Toggle({ name, table, onClick }: { name: string; table: boolean; onClick: () => void }) {
  return <button type="button" className={toggleClass} aria-expanded={table} aria-controls={`${name}-${table ? 'table' : 'chart'}`} onClick={onClick}>{table ? 'View as chart' : 'View as table'}</button>;
}

function Revenue({ data, scope, comparison }: { data: GrowthData; scope: string; comparison: string }) {
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
    ['Instrument & bulk', lakh(t.bulkPaise), `${t.bulkInvoices} invoices of ₹2 L or more${t.bulkReturns > 0 ? `, net of ${t.bulkReturns} large return${t.bulkReturns === 1 ? '' : 's'}` : ''}`],
    ['Gross profit', pct === null || pct < 50 ? 'Not measured yet' : 'Unknown', gpNote],
  ];
  const formula = t.perBuyingMonthPaise === null ? null : `${t.labsBuying} × ${months(t).toFixed(1)} × ${rupees(t.perBuyingMonthPaise)} = ${lakh(t.repeatPaise)}`;
  const comparisonRows = [
    ['Labs buying', String(a.labsBuying), String(b.labsBuying), changeLabel(a.labsBuying, b.labsBuying)],
    ['Buying months per lab', months(a).toFixed(1), months(b).toFixed(1), changeLabel(months(a), months(b))],
    ['₹ per buying month', a.perBuyingMonthPaise === null ? '—' : rupees(a.perBuyingMonthPaise), b.perBuyingMonthPaise === null ? '—' : rupees(b.perBuyingMonthPaise), changeLabel(a.perBuyingMonthPaise, b.perBuyingMonthPaise)],
    ['Repeat sales', lakh(a.repeatPaise), lakh(b.repeatPaise), changeLabel(a.repeatPaise, b.repeatPaise)],
    ['Instrument & bulk', lakh(a.bulkPaise), lakh(b.bulkPaise), changeLabel(a.bulkPaise, b.bulkPaise)],
  ];
  return <section className={card} aria-labelledby="revenue-title"><div className="flex items-center justify-between gap-2"><h2 id="revenue-title" className="text-base font-bold">Where revenue comes from</h2><Toggle name="tree" table={table} onClick={() => setTable(!table)} /></div>{headline && <p className="text-xs font-bold text-sf-ink">{headline}</p>}<p className={muted}>{scope} · all sales</p>
    {table ? <div id="tree-table"><Table caption={`Revenue tree · ${scope}`} headings={['Measure', 'Value', 'Note']} rows={rows} /></div> : (
      <div id="tree-chart" aria-label="Revenue growth tree" className="grid gap-4 lg:grid-cols-[minmax(100px,.8fr)_minmax(0,2.4fr)]">
        <div className="relative after:absolute after:top-full after:left-3 after:h-[17px] after:border-l after:border-sf-line-strong lg:after:top-[27px] lg:after:left-full lg:after:h-0 lg:after:w-[17px] lg:after:border-l-0 lg:after:border-t">
          <Node label={rows[0][0]} value={rows[0][1]} note={rows[0][2]} hero />
        </div>
        <div className="ml-3 space-y-3 border-l border-sf-line-strong pl-4 lg:ml-0">
          <div className="relative before:absolute before:top-[27px] before:-left-[17px] before:w-4 before:border-t before:border-sf-line-strong"><Node label={rows[1][0]} value={rows[1][1]} note={rows[1][2]} /></div>
          <div className="ml-3 grid gap-3 border-l border-sf-line-strong pl-4 sm:ml-0 sm:grid-cols-3 sm:border-l-0 sm:border-t sm:pl-0 sm:pt-3">
            {rows.slice(2, 5).map(row => <div key={row[0]} className="relative before:absolute before:top-[27px] before:-left-[17px] before:w-4 before:border-t before:border-sf-line-strong sm:before:-top-[13px] sm:before:left-1/2 sm:before:h-3 sm:before:w-0 sm:before:border-t-0 sm:before:border-l"><Node label={row[0]} value={row[1]} note={row[2]} /></div>)}
          </div>
          {formula !== null && <p className="rounded-lg bg-sf-accent-soft p-2 text-xs tabular-nums text-sf-brand">{formula}</p>}
          <div className="relative before:absolute before:top-[27px] before:-left-[17px] before:w-4 before:border-t before:border-sf-line-strong"><Node label={rows[5][0]} value={rows[5][1]} note={rows[5][2]} /></div>
        </div>
      </div>
    )}
    {table && formula !== null && <p className="rounded-lg bg-sf-accent-soft p-2 text-xs tabular-nums text-sf-brand">{formula}</p>}<div className="rounded-[10px] border border-dashed border-sf-line p-3 text-xs"><strong>Gross profit</strong><p className={muted}>{gpNote}</p><a className="inline-flex min-h-9 items-center text-sf-brand underline" href="#data-health">Why?</a></div>
    <div className="space-y-2 border-t border-sf-line-soft pt-4"><h3 className="text-xs font-bold">{comparison}</h3><Table caption={`${data.companyCount === 1 ? 'One Tally company' : `${data.companyCount} Tally companies`} · half-year comparison`} headings={['Measure', 'H1', 'H2', 'Change']} rows={comparisonRows} /><p className={muted}>Instrument &amp; bulk is lumpy: {a.bulkInvoices} invoices in H1, {b.bulkInvoices} in H2.</p></div>
  </section>;
}

function Bridge({ data, scope, comparison }: { data: GrowthData; scope: string; comparison: string }) {
  const [table, setTable] = useState(false);
  const b = data.bridge;
  const bars = [
    { label: 'H1 total', lines: ['H1', 'total'], value: b.h1Paise, kind: 'total' },
    { label: `+ New labs (${b.new.labs})`, lines: ['New labs', `(${b.new.labs})`], value: b.new.paise, kind: 'up' },
    { label: `− Labs that stopped (${b.stopped.labs})`, lines: ['Stopped', `(${b.stopped.labs})`], value: -b.stopped.paise, kind: 'down' },
    { label: `+ Existing labs that grew (${b.grew.labs})`, lines: ['Existing', `grew (${b.grew.labs})`], value: b.grew.paise, kind: 'up' },
    { label: `− Existing labs that fell (${b.fell.labs})`, lines: ['Existing', `fell (${b.fell.labs})`], value: -b.fell.paise, kind: 'down' },
    ...(b.other.paise !== 0 ? [{ label: `Other (${b.other.labs})`, lines: ['Other', `(${b.other.labs})`], value: b.other.paise, kind: b.other.paise > 0 ? 'up' : 'down' }] : []),
    { label: 'H2 total', lines: ['H2', 'total'], value: b.h2Paise, kind: 'total' },
  ];
  let running = 0;
  const geometry = bars.map(bar => { const start = bar.kind === 'total' ? 0 : running; const end = bar.kind === 'total' ? bar.value : running + bar.value; running = end; return { ...bar, start, end }; });
  const low = Math.min(0, ...geometry.flatMap(v => [v.start, v.end])), high = Math.max(0, ...geometry.flatMap(v => [v.start, v.end]));
  const y = (n: number) => 30 + (high - n) / (high - low || 1) * 175;
  const width = 100 / bars.length;
  const identity = `${(b.h1Paise / 1e7).toFixed(1)} + ${(b.new.paise / 1e7).toFixed(1)} − ${(b.stopped.paise / 1e7).toFixed(1)} + ${(b.grew.paise / 1e7).toFixed(1)} − ${(b.fell.paise / 1e7).toFixed(1)}${b.other.paise ? ` ${b.other.paise > 0 ? '+' : '−'} ${(Math.abs(b.other.paise) / 1e7).toFixed(1)}` : ''} = ${(b.h2Paise / 1e7).toFixed(1)}.`;
  return <section className={card} aria-labelledby="bridge-title"><div className="flex items-center justify-between gap-2"><h2 id="bridge-title" className="text-base font-bold">Where growth came from</h2><Toggle name="bridge" table={table} onClick={() => setTable(!table)} /></div><p className="text-xs font-bold text-sf-ink">{b.new.paise <= b.stopped.paise ? `New labs only replaced the labs we lost; growth came from ${b.grew.labs} existing labs.` : 'New labs added more than we lost.'}</p><p className={muted}>{comparison} · {scope} · all sales</p>
    {table ? <div id="bridge-table"><Table caption={`Revenue bridge · ${scope}`} headings={['Contribution', 'Revenue']} rows={bars.map(bar => [bar.label, lakh(Math.abs(bar.value))])} /></div> : <div id="bridge-chart"><svg className="block h-[270px] w-full overflow-visible" role="img" aria-labelledby="bridge-svg-title bridge-svg-desc"><title id="bridge-svg-title">H1 to H2 revenue bridge in ₹ lakh</title><desc id="bridge-svg-desc">{bars.map(bar => `${bar.label} ${lakh(Math.abs(bar.value))}`).join('; ')}. {identity}</desc><line x1="0" x2="100%" y1={y(0)} y2={y(0)} stroke="var(--sf-line)" />{geometry.map((bar, i) => { const x = i * width + 2; const top = y(Math.max(bar.start, bar.end)); return <g key={bar.label}>{i < bars.length - 1 && <line x1={`${x + width - 4}%`} x2={`${(i + 1) * width + 2}%`} y1={y(bar.end)} y2={y(bar.end)} stroke="var(--sf-line-strong)" strokeDasharray="3 3" />}<rect data-growth-bar={bar.kind} x={`${x}%`} width={`${width - 4}%`} y={top} height={Math.max(2, Math.abs(y(bar.start) - y(bar.end)))} rx="2" fill={`var(--sf-${bar.kind === 'total' ? 'brand' : bar.kind === 'up' ? 'success' : 'danger'})`} /><text x={`${(i + .5) * width}%`} y={top - 20} textAnchor="middle" className="fill-sf-label text-[15px]"><tspan x={`${(i + .5) * width}%`}>{lakh(Math.abs(bar.value)).replace(/ L$/, '')}</tspan><tspan x={`${(i + .5) * width}%`} dy="14" className="text-xs">L</tspan></text><text x={`${(i + .5) * width}%`} y="230" textAnchor="middle" className="fill-sf-label text-xs">{bar.lines.map((line, j) => <tspan key={j} x={`${(i + .5) * width}%`} dy={j ? 16 : 0}>{line}</tspan>)}</text></g>; })}</svg><div className="flex flex-wrap gap-3 text-xs text-sf-muted">{['Total', 'Increase', 'Decrease'].map((v, i) => <span key={v} className="inline-flex items-center gap-1"><i className={`size-2 rounded-sm ${['bg-sf-brand', 'bg-sf-success', 'bg-sf-danger'][i]}`} />{v}</span>)}<span>Values in ₹ L</span></div></div>}
    <p className="text-xs tabular-nums text-sf-muted" aria-label="Bridge identity">{identity}</p><p className={muted}>Many labs buy only a few months a year, so part of &apos;stopped&apos; may be infrequent buyers.</p></section>;
}

function Health({ data }: { data: GrowthData }) {
  const h = data.health, pct = h.gp.costedPct;
  const age = h.catalog.observedAt === null ? null : Date.now() - Date.parse(h.catalog.observedAt);
  const rows = [
    { title: 'Gross profit', status: pct === null || pct < 50 ? 'Blocked' : pct < 90 ? 'Limited' : 'Current', text: pct === null ? 'cost not computed yet' : `Cost known for ${pct}% of sales`, effect: pct === null || pct < 50 ? 'Profit side of the tree is blank' : '' },
    { title: 'History depth', status: h.history.monthsImported < 24 ? 'Limited' : 'Current', text: `${h.history.monthsImported} months imported`, effect: h.history.monthsImported < 24 ? 'No year-on-year yet' : '' },
    { title: 'Sales confirmation', status: data.confirmed ? 'Current' : 'Limited', text: data.confirmed ? 'Confirmed' : data.confirmedReason ?? 'Unknown' },
    { title: 'Item groups', status: h.itemGroups.unmappedPct === null ? 'Unknown' : h.itemGroups.unmappedPct > 10 ? 'Limited' : 'Current', text: h.itemGroups.unmappedPct === null ? 'Unknown' : `${h.itemGroups.unmappedPct}% of sales has no principal`, owner: 'Map items to principals in Brand setup' },
    { title: 'Reasons (qualitative)', status: h.reasons.visitReasons180 + h.reasons.constraints === 0 ? 'Blocked' : 'Current', text: `${h.reasons.visitReasons180} visit reasons, ${h.reasons.constraints} diagnoses, ${h.reasons.openActions} open actions, ${h.reasons.visits180} visits (180 days)`, effect: h.reasons.visitReasons180 + h.reasons.constraints === 0 ? 'We can see what changed, not why' : '' },
    { title: 'Item catalog', status: age !== null && age >= 0 && age <= 7 * 86400000 ? 'Current' : 'Limited', text: h.catalog.groups === null ? 'Unknown' : `${h.catalog.groups} groups` },
  ];
  return <aside id="data-health" tabIndex={-1} className={`${card} scroll-mt-4 focus:outline-sf-accent`} aria-labelledby="health-title"><h2 id="health-title" className="text-base font-bold">Data health</h2><p className={muted}>What limits these numbers · {data.companyCount === 1 ? 'one Tally company' : `${data.companyCount} Tally companies`}</p><ul>{rows.map(row => <li key={row.title} className="grid grid-cols-[8px_minmax(0,1fr)] gap-2.5 border-b border-sf-line-soft py-3.5 text-xs last:border-0 last:pb-0"><span aria-hidden="true" className={`mt-1.5 size-2 rounded-full ${row.status === 'Current' ? 'bg-sf-success' : row.status === 'Blocked' ? 'bg-sf-danger' : 'bg-sf-warning'}`} /><div><strong>{row.title}</strong><span className="text-sf-muted"> · {row.status}</span><p className="mt-1">{row.text}</p>{row.effect && <p className="mt-1 text-sf-muted">{row.effect}</p>}{row.owner && <p className="mt-1 text-sf-brand">{row.owner}</p>}</div></li>)}</ul></aside>;
}

export function GrowthPage() {
  const [data, setData] = useState<GrowthData | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
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
  return <div className="h-full min-w-0 overflow-y-auto p-4 text-sm text-sf-strong sm:p-6 [overflow-wrap:break-word]"><header className="mb-5 space-y-2"><p className={muted}>More / Management</p><h1 className="text-xl font-bold">Growth</h1>{data && <p className={muted}>{scope} · management only</p>}{data && !data.confirmed && <p className="text-xs text-sf-warning">Not confirmed: {data.confirmedReason ?? 'Unknown'}</p>}</header>{error ? <div role="alert"><p>{error}</p>{error !== 'Growth is for management only.' && <button className="mt-3 min-h-11 rounded-lg border border-sf-line px-3" onClick={() => { setData(null); setError(''); setRevision(n => n + 1); }}>Retry</button>}</div> : !data ? <p role="status">Loading growth…</p> : <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,2.2fr)_minmax(260px,1fr)] lg:gap-5"><div className="min-w-0 space-y-4"><Revenue data={data} scope={scope} comparison={comparison} /><Bridge data={data} scope={scope} comparison={comparison} /></div><Health data={data} /></div>}</div>;
}
