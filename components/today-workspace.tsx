'use client';

import { useEffect, useRef, useState } from 'react';
import { Footprints, IndianRupee, Lock, Package, TriangleAlert, type LucideIcon } from 'lucide-react';
import { ToneIcon, type Tone } from './ui/glance';
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
    <div className="mx-auto max-w-7xl space-y-3 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-sf-ink">Today</h1>
      {!data ? <p className="text-sm text-sf-muted">Loading Today…</p> : <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {(['unblock', 'grow'] as const).map(key => {
          const lane = data[key], isGrow = key === 'grow';
          return <section key={key} aria-label={isGrow ? 'Grow' : 'Unblock today'} className="min-w-0 space-y-2">
            <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-2">
              <h2 className="text-[15px] font-semibold text-sf-ink">{isGrow ? 'Grow' : 'Unblock today'} · {lane.total}</h2>
              {lane.total > lane.rows.length && <button type="button" className="min-h-11 text-xs text-sf-ink underline" onClick={() => onShowAll(isGrow ? 'grow' : 'stuck')}>{isGrow ? 'See all in Wallet' : 'See all in Orders'}</button>}
            </div>
            {lane.rows.length === 0 ? <p className="text-sm text-sf-muted">{isGrow ? data.coverageCertified === false ? 'Growth decisions need wallet estimates and certified Tally sales' : 'No growth decisions yet' : 'Nothing to unblock'}</p> : lane.rows.map((row, index) => <article key={`${row.type}:${index}`} className="flex min-w-0 items-center gap-2 rounded-2xl border border-sf-line bg-white p-2">
              <ToneIcon {...appearance(row)} size="sm" />
              <div className="min-w-0 flex-1"><h3 className="line-clamp-2 break-words text-sm font-semibold leading-5 text-sf-ink">{row.title}</h3><p className="truncate text-xs text-sf-muted" title={row.subtitle}>{row.subtitle}</p></div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <span className={`whitespace-nowrap text-right text-[15px] font-semibold leading-5 tabular-nums ${todayValueLabel(row) === '₹ ?' ? 'text-sf-muted' : 'text-sf-ink'}`}>{todayValueLabel(row)}</span>
                <button type="button" className="min-h-11 min-w-[72px] rounded-xl border border-sf-line px-3 text-xs font-semibold text-sf-ink" onClick={() => onOpen(row.target)}>{buttons[row.type]}</button>
              </div>
            </article>)}
          </section>;
        })}
      </div>}
    </div>
  </div>;
}
