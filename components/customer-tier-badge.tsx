import type { CustomerTier } from '@/lib/customer-tiers';
import { TierStars } from '@/components/tier-stars';
export function CustomerTierBadge({ tier, withLabel }: { tier?: CustomerTier | null; withLabel?: boolean }) {
  if (!tier) return null;
  const label = tier[0].toUpperCase() + tier.slice(1);
  return <span className="inline-flex shrink-0 items-center gap-1 text-sf-muted" title={`${label} lab`}>
    <TierStars tier={tier} />
    <span className="sr-only">{label} lab</span>
    {withLabel ? <span className="text-xs font-semibold">{label}</span> : null}
  </span>;
}
