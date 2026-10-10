'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, RefreshCw, Search, Wrench } from 'lucide-react';
import { filterInstrumentPortfolio, instrumentStatusLabels, type InstrumentPortfolio, type InstrumentPortfolioRow, type InstrumentServiceStatus } from '@/lib/instrument-portfolio';

const statusStyle: Record<InstrumentServiceStatus, string> = {
  urgent: 'border-red-200 bg-red-50 text-red-800',
  attention: 'border-amber-200 bg-amber-50 text-amber-900',
  clear: 'border-emerald-200 bg-emerald-50 text-emerald-800',
};
const inputStyle = 'min-h-11 rounded-xl border border-[#cedfdd] bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#217b69]';

export function InstrumentStatusBadge({ status }: { status: InstrumentServiceStatus }) {
  const Icon = status === 'urgent' ? AlertTriangle : status === 'attention' ? Wrench : CheckCircle2;
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${statusStyle[status]}`}><Icon size={14} aria-hidden="true" />{instrumentStatusLabels[status]}</span>;
}

export function InstrumentCard({ row }: { row: InstrumentPortfolioRow }) {
  return <article className="overflow-hidden rounded-2xl border border-[#d7e4e2] bg-white shadow-sm">
    <div className={`h-1.5 ${row.serviceStatus === 'urgent' ? 'bg-red-500' : row.serviceStatus === 'attention' ? 'bg-amber-400' : 'bg-emerald-500'}`} />
    <div className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-[#586e71]">{row.customerName}</p><h2 className="mt-1 text-lg font-extrabold text-[#092f36]">{row.itemName}</h2><p className="mt-1 text-xs text-[#586e71]">Serial {row.serialNumber}</p></div><InstrumentStatusBadge status={row.serviceStatus} /></div>
    <dl className="mt-5 grid grid-cols-2 gap-4 border-y border-[#edf3f1] py-4 text-sm"><div><dt className="text-xs text-[#586e71]">Installation</dt><dd className="mt-1 font-semibold">{new Date(row.installedAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Calcutta', day: 'numeric', month: 'short', year: 'numeric' })}</dd></div><div><dt className="text-xs text-[#586e71]">Open service tickets</dt><dd className="mt-1 font-semibold">{row.openTicketCount}</dd></div></dl>
    <div className="mt-4 flex items-center justify-between gap-2"><span className="text-xs font-bold text-[#586e71]">Economic health</span><span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">Financial workspace</span></div>
    <p className="mt-2 text-xs leading-5 text-[#586e71]">Management and Accounts can review verified sales, GP, recovery and reagent leakage in Instrument Economics.</p>
    <details className="group mt-4 rounded-xl bg-[#f4f8f6] p-3"><summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold text-[#31585d]">Installation evidence<ChevronDown size={16} className="group-open:rotate-180" aria-hidden="true" /></summary><dl className="mt-3 grid gap-3 text-sm"><div><dt className="text-xs text-[#586e71]">Source reference</dt><dd>{row.orderNumber}</dd></div><div><dt className="text-xs text-[#586e71]">Site contact</dt><dd>{row.siteContact || 'Not recorded'}</dd></div><div><dt className="text-xs text-[#586e71]">Commissioning notes</dt><dd className="whitespace-pre-wrap break-words">{row.commissioningNotes || 'Not recorded'}</dd></div>{row.openTicketNumbers.length ? <div><dt className="text-xs text-[#586e71]">Open ticket references</dt><dd>{row.openTicketNumbers.join(', ')}</dd></div> : null}</dl></details>
    </div></article>;
}

export function InstrumentWorkspace() {
  const [data, setData] = useState<InstrumentPortfolio | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<InstrumentServiceStatus | 'all'>('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch('/api/instruments', { cache: 'no-store', signal });
      const body = await response.json() as InstrumentPortfolio & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Unable to load instruments');
      setData(body); setError('');
    } catch (cause) {
      if (signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Unable to load instruments');
    } finally { if (!signal.aborted) setLoading(false); }
  }, []);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load, refresh]);
  const rows = data?.instruments ?? [];
  const visible = useMemo(() => filterInstrumentPortfolio(data?.instruments ?? [], query, status), [data, query, status]);
  const counts = { urgent: rows.filter(row => row.serviceStatus === 'urgent').length, attention: rows.filter(row => row.serviceStatus === 'attention').length, clear: rows.filter(row => row.serviceStatus === 'clear').length };
  return <main className="h-dvh overflow-y-auto bg-[#f4f7f5] text-[#173239]"><div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><Link href="/" className="inline-flex min-h-10 items-center gap-2 text-sm font-bold text-[#217b69]"><ArrowLeft size={16} aria-hidden="true" />Back to workspace</Link><p className="mt-3 text-xs font-extrabold uppercase tracking-[0.18em] text-[#217b69]">Suprabha OS · Instruments</p><h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Instrument portfolio</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[#586e71]">Your installed equipment, service priorities and economic data readiness in one place.</p></div><button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#cedfdd] bg-white px-4 text-sm font-bold disabled:opacity-50"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />{loading ? 'Refreshing…' : 'Refresh'}</button></header>
    <section aria-label="Portfolio summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
      { label: 'Installed instruments', value: rows.length, icon: Activity, color: 'text-[#145e62]' },
      { label: 'Urgent service', value: counts.urgent, icon: AlertTriangle, color: 'text-red-700' },
      { label: 'Service attention', value: counts.attention, icon: Wrench, color: 'text-amber-800' },
      { label: 'No open service issues', value: counts.clear, icon: CheckCircle2, color: 'text-emerald-700' },
    ].map(({ label, value, icon: Icon, color }) => <article key={label} className="rounded-2xl border border-[#d7e4e2] bg-white p-4 sm:p-5"><Icon size={20} className={color} aria-hidden="true" /><p className="mt-3 text-xs font-semibold text-[#586e71]">{label}</p><strong className={`mt-1 block text-3xl ${color}`}>{data ? value : '—'}</strong></article>)}</section>
    <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700"><strong>Instrument economics.</strong> <Link href="/instrument-economics" className="font-bold underline">Open financial health and reagent leakage</Link> (Management and Accounts access). Service colors describe open issues; they do not confirm instrument uptime or profitability.</aside>
    <section aria-label="Find instruments" className="flex flex-col gap-3 rounded-2xl border border-[#d7e4e2] bg-white p-4 sm:flex-row"><label className="relative flex-1"><span className="sr-only">Search instruments</span><Search size={17} className="absolute left-3 top-3.5 text-[#586e71]" aria-hidden="true" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Customer, instrument, serial or ticket…" className={`${inputStyle} w-full pl-10`} /></label><label className="flex items-center gap-2 text-sm font-semibold">Service status<select value={status} onChange={event => setStatus(event.target.value as InstrumentServiceStatus | 'all')} className={inputStyle}><option value="all">All instruments</option>{Object.entries(instrumentStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></section>
    {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}{data ? ' Previously loaded records are shown and may be out of date.' : ''}</div> : null}
    {data ? <output className="text-xs text-[#586e71]">{visible.length} of {rows.length} instruments · Loaded {new Date(data.generatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Calcutta' })} IST. This is the portfolio load time, not Tally sync freshness.</output> : !error ? <output className="rounded-2xl bg-white p-8 text-sm text-[#586e71]">Loading instrument records…</output> : null}
    {data && !visible.length ? <section className="rounded-2xl border border-dashed border-[#cedfdd] bg-white p-10 text-center"><Activity className="mx-auto text-[#586e71]" aria-hidden="true" /><h2 className="mt-3 font-bold">{rows.length ? 'No matching instruments' : 'No completed installations yet'}</h2><p className="mt-2 text-sm text-[#586e71]">{rows.length ? 'Try another search or service status.' : 'Equipment appears automatically after an installation is completed in Orders.'}</p></section> : <section aria-label="Installed instruments" className="grid gap-4 lg:grid-cols-2">{visible.map(row => <InstrumentCard key={row.installationId} row={row} />)}</section>}
  </div></main>;
}
