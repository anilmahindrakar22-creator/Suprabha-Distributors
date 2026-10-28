import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EconomicDocumentExclusions, type EconomicDocumentExclusion } from '@/components/economic-document-exclusions';

const document: EconomicDocumentExclusion = {
  sourceId: 'PROFORMA-VOUCHER-2026-001', revision: '4', date: '2026-10-07', voucherType: 'Proforma Invoice',
  reason: 'Cancelled before posting', cancelled: true,
};

describe('economic document exclusions', () => {
  it('renders a collapsed accessible disclosure with audit and exclusion details', () => {
    const html = renderToStaticMarkup(<EconomicDocumentExclusions documents={[document]} total={1} />);
    expect(html).toContain('<details');
    expect(html).toContain('<summary');
    expect(html).toContain('Excluded documents (1)');
    expect(html).toContain('Classified non-economic documents are retained for audit and excluded from revenue, GP and supply.');
    expect(html).toContain('7 Oct 2026');
    expect(html).toContain('Proforma Invoice');
    expect(html).toContain('PROFORMA-VOUCHER-2026-001');
    expect(html).toContain('Cancelled');
    expect(html).toContain('Cancelled before posting');
    expect(html).not.toContain('₹');
  });

  it('shows how many older records are retained', () => {
    const html = renderToStaticMarkup(<EconomicDocumentExclusions documents={[document]} total={8} />);
    expect(html).toContain('7 older excluded documents are retained for audit.');
  });

  it('renders nothing when there are no supplied records', () => {
    expect(renderToStaticMarkup(<EconomicDocumentExclusions documents={[]} total={0} />)).toBe('');
  });
});
