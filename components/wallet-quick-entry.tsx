'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SubmitEvent } from 'react';
import type { WalletAccount, WalletConfidence, WalletMethod, WalletSnapshot, WalletWorkspace } from '@/lib/wallet-types';
import { formatPaise, rupeesToPaise } from '@/lib/wallet-format';
import { buildRowCommand, needsReason, type QuickEntryShared } from '@/lib/wallet-quick-entry';

const input = 'min-h-11 w-full min-w-0 rounded-xl border border-sf-line bg-sf-soft-0 px-3 text-sm text-sf-body';
const button = 'min-h-11 rounded-xl border border-sf-line px-3 text-sm font-bold text-sf-body disabled:opacity-50';
const primary = 'min-h-11 rounded-xl bg-sf-brand px-4 text-sm font-bold text-white disabled:opacity-50';
type RowState = { value: string; reason: string; status: string; requestId: string | null; command: ReturnType<typeof buildRowCommand> | null; busy: boolean; current: WalletSnapshot | null | undefined };
class QuickEntryError extends Error { constructor(message: string, readonly status: number) { super(message); } }
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options });
  let body: (T & { error?: string }) | null = null;
  try { body = await response.json() as T & { error?: string }; } catch { /* gateway failures without JSON are handled below */ }
  if (!response.ok) throw new QuickEntryError(response.status === 403 ? 'Wallet is for management' : body?.error || 'Wallet is temporarily unavailable', response.status);
  return body as T;
}
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const accountUrl = (id: string) => `/api/wallet?${new URLSearchParams({ action: 'get_wallet_account', customerId: id })}`;

