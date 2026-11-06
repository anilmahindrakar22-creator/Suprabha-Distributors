'use client';

import { useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { dataFreshness, economicsNotice, isEconomicsStatus, isIsoInstant } from '@/lib/data-freshness';

export function DataFreshnessNotice({ canAct, showEconomics }: { canAct: boolean; showEconomics: boolean }) {
  const [value, setValue] = useState<string | null | undefined>();
  const [economicsStatus, setEconomicsStatus] = useState<unknown>();
  const [, setTick] = useState(0);
  useEffect(() => {
    let active = true, running = false, lastLoad: number | null = null;
    const controller = new AbortController();
    async function refresh() {
      if (!active) return;
      setTick(tick => tick + 1);
      if (running || (lastLoad !== null && Date.now() - lastLoad < 60_000)) return;
      running = true; lastLoad = Date.now();
      try {
        const response = await fetch('/api/orders?summary=1', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (!response.ok) return;
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object' || Array.isArray(body)) return;
        if (!('operations' in body) || !body.operations || typeof body.operations !== 'object' || Array.isArray(body.operations) ||
          !Object.values(body.operations).every(count => typeof count === 'number' && Number.isFinite(count))) return;
        const source = (body as { sourceUpdatedAt?: unknown }).sourceUpdatedAt;
        const economics = (body as { economicsStatus?: unknown }).economicsStatus;
        if (active) {
          if (source === undefined || source === null || isIsoInstant(source)) setValue(source);
          if (economics === null || isEconomicsStatus(economics)) setEconomicsStatus(economics);
        }
      } catch { /* Keep the last good value; freshness must never interrupt work. */ }
      finally { running = false; }
    }
    const wake = () => { if (document.visibilityState === 'visible') void refresh(); };
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 5 * 60_000);
    document.addEventListener('visibilitychange', wake);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', wake);
    };
  }, []);

  const now = new Date();
  const freshness = dataFreshness(value, now);
  const economics = showEconomics ? economicsNotice(economicsStatus, now) : null;
  if (!freshness && !economics) return null;
  const tone = freshness?.level === 'red'
    ? 'border-sf-danger-line bg-sf-danger-soft text-sf-danger'
    : 'border-sf-warning-line bg-sf-warning-soft text-sf-warning';
  // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Keep the notice contract's explicit status role.
  return <output role="status" className={`flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs font-semibold sm:px-6 ${tone}`}>
    <TriangleAlert size={14} aria-hidden="true" className="shrink-0" />
    <span className="min-w-0 break-words">
      {freshness && <span className="block">{canAct
      ? `Tally data last reached StockFlow ${freshness.ageLabel} ago. Check the office connector.`
      : `Stock figures are from ${freshness.ageLabel} ago.`}</span>}
      {economics && <span className="block">{economics}</span>}
    </span>
  </output>;
}
