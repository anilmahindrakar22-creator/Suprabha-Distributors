import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CustomerPriceBook } from '@/components/customer-price-book';
import { PricingWorkspace } from '@/components/pricing-workspace';
import { PricingOptions } from '@/components/pricing-options';
import { HydratedNewOrderPanel, OrderWorkspace } from '@/components/order-workspace';
import { ProductRequest, ProductRequestInbox } from '@/components/product-request';
import { ProcurementRequirements } from '@/components/procurement-requirements';
import { StockFlowFrame } from '@/components/stockflow-frame';
import type { PricingLineResolution } from '@/lib/pricing-types';
import type { OrderBootstrap } from '@/lib/order-types';
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
  if (parameters.get('view') === 'frame') return <StockFlowFrame actorEmail="staff@example.test" actorRole={parameters.get('role') || 'sales'} />;
  if (parameters.get('view') === 'product-requests') return <ProductRequestInbox />;
  if (parameters.get('view') === 'product-request-recovery') return <ProductRequest actorEmail={parameters.get('actor') || 'sales@example.test'} productName="Missing reagent" visible />;
  if (parameters.get('view') === 'requirements') return <ProcurementRequirements />;
  const data: OrderBootstrap = {
      actor: { email: 'order-desk@example.test', role: 'sales' },
      snapshot: { company: 'TEST', fetchedAt: new Date().toISOString(), catalog: [
        { tallyKey: 'GLUCOSE-A', item: 'Glucose A', group: 'Diasys', baseUnit: 'Nos', closing: 10, active: true },
        { tallyKey: 'GLUCOSE-B', item: 'Glucose B', group: 'Diasys', baseUnit: 'Nos', closing: 12, active: true },
        { tallyKey: 'CRP', item: 'CRP', group: 'Sysmex', baseUnit: 'Nos', closing: 8, active: true },
        { tallyKey: 'HBA1C', item: 'HbA1c', group: 'Sysmex', baseUnit: 'Nos', closing: 8, active: true },
        { tallyKey: 'CLEANER', item: 'Cleaner', group: 'Sysmex', baseUnit: 'Nos', closing: 8, active: true },
      ] },
      customers: [
        { id: '11111111-1111-4111-8111-111111111111', name: 'Test Alpha Laboratory', phone: null, city: null, tallyKey: 'ALPHA' },
        { id: '22222222-2222-4222-8222-222222222222', name: 'Test Beta Laboratory', phone: null, city: null, tallyKey: 'BETA' },
      ],
      orders: [], operations: {},
  };
  if (parameters.get('view') === 'orders-workspace') return <OrderWorkspace actorEmail={data.actor.email} />;
  if (parameters.get('view') === 'order-entry') {
    return <HydratedNewOrderPanel data={data} templateOrder={null} onClose={() => undefined} onCreated={() => undefined} onViewCustomer={() => undefined} />;
  }
  if (parameters.get('view') === 'workspace') return <PricingWorkspace actorEmail="fixture@example.test" actorRole="management"/>;
  return <main className="mx-auto max-w-5xl p-4"><h1>Pricing test fixture</h1>{parameters.get('view') === 'order'
    ? <PricingOptions line={{ ...row, fixed: parameters.has('fixed') }} entry={entry} onChange={setEntry}/>
    : <CustomerPriceBook actorEmail="fixture@example.test" actorRole={parameters.get('role') || 'management'}/>}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
