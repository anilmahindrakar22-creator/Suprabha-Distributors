import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AccountRow } from '@/lib/account-types';
import { AccountDetails, accountDate, accountMetaLine, addAccountDays, visitChip } from '@/components/accounts-workspace';

const row: AccountRow = {
  id: '11111111-1111-4111-8111-111111111111', name: 'Care Lab', city: 'Pune',
  owner: { email: 'sales@example.test', territoryId: 'territory', territoryName: 'West', since: '2026-10-01', version: 2 },
  location: null, lastVisit: { visitedOn: '2026-10-03', outcome: 'order_taken', visitedBy: 'sales@example.test', note: null },
  nextVisitOn: null, lastOrderOn: '2026-10-04',
};
describe('Accounts pure presentation', () => {
  it('uses date-only arithmetic across month and year boundaries', () => {
    expect(accountDate('2026-10-03')).toBe('3 Oct');
    expect(addAccountDays('2026-12-28', 7)).toBe('2027-01-04');
    expect(addAccountDays('2026-10-14', -30)).toBe('2026-09-14');
  });
  it('prioritises overdue and future visits over never visited', () => {
    expect(visitChip({ ...row, lastVisit: null, nextVisitOn: '2026-10-14' }, '2026-10-14')).toMatchObject({ text: 'Visit overdue · due 14 Oct', className: 'bg-sf-warning-soft text-sf-warning' });
    expect(visitChip({ ...row, lastVisit: null, nextVisitOn: '2026-10-15' }, '2026-10-14')?.text).toBe('Next visit 15 Oct');
    expect(visitChip({ ...row, lastVisit: null }, '2026-10-14')?.text).toBe('Never visited');
    expect(visitChip(row, '2026-10-14')).toBeNull();
  });
  it('joins existing metadata in order and shows the owner only in All', () => {
    expect(accountMetaLine(row, 'mine')).toBe('Pune · West · Last visit 3 Oct · Order taken · Last order 4 Oct');
    expect(accountMetaLine(row, 'all')).toBe('Pune · West · sales@example.test · Last visit 3 Oct · Order taken · Last order 4 Oct');
    expect(accountMetaLine({ ...row, city: null, owner: null, lastVisit: null, lastOrderOn: null }, 'all')).toBe('');
  });
  it.each([['met', 'Met'], ['not_available', 'Not available'], ['order_taken', 'Order taken'], ['issue_raised', 'Issue raised'], ['other', 'Other']] as const)('labels %s', (outcome, label) => {
    expect(accountMetaLine({ ...row, lastVisit: { ...row.lastVisit!, outcome } }, 'mine')).toContain(`Last visit 3 Oct · ${label}`);
  });
  it('renders real chip text and a map link with its target and rel', () => {
    const html = renderToStaticMarkup(<AccountDetails row={{ ...row, nextVisitOn: '2026-10-03', location: { precision: 'pin', latitude: '18.52', longitude: '73.85', town: null, verifiedBy: 'sales@example.test', verifiedAt: '2026-10-14', version: 1 } }} mode="all" today="2026-10-14" />);
    expect(html).toContain('Visit overdue · due 3 Oct');
    expect(html).toContain('📍 Pin set');
    expect(html).toContain('href="https://www.google.com/maps?q=18.52,73.85"');
    expect(html).toContain('target="_blank" rel="noopener"');
    expect(html).toContain('sales@example.test');
  });
  it('renders town and missing location without inventing a chip', () => {
    const html = renderToStaticMarkup(<AccountDetails row={row} mode="mine" today="2026-10-14" />);
    expect(html).toContain('No location');
    expect(html).not.toContain('rounded-full');
    expect(renderToStaticMarkup(<AccountDetails row={{ ...row, location: { precision: 'town', town: 'Pune', latitude: null, longitude: null, verifiedBy: 'sales@example.test', verifiedAt: '2026-10-14', version: 1 } }} mode="mine" today="2026-10-14" />)).toContain('Town: Pune');
  });
});
