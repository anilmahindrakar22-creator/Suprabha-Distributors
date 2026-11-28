'use client';

import { useEffect, useState } from 'react';
import { isGrowthTier, normalizeGrowthTiers, normalizeGrowthTierLabs, type GrowthTier, type GrowthTierList, type GrowthTiersData, type GrowthTierLabsData } from '@/lib/growth-tier-types';
import { formatPaise } from '@/lib/wallet-format';
import { TierStars } from '@/components/tier-stars';

const muted = 'text-xs text-sf-muted';
const button = 'inline-flex min-h-11 items-center rounded-lg border border-sf-line px-3 text-xs text-sf-brand';
const labels: Record<GrowthTier, string> = { diamond: 'Diamond', platinum: 'Platinum', gold: 'Gold', silver: 'Silver', untiered: 'Untiered' };
const borders: Record<GrowthTier, string> = { diamond: 'border-slate-400', platinum: 'border-zinc-400', gold: 'border-stone-400', silver: 'border-gray-300', untiered: 'border-sf-line-soft' };
// Keep the caption compact while using the same currency formatter as the table.
const bandMoney = (paise: number) => paise >= 10000000 ? formatPaise(paise, true) : paise >= 100000 && paise % 100000 === 0 ? `${formatPaise(paise / 1000)}k` : formatPaise(paise);
const bandRange = (low: number, high: number) => `${bandMoney(low).replace(/ L$/, high >= 10000000 ? '' : ' L')}–${bandMoney(high).replace('₹', '')}`;
const listTitle = (list: GrowthTierList) => isGrowthTier(list) ? `${labels[list]} labs` : list === 'movers' ? 'Moved tier this quarter' : 'Placement targets: Gold and Platinum labs without our instrument';

