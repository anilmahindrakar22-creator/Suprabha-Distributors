import { expect, test, type Page } from '@playwright/test';
import type { AccountRow, AccountsResponse } from '../../lib/account-types';

const customerId = '11111111-1111-4111-8111-111111111111';
const territoryId = '22222222-2222-4222-8222-222222222222';
const base: AccountRow = { id: customerId, name: 'Care Lab', city: 'Pune', appContacts: [], owner: { email: 'sales@example.test', territoryId, territoryName: 'West', since: '2026-10-01', version: 3 }, location: null, lastVisit: null, nextVisitOn: '2026-10-03', lastOrderOn: null, class: { state: 'not_available', monthlyPaise: null, window: { from: '2026-07-01', to: '2026-09-30' } } };
const fixture: AccountsResponse = {
  accounts: [{ ...base }, { ...base, id: '33333333-3333-4333-8333-333333333333', name: 'City Lab', nextVisitOn: '2026-10-21' }, { ...base, id: '44444444-4444-4444-8444-444444444444', name: 'New Lab', nextVisitOn: null }],
  page: { page: 1, pageSize: 50, total: 3 }, owners: [{ email: 'sales@example.test', name: 'Salesperson' }, { email: 'other@example.test', name: 'Other salesperson' }],
  territories: [{ id: territoryId, name: 'West' }], canAssign: false, canSeePowerMap: false, actorEmail: 'sales@example.test', today: '2026-10-14',
  classPolicy: { aMinPaise: '20000000', bMinPaise: '7500000' },
};
type Command = Record<string, unknown>;
async function mockAccounts(page: Page, options: { canAssign?: boolean; canSeePowerMap?: boolean; powerAlerts?: AccountRow['powerAlerts']; lastVisit?: AccountRow['lastVisit']; emptyMine?: boolean; status?: number; networkOnce?: boolean; paginate?: boolean; classes?: boolean; appContacts?: AccountRow['appContacts']; duplicatePhone?: boolean } = {}) {
  const gets: string[] = [];
  const posts: Command[] = [];
  const territories = [...fixture.territories];
  await page.route('**/api/accounts**', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Command;
      posts.push(body);
      if (options.networkOnce && posts.length === 1) { await route.abort('failed'); return; }
      if (options.status) { await route.fulfill({ status: options.status, json: { error: 'Account changed' } }); return; }
      if (body.action === 'create_territory') territories.push({ id: '55555555-5555-4555-8555-555555555555', name: String(body.name) });
      await route.fulfill({ json: { ok: true, duplicatePhone: options.duplicatePhone ?? false } });
    } else {
      gets.push(route.request().url());
      const query = new URL(route.request().url()).searchParams;
      const classRows: AccountRow[] = (['A', 'B', 'below_b', 'not_available', 'not_linked'] as const).map((state, index) => ({ ...base, id: `class-${index}`, name: `Class ${state} Lab`, class: { ...base.class, state, monthlyPaise: index < 3 ? ['21000000', '7500000', '5000000'][index] : null } }));
      const accounts = options.classes ? classRows.filter(row => !query.get('class') || row.class.state === query.get('class')) : options.emptyMine && query.get('scope') === 'mine' ? [] : options.paginate ? [fixture.accounts[Number(query.get('page')) - 1]] : fixture.accounts;
      await route.fulfill({ json: { ...fixture, accounts: accounts.map(row => ({ ...row, appContacts: row.id === customerId ? options.appContacts ?? [] : [], ...(row.id === customerId && options.powerAlerts ? { powerAlerts: options.powerAlerts } : {}), ...(row.id === customerId && options.lastVisit ? { lastVisit: options.lastVisit } : {}) })), territories, canAssign: options.canAssign ?? false, canSeePowerMap: options.canSeePowerMap ?? false, page: { page: Number(query.get('page')), pageSize: options.paginate ? 1 : 50, total: options.paginate ? 3 : accounts.length } } });
    }
  });
  await page.goto('/?view=accounts');
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
  await expect(page.getByText('Loading accounts…')).toHaveCount(0);
  return { gets, posts };
}
const firstCard = (page: Page) => page.getByRole('list', { name: 'Accounts' }).getByRole('listitem').first();
const appContact: AccountRow['appContacts'][number] = { id: '66666666-6666-4666-8666-666666666666', name: 'App buyer', businessRole: 'Purchase', phone: '+91 98765 43210', email: 'buyer@example.test', addedBy: 'sales@example.test', version: 3, canEdit: true };
const powerContacts: AccountRow['appContacts'] = [
  { ...appContact, name: 'Asha', canEdit: false, lastMetOn: '2026-10-03', assessment: { decisionRole: 'decision_maker', stance: 'sceptical', influence: 'high', reason: 'Chose competitor', recordedAt: '2026-10-14', actor: 'manager@example.test' } },
  { ...appContact, id: '77777777-7777-4777-8777-777777777777', name: 'Ravi' },
];

