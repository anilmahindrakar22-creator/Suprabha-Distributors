'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionResult } from '@/lib/wallet-action-types';
import type { MyActionRow, MyActions as MyActionsList } from '@/lib/my-actions-types';
import { walletActionLabels, walletConstraintLabels } from '@/lib/wallet-labels';

const button = 'min-h-11 rounded-xl border border-sf-line px-3 text-sm font-bold text-sf-body disabled:opacity-50';
const primary = 'min-h-11 rounded-xl bg-sf-brand px-4 text-sm font-bold text-white disabled:opacity-50';
const input = 'min-h-11 w-full min-w-0 rounded-xl border border-sf-line bg-sf-soft-0 px-3 text-sm text-sf-body';
const dateLabel = (value: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(`${value}T00:00:00Z`));
class MyActionError extends Error { constructor(message: string, readonly status: number) { super(message); } }
async function request<T>(url: string, options?: RequestInit): Promise<T> { const response = await fetch(url, { cache: 'no-store', ...options }); const body = await response.json() as T & { error?: string }; if (!response.ok) throw new MyActionError(body.error ?? 'Actions are temporarily unavailable', response.status); return body as T; }

export function MyActions({ onBack }: { onBack: () => void }) {
  const [list, setList] = useState<MyActionsList | null>(null); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<{ row: MyActionRow; result: ActionResult } | null>(null); const [busy, setBusy] = useState(false); const [uncertain, setUncertain] = useState(false);
  const pending = useRef<{ fingerprint: string; body: unknown } | null>(null); const flight = useRef(false);
  const reload = useCallback(async () => { const result = await request<MyActionsList>(`/api/my-actions?${new URLSearchParams({ action: 'get_my_actions', page: '1' })}`); setList(result); }, []);
  useEffect(() => { let active = true; void request<MyActionsList>('/api/my-actions?action=get_my_actions&page=1').then(value => { if (active) setList(value); }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'Actions are temporarily unavailable'); }); return () => { active = false; }; }, []);
  async function save(body: unknown) {
    if (flight.current) return; flight.current = true; setBusy(true); setError('');
    const fingerprint = JSON.stringify(body); if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, body };
    try {
      await request('/api/my-actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pending.current.body) });
      pending.current = null; setUncertain(false); setSelected(null); setNotice('Action saved.'); await reload();
    } catch (failure) {
      if (failure instanceof MyActionError && failure.status < 500) {
        pending.current = null; setUncertain(false);
        if (failure.status === 409) { await reload().catch(() => {}); setError('Someone else just updated this. The list was reloaded.'); }
        else if (failure.status === 400 && failure.message === 'Action not found') { setError('This action is no longer yours or no longer exists.'); await reload().catch(() => {}); }
        else setError(failure.message);
      } else { setUncertain(true); setError('Save could not be confirmed. Check the connection and retry the same save.'); }
    } finally { flight.current = false; setBusy(false); }
  }
  const count = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;
  return <section aria-label="My actions" className="mx-auto max-w-3xl min-w-0 space-y-4">
    <div className="flex flex-wrap items-center gap-3"><button type="button" className={button} onClick={onBack}>Back to accounts</button><h3 className="min-w-0 flex-1 text-lg font-bold text-sf-strong">My actions</h3></div>
    {list ? <p className="text-sm text-sf-muted">{count(list.total, 'open action', 'open actions')} · {count(list.overdueCount, 'overdue', 'overdue')}</p> : null}
    {error && !selected ? <p role="alert" className="text-sm text-sf-danger">{error}</p> : null}{notice ? <output className="text-sm text-sf-body">{notice}</output> : null}
    {list?.rows.length === 0 ? <p className="rounded-xl border border-sf-line-soft bg-sf-soft-0 p-4 text-sm">No open actions. Management assigns these from Wallet.</p> : null}
    <ul aria-label="Open actions" className="min-w-0 space-y-3">{list?.rows.map(row => <li key={row.actionId} className="min-w-0 space-y-3 rounded-xl border border-sf-line-soft bg-white p-4">
      <p className="break-words font-bold">{row.customerName}{row.city ? <span className="font-normal text-sf-muted"> · {row.city}</span> : null}</p>
      <p className="text-sm">Due {dateLabel(row.dueOn)}{row.overdue ? <span className="text-sf-danger"> · Overdue</span> : null}</p>
      <p className="break-words text-sm">{walletActionLabels[row.actionType]} · {row.detail}</p>
      {row.constraintCategory ? <p className="text-xs text-sf-muted">Why: {walletConstraintLabels[row.constraintCategory as keyof typeof walletConstraintLabels] ?? row.constraintCategory}</p> : null}
      {selected?.row.actionId !== row.actionId ? <div className="flex flex-wrap items-center gap-3"><button type="button" className={primary} onClick={() => { setSelected({ row, result: 'done' }); setError(''); setNotice(''); }}>Mark done</button><button type="button" className="min-h-11 px-2 text-sm text-sf-muted underline" onClick={() => { setSelected({ row, result: 'dropped' }); setError(''); setNotice(''); }}>Drop</button></div> : null}
      {selected?.row.actionId === row.actionId ? <form aria-label={selected.result === 'done' ? 'Mark action done' : 'Drop action'} className="min-w-0 space-y-3 border-t border-sf-line-soft pt-3" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); const note = form.get('note'); if (typeof note !== 'string') return; void save({ action: 'close_my_action', payload: { requestId: crypto.randomUUID(), actionId: row.actionId, result: selected.result, note: note.trim() } }); }}>
        <label className="block text-sm">Result note<textarea className={input} name="note" required minLength={3} maxLength={500} disabled={busy || uncertain} /></label>
        {error ? <p role="alert" className="text-sm text-sf-danger">{error}</p> : null}
        <div className="flex flex-wrap gap-2">{uncertain ? <button type="button" className={primary} disabled={busy} onClick={() => pending.current && void save(pending.current.body)}>Retry same save</button> : <button className={primary} disabled={busy}>{busy ? 'Saving…' : selected.result === 'done' ? 'Mark done' : 'Drop'}</button>}<button type="button" className={button} disabled={busy} onClick={() => { setSelected(null); setError(''); }}>Cancel</button></div>
      </form> : null}
    </li>)}</ul>
  </section>;
}