function TierLabs({ selected, onClose, onOpenCustomer }: { selected: GrowthTierList; onClose: () => void; onOpenCustomer?: (customerId: string) => void }) {
  const [data, setData] = useState<GrowthTierLabsData | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const query = isGrowthTier(selected) ? `tier=${selected}` : `list=${selected}`;
    void fetch(`/api/growth/tiers?${query}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const next = normalizeGrowthTierLabs(response.ok ? await response.json() : null);
      if (!next || next.list !== selected) throw new Error('Unavailable');
      if (!controller.signal.aborted) setData(next);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [selected, revision]);
  const title = listTitle(selected);
  return <div id="growth-tier-labs" className="min-w-0 space-y-3">
    <div className="flex items-start justify-between gap-3"><h3 className="text-sm font-bold">{title}</h3><button type="button" className={button} onClick={onClose}>Close</button></div>
    {error ? <div role="alert" className="text-xs">Lab tiers are unavailable. <button type="button" className={button} onClick={() => { setError(false); setRevision(n => n + 1); }}>Retry</button></div>
      : !data ? <output className="block animate-pulse rounded bg-sf-soft-0 p-4 text-xs">Loading labs…</output>
      : <><ol aria-label={title} className="space-y-2">{data.rows.map(lab => <li key={lab.labKey} className="min-w-0 space-y-1.5 break-words rounded-lg border border-sf-line p-3 text-xs">
        <p className="flex flex-wrap items-center gap-2"><strong>{lab.name?.trim() || 'Unnamed lab'}</strong><span className={`inline-flex items-center gap-1 rounded-full border bg-white px-2 py-0.5 text-sf-muted ${borders[lab.tier]}`}><TierStars tier={lab.tier} />{labels[lab.tier]}</span></p>
        <p className={muted}>{lab.town ? `${lab.town} · ` : ''}{formatPaise(lab.consumablesPaise)} consumables</p>
        <p>{lab.hasInstrument ? 'Our instrument' : 'Open lab'}</p>
        {(lab.change === 'up' || lab.change === 'down') && lab.previousTier && <p>{lab.change === 'up' ? '▲' : '▼'} from {labels[lab.previousTier]}</p>}
        <div className="flex flex-wrap gap-2">{lab.customerId && <button type="button" className={button} disabled={!onOpenCustomer} onClick={() => { if (lab.customerId) onOpenCustomer?.(lab.customerId); }}>Open customer</button>}{lab.phone && <a className={button} href={`tel:${lab.phone}`}>Call</a>}</div>
      </li>)}</ol>{data.rows.length === 0 && <p className={muted}>No labs in this list.</p>}{data.totalLabs > data.rows.length && <p className={muted}>Showing {data.rows.length} of {data.totalLabs}</p>}</>}
  </div>;
}

export function GrowthLabTiers({ onOpenCustomer }: { onOpenCustomer?: (customerId: string) => void }) {
  const [data, setData] = useState<GrowthTiersData | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<GrowthTierList | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/growth/tiers', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const next = normalizeGrowthTiers(response.ok ? await response.json() : null);
      if (!next) throw new Error('Unavailable');
      if (!controller.signal.aborted) setData(next);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [revision]);
  const toggle = (list: GrowthTierList) => setSelected(current => current === list ? null : list);
  return <section className="min-w-0 space-y-3 rounded-xl border border-sf-line-soft bg-white p-4 lg:p-5" aria-labelledby="growth-tiers-title">
    <h2 id="growth-tiers-title" className="text-base font-bold">Lab tiers</h2>
    {data && <><p className={muted}>By consumables bought from us in the last 12 months. Diamond {bandMoney(data.bands.diamond)}+ · Platinum {bandRange(data.bands.platinum, data.bands.diamond)} · Gold {bandRange(data.bands.gold, data.bands.platinum)} · Silver {bandRange(data.bands.silver, data.bands.gold)}.</p><p className={muted}>Tiers are set each quarter from the 12 months before it.</p></>}
    {error ? <div role="alert" className="text-xs">Lab tiers are unavailable. <button type="button" className={button} onClick={() => { setError(false); setRevision(n => n + 1); }}>Retry</button></div>
      : !data ? <output className="block animate-pulse rounded bg-sf-soft-0 p-4 text-xs">Loading labs…</output>
      : <><div className="overflow-x-auto"><table className="w-full min-w-[420px] text-xs tabular-nums">
        <thead><tr className="border-b border-sf-line text-sf-muted">{['Tier', 'Labs', 'Consumables', 'Share', 'With our instrument'].map((label, i) => <th key={label} scope="col" className={`px-2 py-2 font-normal ${i === 0 ? 'text-left' : 'text-right'}`}>{label}</th>)}</tr></thead>
        <tbody>{data.tiers.map(row => <tr key={row.tier} role="button" tabIndex={0} aria-expanded={selected === row.tier} aria-controls={selected === row.tier ? 'growth-tier-labs' : undefined}
          className="cursor-pointer border-t border-sf-line-soft hover:bg-sf-soft-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-brand" onClick={() => toggle(row.tier)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(row.tier); } }}>
          <th scope="row" className="px-2 py-2 text-left font-normal"><span className="inline-flex items-center gap-1"><TierStars tier={row.tier} />{labels[row.tier]}</span></th><td className="px-2 py-2 text-right">{row.labs}</td><td className="whitespace-nowrap px-2 py-2 text-right">{formatPaise(row.consumablesPaise)}</td><td className="px-2 py-2 text-right">{row.sharePct}%</td><td className="px-2 py-2 text-right">{row.withInstrument}</td>
        </tr>)}</tbody>
      </table></div>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} aria-expanded={selected === 'movers'} aria-controls={selected === 'movers' ? 'growth-tier-labs' : undefined} onClick={() => toggle('movers')}>Moved up {data.movers.up} · down {data.movers.down} this quarter ›</button><button type="button" className={button} aria-expanded={selected === 'placement'} aria-controls={selected === 'placement' ? 'growth-tier-labs' : undefined} onClick={() => toggle('placement')}>Placement targets: {data.placement.labs} labs · {formatPaise(data.placement.consumablesPaise)} ›</button></div>
      {data.stale && <p className={muted}>Tiers are being refreshed; figures are live estimates.</p>}
      {selected && <TierLabs key={selected} selected={selected} onClose={() => setSelected(null)} onOpenCustomer={onOpenCustomer} />}</>}
  </section>;
}