test('management sees Power Map and saves a preset role assessment with a reload', async ({ page }) => {
  const { gets, posts } = await mockAccounts(page, { canSeePowerMap: true, powerAlerts: ['no_decision_maker', 'decision_maker_not_met', 'influential_blocker'], appContacts: powerContacts });
  const card = firstCard(page);
  for (const text of ['No decision maker known', 'Decision maker not met in 60 days', 'Influential blocker']) await expect(card.getByText(text, { exact: true })).toBeVisible();
  await expect(card.getByText('Decision maker · Sceptical · High influence · Last met 3 Oct', { exact: true })).toBeVisible();
  await expect(card.getByText('Role not set · Not met yet', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Set role for Asha', exact: true }).click();
  const form = card.getByRole('form', { name: 'Set role for Asha at Care Lab', exact: false });
  await expect(form.getByLabel('Decision role for Asha', { exact: false })).toHaveValue('decision_maker');
  await expect(form.getByLabel('Stance for Asha', { exact: false })).toHaveValue('sceptical');
  await expect(form.getByLabel('Influence for Asha', { exact: false })).toHaveValue('high');
  await expect(form.getByLabel('Reason for Asha', { exact: false })).toHaveValue('Chose competitor');
  await expect(form.getByLabel('Reason for Asha', { exact: false })).toHaveAttribute('maxlength', '300');
  await expect(form.locator('label select')).toHaveCount(0);
  await form.getByLabel('Decision role for Asha', { exact: false }).selectOption('influencer');
  await form.getByLabel('Stance for Asha', { exact: false }).selectOption('supporter');
  await form.getByLabel('Influence for Asha', { exact: false }).selectOption('medium');
  await form.getByLabel('Reason for Asha', { exact: false }).fill('Recommended our offer');
  const before = gets.length;
  await form.getByRole('button', { name: 'Save role for Asha', exact: false }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts[0]).toEqual({ action: 'set_assessment', contactId: appContact.id, decisionRole: 'influencer', stance: 'supporter', influence: 'medium', reason: 'Recommended our offer', idempotencyKey: expect.any(String) });
  await expect.poll(() => gets.length).toBeGreaterThan(before);
  await expect(form).toHaveCount(0);
});

test('sales response without Power Map contact keys hides all Power Map UI', async ({ page }) => {
  await mockAccounts(page, { appContacts: [appContact] });
  await expect(page.getByLabel('Power Map', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Set role for/ })).toHaveCount(0);
  for (const text of ['No decision maker known', 'Decision maker not met in 60 days', 'Influential blocker', 'Role not set · Not met yet']) await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  await expect(firstCard(page).getByText(/Last met|influence/)).toHaveCount(0);
});

test('visit contacts are available to sales and send two met ids with last visit names', async ({ page }) => {
  const appContacts = powerContacts.map(({ assessment, lastMetOn, ...contact }) => contact);
  const { posts } = await mockAccounts(page, { appContacts, lastVisit: { visitedOn: '2026-10-03', outcome: 'met', visitedBy: 'sales@example.test', note: null, metContacts: appContacts.map(({ id, name }) => ({ id, name })) } });
  await expect(firstCard(page).getByText(/Last visit 3 Oct · Met · with Asha, Ravi/)).toBeVisible();
  await firstCard(page).getByRole('button', { name: 'Log visit for Care Lab', exact: false }).click();
  const form = page.getByRole('form', { name: 'Log visit' });
  await expect(form.getByRole('group', { name: 'Who did you meet?', exact: true })).toBeVisible();
  await form.getByRole('checkbox', { name: 'Met Asha for Care Lab', exact: false }).check();
  await form.getByRole('checkbox', { name: 'Met Ravi for Care Lab', exact: false }).check();
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts[0]).toMatchObject({ action: 'log_visit', metContactIds: appContacts.map(contact => contact.id) });
});

