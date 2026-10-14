import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AccountRow, ContactStyle } from '@/lib/account-types';
import { AccountDetails, accountClassesNote, accountDate, accountMetaLine, addAccountDays, alertLabel, assessmentSummary, classChip, visitChip, styleLine, styleTip, whoDecidesLine } from '@/components/accounts-workspace';

const row: AccountRow = {
  id: '11111111-1111-4111-8111-111111111111', name: 'Care Lab', city: 'Pune',
  appContacts: [],
  owner: { email: 'sales@example.test', territoryId: 'territory', territoryName: 'West', since: '2026-10-01', version: 2 },
  location: null, lastVisit: { id: '88888888-8888-4888-8888-888888888888', visitedOn: '2026-10-03', outcome: 'order_taken', visitedBy: 'sales@example.test', note: null, metContacts: [] },
  nextVisitOn: null, lastOrderOn: '2026-10-04',
  class: { state: 'not_available', monthlyPaise: null, window: { from: '2026-07-01', to: '2026-09-30' } },
};
describe('Accounts pure presentation', () => {
  const style: ContactStyle = { state: 'analytical', computedStyle: 'analytical', confidence: 'high', observations: 3, distinctDates: 3, assertiveness: 1, responsiveness: 1, override: null, cues: {} };
  it.each([
    ['analytical', 'Analytical', "Bring the data: cost per test, validation papers, a written comparison. Don't rush."],
    ['driving', 'Driving', 'Lead with the result: savings, uptime, a clear recommendation. Keep it short.'],
    ['expressive', 'Expressive', 'Demo it, name reference labs, tell the bigger story.'],
    ['amiable', 'Amiable', 'Build trust: service plan, training, reliability. Reduce the risk of switching.'],
  ] as const)('formats %s and its override with the exact tip', (state, label, tip) => {
    for (const confidence of ['high', 'medium', 'low'] as const) expect(styleLine({ ...style, state, confidence })).toBe(`${label} · ${confidence} confidence`);
    expect(styleTip(state)).toBe(tip);
    expect(styleLine({ ...style, override: { style: state, actor: 'Manager', reason: 'Observed', recordedAt: '2026-10-14' } })).toBe(`${label} (set by Manager)`);
  });
  it('formats both unresolved states and gives overrides precedence', () => {
    expect(styleTip('not_enough')).toBeNull();
    expect(styleTip('not_clear')).toBeNull();
    expect(styleLine({ ...style, state: 'not_enough', distinctDates: 2 })).toBe('Style: not enough information (2 of 3 meetings)');
    expect(styleLine({ ...style, state: 'not_clear' })).toBe('Style: not clear yet. Keep rating after visits.');
    expect(styleLine({ ...style, state: 'not_enough', override: { style: 'amiable', actor: 'Manager', reason: 'Observed', recordedAt: '2026-10-14' } })).toBe('Amiable (set by Manager)');
  });
  it('gates styles and management extras while keeping recent rating access', () => {
    const appContact = { id: 'asha', name: 'Asha', businessRole: null, phone: null, email: null, addedBy: 'sales@example.test', version: 1, canEdit: false, style, styleObservations: [] };
    const account = { ...row, appContacts: [appContact], lastVisit: { ...row.lastVisit!, metContacts: [{ id: appContact.id, name: appContact.name }] } };
    const hidden = renderToStaticMarkup(<AccountDetails row={account} mode="mine" today="2026-10-14" />);
    expect(hidden).toContain('Rate behaviour');
    expect(hidden).not.toContain('Analytical');
    expect(hidden).not.toContain('Ratings (');
    expect(hidden).not.toContain('Override style');
    const visible = renderToStaticMarkup(<AccountDetails row={{ ...account, canSeeStyle: true }} mode="mine" today="2026-10-14" />);
    expect(visible).toContain('Analytical · high confidence');
    expect(visible).toContain('Bring the data');
    expect(visible).toContain('Ratings (0)');
    expect(visible).toContain('Override style');
    for (const visitedOn of ['2026-09-13', '2026-10-15']) expect(renderToStaticMarkup(<AccountDetails row={{ ...account, lastVisit: { ...account.lastVisit, visitedOn } }} mode="mine" today="2026-10-14" />)).not.toContain('Rate behaviour');
  });
  it('renders the override tip and underlying observed style', () => {
    const appContact = { id: 'asha', name: 'Asha', businessRole: null, phone: null, email: null, addedBy: 'Sales', version: 1, canEdit: false, style: { ...style, override: { style: 'driving' as const, actor: 'Manager', reason: 'Observed', recordedAt: '2026-10-14' } } };
    const html = renderToStaticMarkup(<AccountDetails row={{ ...row, canSeeStyle: true, appContacts: [appContact] }} mode="mine" today="2026-10-14" />);
    expect(html).toContain('Driving (set by Manager)');
    expect(html).toContain('Lead with the result');
    expect(html).toContain('Observed: Analytical');
    appContact.style.computedStyle = null;
    expect(renderToStaticMarkup(<AccountDetails row={{ ...row, canSeeStyle: true, appContacts: [appContact] }} mode="mine" today="2026-10-14" />)).toContain('Observed: not enough information');
  });
  const contact = { id: 'asha', name: 'Asha', businessRole: null, phone: null, email: null, addedBy: 'sales@example.test', version: 1, canEdit: false };
  const assessment = { decisionRole: 'decision_maker', stance: 'sceptical', influence: 'high', reason: null, actor: 'manager@example.test', recordedAt: '2026-10-14' } as const;
  it('summarises known assessment parts and defaults to Role not set', () => {
    expect(assessmentSummary(contact)).toBe('Role not set');
    expect(assessmentSummary({ ...contact, assessment: null })).toBe('Role not set');
    expect(assessmentSummary({ ...contact, assessment })).toBe('Decision maker · Sceptical · High influence');
    expect(assessmentSummary({ ...contact, assessment: { ...assessment, decisionRole: 'unknown', influence: 'unknown' } })).toBe('Sceptical');
    expect(assessmentSummary({ ...contact, assessment: { ...assessment, decisionRole: 'unknown', stance: 'unknown', influence: 'unknown' } })).toBe('Role not set');
  });
  it.each([
    ['no_decision_maker', 'No decision maker known'],
    ['decision_maker_not_met', 'Decision maker not met in 60 days'],
    ['influential_blocker', 'Influential blocker'],
  ] as const)('labels Power Map alert %s', (alert, label) => expect(alertLabel(alert)).toBe(label));
  it('gates alerts, assessments and Set role on Power Map permission, including read-only contacts', () => {
    const powerRow: AccountRow = { ...row, powerAlerts: ['no_decision_maker', 'decision_maker_not_met', 'influential_blocker'], appContacts: [{ ...contact, assessment, lastMetOn: '2026-10-03' }, { ...contact, id: 'ravi', name: 'Ravi' }] };
    const visible = renderToStaticMarkup(<AccountDetails row={powerRow} mode="mine" today="2026-10-14" canSeePowerMap />);
    expect(visible).toContain('Decision maker · Sceptical · High influence · Last met 3 Oct');
    expect(visible).toContain('Role not set · Not met yet');
    expect(visible).toContain('Set role for Asha');
    for (const alert of powerRow.powerAlerts!) expect(visible).toContain(alertLabel(alert));
    const hidden = renderToStaticMarkup(<AccountDetails row={powerRow} mode="mine" today="2026-10-14" />);
    expect(hidden).not.toContain('Set role');
    expect(hidden).not.toContain('Last met');
    expect(hidden).not.toContain('Role not set');
    for (const alert of powerRow.powerAlerts!) expect(hidden).not.toContain(alertLabel(alert));
  });
  it('summarises decision makers and blockers for Power Map', () => {
    const makeContact = (name: string, changes: Partial<AccountRow['appContacts'][number]> = {}): AccountRow['appContacts'][number] => ({ ...contact, id: name, name, ...changes });
    const decisionMaker = makeContact('Dr Rao', { assessment: { ...assessment, stance: 'supporter' }, lastMetOn: '2026-09-12', style });
    expect(whoDecidesLine({ ...row, appContacts: [decisionMaker] })).toBe('Decides: Dr Rao · Supporter · Analytical · met 12 Sep');
    const blocker = makeContact('Mr Iyer', { assessment: { ...assessment, decisionRole: 'influencer', stance: 'blocker' } });
    expect(whoDecidesLine({ ...row, appContacts: [decisionMaker, blocker] })).toBe('Decides: Dr Rao · Supporter · Analytical · met 12 Sep | Blocking: Mr Iyer');
    const unknown = makeContact('Asha', { assessment: { ...assessment, stance: 'unknown' } });
    expect(whoDecidesLine({ ...row, appContacts: [unknown] })).toBe('Decides: Asha · not met');
    const overridden = makeContact('Zara', { assessment, style: { ...style, override: { style: 'driving', reason: 'Observed', actor: 'Manager', recordedAt: '2026-10-14' } } });
    expect(whoDecidesLine({ ...row, appContacts: [overridden] })).toContain('Zara · Sceptical · Driving · not met');
    const decisionMakers = ['Meena', 'Asha', 'Ravi'].map(name => makeContact(name, { assessment }));
    expect(whoDecidesLine({ ...row, appContacts: decisionMakers })).toBe('Decides: Asha · Sceptical · not met; Meena · Sceptical · not met; +1 more');
    const blockers = ['Zed', 'Asha', 'Meena'].map(name => makeContact(name, { assessment: { ...assessment, decisionRole: 'influencer', stance: 'blocker' } }));
    expect(whoDecidesLine({ ...row, appContacts: blockers })).toBe('Blocking: Asha, Meena, +1 more');
    expect(whoDecidesLine({ ...row, appContacts: [contact] })).toBeNull();
  });
  it('never renders Who decides without Power Map permission', () => {
    const assessed = { ...contact, assessment };
    expect(renderToStaticMarkup(<AccountDetails row={{ ...row, appContacts: [assessed] }} mode="mine" today="2026-10-14" />)).not.toContain('Decides:');
  });
  it('adds at most two met names and the remaining count to last visit metadata', () => {
    const metContacts = ['Asha', 'Ravi', 'Meena', 'Rohan'].map(name => ({ id: name, name }));
    expect(accountMetaLine({ ...row, lastVisit: { ...row.lastVisit!, metContacts } }, 'mine')).toContain('Last visit 3 Oct · Order taken · with Asha, Ravi +2');
    expect(accountMetaLine({ ...row, lastVisit: { ...row.lastVisit!, metContacts: metContacts.slice(0, 1) } }, 'mine')).toContain('with Asha · Last order');
  });
  it('lists app contacts with links, ownership and editing permissions', () => {
    const html = renderToStaticMarkup(<AccountDetails row={{ ...row, appContacts: [
      { id: 'editable', name: 'Asha', businessRole: 'Lab head', phone: '+91 98765 43210', email: 'asha@example.test', addedBy: 'sales@example.test', version: 2, canEdit: true },
      { id: 'readonly', name: 'Ravi', businessRole: null, phone: null, email: null, addedBy: 'other@example.test', version: 1, canEdit: false },
    ] }} mode="mine" today="2026-10-14" />);
    expect(html).toContain('Asha · Lab head');
    expect(html).toContain('href="tel:919876543210"');
    expect(html).toContain('href="mailto:asha@example.test"');
    expect(html).toContain('added by sales@example.test');
    expect(html).toContain('aria-label="Edit Asha"');
    expect(html).toContain('aria-label="Remove Asha"');
    const contactLine = html.match(/<p[^>]*><span[^>]*>Asha · Lab head<\/span>[\s\S]*?<\/p>/)?.[0];
    expect(contactLine).toContain('href="tel:919876543210"');
    expect(contactLine).toContain('href="mailto:asha@example.test"');
    expect(contactLine).not.toContain('<button');
    expect(contactLine).not.toContain('border');
    expect(contactLine).not.toContain('added by');
    const attributionLine = html.match(/<p[^>]*><span>added by sales@example.test<\/span>[\s\S]*?<\/p>/)?.[0];
    expect(attributionLine).toContain('aria-label="Edit Asha"');
    expect(attributionLine).toContain('aria-label="Remove Asha"');
    expect(attributionLine).toContain('inline-flex min-h-11 items-center px-1 text-xs text-sf-brand/80');
    expect(attributionLine).toContain('inline-flex items-center whitespace-nowrap');
    expect(attributionLine).not.toContain('border');
    expect(html).not.toContain('aria-label="Edit Ravi');
    expect(html).not.toContain('aria-label="Remove Ravi');
    expect(html).toContain('Add contact');
  });
  it('hides erase personal data unless the administrator permission is present', () => {
    const account = { ...row, appContacts: [{ id: 'editable', name: 'Asha', businessRole: null, phone: null, email: null, addedBy: 'sales@example.test', version: 1, canEdit: true }] };
    expect(renderToStaticMarkup(<AccountDetails row={account} mode="mine" today="2026-10-14" />)).not.toContain('Erase personal data');
    expect(renderToStaticMarkup(<AccountDetails row={account} mode="mine" today="2026-10-14" canEraseContacts />)).not.toContain('Erase personal data');
  });
  it('shows two of three app contacts and an accessible more toggle', () => {
    const appContacts = ['Asha', 'Ravi', 'Meena'].map(name => ({ id: name, name, businessRole: null, phone: null, email: null, addedBy: 'sales@example.test', version: 1, canEdit: false }));
    const html = renderToStaticMarkup(<AccountDetails row={{ ...row, appContacts }} mode="mine" today="2026-10-14" />);
    expect(html).toContain('Asha');
    expect(html).toContain('Ravi');
    expect(html).not.toContain('Meena');
    expect(html).toContain('+1 more');
    expect(html).toContain('aria-label="1 more contacts for Care Lab"');
    expect(html).toContain('aria-expanded="false"');
    const empty = renderToStaticMarkup(<AccountDetails row={row} mode="mine" today="2026-10-14" />);
    expect(empty).toContain('No contacts yet');
  });
  it('shows one app contact without the empty message or more toggle', () => {
    const html = renderToStaticMarkup(<AccountDetails row={{ ...row, appContacts: [
      { id: 'app-only', name: 'Asha', businessRole: null, phone: null, email: null, addedBy: 'sales@example.test', version: 1, canEdit: true },
    ] }} mode="mine" today="2026-10-14" />);
    expect(html).toContain('Asha');
    expect(html).not.toContain('No contacts yet');
    expect(html).not.toContain('more contacts for');
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
