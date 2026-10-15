'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, Ban, CircleAlert, CircleCheck, Info, Link2 } from 'lucide-react';
import type { CustomerLinkRow, CustomerLinksResponse, CustomerLinkState, ConfirmCustomerLinksResult } from '@/lib/customer-link-types';
import { readJsonBody } from '@/lib/http-json';

const inputClass = 'min-h-11 w-full min-w-0 rounded-xl border border-sf-line bg-white px-3 text-sm text-sf-body';
const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-sf-line px-3 text-sm font-semibold text-sf-brand disabled:opacity-50';
type Selection = { customerId: string; ledgerGuid: string };
type LedgerList = Extract<CustomerLinksResponse, { sourceVersion: string }>;

export function shortGuid(guid: string) { return `…${guid.slice(-8)}`; }
export function rowsAfterReload(selected: Selection[], rows: CustomerLinkRow[]) {
  const kept = selected.filter(selection => rows.some(row => row.state === 'suggested' && row.customerId === selection.customerId && row.guid === selection.ledgerGuid));
  return { kept, removed: selected.length - kept.length };
}
function observedDate(value: string) {
  const date = new Date(value);
  const day = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).replace('Sept', 'Sep');
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).toLowerCase();
  return `${day}, ${time}, IST`;
}

export function CustomerLinkCard({ row, checked = false, disabled = false, onSelect }: { row: CustomerLinkRow; checked?: boolean; disabled?: boolean; onSelect?: (checked: boolean) => void }) {
  const Icon = row.state === 'conflict' ? Ban : row.state === 'linked' ? Link2 : CircleCheck;
  return <li className="min-w-0 rounded-lg border border-sf-line-soft bg-white p-3">
    <div className="flex items-start gap-3">
      {row.state === 'suggested' ? <input type="checkbox" className="mt-1 size-5 shrink-0" aria-label={`Select ${row.customerName} (${row.customerId})`} checked={checked} disabled={disabled} onChange={event => onSelect?.(event.target.checked)} /> : null}
      <div className="min-w-0 flex-1 break-words">
        <p><span className="font-semibold text-sf-strong">{row.customerName}</span>{row.city ? <span className="text-sm text-sf-muted"> · {row.city}</span> : null}</p>
        <p className="text-sm text-sf-body">Tally: {row.ledgerName}</p>
        <p className="text-xs text-sf-muted">GUID {shortGuid(row.guid)}</p>
        <span className={`mt-2 inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${row.state === 'conflict' ? 'border-sf-danger-line bg-sf-danger-soft text-sf-danger' : 'border-sf-success-line bg-sf-success-soft text-sf-success'}`}><Icon aria-hidden="true" size={16} />{row.state === 'suggested' ? 'Exact match' : row.state === 'linked' ? 'Linked' : 'Conflict'}</span>
        {row.state === 'conflict' && row.linkedTo ? <p className="mt-1 text-sm text-sf-body">{'name' in row.linkedTo ? `Linked to ${row.linkedTo.name}` : `Linked to another ledger (${shortGuid(row.linkedTo.guid)})`}</p> : null}
      </div>
    </div>
  </li>;
}