test('visit hides the meeting fieldset without contacts', async ({ page }) => {
  await mockAccounts(page);
  await firstCard(page).getByRole('button', { name: 'Log visit for Care Lab', exact: false }).click();
  await expect(page.getByRole('group', { name: 'Who did you meet?', exact: true })).toHaveCount(0);
});

test('Power Map filter sends the alert query parameter', async ({ page }) => {
  const { gets } = await mockAccounts(page, { canSeePowerMap: true });
  await page.getByLabel('Power Map', { exact: true }).selectOption('no_decision_maker');
  await expect.poll(() => new URL(gets.at(-1)!).searchParams.get('alert')).toBe('no_decision_maker');
});

for (const failure of [502, 408, 429, 422, 'network'] as const) {
  test(`assessment retry handles ${failure} with the correct idempotency key`, async ({ page }) => {
    await mockAccounts(page, { canSeePowerMap: true, appContacts: powerContacts });
    const attempts: Command[] = [];
    await page.route('**/api/accounts', async route => {
      attempts.push(route.request().postDataJSON() as Command);
      if (attempts.length === 1 && failure === 'network') { await route.abort('failed'); return; }
      await route.fulfill(attempts.length === 1 ? { status: failure as number, json: { error: 'Try again' } } : { json: { ok: true } });
    });
    await firstCard(page).getByRole('button', { name: 'Set role for Asha', exact: true }).click();
    const save = firstCard(page).getByRole('button', { name: 'Save role for Asha', exact: false });
    await save.click();
    await expect(firstCard(page).getByRole('alert')).toHaveText(failure === 'network' ? 'Not saved. Check the connection and try again.' : 'Try again');
    await save.click();
    await expect(page.getByRole('status')).toHaveText('Saved.');
    expect(attempts).toHaveLength(2);
    if (failure === 422) expect(attempts[1].idempotencyKey).not.toEqual(attempts[0].idempotencyKey);
    else expect(attempts[1]).toEqual(attempts[0]);
  });
}

test('assessment conflict closes the form and refreshes; Cancel restores focus', async ({ page }) => {
  const { gets } = await mockAccounts(page, { canSeePowerMap: true, appContacts: powerContacts, status: 409 });
  const opener = firstCard(page).getByRole('button', { name: 'Set role for Asha', exact: true });
  await opener.click();
  await firstCard(page).getByRole('button', { name: 'Cancel role for Asha', exact: false }).click();
  await expect(opener).toBeFocused();
  await opener.click();
  const before = gets.length;
  await firstCard(page).getByRole('button', { name: 'Save role for Asha', exact: false }).click();
  await expect(page.getByRole('status')).toHaveText('Someone else changed this account. The list has been refreshed.');
  await expect.poll(() => gets.length).toBeGreaterThan(before);
  await expect(firstCard(page).getByRole('form')).toHaveCount(0);
});

