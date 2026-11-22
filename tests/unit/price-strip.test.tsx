import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PriceStrip } from '@/components/price-strip';
import type { GrowthMarginDetail } from '@/lib/growth-margin-types';

const data: GrowthMarginDetail = {
  kind: 'item', itemKey: 'item-1', name: 'Test item', marginPct: 20,
  page: 1, pageSize: 20, total: 3, typicalPricePaise: 681004, labs: 3,
  tallyItemKey: null, pricePolicy: null,
  rows: [
    { labKey: 'lab-1', customerId: 'customer-1', name: 'Lab One', town: null, unitPricePaise: 600000, quantity: 1, salesPaise: 600000, belowTypical: true, packDifference: false, approvedPricePaise: null, liftToPricePaise: null, minimumPricePaise: null, belowMinimum: null, belowTarget: null },
    { labKey: 'lab-2', customerId: 'customer-2', name: 'Lab Two', town: null, unitPricePaise: 681004, quantity: 1, salesPaise: 681004, belowTypical: false, packDifference: false, approvedPricePaise: null, liftToPricePaise: null, minimumPricePaise: null, belowMinimum: null, belowTarget: null },
    { labKey: 'lab-3', customerId: 'customer-3', name: 'Lab Three', town: null, unitPricePaise: 760000, quantity: 1, salesPaise: 760000, belowTypical: false, packDifference: false, approvedPricePaise: null, liftToPricePaise: null, minimumPricePaise: null, belowMinimum: null, belowTarget: null },
  ],
};

describe('price strip', () => {
  it('renders a fractional typical-price band as integer paise', () => {
    const html = renderToStaticMarkup(<PriceStrip data={data} />);
    expect(html).toContain('band ₹6,129.04 to ₹7,491.04');
  });

  it('renders with Pricing highlight and proposed mark props', () => {
    expect(() => renderToStaticMarkup(<PriceStrip data={data} highlightCustomerId="customer-1" marks={[{ label: 'Proposed', pricePaise: 650050 }]} />)).not.toThrow();
  });
});