export function WalletQuickEntry({ onBack, onForbidden }: { onBack: () => void; onForbidden: () => void }) {
  const [workspace, setWorkspace] = useState<WalletWorkspace | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [includeEstimated, setIncludeEstimated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [source, setSource] = useState('');
  const [sharedExpanded, setSharedExpanded] = useState(false);
  const [moreOptions, setMoreOptions] = useState(false);
  const [method, setMethod] = useState<WalletMethod>('manager_estimate');
  const [confidence, setConfidence] = useState<WalletConfidence>('medium');
  const [asOf, setAsOf] = useState(todayIST);
  const [note, setNote] = useState('Quick entry');
  const [revision, setRevision] = useState(0);
  const [savedLine, setSavedLine] = useState('');
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const hasValues = Object.values(rows).some(row => !!row.value.trim());
  const shared: QuickEntryShared = useMemo(() => ({ source, method, confidence, asOf, note }), [source, method, confidence, asOf, note]);
  const methodLabel = { customer_stated: 'Customer stated', test_volume: 'Test volume', manager_estimate: 'Manager estimate' }[method];
  const dateLabel = asOf ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(`${asOf}T00:00:00Z`)) : '';

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ action: 'get_wallet_workspace', view: includeEstimated ? 'all' : 'no_estimate', page: String(page), search });
    void request<WalletWorkspace>(`/api/wallet?${params}`).then(data => { if (active) { setWorkspace(data); setLoading(false); } }).catch(failure => {
      if (active) { setError(failure instanceof Error ? failure.message : 'Wallet is temporarily unavailable'); setLoading(false); if (failure instanceof QuickEntryError && failure.status === 403) onForbidden(); }
    });
    return () => { active = false; };
  }, [includeEstimated, page, search, revision, onForbidden]);

  function update(id: string, change: Partial<RowState>) {
    setRows(previous => ({ ...previous, [id]: { ...(previous[id] ?? { value: '', reason: '', status: '', requestId: null, command: null, busy: false, current: undefined }), ...change } }));
  }

  async function saveRows(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !workspace || !event.currentTarget.reportValidity()) return;
    const entered = workspace.rows.filter(row => !!rows[row.customerId]?.value.trim() || !!rows[row.customerId]?.command);
    if (!entered.length) return;
    busy.current = true; setSaving(true); setSavedLine('');
    let succeeded = 0;
    for (const row of entered) {
      let state = rows[row.customerId] ?? { value: '', reason: '', status: '', requestId: null, command: null, busy: false, current: undefined };
      update(row.customerId, { busy: true, status: 'Saving…' });
      let command = state.command;
      try {
        let current = state.current;
        if (current === undefined) current = (await request<WalletAccount>(accountUrl(row.customerId))).current;
        if (!command) command = buildRowCommand(shared, { ...row, current }, state.value, state.reason, state.requestId ?? crypto.randomUUID());
        state = { ...state, current, command, requestId: command.payload.requestId };
        update(row.customerId, { current, command, requestId: command.payload.requestId });
        const result = await request<{ ok: boolean }>('/api/wallet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command) });
        if (!result || result.ok !== true) throw new Error('Save could not be confirmed. Retry the same row.');
        succeeded++;
        update(row.customerId, { value: '', reason: '', status: '✓ Saved', requestId: null, command: null, busy: false });
      } catch (failure) {
        const retryable = !(failure instanceof QuickEntryError) || failure.status >= 500 || [408, 429].includes(failure.status);
        const conflict = failure instanceof QuickEntryError && failure.status === 409;
        const denied = failure instanceof QuickEntryError && failure.status === 403;
        const msg = conflict
          ? 'Changed by someone else, reload this row'
          : retryable
            ? 'Save could not be confirmed. Retry the same row.'
            : failure instanceof Error ? failure.message : 'Wallet is temporarily unavailable';
        update(row.customerId, { status: `⚠ ${msg}`, busy: false, command: retryable ? (state.command ?? command) : null, requestId: retryable ? (state.requestId ?? command?.payload.requestId ?? null) : null });
        if (denied) { onForbidden(); break; }
      }
    }
    busy.current = false; setSaving(false);
    setSavedLine(`Saved ${succeeded} of ${entered.length}`);
    if (succeeded) setRevision(value => value + 1);
  }

  const currentRows = workspace?.rows ?? [];
  return <section aria-label="Wallet quick entry" data-unsaved={hasValues ? 'true' : 'false'} className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
    <header className="flex flex-wrap items-center gap-3"><button type="button" className={button} onClick={onBack}>Back to Wallet</button><h2 className="text-xl font-bold text-sf-strong">Quick entry</h2></header>
    <form aria-label="Wallet quick entry form" className="space-y-4" onSubmit={event => void saveRows(event)}>
      {source && !sharedExpanded ? <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-sf-muted"><p className="min-w-0">{source} · {methodLabel} · {confidence[0].toUpperCase() + confidence.slice(1)} · {dateLabel}</p><button type="button" className="min-h-11 px-2 text-sf-muted underline" onClick={() => setSharedExpanded(true)}>Change</button></div> : <fieldset disabled={saving} className="min-w-0 space-y-3">
        <label className="block text-sm">Source<input className={input} required minLength={3} maxLength={500} value={source} onChange={event => setSource(event.target.value)} placeholder="Owner estimate, Oct 2026" /></label>
        {!source ? <button type="button" className="min-h-11 text-sm text-sf-muted underline" onClick={() => setMoreOptions(value => !value)}>{moreOptions ? 'Fewer options' : 'More options'}</button> : null}
        {(source || moreOptions || sharedExpanded) ? <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm">Method<select className={input} value={method} onChange={event => setMethod(event.target.value as WalletMethod)}><option value="customer_stated">Customer stated</option><option value="test_volume">Test volume</option><option value="manager_estimate">Manager estimate</option></select></label>
          <label className="block text-sm">Confidence<select className={input} value={confidence} onChange={event => setConfidence(event.target.value as WalletConfidence)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
          <label className="block text-sm">As of<input className={input} type="date" required max={todayIST()} value={asOf} onChange={event => setAsOf(event.target.value)} /></label>
          <label className="block text-sm">Note<input className={input} required minLength={3} maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></label>
        </div> : null}
      </fieldset>}
      <label className="block text-sm">Search labs<input className={input} maxLength={80} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Name or town" /></label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={includeEstimated} onChange={event => { setIncludeEstimated(event.target.checked); setPage(1); }} />Include labs with an estimate</label>
      <ul className="space-y-3" aria-busy={loading}>
        {currentRows.map(row => {
          const state = rows[row.customerId] ?? { value: '', reason: '', status: '', requestId: null, command: null, busy: false, current: undefined };
          const amount = rupeesToPaise(state.value);
          const lower = needsReason(state.current?.monthlyWalletPaise ?? row.walletPaise, amount);
          return <li key={row.customerId} className="min-w-0 rounded-xl border border-sf-line-soft bg-white p-3"><div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-center">
            <div className="min-w-0"><p className="truncate"><span className="font-semibold">{row.name}</span><span className="text-sf-muted"> · {row.city || 'City unavailable'}</span></p><p className="text-sm text-sf-muted">{row.walletPaise === null ? 'No estimate' : `Now ${formatPaise(row.walletPaise)}/mo`}</p></div>
            <div className="min-w-0 space-y-2"><label className="block text-xs text-sf-muted">₹ / month<input className={input} inputMode="decimal" value={state.value} onChange={event => update(row.customerId, { value: event.target.value, status: '', command: null, requestId: null })} /></label>
              {lower ? <label className="block text-sm">Reason for lowering<input className={input} required minLength={3} maxLength={500} value={state.reason} onChange={event => update(row.customerId, { reason: event.target.value, command: null })} /></label> : null}
              {state.status ? <output className="block text-sm text-sf-body">{state.status}</output> : null}
            </div>
          </div></li>;
        })}
      </ul>
      {!currentRows.length && !loading ? <p className="text-sm text-sf-muted">No labs match.</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>Page {workspace?.page ?? page} · {workspace?.total ?? 0} labs</span><div className="flex gap-2"><button type="button" className={button} disabled={loading || page <= 1 || saving} onClick={() => setPage(n => n - 1)}>Previous</button><button type="button" className={button} disabled={loading || page * 50 >= (workspace?.total ?? 0) || saving} onClick={() => setPage(n => n + 1)}>Next</button></div></div>
      {loading ? <p className="text-sm text-sf-muted">Loading labs…</p> : null}{error ? <p role="alert" className="text-sm text-sf-danger">{error} <button type="button" className={button} onClick={() => setRevision(n => n + 1)}>Retry</button></p> : null}
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-sf-line bg-white px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0"><button className={primary} disabled={saving || loading || !hasValues}>Save entered rows ({currentRows.filter(row => !!rows[row.customerId]?.value.trim()).length})</button>{savedLine ? <p className="text-sm text-sf-muted">{savedLine}</p> : null}</div>
    </form>
  </section>;
}