test('phone layout has no horizontal overflow with Set role open', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'pricing-mobile', 'Phone layout');
  await mockAccounts(page, { canSeePowerMap: true, appContacts: powerContacts });
  await page.setViewportSize({ width: 375, height: 812 });
  await firstCard(page).getByRole('button', { name: 'Set role for Asha', exact: true }).click();
  await expect(firstCard(page).getByLabel('Decision role for Asha', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('adds an app contact with a flat command and duplicate-phone notice', async ({ page }) => {
  const { gets, posts } = await mockAccounts(page, { duplicatePhone: true });
  const addContact = firstCard(page).getByRole('button', { name: 'Add contact for Care Lab', exact: true });
  const actions = addContact.locator('..');
  await expect(actions.getByRole('button')).toHaveText(['Log visit', 'Location', 'Add contact']);
  expect(await addContact.getAttribute('class')).toEqual(await actions.getByRole('button', { name: 'Location for Care Lab', exact: false }).getAttribute('class'));
  await addContact.click();
  const form = page.getByRole('form', { name: 'Add contact for Care Lab', exact: false });
  await expect(form.getByLabel('Contact name for Care Lab', { exact: false })).toBeFocused();
  await form.getByLabel('Contact name for Care Lab', { exact: false }).fill('App buyer');
  await form.getByLabel('Contact role for Care Lab', { exact: false }).fill('Purchase');
  await form.getByLabel('Contact phone for Care Lab', { exact: false }).fill('+91 98765 43210');
  await form.getByLabel('Contact email for Care Lab', { exact: false }).fill('buyer@example.test');
  const before = gets.length;
  await form.getByRole('button', { name: 'Save contact for Care Lab', exact: false }).click();
  await expect(page.getByRole('status')).toHaveText('Saved. This phone is already on the account.');
  expect(posts[0]).toEqual({ action: 'add_contact', customerId, name: 'App buyer', businessRole: 'Purchase', phone: '+91 98765 43210', email: 'buyer@example.test', idempotencyKey: expect.any(String) });
  expect(String(posts[0].idempotencyKey).length).toBeGreaterThanOrEqual(16);
  await expect.poll(() => gets.length).toBeGreaterThan(before);
  await expect(form).toHaveCount(0);
});

test('edits an app contact using its current version', async ({ page }) => {
  const { posts } = await mockAccounts(page, { appContacts: [appContact] });
  const card = firstCard(page);
  await expect(card.getByText('App buyer · Purchase', { exact: true })).toBeVisible();
  await expect(card.getByText('added by sales@example.test', { exact: true })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Call App buyer for Care Lab', exact: false })).toHaveAttribute('href', 'tel:919876543210');
  await expect(card.getByRole('link', { name: 'Email App buyer for Care Lab', exact: false })).toHaveAttribute('href', 'mailto:buyer@example.test');
  const contactLine = card.getByText('App buyer · Purchase', { exact: true }).locator('..');
  await expect(contactLine.getByRole('link')).toHaveCount(2);
  await expect(contactLine.getByRole('button')).toHaveCount(0);
  await expect(contactLine).not.toContainText('added by');
  const attributionLine = card.getByText('added by sales@example.test', { exact: true }).locator('..');
  await expect(attributionLine.getByRole('button')).toHaveText(['Edit', 'Remove']);
  await card.getByRole('button', { name: 'Edit App buyer', exact: true }).click();
  const form = page.getByRole('form', { name: 'Edit App buyer for Care Lab', exact: false });
  await expect(form.getByLabel('Contact name for Care Lab', { exact: false })).toHaveValue('App buyer');
  await form.getByLabel('Contact role for Care Lab', { exact: false }).fill('Lab head');
  await form.getByRole('button', { name: 'Save contact for Care Lab', exact: false }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts[0]).toMatchObject({ action: 'update_contact', contactId: appContact.id, expectedVersion: 3, name: 'App buyer', businessRole: 'Lab head' });
});

test('remove uses an inline confirmation with Keep and the current version', async ({ page }) => {
  const { posts } = await mockAccounts(page, { appContacts: [appContact] });
  const card = firstCard(page);
  const remove = card.getByRole('button', { name: 'Remove App buyer', exact: true });
  await remove.click();
  await expect(card.getByText('Remove App buyer?', { exact: true })).toBeVisible();
  expect(posts).toHaveLength(0);
  await card.getByRole('button', { name: 'Keep App buyer for Care Lab', exact: false }).click();
  await expect(card.getByText('Remove App buyer?', { exact: true })).toHaveCount(0);
  await remove.click();
  await card.getByRole('button', { name: 'Confirm remove App buyer for Care Lab', exact: false }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts[0]).toMatchObject({ action: 'remove_contact', contactId: appContact.id, expectedVersion: 3, idempotencyKey: expect.any(String) });
});

test('app contacts without canEdit have no Edit or Remove controls', async ({ page }) => {
  await mockAccounts(page, { appContacts: [{ ...appContact, canEdit: false }] });
  const card = firstCard(page);
  await expect(card.getByText('App buyer · Purchase', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: /Edit App buyer|Remove App buyer/ })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Add contact for Care Lab', exact: false })).toBeVisible();
});

test('a contact conflict closes its form and refreshes accounts', async ({ page }) => {
  const { gets } = await mockAccounts(page, { appContacts: [appContact], status: 409 });
  await firstCard(page).getByRole('button', { name: 'Edit App buyer', exact: true }).click();
  const form = page.getByRole('form', { name: 'Edit App buyer for Care Lab', exact: false });
  const before = gets.length;
  await form.getByRole('button', { name: 'Save contact for Care Lab', exact: false }).click();
  await expect(page.getByRole('status')).toHaveText('Someone else changed this account. The list has been refreshed.');
  await expect.poll(() => gets.length).toBeGreaterThan(before);
  await expect(form).toHaveCount(0);
});

test('a contact network retry preserves its idempotency key', async ({ page }) => {
  const { posts } = await mockAccounts(page, { networkOnce: true });
  await firstCard(page).getByRole('button', { name: 'Add contact for Care Lab', exact: false }).click();
  const form = page.getByRole('form', { name: 'Add contact for Care Lab', exact: false });
  await form.getByLabel('Contact name for Care Lab', { exact: false }).fill('App buyer');
  await form.getByRole('button', { name: 'Save contact for Care Lab', exact: false }).click();
  await expect(firstCard(page).getByRole('alert')).toHaveText('Not saved. Check the connection and try again.');
  await form.getByRole('button', { name: 'Save contact for Care Lab', exact: false }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts[1]).toEqual(posts[0]);
});

for (const status of [502, 408, 429, 422]) {
  test(`contact retry ${status < 500 && status !== 408 && status !== 429 ? 'renews' : 'preserves'} the key after ${status}`, async ({ page }) => {
    await mockAccounts(page);
    const attempts: Command[] = [];
    await page.route('**/api/accounts', async route => {
      attempts.push(route.request().postDataJSON() as Command);
      await route.fulfill(attempts.length === 1 ? { status, json: { error: 'Try again' } } : { json: { ok: true } });
    });
    await firstCard(page).getByRole('button', { name: 'Add contact for Care Lab', exact: false }).click();
    const form = page.getByRole('form', { name: 'Add contact for Care Lab', exact: false });
    await form.getByLabel('Contact name for Care Lab', { exact: false }).fill('App buyer');
    await form.getByRole('button', { name: 'Save contact for Care Lab', exact: false }).click();
    await expect(firstCard(page).getByRole('alert')).toHaveText('Try again');
    await form.getByRole('button', { name: 'Save contact for Care Lab', exact: false }).click();
    await expect(page.getByRole('status')).toHaveText('Saved.');
    expect(attempts).toHaveLength(2);
    if (status === 422) expect(attempts[1].idempotencyKey).not.toEqual(attempts[0].idempotencyKey);
    else expect(attempts[1]).toEqual(attempts[0]);
  });
}

test("3 app contacts show 2 + '+1 more'", async ({ page }) => {
  await mockAccounts(page, { appContacts: [
    { ...appContact, id: 'asha', name: 'Asha', businessRole: null },
    { ...appContact, id: 'ravi', name: 'Ravi', businessRole: null, phone: '9876543211' },
    { ...appContact, id: 'meena', name: 'Meena', businessRole: null, email: 'meena@example.test' },
  ] });
  const card = firstCard(page);
  await expect(card.getByText('Asha', { exact: true })).toBeVisible();
  await expect(card.getByText('Ravi', { exact: true })).toBeVisible();
  await expect(card.getByText('Meena', { exact: true })).toHaveCount(0);
  await expect(card.getByRole('link', { name: 'Call Asha for Care Lab', exact: false })).toHaveAttribute('href', 'tel:919876543210');
  const toggle = card.getByRole('button', { name: '1 more contacts for Care Lab', exact: true });
  await expect(toggle).toHaveText('+1 more');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const controls = await toggle.getAttribute('aria-controls');
  await toggle.click();
  await expect(card.getByText('Ravi', { exact: true })).toBeVisible();
  await expect(card.getByText('Meena', { exact: true })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Call Ravi for Care Lab', exact: false })).toHaveAttribute('href', 'tel:9876543211');
  await expect(card.getByRole('link', { name: 'Email Meena for Care Lab', exact: false })).toHaveAttribute('href', 'mailto:meena@example.test');
  const expanded = card.locator(`[id="${controls}"]`);
  await expect(expanded).toContainText('Meena');
  const hide = card.getByRole('button', { name: 'Hide contacts for Care Lab', exact: false });
  await expect(hide).toHaveText('Hide');
  await expect(hide).toHaveAttribute('aria-expanded', 'true');
  await hide.click();
  await expect(card.getByText('Ravi', { exact: true })).toBeVisible();
  await expect(card.getByText('Meena', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Accounts' }).getByRole('listitem').nth(1).getByText('No contacts yet', { exact: true })).toBeVisible();
});

test('all class states render and the Class filter applies in Mine and All', async ({ page }) => {
  const { gets } = await mockAccounts(page, { classes: true });
  const cards = page.getByRole('list', { name: 'Accounts' });
  await expect(cards.getByText('A', { exact: true })).toHaveAttribute('title', 'A · ₹2.1 L a month, Jul–Sep');
  await expect(cards.getByText('B', { exact: true })).toHaveAttribute('title', 'B · ₹75 K a month, Jul–Sep');
  await expect(cards.getByText('Below B', { exact: true })).toBeVisible();
  await expect(cards.getByText('Class not available yet', { exact: true })).toHaveCount(0);
  const unlinkedCard = cards.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Class not_linked Lab', exact: true }) });
  await expect(unlinkedCard.locator('p').first()).toHaveText('Pune · West · Not linked to Tally sales');
  const note = page.getByText('Account classes appear once full Tally sales for Jul–Sep are imported.', { exact: true });
  await expect(note).toHaveCount(1);
  await expect(note).toBeVisible();
  await page.getByLabel('Class', { exact: true }).selectOption('A');
  await expect.poll(() => new URL(gets.at(-1)!).searchParams.get('class')).toBe('A');
  await expect(cards.getByRole('listitem')).toHaveCount(1);
  await expect(note).toHaveCount(0);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByLabel('Class', { exact: true })).toHaveValue('A');
  await expect.poll(() => new URL(gets.at(-1)!).searchParams.get('scope')).toBe('all');
  expect(new URL(gets.at(-1)!).searchParams.get('class')).toBe('A');
  await page.getByLabel('Class', { exact: true }).selectOption('not_available');
  await expect.poll(() => new URL(gets.at(-1)!).searchParams.get('class')).toBe('not_available');
  await expect(cards.getByRole('heading')).toHaveText(['Class not_available Lab']);
  await expect(note).toHaveCount(1);
  await expect(cards.getByText('Class not available yet', { exact: true })).toHaveCount(0);
});

// The pricing browser configuration runs this suite on pricing-desktop and pricing-mobile.
test('server order and overdue, next and never chips', async ({ page }) => {
  const { gets } = await mockAccounts(page);
  await expect(page.getByRole('list', { name: 'Accounts' }).getByRole('heading')).toHaveText(['Care Lab', 'City Lab', 'New Lab']);
  await expect(page.getByText('Visit overdue · due 3 Oct', { exact: true })).toBeVisible();
  await expect(page.getByText('Next visit 21 Oct', { exact: true })).toBeVisible();
  await expect(page.getByText('Never visited', { exact: true })).toBeVisible();
  await expect(page.getByText('3 accounts · 1 visit due')).toBeVisible();
  expect(new URL(gets[0]).search).toBe('?scope=mine&page=1');
});
test('Mine empty switches to All', async ({ page }) => {
  const { gets } = await mockAccounts(page, { emptyMine: true });
  await expect(page.getByText('No accounts are assigned to you yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Show all accounts', exact: true }).click();
  await expect.poll(() => new URL(gets.at(-1)!).searchParams.get('scope')).toBe('all');
  await expect(firstCard(page)).toContainText('Care Lab');
});
test('log visit quick date posts the flat body and reloads', async ({ page }) => {
  const { gets, posts } = await mockAccounts(page);
  await firstCard(page).getByRole('button', { name: 'Log visit for Care Lab', exact: false }).click();
  const form = page.getByRole('form', { name: 'Log visit' });
  await expect(form.getByLabel('Date', { exact: true })).toBeFocused();
  await expect(form.getByLabel('Date', { exact: true })).toHaveAttribute('min', '2026-09-14');
  await expect(form.getByLabel('Date', { exact: true })).toHaveAttribute('max', '2026-10-14');
  await form.getByLabel('Date', { exact: true }).fill('2026-10-10');
  await form.getByLabel('Note', { exact: true }).fill('Met the buyer');
  await form.getByRole('button', { name: '+7 days', exact: true }).click();
  await expect(form.getByLabel('Next visit', { exact: true })).toHaveValue('2026-10-17');
  const before = gets.length;
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts[0]).toEqual({ action: 'log_visit', customerId, visitedOn: '2026-10-10', outcome: 'met', note: 'Met the buyer', nextVisitOn: '2026-10-17', idempotencyKey: expect.any(String) });
  await expect.poll(() => gets.length).toBeGreaterThan(before);
  await expect(form).toHaveCount(0);
});
test('location parses a map link and blocks invalid input', async ({ page }) => {
  const { posts } = await mockAccounts(page);
  await firstCard(page).getByRole('button', { name: 'Location for Care Lab', exact: false }).click();
  const form = page.getByRole('form', { name: 'Account location' });
  await form.getByLabel('Google Maps link or lat, long').fill('not a location');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('Paste a Google Maps link or two numbers like 18.52, 73.85');
  expect(posts).toHaveLength(0);
  await form.getByLabel('Google Maps link or lat, long').fill('https://www.google.com/maps/@18.52,73.85,15z');
  await expect(form.getByText('18.52, 73.85', { exact: true })).toBeVisible();
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts[0]).toMatchObject({ action: 'set_location', customerId, expectedVersion: null, precision: 'pin', latitude: '18.52', longitude: '73.85', source: 'pasted_link' });
});
test('location warns outside the market area without blocking Save and clears inside', async ({ page }) => {
  const { posts } = await mockAccounts(page);
  await firstCard(page).getByRole('button', { name: 'Location for Care Lab', exact: false }).click();
  const form = page.getByRole('form', { name: 'Account location' });
  const input = form.getByLabel('Google Maps link or lat, long');
  const warning = form.getByText('This pin is outside the five-district market area (Kalaburagi, Bidar, Raichur, Yadgir, Bijapur). Check the link before saving.', { exact: true });
  await input.fill('18.52, 73.85');
  await expect(form.getByText('18.52, 73.85', { exact: true })).toBeVisible();
  await expect(warning).toBeVisible();
  await expect(warning).not.toHaveAttribute('role', 'alert');
  await expect(form.getByRole('alert')).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await input.fill('17.33, 76.83');
  await expect(form.getByText('17.33, 76.83', { exact: true })).toBeVisible();
  await expect(warning).toHaveCount(0);
  await input.fill('18.52, 73.85');
  await expect(warning).toBeVisible();
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ action: 'set_location', customerId, expectedVersion: null, precision: 'pin', latitude: '18.52', longitude: '73.85', source: 'manual_pin' });
});
test('assignment controls respect canAssign', async ({ page }) => {
  await mockAccounts(page);
  await expect(page.getByRole('button', { name: 'Owner for Care Lab', exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByLabel('Owner', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Territory', { exact: true })).toHaveCount(0);
});
test('All filters and owner form use assignment choices and version', async ({ page }) => {
  const { gets, posts } = await mockAccounts(page, { canAssign: true });
  await expect(page.getByLabel('Owner', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByLabel('Owner', { exact: true }).selectOption('other@example.test');
  await page.getByLabel('Territory', { exact: true }).selectOption(territoryId);
  await expect.poll(() => new URL(gets.at(-1)!).searchParams.get('territory')).toBe(territoryId);
  expect(new URL(gets.at(-1)!).searchParams.get('owner')).toBe('other@example.test');
  await firstCard(page).getByRole('button', { name: 'Owner for Care Lab', exact: false }).click();
  const form = page.getByRole('form', { name: 'Account owner' });
  await form.getByLabel('Owner', { exact: true }).selectOption('other@example.test');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts[0]).toMatchObject({ action: 'assign_account', customerId, ownerEmail: 'other@example.test', territoryId, expectedVersion: 3 });
});
test('409 refreshes the list with a clear notice', async ({ page }) => {
  const { gets } = await mockAccounts(page, { status: 409 });
  await firstCard(page).getByRole('button', { name: 'Log visit for Care Lab', exact: false }).click();
  const before = gets.length;
  await page.getByRole('form', { name: 'Log visit' }).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Someone else changed this account. The list has been refreshed.');
  await expect.poll(() => gets.length).toBeGreaterThan(before);
});
test('network retry keeps the same idempotency key and Cancel restores focus', async ({ page }) => {
  const { posts } = await mockAccounts(page, { networkOnce: true });
  const opener = firstCard(page).getByRole('button', { name: 'Log visit for Care Lab', exact: false });
  await opener.click();
  const form = page.getByRole('form', { name: 'Log visit' });
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('Not saved. Check the connection and try again.');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts[1]).toEqual(posts[0]);
  await opener.click();
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(opener).toBeFocused();
});

test('gateway timeout retry preserves the command key when the first write may have committed', async ({ page }) => {
  const { posts } = await mockAccounts(page);
  const attempts: Command[] = [];
  await page.route('**/api/accounts', async route => {
    const body = route.request().postDataJSON() as Command;
    attempts.push(body);
    if (attempts.length === 1) {
      await route.fulfill({ status: 502, json: { error: 'Accounts are temporarily unavailable' } });
    } else await route.fulfill({ json: { ok: true } });
  });
  await firstCard(page).getByRole('button', { name: 'Log visit for Care Lab', exact: false }).click();
  const form = page.getByRole('form', { name: 'Log visit' });
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('Accounts are temporarily unavailable');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(posts).toHaveLength(0);
});
test('new territory reloads choices and selects the new territory', async ({ page }) => {
  const { posts } = await mockAccounts(page, { canAssign: true });
  await firstCard(page).getByRole('button', { name: 'Owner for Care Lab', exact: false }).click();
  const form = page.getByRole('form', { name: 'Account owner' });
  await form.getByLabel('New territory', { exact: true }).fill('North');
  await form.getByRole('button', { name: 'New territory', exact: true }).click();
  await expect(form.getByLabel('Territory', { exact: true })).toHaveValue('55555555-5555-4555-8555-555555555555');
  expect(posts[0]).toMatchObject({ action: 'create_territory', name: 'North' });
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts[1]).toMatchObject({ action: 'assign_account', territoryId: '55555555-5555-4555-8555-555555555555' });
});
test('search debounces and pagination returns the server page', async ({ page }) => {
  const { gets } = await mockAccounts(page, { paginate: true });
  await expect(page.getByText('Showing 1–1 of 3')).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Showing 2–2 of 3')).toBeVisible();
  await page.getByLabel('Search accounts').fill('Pune');
  await expect.poll(() => new URL(gets.at(-1)!).searchParams.get('search')).toBe('Pune');
  expect(new URL(gets.at(-1)!).searchParams.get('page')).toBe('1');
});
test('phone layout has no horizontal overflow including open forms', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'pricing-mobile', 'Phone layout');
  await mockAccounts(page, { canAssign: true, appContacts: [appContact] });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(firstCard(page).getByRole('button', { name: 'Add contact for Care Lab', exact: true }).locator('..').getByRole('button')).toHaveText(['Log visit', 'Location', 'Add contact', 'Owner']);
  await firstCard(page).getByRole('button', { name: 'Remove App buyer', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await firstCard(page).getByRole('button', { name: 'Keep App buyer for Care Lab', exact: false }).click();
  for (const action of ['Log visit', 'Location', 'Owner']) {
    await firstCard(page).getByRole('button', { name: `${action} for Care Lab`, exact: false }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  await firstCard(page).getByRole('button', { name: 'Add contact for Care Lab', exact: false }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
