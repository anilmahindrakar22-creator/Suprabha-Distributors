import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CustomerLinkCard, rowsAfterReload, shortGuid } from '../../components/customer-links';
import type { CustomerLinkRow } from '../../lib/customer-link-types';

const row: CustomerLinkRow = { customerId: 'care', customerName: 'Care Lab', city: 'Pune', ledgerName: 'Care ledger', guid: 'ledger-12345678', state: 'suggested' };
describe('Customer link presentation', () => {
  it('shows only the last eight GUID characters', () => {
    expect(shortGuid(row.guid)).toBe('…12345678');
    expect(shortGuid('abc')).toBe('…abc');
    expect(shortGuid('')).toBe('…');
  });
  it('keeps only the same suggested customer and ledger after a reload', () => {
    const selected = ['care', 'linked', 'conflict', 'missing', 'changed'].map(customerId => ({ customerId, ledgerGuid: row.guid }));
    expect(rowsAfterReload(selected, [row, { ...row, customerId: 'linked', state: 'linked' }, { ...row, customerId: 'conflict', state: 'conflict' }, { ...row, customerId: 'changed', guid: 'new-ledger' }])).toEqual({ kept: [selected[0]], removed: 4 });
    expect(rowsAfterReload([], [row])).toEqual({ kept: [], removed: 0 });
  });
  it('renders an unselected suggested checkbox and no controls nested in labels', () => {
    const html = renderToStaticMarkup(<CustomerLinkCard row={row} />);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('Select Care Lab');
    expect(html).not.toContain('checked=');
    expect(html).not.toMatch(/<label[^>]*>.*<(input|select|button)/);
    for (const state of ['linked', 'conflict'] as const) expect(renderToStaticMarkup(<CustomerLinkCard row={{ ...row, state }} />)).not.toContain('type="checkbox"');
  });
});
