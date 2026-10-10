type Tone = 'neutral' | 'positive' | 'negative';

function formatPaise(value: string | null | undefined, signed = false): { text: string; tone: Tone } {
  if (value == null || !/^[+-]?\d+$/.test(value)) return { text: 'Unavailable', tone: 'neutral' };
  let amount: bigint;
  try {
    amount = BigInt(value);
  } catch {
    return { text: 'Unavailable', tone: 'neutral' };
  }

  const tone: Tone = amount < BigInt(0) ? 'negative' : amount > BigInt(0) ? 'positive' : 'neutral';
  const absolute = amount < BigInt(0) ? -amount : amount;
  const rupees = (absolute / BigInt(100)).toString();
  const grouped = rupees.length <= 3
    ? rupees
    : `${rupees.slice(0, -3).replace(/\B(?=(\d{2})+$)/g, ',')},${rupees.slice(-3)}`;
  const fraction = (absolute % BigInt(100)).toString().padStart(2, '0');
  const sign = amount < BigInt(0) ? '−' : signed && amount > BigInt(0) ? '+' : '';
  return { text: `${sign}₹${grouped}.${fraction}`, tone };
}

function Amount({ label, value, variance = false, unavailable = false }: {
  label: string;
  value: string | null | undefined;
  variance?: boolean;
  unavailable?: boolean;
}) {
  const formatted = unavailable ? { text: 'Unavailable', tone: 'neutral' as const } : formatPaise(value, variance);
  const toneClass = !variance
    ? 'text-[#173b3d]'
    : formatted.tone === 'negative'
    ? 'text-amber-800'
    : formatted.tone === 'positive'
      ? 'text-emerald-800'
      : 'text-[#173b3d]';
  return <div className="min-w-0 rounded-lg border border-[#d7e4e2] bg-white p-3">
    <dt className="break-words text-xs font-semibold leading-5 text-[#586e71]">{label}</dt>
    <dd className={`mt-1 break-all text-sm font-bold tabular-nums ${toneClass}`}>{formatted.text}</dd>
  </div>;
}

export function LeakageEconomicsVariance({
  expectedRevenuePaise,
  actualRevenuePaise,
  expectedGpPaise,
  actualGpPaise,
  revenueVariancePaise,
  gpVariancePaise,
  financialVarianceStatus,
}: {
  expectedRevenuePaise?: string | null;
  actualRevenuePaise?: string | null;
  expectedGpPaise?: string | null;
  actualGpPaise?: string | null;
  revenueVariancePaise?: string | null;
  gpVariancePaise?: string | null;
  financialVarianceStatus?: string;
}) {
  const gpUnavailable = financialVarianceStatus === 'missing_cost';

  return <details className="rounded-xl border border-[#d7e4e2] bg-[#f7fbfa] p-3 text-[#173b3d]">
    <summary className="min-h-10 cursor-pointer text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145e62]">Actual economics vs baseline</summary>
    <dl className="mt-2 grid grid-cols-2 gap-2">
      <Amount label="Expected revenue" value={expectedRevenuePaise} />
      <Amount label="Actual mapped revenue" value={actualRevenuePaise} />
      <Amount label="Revenue variance" value={revenueVariancePaise} variance />
      <Amount label="Expected GP" value={expectedGpPaise} />
      <Amount label="Actual GP" value={actualGpPaise} unavailable={gpUnavailable} />
      <Amount label="GP variance" value={gpVariancePaise} variance unavailable={gpUnavailable} />
    </dl>
    <div className="mt-3 grid gap-1 text-xs leading-5 text-[#586e71]">
      {financialVarianceStatus === 'data_review_required' && <p>Financial evidence needs review before these values can be relied on.</p>}
      {financialVarianceStatus === 'baseline_incomplete' && <p>Expected price or cost assumptions are incomplete. Available actual values remain separate.</p>}
      {gpUnavailable && <p>Actual GP and GP variance are unavailable because cost evidence is missing.</p>}
      <p>Variances are actual minus expected. They overlap with supply-gap estimates and must not be added together. They do not prove a cause.</p>
    </div>
  </details>;
}
