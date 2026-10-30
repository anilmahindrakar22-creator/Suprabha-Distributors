'use client';

import { useEffect, useRef, useState } from 'react';
import { Footprints, IndianRupee, Lock, Package, TriangleAlert, type LucideIcon } from 'lucide-react';
import { ToneIcon, StatusChip, type Tone } from './ui/glance';
import { actionIcons, commercialIcons } from '@/lib/glance-icons';
import { parseToday, todayValueLabel, type Today, type TodayDecision, type TodayTarget } from '@/lib/today';

export type TodayQueue = 'price' | 'stuck' | 'stock' | 'grow';
const buttons = { approve_price: 'Approve', stock_covers: 'Release', stuck_order: 'Open', diagnose: 'Start', deadline: 'Plan', overdue_action: 'Follow up' };
function appearance(row: TodayDecision): { icon: LucideIcon; tone: Tone } {
  switch (row.type) {
    case 'approve_price': return { icon: IndianRupee, tone: 'danger' };
    case 'stock_covers': return { icon: Package, tone: 'success' };
    case 'stuck_order': return { icon: TriangleAlert, tone: 'warning' };
    case 'diagnose': return { icon: commercialIcons.lab, tone: 'info' };
    case 'deadline': return { icon: Lock, tone: 'warning' };
    case 'overdue_action': {
      const action = Object.keys(actionIcons).find(key => row.subtitle.toLowerCase().split(/\s*[·:—]\s*/).some(part => part === key || part === key.replaceAll('_', ' ')));
      return { icon: action ? actionIcons[action as keyof typeof actionIcons] : Footprints, tone: 'danger' };
    }
  }
}

export function TodayWorkspace({ onOpen, onShowAll }: { onOpen: (target: TodayTarget) => void; onShowAll: (queue: TodayQueue) => void }) {
  const [data, setData] = useState<Today | null>(null);
  const [failed, setFailed] = useState(false);
  const retry = useRef<() => void>(() => undefined);
  useEffect(() => {
    let active = true, running = false, lastLoad: number | null = null;
    const controller = new AbortController();
    async function refresh(force = false) {
      if (!active || running || (!force && lastLoad !== null && Date.now() - lastLoad < 60_000)) return;
      running = true; lastLoad = Date.now();
      try {
        const response = await fetch('/api/today', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (!response.ok) throw new Error('Today could not load');
        const parsed = parseToday(await response.json());
        // §3 predates certification metadata. Read the existing Wallet coverage only
        // when an empty Grow lane needs to distinguish an empty queue from missing data.
        if (parsed.grow.rows.length === 0 && parsed.coverageCertified === undefined) {
          const coverageResponse = await fetch('/api/wallet?action=get_wallet_workspace&view=all&page=1&search=', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
          if (!coverageResponse.ok) throw new Error('Coverage could not load');
          const wallet: unknown = await coverageResponse.json();
          if (!wallet || typeof wallet !== 'object' || !('coverage' in wallet) || !wallet.coverage || typeof wallet.coverage !== 'object' || !('certified' in wallet.coverage) || typeof wallet.coverage.certified !== 'boolean') throw new Error('Invalid coverage');
          parsed.coverageCertified = wallet.coverage.certified;
        }
        if (active) { setData(parsed); setFailed(false); }
      } catch { if (active) setFailed(true); }
      finally { running = false; }
    }
    retry.current = () => { void refresh(true); };
    const wake = () => { if (document.visibilityState === 'visible') void refresh(); };
    void refresh();
    document.addEventListener('visibilitychange', wake);
    return () => { active = false; controller.abort(); document.removeEventListener('visibilitychange', wake); };
  }, []);
  if (failed) return <div role="alert" className="flex items-center gap-3 p-4 text-sm text-sf-muted">Today could not load <button type="button" className="min-h-11 rounded-xl border border-sf-line px-4 font-semibold text-sf-ink" onClick={() => retry.current()}>Retry</button></div>;
  return <div className="h-full overflow-y-auto">
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-sf-ink">Today</h1>
      {!data ? <p className="text-sm text-sf-muted">Loading Today…</p> : <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        {(['unblock', 'grow'] as const).map(key => {
          const lane = data[key], isGrow = key === 'grow';
          const queues: TodayQueue[] = isGrow ? ['grow'] : Array.from(new Set(lane.rows.map(row => row.type === 'approve_price' ? 'price' as const : row.type === 'stock_covers' ? 'stock' as const : 'stuck' as const)));
          return <section key={key} aria-label={isGrow ? 'Grow' : 'Unblock today'} className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-lg font-bold text-sf-ink">{isGrow ? 'Grow' : 'Unblock today'} <StatusChip icon={isGrow ? commercialIcons.lab : Package} tone="info" count={lane.total}>{isGrow ? 'Labs' : 'Decisions'}</StatusChip></h2>
              <div className="flex flex-wrap gap-x-3">{(queues.length ? queues : [isGrow ? 'grow' as const : 'price' as const]).map(queue => <button key={queue} type="button" aria-label={`Show all ${lane.total} ${queue === 'grow' ? 'growth decisions' : queue === 'price' ? 'price approvals' : queue === 'stock' ? 'stock decisions' : 'stuck orders'}`} className="min-h-11 text-sm text-sf-body underline" onClick={() => onShowAll(queue)}>Show all {lane.total}{queues.length > 1 ? ` · ${queue === 'price' ? 'Price approvals' : queue === 'stock' ? 'Stock' : 'Stuck'}` : ''}</button>)}</div>
            </div>
            {lane.rows.length === 0 ? <p className="text-sm text-sf-muted">{isGrow ? data.coverageCertified === false ? 'Growth decisions need wallet estimates and certified Tally sales' : 'No growth decisions yet' : 'Nothing to unblock'}</p> : lane.rows.map((row, index) => <article key={`${row.type}:${index}`} className="min-w-0 rounded-2xl border border-sf-line bg-white p-4">
              <div className="flex items-start gap-3">
                <ToneIcon {...appearance(row)} />
                <div className="min-w-0 flex-1"><h3 className="break-words text-sm font-bold text-sf-ink">{row.title}</h3><p className="mt-1 break-words text-xs text-sf-muted">{row.subtitle}</p></div>
                <span className={`max-w-[45%] break-words text-right text-sm font-semibold tabular-nums ${todayValueLabel(row) === '₹ ?' ? 'text-sf-muted' : 'text-sf-ink'}`}>{todayValueLabel(row)}</span>
              </div>
              <div className="mt-3 flex justify-end"><button type="button" className="min-h-11 rounded-xl bg-sf-ink px-4 text-sm font-bold text-white" onClick={() => onOpen(row.target)}>{buttons[row.type]}</button></div>
            </article>)}
          </section>;
        })}
      </div>}
    </div>
  </div>;
}