export function CustomerLinks({ onBack }: { onBack: () => void }) {
  const prefix = useId();
  const [data, setData] = useState<CustomerLinksResponse | null>(null);
  const [companies, setCompanies] = useState<string[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [state, setState] = useState<CustomerLinkState>('suggested');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Selection[]>([]);
  const selection = useRef(selected);
  function select(next: Selection[]) { selection.current = next; setSelected(next); }
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [removed, setRemoved] = useState(0);
  const request = useRef(0);
  const inFlight = useRef(false);
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const bar = useRef<HTMLFormElement>(null);
  // The bar is sticky inside the scrolling content (above the frame's bottom nav) and
  // takes its own space after the list, so the last row can always scroll above it.
  const hasSelection = selected.length > 0;
  const load = useCallback(async (signal?: AbortSignal) => {
    const current = ++request.current;
    setLoading(true); setLoadError('');
    try {
      const params = new URLSearchParams({ search, state, page: String(page) });
      if (companyId) params.set('companyId', companyId);
      const response = await fetch(`/api/customer-links?${params}`, { cache: 'no-store', signal });
      const body = await readJsonBody<CustomerLinksResponse & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error || 'Customer links could not be loaded. Please try again.');
      if (current !== request.current || signal?.aborted) return;
      setData(body);
      if ('companies' in body) setCompanies(body.companies);
      const result = rowsAfterReload(selection.current, 'rows' in body ? body.rows : []);
      selection.current = result.kept; setSelected(result.kept);
      setRemoved(result.removed);
    } catch (cause) {
      if (current === request.current && !signal?.aborted) setLoadError(cause instanceof Error ? cause.message : 'Customer links could not be loaded. Please try again.');
    } finally { if (current === request.current && !signal?.aborted) setLoading(false); }
  }, [companyId, search, state, page]);
  useEffect(() => {
    if (query === search) return;
    const timer = setTimeout(() => { setSearch(query); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [query, search]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [load]);
  const list: LedgerList | null = data && 'observedAt' in data ? data : null;
  const validReason = reason.trim().length >= 3 && reason.trim().length <= 300;
  async function confirm() {
    if (!list || loading || loadError || !validReason || !selected.length || selected.length > 50 || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setNotice(''); setRemoved(0);
    const body = { action: 'confirm_customer_links', companyId: list.companyId, sourceVersion: list.sourceVersion, rows: selected, reason: reason.trim() };
    const fingerprint = JSON.stringify(body);
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const response = await fetch('/api/customer-links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, idempotencyKey: pending.current.key }) });
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) pending.current = null;
      const result = await readJsonBody<Partial<ConfirmCustomerLinksResult> & { error?: string; code?: string }>(response);
      if (response.status === 409 || result.code === 'PT409') {
        pending.current = null; setError(result.error || 'The Tally ledger list changed. Reload and review.'); await load(); return;
      }
      if (!response.ok) { setError(result.error || 'Not saved. Please try again.'); return; }
      pending.current = null; setNotice(`${result.confirmed ?? selected.length} linked`); select([]); setReason(''); await load();
    } catch { setError('Not saved. Check the connection and try again.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const visible = list?.rows.filter(row => row.state === 'suggested') ?? [];
  const allChecked = visible.length > 0 && visible.every(row => selected.some(item => item.customerId === row.customerId && item.ledgerGuid === row.guid));
  const waiting = data && 'waiting' in data;
  const from = list?.rows.length ? (list.page.page - 1) * 25 + 1 : 0;
  return <div className="min-w-0 space-y-3">
    <button type="button" disabled={busy} className="inline-flex min-h-11 items-center gap-2 text-sm text-sf-brand" onClick={onBack}><ArrowLeft aria-hidden="true" size={18} />Back to accounts</button>
    <h3 className="text-xl font-bold text-sf-strong">Link customers to Tally</h3>
    {list ? <p className="break-words text-xs text-sf-muted">Tally ledger list from {observedDate(list.observedAt)} · {list.companyId}</p> : null}
    {waiting ? <output aria-live="polite" className="flex items-start gap-2 rounded-lg bg-sf-info-soft p-3 text-sm text-sf-info"><Info aria-hidden="true" size={16} className="shrink-0" />Waiting for the Tally ledger list. Nothing to confirm yet.</output> : <>
      {companies.length > 1 ? <div><label htmlFor={`${prefix}-company`} className="text-sm text-sf-body">Company</label><select id={`${prefix}-company`} className={inputClass} disabled={busy} value={companyId} onChange={event => { select([]); setReason(''); setCompanyId(event.target.value); setPage(1); }}><option value="" disabled>Select a company</option>{companies.map(company => <option key={company} value={company}>{company}</option>)}</select></div> : null}
      {notice ? <output aria-live="polite" className="flex items-center gap-2 rounded-lg border border-sf-success-line bg-sf-success-soft p-3 text-sm text-sf-success"><CircleCheck aria-hidden="true" size={16} />{notice}</output> : null}
      {error ? <p role="alert" className="flex items-start gap-2 rounded-lg border border-sf-danger-line bg-sf-danger-soft p-3 text-sm text-sf-danger"><CircleAlert aria-hidden="true" size={16} className="shrink-0" />{error}</p> : null}
      {removed > 0 ? <p className="text-xs text-sf-muted">{removed} rows changed and were removed from your selection</p> : null}
      {list ? <>
        <div><label htmlFor={`${prefix}-search`} className="text-sm text-sf-body">Search customer or ledger</label><input id={`${prefix}-search`} className={inputClass} maxLength={120} value={query} disabled={busy} onChange={event => setQuery(event.target.value)} /></div>
        <div aria-label="Customer link state" className="flex flex-wrap gap-1">{(['suggested', 'linked', 'conflict'] as const).map(value => <button key={value} type="button" disabled={busy} aria-pressed={state === value} className={`${buttonClass} ${state === value ? 'bg-sf-brand text-white' : 'bg-white'}`} onClick={() => { setState(value); setPage(1); }}>{value === 'suggested' ? 'Suggested' : value === 'linked' ? 'Linked' : 'Conflicts'}</button>)}</div>
        {state === 'suggested' ? <div className="flex min-h-11 items-center gap-2"><input id={`${prefix}-all`} type="checkbox" className="size-5" disabled={busy || loading || !!loadError || !visible.length} checked={allChecked} onChange={event => {
          select(event.target.checked ? [...selected.filter(item => !visible.some(row => row.customerId === item.customerId)), ...visible.map(row => ({ customerId: row.customerId, ledgerGuid: row.guid }))] : selected.filter(item => !visible.some(row => row.customerId === item.customerId)));
        }} /><label htmlFor={`${prefix}-all`} className="text-sm text-sf-body">Select all on this page</label></div> : null}
        <ul aria-label="Customer links" className="space-y-3">{list.rows.map(row => <CustomerLinkCard key={`${row.customerId}-${row.guid}`} row={row} disabled={busy || loading || !!loadError} checked={selected.some(item => item.customerId === row.customerId && item.ledgerGuid === row.guid)} onSelect={checked => select(checked ? [...selected, { customerId: row.customerId, ledgerGuid: row.guid }] : selected.filter(item => item.customerId !== row.customerId))} />)}</ul>
        {!list.rows.length ? <p className="text-sm text-sf-muted">No customers match.</p> : null}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-sf-muted"><span>Showing {from}–{from ? from + list.rows.length - 1 : 0} of {list.page.total}</span><div className="flex gap-2"><button type="button" className={buttonClass} disabled={busy || loading || page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className={buttonClass} disabled={busy || loading || page * 25 >= list.page.total} onClick={() => setPage(page + 1)}>Next</button></div></div>
      </> : null}
    </>}
    {loading ? <p className="text-sm text-sf-muted">Loading customer links…</p> : null}
    {loadError ? <div role="alert" className="rounded-lg bg-sf-danger-soft p-3 text-sm text-sf-danger"><p className="flex items-center gap-2"><CircleAlert aria-hidden="true" size={16} />{loadError}</p><button type="button" disabled={busy} className={buttonClass} onClick={() => void load()}>Retry</button></div> : null}
    {hasSelection && !waiting ? <form ref={bar} aria-label="Confirm customer links" className="sticky bottom-0 z-10 space-y-2 border-t border-sf-line-soft bg-white p-3" onSubmit={event => { event.preventDefault(); void confirm(); }}>
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm text-sf-body">{selected.length} selected</span><button type="button" className={buttonClass} disabled={busy} onClick={() => { select([]); setReason(''); }}>Clear</button></div>
      <div><label htmlFor={`${prefix}-reason`} className="text-sm text-sf-body">Reason</label><input id={`${prefix}-reason`} className={inputClass} required minLength={3} maxLength={300} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} placeholder="e.g. Checked against Tally ledger list" /></div>
      {selected.length > 50 ? <p className="text-sm text-sf-danger">Select up to 50 links at a time.</p> : null}
      <button type="submit" disabled={busy || loading || !!loadError || !validReason || selected.length > 50} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-sf-brand px-3 text-sm font-bold text-white disabled:opacity-50"><CircleCheck aria-hidden="true" size={18} />Confirm {selected.length} links</button>
    </form> : null}
  </div>;
}
