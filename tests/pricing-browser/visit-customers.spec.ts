import { expect, test, type Page } from '@playwright/test';

const customerId = '66111111-1111-4111-8111-111111111111';
async function fixture(page: Page, failure?: 'network' | 'malformed' | 'conflict') {
  const posts: Record<string, unknown>[] = [];
  let created = false;
  await page.route('**/api/accounts**', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); posts.push(body);
      if (body.action === 'create_customer') {
        if (posts.length === 1 && failure) {
          if (failure === 'network') await route.abort('failed');
          else if (failure === 'malformed') await route.fulfill({ json: { ok: true } });
          else await route.fulfill({ status: 409, json: { error: 'A customer with this name already exists. Search accounts first.' } });
          return;
        }
        created = true;
        await route.fulfill({ json: { ok: true, customerId, name: body.name, tallyLedgerState: 'no_ledger' } });
      } else await route.fulfill({ json: { ok: true, customerId, visitId: '88222222-2222-4222-8222-222222222222' } });
      return;
    }
    const query = new URL(route.request().url()).searchParams;
    const accounts = created && query.get('scope') === 'all' ? [{ id: customerId, name: 'New visit lab', city: 'Bidar', tallyLedgerState: 'no_ledger', appContacts: [], owner: null, location: null, lastVisit: null, nextVisitOn: null, lastOrderOn: null, class: { state: 'not_linked', monthlyPaise: null, window: { from: '2026-07-01', to: '2026-09-30' } } }] : [];
    await route.fulfill({ json: { accounts, page: { page: 1, pageSize: 50, total: accounts.length }, owners: [], territories: [], canAssign: false, canEraseContacts: false, canSeePowerMap: false, actorEmail: 'sales@example.test', today: '2026-10-15', classPolicy: { aMinPaise: '20000000', bMinPaise: '7500000' } } });
  });
  await page.goto('/?view=accounts');
  await page.getByRole('button', { name: 'Add customer', exact: true }).click();
  const form = page.getByRole('form', { name: 'Add customer for visits' });
  await expect(form.getByLabel('Customer name')).toBeFocused();
  await form.getByLabel('Customer name').fill('New visit lab');
  await form.getByLabel('Town (optional)').fill('Bidar');
  return { posts, form };
}
test('Sales adds a customer without a ledger and logs the visit on the same record', async ({ page }) => {
  const { posts, form } = await fixture(page);
  await expect(form.getByText(/No Tally ledger needed/)).toBeVisible();
  await expect(form.locator('input')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Link to Tally', exact: true })).toHaveCount(0);
  await form.getByRole('button', { name: 'Save customer', exact: true }).click();
  await expect(page.getByText('Not yet linked to Tally · visits available')).toBeVisible();
  await expect(page.getByText('Customer saved. Log the visit below.')).toBeVisible();
  await page.getByRole('form', { name: 'Log visit', exact: true }).getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[0]).toMatchObject({ action: 'create_customer', name: 'New visit lab', city: 'Bidar', phone: null });
  expect(posts[0]).not.toHaveProperty('tallyKey');
  expect(posts[1]).toMatchObject({ action: 'log_visit', customerId });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
for (const failure of ['network', 'malformed'] as const) test(`${failure} save retains the original command and locks edits until retry`, async ({ page }) => {
  const { posts, form } = await fixture(page, failure);
  await form.getByRole('button', { name: 'Save customer', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText(/result could not be confirmed/);
  await expect(form.getByLabel('Customer name')).toBeDisabled();
  await expect(form.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await form.getByRole('button', { name: 'Retry same save' }).click();
  await expect(page.getByText('Customer saved. Log the visit below.')).toBeVisible();
  expect(posts[1]).toEqual(posts[0]);
});
test('duplicate rejection keeps the form editable and never pretends to save', async ({ page }) => {
  const { posts, form } = await fixture(page, 'conflict');
  await form.getByRole('button', { name: 'Save customer', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText(/already exists/);
  await expect(form.getByLabel('Customer name')).toBeEnabled();
  await expect(form.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add customer', exact: true })).toBeFocused();
  expect(posts).toHaveLength(1);
});
