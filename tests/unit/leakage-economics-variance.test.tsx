import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LeakageEconomicsVariance } from '@/components/leakage-economics-variance';

describe('leakage economics variance', () => {
  it('formats large paise exactly with Indian grouping and explicit variance signs', () => {
    const html = renderToStaticMarkup(<LeakageEconomicsVariance
      expectedRevenuePaise="123456789012345678901"
      actualRevenuePaise="123456789012345678900"
      revenueVariancePaise="-123456789012345678901"
      expectedGpPaise="250050"
      actualGpPaise="300000"
      gpVariancePaise="49950"
    />);
    expect(html).toContain('₹12,34,56,78,90,12,34,56,789.01');
    expect(html).toContain('−₹12,34,56,78,90,12,34,56,789.01');
    expect(html).toContain('+₹499.50');
    expect(html).toContain('text-amber-800');
    expect(html).toContain('text-emerald-800');
    expect(html).toContain('Variances are actual minus expected.');
    expect(html).toContain('They overlap with supply-gap estimates and must not be added together.');
    expect(html).toContain('They do not prove a cause.');
  });

  it('marks null and invalid values unavailable', () => {
    const html = renderToStaticMarkup(<LeakageEconomicsVariance expectedRevenuePaise="1.2" actualRevenuePaise={null} />);
    expect(html.match(/Unavailable/g)).toHaveLength(6);
    expect(html).not.toContain('₹0.00');
  });

  it('explains evidence review and marks gross profit unavailable when costs are missing', () => {
    const html = renderToStaticMarkup(<LeakageEconomicsVariance
      expectedRevenuePaise="10000"
      actualRevenuePaise="9000"
      revenueVariancePaise="-1000"
      expectedGpPaise="1200"
      actualGpPaise="800"
      gpVariancePaise="-400"
      financialVarianceStatus="missing_cost"
    />);
    expect(html).toContain('Actual GP and GP variance are unavailable because cost evidence is missing.');
    expect(html.match(/Unavailable/g)).toHaveLength(2);
    expect(html).not.toContain('−₹4.00');
    expect(html).toContain('₹12.00');

    const review = renderToStaticMarkup(<LeakageEconomicsVariance financialVarianceStatus="data_review_required" />);
    expect(review).toContain('Financial evidence needs review before these values can be relied on.');
  });
});
