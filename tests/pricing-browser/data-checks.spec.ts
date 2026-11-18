import { expect, test, type Page } from '@playwright/test';
import type { AccountsResponse } from '../../lib/account-types';

const fixture: AccountsResponse = {
  accounts: [], page: { page: 1, pageSize: 50, total: 0 },
  owners: [], territories: [], canAssign: true, canEraseContacts: false, canSeePowerMap: false,
  actorEmail: 'manager@example.test', today: '2026-11-18',
  classPolicy: { aMinPaise: '20000000', bMinPaise: '7500000' },
};
const checks = {
  view: 'data_checks', asOf: '2026-11-18',
  unlinkedLedgers: { count: 7, ofBuying: 100, top: Array.from({ length: 7 }, (_, i) => ({ name: `Test ledger ${i + 1}`, lastSaleOn: '2026-11-17' })) },
  noPinCode: { count: 20, ofBuying: 93, top: Array.from({ length: 20 }, (_, i) => ({
    customerId: `11111111-1111-4111-8111-${String(i + 1).padStart(12, '0')}`, name: `Test customer ${i + 1}`, town: 'Test town',
  })) },
  itemsNotInStockFlow: { count: 0, ofSold: 42 },
  freshness: { salesThrough: '2026-11-17', itemListReadAt: '2026-11-18T04:30:00Z' },
};
async function setup(page: Page, status = 200) {
  await page.route('**/api/power-map**', route => route.fulfill({ json: { contacts: [], links: [], route: null } }));
  await page.route('**/api/accounts**', route => route.fulfill({ json: fixture }));
  await page.route('**/api/data-checks', route => route.fulfill({ status, json: status === 200 ? checks : { error: 'Restricted' } }));
  await page.route('**/api/customer-links**', route => route.fulfill({ json: { companyId: null, sourceVersion: null, rows: [], waiting: true } }));
  const checked = page.waitForResponse(response => new URL(response.url()).pathname === '/api/data-checks');
  await page.goto('/?view=accounts');
  await (await checked).finished();
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
}
test('data checks explain gaps, expand customer names and open Tally links', async ({ page }) => {
  await setup(page);
  const summary = page.locator('summary').filter({ hasText: 'Data checks' });
  await expect(summary).toHaveText('Data checks · 2 to fix');
  const card = summary.locator('..');
  await expect(card).not.toHaveAttribute('open', '');
  await summary.click();
  await expect(card.getByText("7 of 100 Tally ledgers that bought in the last 90 days aren't linked to a customer. Their sales are missing from Growth, the map and Pricing checks.", { exact: true })).toBeVisible();
  await expect(card.getByText('Test ledger 1', { exact: false })).toBeVisible();
  await expect(card.getByText('Test customer 1 · Test town', { exact: true })).not.toBeVisible();
  await card.locator('summary').filter({ hasText: 'Show customers (20)' }).click();
  await expect(card.getByText('Test customer 1 · Test town', { exact: true })).toBeVisible();
  const items = card.getByText('All 42 items sold in the last 90 days are in StockFlow.', { exact: true });
  await expect(items).toBeVisible();
  await expect(items.locator('..').locator('svg.lucide-circle-check')).toHaveCount(1);
  await expect(card.getByText('Sales up to 17 Nov · Tally item list read 18 Nov 10:00')).toBeVisible();
  await card.getByRole('button', { name: 'Link to Tally', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Link customers to Tally', exact: true })).toBeVisible();
});
test('403 hides the optional card and leaves Accounts usable', async ({ page }) => {
  await setup(page, 403);
  await expect(page.getByRole('button', { name: 'Add customer', exact: true })).toBeVisible();
  await expect(page.locator('summary').filter({ hasText: 'Data checks' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
});
test('expanded checks fit a 375px phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setup(page);
  await page.locator('summary').filter({ hasText: 'Data checks' }).click();
  await page.locator('summary').filter({ hasText: 'Show customers (20)' }).click();
  await expect(page.getByText('Test customer 20 · Test town', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
