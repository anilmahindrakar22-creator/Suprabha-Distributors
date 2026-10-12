'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { PageHeader, SummaryStrip, pageActionClass } from './page-header';
import { readJsonBody } from '@/lib/http-json';
import type { MarketOverview, MarketOverviewCustomer, MarketOverviewFilter } from '@/lib/market-overview-types';
import { formatPaise, rupeesToPaise, walletMethods, walletConfidences, type CustomerWallet, type WalletDivision } from '@/lib/wallet-types';

const inputClass = 'min-h-11 w-full min-w-0 rounded-xl border border-sf-line bg-sf-soft-0 px-3 text-sm font-normal text-sf-body outline-none focus:border-sf-mint';
const buttonClass = 'min-h-11 rounded-xl bg-sf-ink-hover px-4 text-sm font-bold text-sf-soft disabled:opacity-50';
const alertClass = 'rounded-xl bg-sf-danger-soft p-3 text-sm text-sf-danger';
type CoverageFilter = Extract<MarketOverviewFilter, 'all' | 'no_estimate' | 'stale_estimate'>;

type FormSubmission = { preventDefault(): void };

function todayInKolkata() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
function displayDate(date: string) {
  const [year, month, day] = date.split('-');
  return `${Number(day)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month) - 1]} ${year}`;
}
const methodLabel = (value: string) => walletMethods.find(method => method.value === value)?.label;
const confidenceLabel = (value: string) => walletConfidences.find(confidence => confidence.value === value)?.label;

async function getJson<T>(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { cache: 'no-store', signal });
  const body = await readJsonBody<T & { error?: string }>(response);
  if (!response.ok) throw new Error(body.error || 'Unable to load Market');
  return body;
}
async function postCommand(url: string, command: Record<string, unknown>) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command) });
  const body = await readJsonBody<{ error?: string }>(response);
  if (!response.ok) throw new Error(body.error || 'Unable to save Market update');
}
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : 'Market is temporarily unavailable';

