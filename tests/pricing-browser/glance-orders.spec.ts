import { expect, test, type Page } from '@playwright/test';
import { orderBootstrap, orderSummary } from '../fixtures/api-builders';

const operations = {
  awaitingConfirmation: 2, awaitingStock: 3, readyForPicking: 4, packed: 5,
  awaitingTallyBilling: 6, dispatchedToday: 7, urgentExceptions: 8,
};

async function mockOrders(page: Page, urgentExceptions = 8) {
  const requests: URL[] = [];
  await page.route('**/api/orders**', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    if (url.searchParams.get('list') === '1') requests.push(url);
    const summary = { ...operations, urgentExceptions };
    if (url.searchParams.has('summary')) return route.fulfill({ json: { operations: summary } });
    const orders = url.searchParams.get('status') === 'history' ? [] : [orderSummary({
      id: 'glance-order', orderNumber: 'SF-GLANCE', status: 'awaiting_confirmation', pricingState: 'approved',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })];
    return route.fulfill({ json: orderBootstrap({
      actor: { email: 'administrator@example.test', role: 'administrator', roles: ['administrator'] }, orders, operations: summary,
      pagination: { total: orders.length, page: 1, pageCount: 1, pageSize: 20 },
    }) });
  });
  await page.route('**/api/procurement-requirements**', route => route.fulfill({ json: { requirements: [] } }));
  await page.goto('/?view=orders-workspace');
  return requests;
}

for (const width of [375, 1280]) {
  test.describe(`Orders glance at ${width}px`, () => {
    test.use({ viewport: { width, height: 812 } });

    test('pipeline shows five summary counts and the stuck count', async ({ page }) => {
      await mockOrders(page);
      const pipeline = page.getByRole('region', { name: 'Order pipeline', exact: true });
      await expect(pipeline).toBeVisible();
      for (const [label, count] of [['Confirm', 2], ['Waiting for stock', 3], ['Pack', 9], ['Bill', 6], ['Dispatched today', 7]] as const) {
        const column = pipeline.getByText(label, { exact: true }).locator('..');
        await expect(column.getByText(String(count), { exact: true })).toBeVisible();
        await expect(column.locator('svg')).toHaveAttribute('aria-hidden', 'true');
      }
      const stuck = pipeline.getByText('Stuck over 24 h', { exact: true }).locator('..');
      await expect(stuck).toContainText('8');
      await expect(stuck.locator('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });

    test('stuck chip is absent when urgentExceptions is zero', async ({ page }) => {
      await mockOrders(page, 0);
      await expect(page.getByRole('region', { name: 'Order pipeline' })).toBeVisible();
      await expect(page.getByText('Stuck over 24 h', { exact: true })).toHaveCount(0);
    });

    test('tappable stages keep the existing order filters and 44px targets', async ({ page }) => {
      const requests = await mockOrders(page);
      const pipeline = page.getByRole('region', { name: 'Order pipeline' });
      for (const [label, status] of [['Confirm', 'awaiting_confirmation'], ['Pack', 'picking'], ['Bill', 'billing']]) {
        const button = pipeline.getByRole('button', { name: new RegExp(label) });
        await button.click();
        await expect.poll(() => requests.at(-1)?.searchParams.get('status')).toBe(status);
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        const box = await button.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect(box?.width).toBeGreaterThanOrEqual(44);
      }
    });

    test('order rows keep stage text beside a small aria-hidden stage icon', async ({ page }) => {
      await mockOrders(page);
      const row = page.getByRole('button', { name: /^SF-GLANCE,/ }).first();
      await expect(row).toBeVisible();
      await expect(row.getByText('Confirm', { exact: true })).toBeVisible();
      await expect(row.locator('svg.lucide-phone-call')).toHaveAttribute('aria-hidden', 'true');
      await expect(row.locator('svg.lucide-phone-call').locator('..')).toHaveClass(/size-8/);
    });
  });
}
