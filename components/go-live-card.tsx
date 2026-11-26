'use client';
import { useEffect, useState } from 'react';
import { goLiveRoles, normalizeGoLive, type GoLiveResponse } from '@/lib/go-live-types';

function day(value: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(new Date(value));
}
export function GoLiveCard() {
  const [data, setData] = useState<GoLiveResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/go-live', { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Unavailable');
        const result = normalizeGoLive(await response.json());
        if (!controller.signal.aborted) { setData(result); setFailed(false); }
      } catch { if (!controller.signal.aborted) setFailed(true); }
    })();
    return () => controller.abort();
  }, [attempt]);
  if (!data) return failed ? <p className="flex items-center gap-2 text-xs text-sf-muted">Go-live is unavailable. <button type="button" aria-label="Retry go-live view" onClick={() => setAttempt(n => n + 1)} className="min-h-11 rounded-xl border border-sf-line px-3 font-bold text-sf-brand">Retry</button></p> : null;
  const week = data.weeks[0];
  const noStaff = data.membersByRole.sales + data.membersByRole.operations + data.membersByRole.accounts + data.membersByRole.billing === 0;
  return <section aria-label="Go-live" className="min-w-0 max-w-full rounded-2xl border border-sf-line-soft bg-white p-4">
    <details>
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-1 text-xs">
        <span>Go-live · this week: {week.ordersEntered} orders for {week.tallySaleInvoices} Tally sales · {week.visitsLogged} visits · {week.activePeople} people active</span>
        <span className="ml-auto font-bold text-sf-brand">Expand</span>
        {noStaff ? <span className="w-full text-sf-muted">No sales, operations or accounts staff added yet</span> : null}
      </summary>
      <div className="mt-3 min-w-0 space-y-4 text-xs text-sf-body">
        <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[700px] text-left">
          <thead><tr>{['Week','Orders','Linked to Tally','Tally sales','Order coverage','Visits','Active people'].map(label => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{data.weeks.map(row => <tr key={row.weekStart} className="border-t border-sf-line-soft"><td className="py-2">{day(row.weekStart)}</td><td>{row.ordersEntered}</td><td>{row.ordersLinkedToTally}</td><td>{row.tallySaleInvoices}</td><td>{row.tallySaleInvoices ? Math.round(row.ordersLinkedToTally / row.tallySaleInvoices * 100) + '%' : '–'}</td><td>{row.visitsLogged}</td><td>{row.activePeople}</td></tr>)}</tbody>
        </table></div>
        <div><h3 className="font-semibold">People this week</h3>
          {data.people.length ? <ul>{data.people.map(person => <li key={person.email} className="break-words border-t border-sf-line-soft py-2">
            {person.email.split('@')[0]} · {person.roles.join(', ')} · {person.actionsThisWeek} actions · {person.ordersThisWeek} orders · {person.visitsThisWeek} visits · Last active: {person.lastActionAt ? day(person.lastActionAt) : 'never'}
          </li>)}</ul> : <p>No active members.</p>}
        </div>
        <p className="break-words"><strong>Members by role</strong> · {goLiveRoles.map(role => role + ': ' + data.membersByRole[role]).join(' · ')}</p>
      </div>
    </details>
  </section>;
}
