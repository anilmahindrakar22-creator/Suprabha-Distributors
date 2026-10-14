import { expect, test, type Page } from '@playwright/test';
import type { AccountRow, AccountsResponse } from '../../lib/account-types';

const customerId = '11111111-1111-4111-8111-111111111111';
const territoryId = '22222222-2222-4222-8222-222222222222';
const base: AccountRow = { id: customerId, name: 'Care Lab', city: 'Pune', owner: { email: 'sales@example.test', territoryId, territoryName: 'West', since: '2026-10-01', version: 3 }, location: null, lastVisit: null, nextVisitOn: '2026-10-03', lastOrderOn: null, class: { state: 'not_available', monthlyPaise: null, window: { from: '2026-07-01', to: '2026-09-30' } } };
const fixture: AccountsResponse = {
  accounts: [base, { ...base, id: '33333333-3333-4333-8333-333333333333', name: 'City Lab', nextVisitOn: '2026-10-21' }, { ...base, id: '44444444-4444-4444-8444-444444444444', name: 'New Lab', nextVisitOn: null }],
  page: { page: 1, pageSize: 50, total: 3 }, owners: [{ email: 'sales@example.test', name: 'Salesperson' }, { email: 'other@example.test', name: 'Other salesperson' }],
  territories: [{ id: territoryId, name: 'West' }], canAssign: false, actorEmail: 'sales@example.test', today: '2026-10-14',
  classPolicy: { aMinPaise: '20000000', bMinPaise: '7500000' },
};
type Command = Record<string, unknown>;
async function mockAccounts(page: Page, options: { canAssign?: boolean; emptyMine?: boolean; status?: number; networkOnce?: boolean; paginate?: boolean; classes?: boolean } = {}) {
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
      await route.fulfill({ json: { ok: true } });
    } else {
      gets.push(route.request().url());
      const query = new URL(route.request().url()).searchParams;
      const classRows: AccountRow[] = (['A', 'B', 'below_b', 'not_available', 'not_linked'] as const).map((state, index) => ({ ...base, id: `class-${index}`, name: `Class ${state} Lab`, class: { ...base.class, state, monthlyPaise: index < 3 ? ['21000000', '7500000', '5000000'][index] : null } }));
      const accounts = options.classes ? classRows.filter(row => !query.get('class') || row.class.state === query.get('class')) : options.emptyMine && query.get('scope') === 'mine' ? [] : options.paginate ? [fixture.accounts[Number(query.get('page')) - 1]] : fixture.accounts;
      await route.fulfill({ json: { ...fixture, accounts, territories, canAssign: options.canAssign ?? false, page: { page: Number(query.get('page')), pageSize: options.paginate ? 1 : 50, total: options.paginate ? 3 : accounts.length } } });
    }
  });
  await page.goto('/?view=accounts');
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
  await expect(page.getByText('Loading accounts…')).toHaveCount(0);
  return { gets, posts };
}
const firstCard = (page: Page) => page.getByRole('list', { name: 'Accounts' }).getByRole('listitem').first();

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
  await firstCard(page).getByRole('button', { name: 'Log visit', exact: true }).click();
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
  await firstCard(page).getByRole('button', { name: 'Location', exact: true }).click();
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
test('assignment controls respect canAssign', async ({ page }) => {
  await mockAccounts(page);
  await expect(page.getByRole('button', { name: 'Owner', exact: true })).toHaveCount(0);
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
  await firstCard(page).getByRole('button', { name: 'Owner', exact: true }).click();
  const form = page.getByRole('form', { name: 'Account owner' });
  await form.getByLabel('Owner', { exact: true }).selectOption('other@example.test');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts[0]).toMatchObject({ action: 'assign_account', customerId, ownerEmail: 'other@example.test', territoryId, expectedVersion: 3 });
});
test('409 refreshes the list with a clear notice', async ({ page }) => {
  const { gets } = await mockAccounts(page, { status: 409 });
  await firstCard(page).getByRole('button', { name: 'Log visit', exact: true }).click();
  const before = gets.length;
  await page.getByRole('form', { name: 'Log visit' }).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Someone else changed this account. The list has been refreshed.');
  await expect.poll(() => gets.length).toBeGreaterThan(before);
});
test('network retry keeps the same idempotency key and Cancel restores focus', async ({ page }) => {
  const { posts } = await mockAccounts(page, { networkOnce: true });
  const opener = firstCard(page).getByRole('button', { name: 'Log visit', exact: true });
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
  await firstCard(page).getByRole('button', { name: 'Log visit', exact: true }).click();
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
  await firstCard(page).getByRole('button', { name: 'Owner', exact: true }).click();
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
  await mockAccounts(page, { canAssign: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: 'All', exact: true }).click();
  for (const action of ['Log visit', 'Location', 'Owner']) {
    await firstCard(page).getByRole('button', { name: action, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});
