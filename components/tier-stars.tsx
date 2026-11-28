import { Star } from 'lucide-react';

export function TierStars({ tier, size = 12 }: { tier: 'diamond' | 'platinum' | 'gold' | 'silver' | 'untiered' | null | undefined; size?: number }) {
  const count = tier === 'diamond' ? 4 : tier === 'platinum' ? 3 : tier === 'gold' ? 2 : tier === 'silver' ? 1 : 0;
  return <span aria-hidden="true" className="inline-flex shrink-0 items-center gap-px">
    {Array.from({ length: count }, (_, index) => <Star key={index} size={size} fill="currentColor" strokeWidth={1.5} />)}
  </span>;
}
