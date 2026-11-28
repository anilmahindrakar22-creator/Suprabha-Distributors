import { Award, Crown, Gem, Medal } from 'lucide-react';
import type { CustomerTier } from '@/lib/customer-tiers';

const icons = { diamond: Gem, platinum: Crown, gold: Medal, silver: Award };
export function CustomerTierBadge({ tier, withLabel }: { tier?: CustomerTier | null; withLabel?: boolean }) {
  if (!tier) return null;
  const Icon = icons[tier];
  const label = tier[0].toUpperCase() + tier.slice(1);
  return <span className="inline-flex shrink-0 items-center gap-1 text-sf-muted" title={`${label} lab`}>
    <Icon size={14} aria-hidden="true" />
    <span className="sr-only">{label} lab</span>
    {withLabel ? <span className="text-xs font-semibold">{label}</span> : null}
  </span>;
}
