import { expect, test, type Page } from '@playwright/test';
import type { MarketOverview } from '../../lib/market-overview-types';
import type { CustomerWallet, WalletDivision } from '../../lib/wallet-types';

const customerId = '11111111-1111-4111-8111-111111111111';
const division: WalletDivision = { id: '22222222-2222-4222-8222-222222222222', name: 'Biochemistry', active: true, sortOrder: 1, version: 1 };
const fixture: MarketOverview = {
  customers: [50, 30, 15, 5].map((amount, index) => ({
    id: index === 0 ? customerId : `customer-${index}`, name: ['Care Hospital', 'City Laboratory', 'Health Clinic', 'Central Lab'][index], city: 'Bengaluru',
    hasPin: false, walletTotalPaise: String(amount * 100), divisionsEstimated: 1, latestAsOf: '2026-10-01', oldestAsOf: '2026-10-01', staleEstimate: false, inFocus: index < 2,
  })),
  page: { page: 1, pageSize: 50, total: 4 }, counts: { all: 6, noPin: 4, noEstimate: 2, staleEstimate: 1 },
  pareto: { basis: 'estimated_wallet', focusCustomers: 2, focusWalletPaise: '8000', totalWalletPaise: '10000', estimatedCustomers: 4, activeCustomers: 6 }, activeDivisions: 1,
};
type Command = { action: string; payload: Record<string, unknown> };

async function mockMarket(page: Page, failEstimate = false) {
  const overviewRequests: string[] = [];
  const locationPosts: Command[] = [];
  const estimatePosts: Command[] = [];
  let customers = fixture.customers.map(customer => ({ ...customer }));
  let wallet: CustomerWallet = { current: [], history: [], totalMonthlyWalletPaise: '0' };
  await page.route('**/api/market', async route => {
    if (route.request().method() === 'POST') {
      const command = route.request().postDataJSON() as Command;
      locationPosts.push(command);
      customers = customers.map(customer => customer.id === command.payload.customerId ? { ...customer, hasPin: true, latitude: String(command.payload.latitude), longitude: String(command.payload.longitude), locationVersion: 1 } : customer);
      await route.fulfill({ json: { ok: true } });
    } else await route.fulfill({ json: { customers, page: fixture.page } });
  });
  await page.route('**/api/market/wallet**', async route => {
    if (route.request().method() === 'POST') {
      const command = route.request().postDataJSON() as Command;
      estimatePosts.push(command);
      if (failEstimate) { await route.fulfill({ status: 400, json: { error: 'Invalid estimate details' } }); return; }
      const row = { division, monthlyWalletPaise: String(command.payload.monthlyWalletPaise), method: 'customer_stated' as const, confidence: 'high' as const, asOf: String(command.payload.asOf), note: String(command.payload.note), createdAt: '2026-10-12T10:00:00Z', createdBy: 'manager@example.test' };
      wallet = { current: [row], history: [row], totalMonthlyWalletPaise: row.monthlyWalletPaise };
      customers = customers.map(customer => customer.id === command.payload.customerId ? { ...customer, walletTotalPaise: row.monthlyWalletPaise } : customer);
      await route.fulfill({ json: { ok: true } });
    } else if (new URL(route.request().url()).searchParams.get('view') === 'divisions') {
      await route.fulfill({ json: { divisions: [division, { ...division, id: 'inactive', name: 'Inactive division', active: false }] } });
    } else await route.fulfill({ json: wallet });
  });
  await page.route('**/api/market/overview**', async route => {
    overviewRequests.push(route.request().url());
    const filter = new URL(route.request().url()).searchParams.get('filter');
    const visible = customers.filter(customer => filter === 'focus' ? customer.inFocus : filter === 'no_pin' ? !customer.hasPin : true);
    await route.fulfill({ json: { ...fixture, customers: visible, page: { ...fixture.page, total: visible.length } } });
  });
  await page.goto('/?view=market');
  await expect(page.getByRole('list', { name: 'Customers' }).getByRole('button').first()).toBeVisible();
  return { overviewRequests, locationPosts, estimatePosts };
}
async function openCustomer(page: Page) {
  await page.getByRole('list', { name: 'Customers' }).getByRole('button', { name: /Care Hospital/ }).click();
  await expect(page.getByText('No estimate yet.', { exact: true })).toBeVisible();
}
async function fillEstimate(page: Page) {
  await page.getByRole('button', { name: 'Update estimate', exact: true }).click();
  await page.getByLabel('Division', { exact: true }).selectOption(division.id);
  await page.getByLabel('Monthly wallet (₹)', { exact: true }).fill('1,25,000');
  await page.getByLabel('Method', { exact: true }).selectOption('customer_stated');
  await page.getByLabel('Confidence', { exact: true }).selectOption('high');
  await page.getByLabel('Note', { exact: true }).fill('Confirmed with the customer');
}

