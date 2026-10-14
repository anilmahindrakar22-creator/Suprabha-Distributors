import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AccountRow } from '@/lib/account-types';
import { AccountDetails, accountClassesNote, accountDate, accountMetaLine, addAccountDays, classChip, contactSummary, visitChip } from '@/components/accounts-workspace';

const row: AccountRow = {
  id: '11111111-1111-4111-8111-111111111111', name: 'Care Lab', city: 'Pune',
  contacts: [],
  owner: { email: 'sales@example.test', territoryId: 'territory', territoryName: 'West', since: '2026-10-01', version: 2 },
  location: null, lastVisit: { visitedOn: '2026-10-03', outcome: 'order_taken', visitedBy: 'sales@example.test', note: null },
  nextVisitOn: null, lastOrderOn: '2026-10-04',
  class: { state: 'not_available', monthlyPaise: null, window: { from: '2026-07-01', to: '2026-09-30' } },
};
describe('Accounts pure presentation', () => {
  it('summarizes none, one and three Tally contacts', () => {
    const first = { name: 'Asha', phone: '+91 123', email: null };
    const rest = [{ name: 'Ravi', phone: null, email: 'ravi@example.test' }, { name: 'Meena', phone: null, email: null }];
    expect(contactSummary(row)).toEqual({ first: null, rest: [] });
    expect(contactSummary({ ...row, contacts: [first] })).toEqual({ first, rest: [] });
    expect(contactSummary({ ...row, contacts: [first, ...rest] })).toEqual({ first, rest });
    const html = renderToStaticMarkup(<AccountDetails row={{ ...row, contacts: [first, ...rest] }} mode="mine" today="2026-10-14" />);
    expect(html).toContain('href="tel:91123"');
    expect(html).toContain('aria-label="Call Asha"');
    expect(html).toContain('+2 more');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('ravi@example.test');
    expect(renderToStaticMarkup(<AccountDetails row={row} mode="mine" today="2026-10-14" />)).toContain('No contact in Tally');
  });
  it.each([
    ['A', '21000000', 'A', 'A · ₹2.1 L a month, Jul–Sep'],
    ['B', '7500000', 'B', 'B · ₹75 K a month, Jul–Sep'],
    ['below_b', '5000000', 'Below B', 'below_b · ₹50 K a month, Jul–Sep'],
    ['below_b', '-150000', 'Below B', 'below_b · ₹-1.5 K a month, Jul–Sep'],
    ['below_b', '0', 'Below B', 'below_b · ₹0 a month, Jul–Sep'],
  ] as const)('formats complete %s class inputs', (state, monthlyPaise, text, title) => {
    expect(classChip({ ...row, class: { ...row.class, state, monthlyPaise } })).toMatchObject({ text, title });
  });
  it('keeps link and coverage gates ahead of any monetary input', () => {
    expect(classChip({ ...row, class: { ...row.class, state: 'not_linked', monthlyPaise: '999999999' } })).toBeNull();
    expect(classChip({ ...row, class: { ...row.class, state: 'not_available', monthlyPaise: '999999999' } })).toBeNull();
    for (const monthlyPaise of [null, '', 'NaN', '2.1e7']) {
      expect(classChip({ ...row, class: { ...row.class, state: 'A', monthlyPaise } })).toBeNull();
    }
    expect(classChip({ ...row, class: { state: 'A', monthlyPaise: '21000000', window: { from: '2026-02-30', to: '2026-09-30' } } })).toBeNull();
    expect(classChip({ ...row, class: { state: 'B', monthlyPaise: '7500000', window: { from: '2026-10-01', to: '2026-09-30' } } })).toBeNull();
  });
  it('uses the first unavailable row window for the shared import note', () => {
    const linked: AccountRow = { ...row, class: { ...row.class, state: 'not_linked' } };
    const later: AccountRow = { ...row, class: { ...row.class, window: { from: '2026-10-01', to: '2026-12-31' } } };
    expect(accountClassesNote([linked, row, later])).toBe('Account classes appear once full Tally sales for Jul–Sep are imported.');
    expect(accountClassesNote([later])).toBe('Account classes appear once full Tally sales for Oct–Dec are imported.');
    expect(accountClassesNote([linked])).toBeNull();
    expect(accountClassesNote([])).toBeNull();
  });
  it('renders a class before the visit chip with accessible monthly context', () => {
    const html = renderToStaticMarkup(<AccountDetails row={{ ...row, class: { ...row.class, state: 'A', monthlyPaise: '21000000' }, nextVisitOn: '2026-10-03' }} mode="mine" today="2026-10-14" />);
    expect(html).toContain('title="A · ₹2.1 L a month, Jul–Sep"');
    expect(html).toContain('aria-label="A · ₹2.1 L a month, Jul–Sep"');
    expect(html.indexOf('A · ₹2.1 L')).toBeLessThan(html.indexOf('Visit overdue'));
    expect(html).toContain('min-w-0 flex-1');
    expect(html.match(/shrink-0/g)).toHaveLength(2);
  });
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
  it('appends the Tally link status to metadata and omits unavailable class text on cards', () => {
    const unlinked: AccountRow = { ...row, class: { ...row.class, state: 'not_linked' } };
    expect(accountMetaLine(unlinked, 'mine')).toBe('Pune · West · Last visit 3 Oct · Order taken · Last order 4 Oct · Not linked to Tally sales');
    const html = renderToStaticMarkup(<AccountDetails row={unlinked} mode="mine" today="2026-10-14" />);
    expect(html).toContain('Last order 4 Oct · Not linked to Tally sales</p>');
    expect(html).not.toContain('aria-label="Not linked to Tally sales"');
    expect(renderToStaticMarkup(<AccountDetails row={row} mode="mine" today="2026-10-14" />)).not.toContain('Class not available yet');
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
