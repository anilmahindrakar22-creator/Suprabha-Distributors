import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CustomerPriceBook } from '@/components/customer-price-book';
import { PricingOptions } from '@/components/pricing-options';
import type { PricingLineResolution } from '@/lib/pricing-types';
import '@/app/globals.css';

const row = {
  fixed: false, lastRate: 420, historicCost: 300, currentCost: 310, costChange: 10,
  continuityPrice: 430, targetMarginPrice: 445, recommendedPrice: 445,
  recommendationReason: 'Target-margin price exceeds continuity and improves gross profit.',
  continuityGP: 120, continuityMargin: 27.91, recommendedGP: 135, recommendedMargin: 30.34,
  differenceToCustomer: 25, additionalGP: 15,
} as PricingLineResolution;
function Fixture() {
  const [entry, setEntry] = useState({ rate: '445', reason: '' });
  const parameters = new URLSearchParams(location.search);
  return <main className="mx-auto max-w-5xl p-4"><h1>Pricing test fixture</h1>{parameters.get('view') === 'order'
    ? <PricingOptions line={{ ...row, fixed: parameters.has('fixed') }} entry={entry} onChange={setEntry}/>
    : <CustomerPriceBook actorEmail="fixture@example.test" actorRole={parameters.get('role') || 'management'}/>}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
