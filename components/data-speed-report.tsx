'use client';

import { useCallback, useEffect, useState } from 'react';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { gatewayLabel, normalizeDataSpeed, overBudget, type DataSpeedResponse } from '@/lib/data-speed-types';
import { importProblemText } from '@/lib/import-problem-text';

function day(value: string | null) {
  return value ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(new Date(value)) : 'unavailable';
}
function readAt(value: string | null) {
  if (!value) return 'unavailable';
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
  return `${day(value)} ${time}`;
}
function duration(ms: number) { return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`; }
function hoursOld(value: string | null) { return value ? (Date.now() - Date.parse(value)) / 3_600_000 : Infinity; }
export function DataSpeedReport() {
  const [data, setData] = useState<DataSpeedResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<{ reason: string; count: number; requestId: string } | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [ackMessage, setAckMessage] = useState('');
  const load = useCallback(() => setAttempt(n => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/data-speed', { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Unavailable');
        const result = normalizeDataSpeed(await response.json());
        if (!controller.signal.aborted) { setData(result); setFailed(false); }
      } catch { if (!controller.signal.aborted) setFailed(true); }
    })();
    return () => controller.abort();
  }, [attempt]);
  if (!data) return failed ? <p className="flex items-center gap-2 text-xs text-sf-muted">Data &amp; speed is unavailable. <button type="button" onClick={load} className="min-h-11 rounded-xl border border-sf-line px-3 font-bold text-sf-brand">Retry</button></p> : null;
  const reads = data.reads.filter(row => row.calls >= 5).slice(0, 8);
  const staleImport = hoursOld(data.lastImportAt) > 6;
  const overBudgetCount = data.statsAvailable ? reads.filter(row => overBudget(row, data.budget)).length : 0;
  const openProblemCount = data.exceptions.reduce((total, row) => total + row.total, 0);
  async function acknowledge() {
    if (!selected || note.trim().length < 10 || note.trim().length > 500 || saving) return;
    setSaving(true); setAckMessage('');
    try {
      const response = await fetch('/api/data-speed', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'acknowledge', requestId: selected.requestId, reason: selected.reason, expectedCount: selected.count, note }) });
      if (response.status === 200) { setAckMessage(`Acknowledged ${selected.count}.`); setSelected(null); setNote(''); load(); }
      else if (response.status === 409) { setAckMessage('The count changed. Reloaded — check again.'); setSelected(null); setNote(''); load(); }
      else setAckMessage('Could not save. Try again.');
    } catch { setAckMessage('Could not save. Try again.'); }
    finally { setSaving(false); }
  }
  return <section aria-label="Data and speed" className="min-w-0 rounded-2xl border border-sf-line-soft bg-white p-4">
    <details>
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-1 text-sm">
        <strong className="text-sf-strong">Data &amp; speed</strong>
        <span className="text-xs">·</span>
        {staleImport ? <span className="inline-flex items-center gap-1 text-xs text-sf-warning"><TriangleAlert aria-hidden="true" size={14} />No import for {Number.isFinite(hoursOld(data.lastImportAt)) ? Math.floor(hoursOld(data.lastImportAt)) : 'many'} h</span> : <span className="text-xs">Import {readAt(data.lastImportAt)}</span>}
        <span className="text-xs">·</span>
        {data.statsAvailable ? overBudgetCount ? <span className="inline-flex items-center gap-1 text-xs text-sf-warning"><TriangleAlert aria-hidden="true" size={14} />{overBudgetCount} screen{overBudgetCount === 1 ? '' : 's'} over budget</span> : <span className="text-xs">Screens within budget</span> : <span className="text-xs">Speed unavailable</span>}
        <span className="text-xs">·</span>
        <span className="text-xs">{openProblemCount ? `${openProblemCount} open import problems` : 'No open import problems'}</span>
        <span className="ml-auto text-xs font-bold text-sf-brand">Details</span>
      </summary>
      <div className="mt-3 space-y-4 text-xs text-sf-body">
      <div>
        <p>Last import {readAt(data.lastImportAt)} · Last rebuild {readAt(data.lastRebuildAt)}</p>
        {staleImport ? <p className="mt-1 flex items-start gap-1.5 text-sf-warning"><TriangleAlert aria-hidden="true" size={16} className="shrink-0" />No Tally import for {Number.isFinite(hoursOld(data.lastImportAt)) ? Math.floor(hoursOld(data.lastImportAt)) : 'many'} hours. Check that the office PC and Tally are open.</p> : null}
      </div>
      <div>
        <h3 className="font-semibold">Slowest screens</h3>
        <p className="text-sf-muted">{data.windowFrom ? `This week (since ${day(data.windowFrom)})` : `Since ${day(data.statsResetAt)}`}</p>
        {!data.statsAvailable ? <p className="mt-2">Speed figures are not available.</p> : reads.length ? <div className="mt-2 min-w-0 overflow-x-auto"><table className="min-w-[480px] w-full text-left"><thead><tr><th>Screen</th><th>Average</th><th>Last week</th><th>Slowest (since {day(data.statsResetAt)})</th><th>Uses</th></tr></thead><tbody>{reads.map(row => {
          const warning = overBudget(row, data.budget);
          return <tr key={row.gateway} className="border-t border-sf-line-soft"><td className="py-1 pr-2">{gatewayLabel(row.gateway)}{warning ? <span className="ml-1 inline-flex items-center gap-1 text-sf-warning"><TriangleAlert aria-hidden="true" size={14} />Over {warning === 'mean' ? '1 s average' : '3 s slowest'}</span> : null}</td><td>{duration(row.meanMs)}</td><td>{row.previousMeanMs === null ? '—' : duration(row.previousMeanMs)}</td><td>{duration(row.maxMs)}</td><td>{row.calls}</td></tr>;
        })}</tbody></table></div> : <p className="mt-2">No screen was used enough this week to measure.</p>}
        <p className="mt-2 text-sf-muted">Budget: {duration(data.budget.meanMs)} average, {duration(data.budget.maxMs)} slowest. Figures are database time only.</p>
      </div>
      <div>
        <h3 className="font-semibold">Open import problems</h3>
        {data.exceptions.length ? <div className="mt-2 min-w-0 overflow-x-auto"><table className="min-w-[480px] w-full text-left"><thead><tr><th>Problem</th><th>Open</th><th>Under 7 days</th><th>7–30 days</th><th>Over 30 days</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{data.exceptions.map(row => <tr key={row.reason} className="border-t border-sf-line-soft"><td className="py-1 pr-2">{importProblemText(row.reason)}</td><td>{row.total}</td><td>{row.under7Days}</td><td>{row.from7To30Days}</td><td>{row.over30Days}</td><td>{row.acknowledgeable > 0 ? <button type="button" className="min-h-11 rounded-xl border border-sf-line px-3 font-bold text-sf-brand" aria-label={`Acknowledge (${row.acknowledgeable}) ${importProblemText(row.reason)}`} onClick={() => { setSelected({ reason: row.reason, count: row.acknowledgeable, requestId: crypto.randomUUID() }); setNote(''); setAckMessage(''); }}>Acknowledge ({row.acknowledgeable})</button> : null}</td></tr>)}</tbody></table></div> : <p className="mt-2 flex items-center gap-1.5"><CircleCheck aria-hidden="true" size={16} />No open import problems.</p>}
        {selected ? <div className="mt-3 rounded-xl border border-sf-line-soft p-3">
          <p>Mark {selected.count} "{importProblemText(selected.reason)}" as reviewed. They stay on record; nothing is deleted.</p>
          <label className="mt-2 block">Why they no longer need action<textarea className="mt-1 min-h-20 w-full rounded-lg border border-sf-line p-2" required minLength={10} maxLength={500} autoFocus value={note} onChange={event => setNote(event.target.value)} /></label>
          <div className="mt-2 flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded-xl border border-sf-line px-3 font-bold text-sf-brand disabled:opacity-50" disabled={saving || note.trim().length < 10 || note.trim().length > 500} onClick={() => void acknowledge()}>Acknowledge</button><button type="button" className="min-h-11 rounded-xl border border-sf-line px-3 font-bold" disabled={saving} onClick={() => { setSelected(null); setNote(''); setAckMessage(''); }}>Cancel</button></div>
        </div> : null}
        {ackMessage ? <p role="status" className="mt-2">{ackMessage}</p> : null}
      </div>
      <p className="text-sf-muted">Speed snapshots are taken every Monday.{data.snapshotCount === 0 ? ' The first weekly comparison appears after the first snapshot.' : ''}</p>
      </div>
    </details>
  </section>;
}
