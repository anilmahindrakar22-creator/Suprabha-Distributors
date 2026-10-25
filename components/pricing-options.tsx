'use client';

import { useId, useState } from 'react';
import type { PricingLineResolution } from '@/lib/pricing-types';

const format = (amount: number | null) => amount == null ? 'Unavailable' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount);

export function PricingOptions({ line, entry, onChange }: { line: PricingLineResolution; entry: { rate: string; reason: string }; onChange: (entry: { rate: string; reason: string }) => void }) {
  const [custom, setCustom] = useState(false);
  const needsRate = line.proposedRate == null && line.continuityPrice == null && line.recommendedPrice == null;
  const inputId = useId();
  const choose = (amount: number | null, reason: string) => {
    if (amount == null) return;
    setCustom(false);
    onChange({ rate: String(amount), reason });
  };
  const earlierPrices: Array<{ rate: number; reference: string | null; date: string | null; approved: boolean }> = [];
  if (line.lastRate != null && ['LAST_TALLY_INVOICE', 'APPROVED_CONTRACT'].includes(line.source.type)) {
    earlierPrices.push({ rate: line.lastRate, reference: line.source.reference, date: line.source.date, approved: line.source.type === 'APPROVED_CONTRACT' });
  }
  for (const recent of [...line.recentRates].sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate))) {
    if (!earlierPrices.some(price => price.rate === recent.rate)) earlierPrices.push({ rate: recent.rate, reference: recent.invoiceReference, date: recent.invoiceDate, approved: false });
  }
  const earlierPriceChips = earlierPrices.length ? <div className="min-w-0 space-y-2">
    <p className="text-xs font-bold text-sf-muted">Earlier prices for this customer</p>
    <div className="flex min-w-0 flex-wrap gap-2">{earlierPrices.slice(0, 4).map(price => {
      const date = price.date ? new Date(price.date).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }) : '';
      const text = `Use ₹${price.rate.toLocaleString('en-IN', { maximumFractionDigits: 2 })} · ${price.approved ? 'approved price' : [date, price.reference].filter(Boolean).join(' · ')}`;
      return <button key={price.rate} type="button" onClick={() => {
        setCustom(true);
        onChange({ rate: String(price.rate), reason: price.approved ? 'Same as approved customer price' : `Same as ${[price.reference, date].filter(Boolean).join(', ')}` });
      }} className="min-h-11 max-w-full whitespace-normal break-words rounded-lg border border-sf-line px-3 py-2 text-left text-xs font-bold text-sf-body">{text}</button>;
    })}</div>
  </div> : null;
  if (needsRate) return <div className="mt-3 space-y-3">
    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">No usable selling price is available for this customer and item. Enter the agreed rate and reason to request approval.</p>
    <p className="text-sm">Current purchase cost: <strong>{format(line.currentCost)}</strong></p>
    {earlierPriceChips}
    <label className="block text-sm font-bold" htmlFor={inputId}>Custom selling rate<input id={inputId} type="number" min="0.01" max="100000000" step="0.01" value={entry.rate} onChange={event => onChange({ ...entry, rate: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border px-3 font-normal"/></label>
    <label className="block text-sm font-bold">Decision reason<input maxLength={1000} value={entry.reason} onChange={event => onChange({ ...entry, reason: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border px-3 font-normal"/></label>
    {entry.rate ? <p className="text-xs font-bold">Selected rate: {format(Number(entry.rate))}</p> : null}
  </div>;
  return <div className="mt-3 space-y-3">
    {line.costChange != null && line.costChange > 0 && line.guardrail === 'PRICE_REVIEW_REQUIRED' ? <p className="rounded-lg bg-amber-50 p-3 text-xs font-bold text-amber-900">Purchase cost increased. This order needs administrator price review before billing, including fixed agreements.</p> : null}
    <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
      {([
        ['Last customer rate', line.lastRate], ['Cost at last sale', line.historicCost], ['Current cost', line.currentCost],
        ['Cost change', line.costChange], ['Continuity price', line.continuityPrice], ['Target-margin price', line.targetMarginPrice],
      ] as const).map(([label, value]) => <div key={label}><dt className="text-sf-muted">{label}</dt><dd className="mt-1 font-bold">{format(value)}</dd></div>)}
    </dl>
    <p className="rounded-lg bg-sf-accent-soft p-3 text-xs"><strong>Recommended {format(line.recommendedPrice)}</strong><span className="mt-1 block">{line.recommendationReason}</span></p>
    <p className="text-xs">Continuity GP {format(line.continuityGP)} ({line.continuityMargin ?? '—'}%) · Recommended GP {format(line.recommendedGP)} ({line.recommendedMargin ?? '—'}%).</p>
    <p className="text-xs">Change from last customer rate {format(line.differenceToCustomer)} · Additional GP per unit {format(line.additionalGP)}.</p>
    {earlierPriceChips}
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={line.fixed || line.continuityPrice == null} onClick={() => choose(line.continuityPrice, 'Maintain customer continuity; pass through only positive cost change.')} className="min-h-10 rounded-lg border px-3 text-xs font-bold disabled:opacity-40">Maintain {format(line.continuityPrice)}</button>
      <button type="button" disabled={line.recommendedPrice == null} onClick={() => choose(line.recommendedPrice, line.recommendationReason)} className="min-h-10 rounded-lg bg-sf-success px-3 text-xs font-bold text-white disabled:opacity-40">Recommended {format(line.recommendedPrice)}</button>
      <button type="button" aria-expanded={custom} aria-controls={inputId} onClick={() => { setCustom(true); onChange({ ...entry, reason: '' }); }} className="min-h-10 rounded-lg border px-3 text-xs font-bold">Custom</button>
    </div>
    {line.fixed ? <p className="text-xs text-amber-800">This agreement is fixed. A custom change requires a reason and management approval.</p> : null}
    <p className="text-xs font-bold">Selected rate: {entry.rate ? format(Number(entry.rate)) : 'Choose a price'}</p>
    {custom ? <label className="block text-xs font-bold" htmlFor={inputId}>Custom selling rate<input id={inputId} type="number" min="0.01" max="100000000" step="0.01" value={entry.rate} onChange={(event) => onChange({ ...entry, rate: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border px-3 font-normal"/></label> : null}
    <label className="block text-xs font-bold">Decision reason<input maxLength={1000} value={entry.reason} onChange={(event) => onChange({ ...entry, reason: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border px-3 font-normal"/></label>
  </div>;
}