export function MarketWorkspace() {
  const [data, setData] = useState<MarketOverview | null>(null);
  const [mode, setMode] = useState<'wallet' | 'coverage'>('wallet');
  const [walletFilter, setWalletFilter] = useState<'focus' | 'all' | null>(null);
  const [coverageFilter, setCoverageFilter] = useState<CoverageFilter>('all');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  const divisions = useRef<Promise<WalletDivision[]> | null>(null);
  const filter = mode === 'wallet' ? walletFilter ?? 'focus' : coverageFilter;

  const loadDivisions = useCallback(() => {
    if (!divisions.current) divisions.current = getJson<{ divisions: WalletDivision[] }>('/api/market/wallet?view=divisions')
      .then(body => body.divisions).catch(cause => { divisions.current = null; throw cause; });
    return divisions.current;
  }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    const current = ++request.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ filter, search, page: String(page) });
      const body = await getJson<MarketOverview>(`/api/market/overview?${params}`, signal);
      if (current !== request.current || signal?.aborted) return;
      setData(body); setError('');
      if (mode === 'wallet') setWalletFilter(previous => previous ?? (body.pareto.estimatedCustomers > 0 ? 'focus' : 'all'));
    } catch (cause) {
      if (current === request.current && !signal?.aborted) setError(errorMessage(cause));
    } finally {
      if (current === request.current && !signal?.aborted) setLoading(false);
    }
  }, [filter, search, page, mode]);
  useEffect(() => {
    if (query === search) return;
    const timer = window.setTimeout(() => { setSearch(query); setPage(1); setOpenId(null); }, 300);
    return () => window.clearTimeout(timer);
  }, [query, search]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load]);

  function selectMode(next: typeof mode) { setMode(next); setPage(1); setOpenId(null); }
  function selectCoverage(next: CoverageFilter) { setCoverageFilter(current => current === next ? 'all' : next); setPage(1); setOpenId(null); }

  return <div className="h-full overflow-y-auto bg-sf-page"><div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
    <PageHeader title="Market" description="Where the money is, and what we don't know yet." actions={<button type="button" disabled={loading} onClick={() => void load()} className={`${pageActionClass} min-h-11`}>Refresh</button>} />
    <div role="tablist" aria-label="Market mode" className="inline-flex w-full gap-1 overflow-x-auto sm:w-auto rounded-2xl border border-sf-line-soft bg-sf-soft-0 p-1.5 [scrollbar-width:none]">
      {(['wallet', 'coverage'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => selectMode(value)} className={`min-h-10 flex-1 shrink-0 whitespace-nowrap rounded-xl px-5 sm:flex-none py-2 text-sm font-bold ${mode === value ? 'bg-sf-brand text-sf-soft-0' : 'text-sf-body hover:bg-sf-soft'}`}>{value === 'wallet' ? 'Wallet' : 'Coverage'}</button>)}
    </div>
    {mode === 'wallet' && data ? <div className="space-y-2 rounded-2xl border border-sf-line-soft bg-sf-soft-0 p-4 text-sm text-sf-body">
      {data.pareto.estimatedCustomers > 0 ? <><p><strong>{data.pareto.focusCustomers} customers</strong> hold 80% of the estimated wallet · <strong>{formatPaise(data.pareto.focusWalletPaise)}/month</strong></p><p className="text-sf-muted">Based on {data.pareto.estimatedCustomers} of {data.pareto.activeCustomers} customers with a wallet estimate. Tally sales are not included yet.</p></> : <p>No wallet estimates yet. Open a customer and add one.</p>}
      <button type="button" className="min-h-11 text-sm font-bold text-sf-brand" onClick={() => { setWalletFilter(filter === 'focus' ? 'all' : 'focus'); setPage(1); setOpenId(null); }}>{filter === 'focus' ? 'Show all customers' : 'Show focus list'}</button>
    </div> : null}
    {mode === 'coverage' ? <SummaryStrip label="Coverage" items={[
      { label: 'No wallet estimate', value: data?.counts.noEstimate, tone: data?.counts.noEstimate ? 'attention' : 'normal', onSelect: () => selectCoverage('no_estimate'), selected: filter === 'no_estimate' },
      { label: 'Estimate older than 6 months', value: data?.counts.staleEstimate, tone: data?.counts.staleEstimate ? 'attention' : 'normal', onSelect: () => selectCoverage('stale_estimate'), selected: filter === 'stale_estimate' },
    ]} /> : null}
    <label className="block text-sm font-bold text-sf-body">Search customers<input type="search" value={query} maxLength={120} onChange={event => setQuery(event.target.value)} placeholder="Search customers or city" className={`mt-2 ${inputClass}`} /></label>
    {error ? <p role="alert" className={alertClass}>{error}</p> : null}
    {status ? <output className="block text-sm text-sf-success">{status}</output> : null}
    {loading ? <output className="block text-sm text-sf-muted">Loading Market…</output> : null}
    {data && !loading && !data.customers.length ? <p className="text-sm text-sf-muted">No customers match this list.</p> : null}
    <ul aria-label="Customers" aria-busy={loading} className="space-y-3">{data?.customers.map(customer => <li key={customer.id} className="min-w-0 rounded-2xl border border-sf-line-soft bg-sf-soft-0">
      <button type="button" aria-expanded={openId === customer.id} aria-controls={`market-customer-${customer.id}`} className="min-h-11 w-full space-y-2 p-4 text-left text-sm text-sf-body" onClick={() => setOpenId(current => current === customer.id ? null : customer.id)}>
        <span className="flex items-start justify-between gap-3"><span className="min-w-0 break-words"><strong className="text-sf-ink">{customer.name}</strong>{customer.city ? <span className="ml-2 text-sf-muted">{customer.city}</span> : null}</span><span className={`shrink-0 ${customer.walletTotalPaise === null ? 'text-sf-muted' : 'font-bold text-sf-ink'}`}>{customer.walletTotalPaise === null ? 'No estimate' : `${formatPaise(customer.walletTotalPaise)}/month`}</span></span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-sf-muted"><span>{customer.divisionsEstimated} of {data.activeDivisions} divisions</span>{mode === 'wallet' && customer.inFocus ? <span className="rounded-full bg-sf-accent-soft px-2 py-0.5 font-bold text-sf-accent">Focus</span> : null}{customer.staleEstimate ? <span className="rounded-full bg-sf-warning-soft px-2 py-0.5 font-bold text-sf-warning">Old estimate</span> : null}</span>
      </button>
      {openId === customer.id ? <CustomerPanel key={customer.id} customer={customer} loadDivisions={loadDivisions} refreshOverview={load} onStatus={setStatus} /> : null}
    </li>)}</ul>
    {data && data.page.total > 50 ? <div className="flex items-center justify-between gap-3"><button type="button" className={`${pageActionClass} min-h-11`} disabled={loading || page === 1} onClick={() => { setPage(current => current - 1); setOpenId(null); }}>Previous</button><span className="text-sm text-sf-muted">Page {page}</span><button type="button" className={`${pageActionClass} min-h-11`} disabled={loading || page * 50 >= data.page.total} onClick={() => { setPage(current => current + 1); setOpenId(null); }}>Next</button></div> : null}
  </div></div>;
}