test('wallet focus list and pareto line', async ({ page }) => {
  const mocks = await mockMarket(page);
  await expect(page.getByText('2 customers', { exact: true })).toBeVisible();
  await expect(page.getByText(/Based on 4 of 6/)).toBeVisible();
  expect(new URL(mocks.overviewRequests[0]).searchParams.get('filter')).toBe('focus');
  await expect(page.getByRole('list', { name: 'Customers' }).getByRole('button')).toHaveCount(2);
  await page.getByRole('button', { name: 'Show all customers', exact: true }).click();
  await expect.poll(() => new URL(mocks.overviewRequests.at(-1)!).searchParams.get('filter')).toBe('all');
  await expect(page.getByRole('list', { name: 'Customers' }).getByRole('button')).toHaveCount(4);
});

test('coverage tiles filter the list', async ({ page }) => {
  const mocks = await mockMarket(page);
  await page.getByRole('tab', { name: 'Coverage', exact: true }).click();
  const tile = page.getByRole('region', { name: 'Coverage', exact: true }).getByRole('button', { name: /No map pin/ });
  await tile.click();
  await expect(tile).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => new URL(mocks.overviewRequests.at(-1)!).searchParams.get('filter')).toBe('no_pin');
  await tile.click();
  await expect(tile).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => new URL(mocks.overviewRequests.at(-1)!).searchParams.get('filter')).toBe('all');
});

test('customer panel saves a pasted location and an estimate', async ({ page }) => {
  const mocks = await mockMarket(page);
  await openCustomer(page);
  await page.getByLabel('Paste a map link or coordinates').fill('https://www.google.com/maps/place/X/@12.9716,77.5946,17z');
  await page.getByRole('button', { name: 'Save location', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Location saved' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change location', exact: true })).toBeVisible();
  expect(mocks.locationPosts[0]).toMatchObject({ action: 'set_customer_location', payload: { customerId, latitude: '12.9716', longitude: '77.5946', source: 'pasted_link' } });
  await expect(page.getByLabel('Paste a map link or coordinates')).toHaveValue('');
  await expect(page.getByText('12.971600, 77.594600')).toBeVisible();
  await fillEstimate(page);
  await expect(page.getByLabel('Division', { exact: true }).getByRole('option', { name: 'Inactive division' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Estimate saved' })).toBeVisible();
  expect(mocks.estimatePosts[0]).toMatchObject({ action: 'record_wallet_estimate', payload: { customerId, divisionId: division.id, monthlyWalletPaise: '12500000', method: 'customer_stated', confidence: 'high', note: 'Confirmed with the customer' } });
  await expect(page.getByRole('region', { name: 'Wallet estimate', exact: true }).locator('table:visible, ul[aria-label="Current estimates"]:visible')).toContainText('₹1,25,000');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('short map link is rejected without a request', async ({ page }) => {
  const mocks = await mockMarket(page);
  await openCustomer(page);
  await page.getByLabel('Paste a map link or coordinates').fill('https://maps.app.goo.gl/abc');
  await page.getByRole('button', { name: 'Save location', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Open the link and copy the full address bar URL');
  expect(mocks.locationPosts).toHaveLength(0);
  expect(mocks.estimatePosts).toHaveLength(0);
});

test('estimate save failure keeps the typed values', async ({ page }) => {
  await mockMarket(page, true);
  await openCustomer(page);
  await fillEstimate(page);
  const asOf = await page.getByLabel('As of', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid estimate details');
  await expect(page.getByLabel('Monthly wallet (₹)', { exact: true })).toHaveValue('1,25,000');
  await expect(page.getByLabel('Division', { exact: true })).toHaveValue(division.id);
  await expect(page.getByLabel('Method', { exact: true })).toHaveValue('customer_stated');
  await expect(page.getByLabel('Confidence', { exact: true })).toHaveValue('high');
  await expect(page.getByLabel('As of', { exact: true })).toHaveValue(asOf);
  await expect(page.getByLabel('Note', { exact: true })).toHaveValue('Confirmed with the customer');
});
