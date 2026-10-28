import { expect, test, type Page } from '@playwright/test';
import { orderBootstrap, orderSummary } from '../fixtures/api-builders';

test.use({ viewport: { width: 375, height: 812 } });

async function mockViews(page: Page, role: 'billing' | 'warehouse' = 'billing') {
  const requests: URL[] = [];
  const createdAt = new Date(Date.now() - 20 * 86_400_000).toISOString();
  const orders = [orderSummary({ id: 'urgent', orderNumber: 'SF-URGENT', priority: 'urgent', createdAt }), orderSummary({ id: 'high', orderNumber: 'SF-HIGH', priority: 'high', createdAt })];
  await page.route('**/api/orders**', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('list') === '1') requests.push(url);
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    const rows = url.searchParams.get('status') === 'history' ? [] : orders;
    return route.fulfill({ json: orderBootstrap({ actor: { email: `${role}@example.test`, role, roles: [role] }, orders: rows, operations: { challanUnbilled: 2 }, pagination: { total: rows.length, page: 1, pageCount: 1, pageSize: 20 } }) });
  });
  await page.route('**/api/procurement-requirements**', route => route.fulfill({ json: { requirements: [] } }));
  await page.goto('/?view=orders-workspace');
  return requests;
}

test('priority borders and IST open age are visible on order cards', async ({ page }) => {
  await mockViews(page);
  for (const [number, border] of [['SF-URGENT', 'border-l-sf-danger'], ['SF-HIGH', 'border-l-sf-warning']]) {
    await page.getByRole('button', { name: new RegExp(`^${number},`) }).click();
    const dialog = page.getByRole('dialog', { name: `Order ${number}`, exact: true });
    await expect(dialog.locator('article')).toHaveClass(new RegExp(`border-l-4.*${border}`));
    await expect(dialog.getByText('Open 20 days', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: /Back/ }).click();
  }
});

test('queue chips use the existing list request filters', async ({ page }) => {
  const requests = await mockViews(page);
  const views = page.getByRole('navigation', { name: 'Order queues', exact: true });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const from = new Date(`${today}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 6);
  await views.getByRole('button', { name: 'Recent', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('date')).toBe(from.toISOString().slice(0, 10));
  await expect(views.getByRole('button', { name: 'Recent', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(requests.at(-1)?.searchParams.has('dateTo')).toBe(false);
  await views.getByRole('button', { name: 'Urgent & high', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('status')).toBe('priority_high');
  await views.getByRole('button', { name: 'Challans to bill 2', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('status')).toBe('challan_unbilled');
  await views.getByRole('button', { name: 'Active', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('status')).toBe('open');
  expect(requests.at(-1)?.searchParams.has('date')).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('warehouse does not see the challan billing queue chip', async ({ page }) => {
  await mockViews(page, 'warehouse');
  const views = page.getByRole('navigation', { name: 'Order queues', exact: true });
  await expect(views.getByRole('button', { name: 'Challans to bill 2', exact: true })).toHaveCount(0);
});
