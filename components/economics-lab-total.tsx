import type { LabTotal } from '@/lib/economics-lab-totals';

const money = (paise: bigint) => {
  const sign = paise < BigInt(0) ? '−' : '';
  const absolute = paise < BigInt(0) ? -paise : paise;
  return `${sign}₹${(absolute / BigInt(100)).toLocaleString('en-IN')}.${String(absolute % BigInt(100)).padStart(2, '0')}`;
};

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="flex items-baseline justify-between gap-2 rounded-xl bg-sf-soft p-3 sm:block"><dt className="text-xs font-semibold text-sf-muted">{label}</dt><dd className="tabular-nums text-sm font-bold text-sf-ink sm:mt-1">{value}</dd></div>;
}

export function EconomicsLabTotal({ lab, forecastWindowMonths }: { lab: LabTotal; forecastWindowMonths: number }) {
  const recoveredPercent = lab.capitalPaise <= BigInt(0) ? (lab.recoveryPaise > BigInt(0) ? 'over 100%' : '0%') : lab.recoveryPaise * BigInt(100) > lab.capitalPaise * BigInt(100) ? 'over 100%' : `${(lab.recoveryPaise * BigInt(100) / lab.capitalPaise).toString()}%`;
  return <article aria-label="Lab total" className="rounded-2xl border border-sf-line-soft bg-white p-4 sm:p-5">
    <p className="text-xs font-semibold text-sf-muted">{lab.customerName} · lab total</p>
    <h3 className="mt-1 text-lg font-extrabold text-sf-ink">{lab.members.length} instruments</h3>
    <dl className="mt-4 grid gap-2 sm:grid-cols-3">
      <Metric label="Invested" value={money(lab.capitalPaise)} />
      <Metric label="Recovered" value={money(lab.recoveryPaise)} />
      <Metric label={lab.surplusPaise > BigInt(0) ? 'Surplus above investment' : 'Outstanding'} value={money(lab.surplusPaise > BigInt(0) ? lab.surplusPaise : lab.outstandingPaise)} />
    </dl>
    <p className="mt-3 text-sm text-sf-muted">Recovered {recoveredPercent} of the investment across the lab.</p>
    <ul aria-label="Recovery by instrument" className="mt-4 divide-y divide-sf-soft">
      {lab.members.map(member => <li key={member.id} className="py-3 first:pt-0 last:pb-0">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-sm font-semibold text-sf-ink">{member.name}</p>{member.noReagentSales ? <p className="mt-1 text-xs text-sf-warning">No reagent sales linked yet — check its reagent items</p> : null}</div><p className="shrink-0 text-right text-sm text-sf-ink">{money(member.recoveryPaise)} <span className="text-xs text-sf-muted">{member.sharePercent}%</span></p></div>
        <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-sf-soft"><div className="h-full rounded-full bg-sf-brand" style={{ width: `${Math.max(0, Math.min(100, member.sharePercent))}%` }} /></div>
      </li>)}
    </ul>
    <p className="mt-4 text-xs text-sf-muted">Payback months for the lab follow once every instrument has {forecastWindowMonths} months of complete data. Instrument cards below keep their own figures.</p>
  </article>;
}