function CustomerPanel({ customer, loadDivisions, refreshOverview, onStatus }: { customer: MarketOverviewCustomer; loadDivisions: () => Promise<WalletDivision[]>; refreshOverview: () => Promise<void>; onStatus: (message: string) => void }) {
  const fieldId = useId();
  const [wallet, setWallet] = useState<CustomerWallet | null>(null);
  const [divisions, setDivisions] = useState<WalletDivision[]>([]);
  const [panelError, setPanelError] = useState('');
  const [estimateError, setEstimateError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState('');
  const [today] = useState(todayInKolkata);
  const [form, setForm] = useState({ divisionId: '', amount: '', method: 'manager_estimate', confidence: 'medium', asOf: today, note: '' });
  const request = useRef(0);
  const load = useCallback(async (signal?: AbortSignal) => {
    const current = ++request.current;
    try {
      const results = await Promise.allSettled([
        getJson<CustomerWallet>(`/api/market/wallet?customerId=${encodeURIComponent(customer.id)}`, signal), loadDivisions(),
      ]);
      if (signal?.aborted || current !== request.current) return;
      const [walletResult, divisionsResult] = results;
      if (walletResult.status === 'fulfilled') setWallet(walletResult.value);
      if (divisionsResult.status === 'fulfilled') {
        const active = divisionsResult.value.filter(division => division.active);
        setDivisions(active); setForm(previous => ({ ...previous, divisionId: previous.divisionId || active[0]?.id || '' }));
      }
      const failure = results.find(result => result.status === 'rejected');
      setPanelError(failure?.status === 'rejected' ? errorMessage(failure.reason) : '');
    } catch (cause) { if (!signal?.aborted && current === request.current) setPanelError(errorMessage(cause)); }
  }, [customer.id, loadDivisions]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load]);

  async function saveEstimate(event: FormSubmission) {
    event.preventDefault(); setEstimateError(''); onStatus('');
    const monthlyWalletPaise = rupeesToPaise(form.amount);
    if (monthlyWalletPaise === null) { setEstimateError('Enter an amount like 1,25,000'); return; }
    setBusy('estimate');
    try {
      await postCommand('/api/market/wallet', { action: 'record_wallet_estimate', payload: { customerId: customer.id, divisionId: form.divisionId, monthlyWalletPaise, method: form.method, confidence: form.confidence, asOf: form.asOf, note: form.note, idempotencyKey: crypto.randomUUID() } });
      onStatus('Estimate saved'); await load(); await refreshOverview();
    } catch (cause) { setEstimateError(errorMessage(cause)); }
    finally { setBusy(''); }
  }
  return <div id={`market-customer-${customer.id}`} className="min-w-0 space-y-5 border-t border-sf-line-soft p-4">
    {panelError ? <p role="alert" className={alertClass}>{panelError}</p> : null}
    <section aria-label="Wallet estimate" className="min-w-0 space-y-3 text-sm text-sf-body"><h3 className="font-bold text-sf-ink">Wallet estimate</h3>
      {!wallet && !panelError ? <p className="text-sf-muted">Loading wallet estimate…</p> : null}
      {wallet?.current.length ? <>
        <ul className="space-y-2 sm:hidden" aria-label="Current estimates">
          {wallet.current.map(row => <li key={row.division.id} className="rounded-xl border border-sf-line-soft p-3">
            <div className="flex items-start justify-between gap-3"><strong className="min-w-0 break-words">{row.division.name}</strong><span className="shrink-0 text-right">{formatPaise(row.monthlyWalletPaise)}/month</span></div>
            <p className="mt-1 text-xs text-sf-muted">{methodLabel(row.method)} {'\u00b7'} {confidenceLabel(row.confidence)} {'\u00b7'} {displayDate(row.asOf)}</p>
          </li>)}
          <li className="flex justify-between gap-3 border-t border-sf-line p-3 font-bold"><span>Total</span><span className="text-right">{formatPaise(wallet.totalMonthlyWalletPaise)}/month</span></li>
        </ul>
        <div className="hidden sm:block"><div className="max-w-full overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Division', 'Wallet per month', 'Method', 'Confidence', 'As of'].map(label => <th key={label} scope="col" className="p-2 font-bold">{label}</th>)}</tr></thead><tbody>{wallet.current.map(row => <tr key={row.division.id} className="border-t border-sf-line-soft"><th scope="row" className="p-2 font-normal">{row.division.name}</th><td className="p-2">{formatPaise(row.monthlyWalletPaise)}</td><td className="p-2">{methodLabel(row.method)}</td><td className="p-2">{confidenceLabel(row.confidence)}</td><td className="whitespace-nowrap p-2">{displayDate(row.asOf)}</td></tr>)}</tbody><tfoot><tr className="border-t border-sf-line"><th scope="row" className="p-2">Total</th><td colSpan={4} className="p-2 font-bold">{formatPaise(wallet.totalMonthlyWalletPaise)}/month</td></tr></tfoot></table></div></div></> : wallet ? <p className="text-sf-muted">No estimate yet.</p> : null}
      <button type="button" aria-expanded={showForm} onClick={() => setShowForm(current => !current)} className={buttonClass}>Update estimate</button>
      {showForm ? <form onSubmit={event => void saveEstimate(event)} className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="grid min-w-0 gap-1 font-bold"><label htmlFor={`${fieldId}-division`} className="font-bold">Division</label><select id={`${fieldId}-division`} required value={form.divisionId} onChange={event => setForm(previous => ({ ...previous, divisionId: event.target.value }))} className={inputClass}><option value="">Select a division</option>{divisions.map(division => <option key={division.id} value={division.id}>{division.name}</option>)}</select></div>
        <div className="grid min-w-0 gap-1 font-bold"><label htmlFor={`${fieldId}-amount`} className="font-bold">Monthly wallet (₹)</label><input id={`${fieldId}-amount`} inputMode="decimal" value={form.amount} onChange={event => setForm(previous => ({ ...previous, amount: event.target.value }))} className={inputClass} /></div>
        <div className="grid min-w-0 gap-1 font-bold"><label htmlFor={`${fieldId}-method`} className="font-bold">Method</label><select id={`${fieldId}-method`} value={form.method} onChange={event => setForm(previous => ({ ...previous, method: event.target.value }))} className={inputClass}>{walletMethods.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}</select></div>
        <div className="grid min-w-0 gap-1 font-bold"><label htmlFor={`${fieldId}-confidence`} className="font-bold">Confidence</label><select id={`${fieldId}-confidence`} value={form.confidence} onChange={event => setForm(previous => ({ ...previous, confidence: event.target.value }))} className={inputClass}>{walletConfidences.map(confidence => <option key={confidence.value} value={confidence.value}>{confidence.label}</option>)}</select></div>
        <div className="grid min-w-0 gap-1 font-bold"><label htmlFor={`${fieldId}-asof`} className="font-bold">As of</label><input id={`${fieldId}-asof`} type="date" required max={today} value={form.asOf} onChange={event => setForm(previous => ({ ...previous, asOf: event.target.value }))} className={inputClass} /></div>
        <div className="grid min-w-0 gap-1 font-bold sm:col-span-2"><label htmlFor={`${fieldId}-note`} className="font-bold">Note</label><textarea id={`${fieldId}-note`} required minLength={3} maxLength={500} value={form.note} onChange={event => setForm(previous => ({ ...previous, note: event.target.value }))} className={`${inputClass} min-h-24 py-2`} /></div>
        {estimateError ? <p role="alert" className={`${alertClass} sm:col-span-2`}>{estimateError}</p> : null}
        <button disabled={Boolean(busy) || !divisions.length} className={`${buttonClass} justify-self-start`}>Save</button>
      </form> : null}
      {wallet ? <details><summary className="min-h-11 cursor-pointer py-3 font-bold text-sf-brand">History ({wallet.history.length})</summary><ul className="space-y-3">{[...wallet.history].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((row, index) => <li key={`${row.division.id}:${row.createdAt}:${index}`} className="break-words rounded-xl bg-sf-soft p-3"><p>{displayDate(row.asOf)} · {row.division.name} · {formatPaise(row.monthlyWalletPaise)} · {methodLabel(row.method)} · {confidenceLabel(row.confidence)} · by {row.createdBy}</p><p className="mt-1 whitespace-pre-wrap text-sf-muted">{row.note}</p></li>)}</ul></details> : null}
    </section>
  </div>;
}
