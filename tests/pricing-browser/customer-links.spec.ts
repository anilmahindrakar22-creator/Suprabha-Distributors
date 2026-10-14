import { expect, test, type Page } from '@playwright/test';
import type { AccountsResponse } from '../../lib/account-types';
import type { CustomerLinkRow } from '../../lib/customer-link-types';

const rows: CustomerLinkRow[] = [
  { customerId: '11111111-1111-4111-8111-111111111111', customerName: 'Care Lab', city: 'Pune', ledgerName: 'Care ledger', guid: 'ledger-12345678', state: 'suggested' },
  { customerId: '22222222-2222-4222-8222-222222222222', customerName: 'City Lab', city: null, ledgerName: 'City ledger', guid: 'ledger-87654321', state: 'suggested' },
  { customerId: '33333333-3333-4333-8333-333333333333', customerName: 'Linked Lab', city: null, ledgerName: 'Linked ledger', guid: 'ledger-linked', state: 'linked' },
  { customerId: '44444444-4444-4444-8444-444444444444', customerName: 'Conflict Lab', city: null, ledgerName: 'Conflict ledger', guid: 'ledger-conflict', state: 'conflict', linkedTo: { customerId: 'other', name: 'Other Lab' } },
  { customerId: '55555555-5555-4555-8555-555555555555', customerName: 'Other ledger Lab', city: null, ledgerName: 'Other ledger', guid: 'ledger-other', state: 'conflict', linkedTo: { guid: 'other-abcdefgh' } },
];
async function mockLinks(page: Page, options: { canAssign?: boolean; waiting?: boolean; conflict?: boolean; retryStatus?: number | 'network'; companies?: boolean } = {}) {
  const gets: string[] = [];
  const posts: Record<string, unknown>[] = [];
  let currentRows = rows.map(row => ({ ...row }));
  await page.route('**/api/accounts**', async route => {
    const body: AccountsResponse = { accounts: [], page: { page: 1, pageSize: 50, total: 0 }, owners: [], territories: [], canAssign: options.canAssign ?? true, canEraseContacts: false, canSeePowerMap: false, actorEmail: 'manager@example.test', today: '2026-10-15', classPolicy: { aMinPaise: '20000000', bMinPaise: '7500000' } };
    await route.fulfill({ json: body });
  });
  await page.route('**/api/customer-links**', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      posts.push(body);
      if (options.retryStatus && posts.length === 1) {
        if (options.retryStatus === 'network') await route.abort('failed');
        else await route.fulfill({ status: options.retryStatus, json: { error: 'Try again' } });
        return;
      }
      if (options.conflict) {
        currentRows[0].state = 'linked';
        await route.fulfill({ status: 409, json: { code: 'PT409', error: 'Care Lab changed. Reload and review.' } });
      } else {
        currentRows = currentRows.map(row => row.state === 'suggested' ? { ...row, state: 'linked' } : row);
        await route.fulfill({ json: { ok: true, confirmed: 2, customerIds: rows.slice(0, 2).map(row => row.customerId) } });
      }
      return;
    }
    gets.push(route.request().url());
    const query = new URL(route.request().url()).searchParams;
    if (options.waiting) { await route.fulfill({ json: { waiting: true, companyId: null, sourceVersion: null, rows: [] } }); return; }
    if (options.companies && !query.get('companyId')) { await route.fulfill({ json: { companies: ['Company A', 'Company B'] } }); return; }
    const shown = currentRows.filter(row => row.state === query.get('state') && `${row.customerName} ${row.ledgerName}`.toLowerCase().includes((query.get('search') ?? '').toLowerCase()));
    await route.fulfill({ json: { companyId: query.get('companyId') ?? 'Company A', sourceVersion: 'export-v1', observedAt: '2026-10-15T06:30:00Z', rows: shown, page: { page: Number(query.get('page')), pageSize: 25, total: shown.length } } });
  });
  await page.goto('/?view=accounts');
  await expect(page.getByText('Loading accounts…')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
  return { gets, posts };
}
async function openLinks(page: Page) {
  await page.getByRole('button', { name: 'Link to Tally', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Link customers to Tally' })).toBeVisible();
  await expect(page.getByText('Loading customer links…')).toHaveCount(0);
}
test('management can open links and return; sales has no entry', async ({ page }) => {
  await mockLinks(page);
  await openLinks(page);
  await expect(page.getByLabel('Search accounts', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to accounts', exact: true }).click();
  await expect(page.getByLabel('Search accounts', { exact: true })).toBeVisible();
  await mockLinks(page, { canAssign: false });
  await expect(page.getByRole('button', { name: 'Link to Tally', exact: true })).toHaveCount(0);
});
test('only suggested rows have unselected checkboxes; conflicts explain the link', async ({ page }) => {
  await mockLinks(page); await openLinks(page);
  const list = page.getByRole('list', { name: 'Customer links' });
  await expect(list.getByRole('checkbox')).toHaveCount(2);
  await expect(list.getByRole('checkbox', { name: /^Select Care Lab/ })).not.toBeChecked();
  await expect(list.getByRole('checkbox', { name: /^Select City Lab/ })).not.toBeChecked();
  await expect(page.getByText('Tally ledger list from 15 Oct 2026, 12:00 pm, IST · Company A')).toBeVisible();
  await page.getByRole('button', { name: 'Linked', exact: true }).click();
  await expect(list).toContainText('Linked Lab'); await expect(list.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Conflicts', exact: true }).click();
  await expect(list).toContainText('Linked to Other Lab');
  await expect(list).toContainText('Linked to another ledger (…abcdefgh)');
  await expect(list.getByRole('checkbox')).toHaveCount(0);
});
test('select all confirms exactly the visible rows with reason and generation', async ({ page }) => {
  const { gets, posts } = await mockLinks(page); await openLinks(page);
  await page.getByLabel('Select all on this page', { exact: true }).check();
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  const confirm = page.getByRole('button', { name: 'Confirm 2 links' });
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Reason', { exact: true }).fill('ab'); await expect(confirm).toBeDisabled();
  await page.getByLabel('Reason', { exact: true }).fill('Checked against Tally ledger list');
  const before = gets.length;
  await confirm.click();
  await expect(page.getByRole('status')).toHaveText('2 linked');
  await expect.poll(() => gets.length).toBeGreaterThan(before);
  expect(posts).toEqual([{ action: 'confirm_customer_links', companyId: 'Company A', sourceVersion: 'export-v1', rows: rows.slice(0, 2).map(row => ({ customerId: row.customerId, ledgerGuid: row.guid })), reason: 'Checked against Tally ledger list', idempotencyKey: expect.any(String) }]);
  await expect(page.getByLabel('Reason', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Customer links' }).getByRole('listitem')).toHaveCount(0);
});
test('409 displays a danger notice and reload removes the changed selection', async ({ page }) => {
  const { gets } = await mockLinks(page, { conflict: true }); await openLinks(page);
  await page.getByLabel('Select all on this page', { exact: true }).check();
  await page.getByLabel('Reason', { exact: true }).fill('Checked');
  const before = gets.length;
  await page.getByRole('button', { name: 'Confirm 2 links' }).click();
  await expect(page.getByRole('alert')).toHaveText('Care Lab changed. Reload and review.');
  await expect(page.getByRole('alert')).toHaveClass(/bg-sf-danger-soft/);
  await expect.poll(() => gets.length).toBeGreaterThan(before);
  await expect(page.getByText('1 rows changed and were removed from your selection')).toBeVisible();
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /^Select City Lab/ })).toBeChecked();
});
test('waiting shows the info notice without rows or controls', async ({ page }) => {
  await mockLinks(page, { waiting: true }); await openLinks(page);
  await expect(page.getByRole('status')).toHaveText('Waiting for the Tally ledger list. Nothing to confirm yet.');
  await expect(page.getByRole('status')).toHaveClass(/bg-sf-info-soft/);
  await expect(page.getByRole('list', { name: 'Customer links' })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByLabel('Search customer or ledger')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Suggested', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
});
test('phone selection bar reserves its height and leaves the last row accessible', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'pricing-mobile', 'Phone layout');
  await page.setViewportSize({ width: 375, height: 812 });
  await mockLinks(page); await openLinks(page);
  await page.getByLabel('Select all on this page', { exact: true }).check();
  const bar = page.getByRole('form', { name: 'Confirm customer links' });
  const list = page.getByRole('list', { name: 'Customer links' });
  await expect(bar).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const last = list.getByRole('listitem').last();
  // At the bottom of the page the sticky bar sits after the list, so the last row is fully above it.
  await page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>('*')) if (element.scrollHeight > element.clientHeight) element.scrollTop = element.scrollHeight;
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  const lastBox = await last.boundingBox(); const barBox = await bar.boundingBox();
  expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(barBox!.y);
});
for (const status of [502, 408, 429, 'network', 422] as const) {
  test(`retry after ${status} uses the appropriate idempotency key`, async ({ page }) => {
    const { posts } = await mockLinks(page, { retryStatus: status }); await openLinks(page);
    await page.getByLabel('Select all on this page', { exact: true }).check();
    await page.getByLabel('Reason', { exact: true }).fill('Checked');
    await page.getByRole('button', { name: 'Confirm 2 links' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm 2 links' }).click();
    await expect(page.getByRole('status')).toHaveText('2 linked');
    expect(posts).toHaveLength(2);
    if (status === 422) expect(posts[1].idempotencyKey).not.toEqual(posts[0].idempotencyKey);
    else expect(posts[1]).toEqual(posts[0]);
  });
}
test('company choice scopes the reload and search is debounced', async ({ page }) => {
  const { gets } = await mockLinks(page, { companies: true }); await openLinks(page);
  await page.getByLabel('Company', { exact: true }).selectOption('Company B');
  await expect(page.getByRole('list', { name: 'Customer links' }).getByRole('listitem')).toHaveCount(2);
  expect(new URL(gets.at(-1)!).searchParams.get('companyId')).toBe('Company B');
  await page.getByLabel('Search customer or ledger').fill('City');
  await expect.poll(() => new URL(gets.at(-1)!).searchParams.get('search')).toBe('City');
  await expect(page.getByRole('list', { name: 'Customer links' }).getByRole('listitem')).toHaveCount(1);
});
