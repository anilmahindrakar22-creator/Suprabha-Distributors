import { test, expect } from '@playwright/test';
import { toOrderItem, toOrderResponse } from '../fixtures/api-builders';

const itemKey = 'Chem & β';
const emptyAlerts = { windowDays: 7, alerts: [], pagination: { page: 1, pageCount: 1, total: 0 } };

test('requirements show shortages first with counts and alert coverage', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/requirements?*', async (route) => {
    if (new URL(route.request().url()).searchParams.has('alerts')) {
      await route.fulfill({ json: { windowDays: 7, alerts: [
        { tallyKey: 'SHORT', itemName: 'Partial stock arrival', stockBefore: 2, stockAfter: 7, sourceAt: '2026-10-01T00:00:00Z', affectedOrders: 3, currentStock: 7, waitingOrders: 3, waitingQuantity: 10, coveredOrders: 2 },
        { tallyKey: 'COVERED', itemName: 'Full stock arrival', stockBefore: 0, stockAfter: 8, sourceAt: '2026-10-01T00:00:00Z', affectedOrders: 2, currentStock: 8, waitingOrders: 2, waitingQuantity: 8, coveredOrders: 2 },
        { tallyKey: 'UNKNOWN', itemName: 'Unknown stock arrival', stockBefore: 0, stockAfter: 2, sourceAt: '2026-10-01T00:00:00Z', affectedOrders: 1, currentStock: null, waitingOrders: 1, waitingQuantity: 5, coveredOrders: null },
      ], pagination: { page: 1, pageCount: 1, total: 3 } } });
      return;
    }
    await route.fulfill({ json: toOrderResponse({ page: 1, total: 3, waitingCount: 1, unknownCount: 1, items: [
      toOrderItem({ itemKey: 'SHORT', itemName: 'Short item', openDemand: 10, closing: 7, suggestedQty: 3, state: 'order', waitingOrders: 3, oldestOrderAt: '2026-09-01T00:00:00Z' }),
      toOrderItem({ itemKey: 'UNKNOWN', itemName: 'Unknown item', openDemand: 5, closing: null, suggestedQty: null, state: 'stock_unknown', waitingOrders: 1, oldestOrderAt: '2026-09-01T00:00:00Z' }),
      toOrderItem({ itemKey: 'COVERED', itemName: 'Covered item', openDemand: 8, closing: 8, suggestedQty: 0, state: 'order', waitingOrders: 2, oldestOrderAt: '2026-09-01T00:00:00Z' }),
    ] }) });
  });
  await page.goto('/?view=requirements');
  const section = page.getByRole('region', { name: 'To order' });
  await expect(section.getByText('3 to order', { exact: true })).toBeVisible();
  await expect(section.getByText('1 stock unknown', { exact: true })).toBeVisible();
  await expect(section.locator('h2')).toHaveText(['To order', 'New stock for waiting orders (3)']);
  await expect(section.getByText('Tally now shows 7 · enough for 2 of 3 waiting orders')).toBeVisible();
  await expect(section.getByText('Tally now shows 8 · enough for both waiting orders')).toBeVisible();
  await expect(section.getByText('current stock unknown', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const button of await section.getByRole('button').all()) {
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});

for (const invalid of ['counts', 'state'] as const) {
  test(`invalid requirement ${invalid} fails visibly`, async ({ page }) => {
    await page.route('**/api/requirements?*', async (route) => {
      if (new URL(route.request().url()).searchParams.has('alerts')) { await route.fulfill({ json: emptyAlerts }); return; }
      await route.fulfill({ json: toOrderResponse({ page: 1, total: 1, waitingCount: invalid === 'counts' ? -1 : 1, unknownCount: 0, items: [
        toOrderItem({ itemKey: 'BAD', itemName: 'Invalid requirement', openDemand: 5, closing: 2, suggestedQty: 3, state: (invalid === 'state' ? 'invalid' : 'order') as 'order', waitingOrders: 1, oldestOrderAt: '2026-09-01T00:00:00Z' }),
      ] }) });
    });
    await page.goto('/?view=requirements');
    await expect(page.getByRole('alert')).toContainText('incomplete');
    await expect(page.getByRole('heading', { name: 'Invalid requirement' })).toHaveCount(0);
  });
}

test('waiting orders load only on request, encode the exact key and paginate', async ({ page }) => {
  let summaryReads = 0;
  const waitingPages: number[] = [];
  await page.route('**/api/requirements?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('alerts')) { await route.fulfill({ json: emptyAlerts }); return; }
    if (url.searchParams.has('itemKey')) {
      expect(url.searchParams.get('itemKey')).toBe(itemKey);
      const number = Number(url.searchParams.get('page'));
      waitingPages.push(number);
      await route.fulfill({ json: { orders: [{ orderId: `order-${number}`, orderNumber: `SO-${number}`, customerName: `Customer ${number}`, status: 'Open', remainingQuantity: number * 2, priority: 'high', createdAt: '2026-09-01T00:00:00Z' }], pagination: { page: number, pageCount: 2, total: 21 } } });
      return;
    }
    summaryReads += 1;
    const number = Number(url.searchParams.get('page'));
    await route.fulfill({ json: toOrderResponse({ page: number, total: 1, waitingCount: 0, unknownCount: 1, items: [toOrderItem({ itemKey: itemKey, itemName: 'Demand reagent', openDemand: 13, closing: null, suggestedQty: null, state: 'stock_unknown', waitingOrders: 2, oldestOrderAt: '2026-09-01T00:00:00Z' })] }) });
  });
  await page.goto('/?view=requirements');
  expect(waitingPages).toEqual([]);
  await expect(page.getByText('Demand reagent')).toBeVisible();
  expect(summaryReads).toBe(1);
  expect(waitingPages).toEqual([]);
  await page.getByRole('button', { name: 'View waiting orders' }).click();
  await expect(page.getByText('Customer 1 · SO-1')).toBeVisible();
  expect(waitingPages).toEqual([1]);
  await page.getByLabel('Waiting orders for Demand reagent').getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Customer 2 · SO-2')).toBeVisible();
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  expect(waitingPages).toEqual([1, 2]);
});

test('invalid or failed waiting order responses are visible without fabricated facts', async ({ page }) => {
  await page.route('**/api/requirements?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('alerts')) { await route.fulfill({ json: emptyAlerts }); return; }
    if (url.searchParams.has('itemKey')) {
      await route.fulfill({ status: 503, json: { error: 'Waiting orders unavailable.' } });
      return;
    }
    await route.fulfill({ json: toOrderResponse({ page: 1, total: 1, waitingCount: 0, unknownCount: 1, items: [toOrderItem({ itemKey: itemKey, itemName: 'Demand reagent', openDemand: 13, closing: null, suggestedQty: null, state: 'stock_unknown', waitingOrders: 2, oldestOrderAt: '2026-09-01T00:00:00Z' })] }) });
  });
  await page.goto('/?view=requirements');
  await page.getByRole('button', { name: 'View waiting orders' }).click();
  await expect(page.getByRole('alert')).toContainText('Waiting orders unavailable.');
  await expect(page.getByText(/Customer 1|SO-1|Remaining:/)).toHaveCount(0);
});

test('malformed waiting order quantities fail visibly', async ({ page }) => {
  await page.route('**/api/requirements?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('alerts')) { await route.fulfill({ json: emptyAlerts }); return; }
    if (url.searchParams.has('itemKey')) {
      await route.fulfill({ json: { orders: [{ orderId: 'order-1', orderNumber: 'SO-1', customerName: 'Customer', status: 'Open', remainingQuantity: 'unknown', priority: 'high', createdAt: '2026-09-01T00:00:00Z' }], pagination: { page: 1, pageCount: 1, total: 1 } } });
      return;
    }
    await route.fulfill({ json: toOrderResponse({ page: 1, total: 1, waitingCount: 0, unknownCount: 1, items: [toOrderItem({ itemKey: itemKey, itemName: 'Demand reagent', openDemand: 13, closing: null, suggestedQty: null, state: 'stock_unknown', waitingOrders: 2, oldestOrderAt: '2026-09-01T00:00:00Z' })] }) });
  });
  await page.goto('/?view=requirements');
  await page.getByRole('button', { name: 'View waiting orders' }).click();
  await expect(page.getByRole('alert')).toContainText('incomplete');
  await expect(page.getByText('Customer · SO-1')).toHaveCount(0);
});

test('to order loads immediately, keeps unknown stock explicit and appends pages', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/requirements?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('alerts')) { await route.fulfill({ json: emptyAlerts }); return; }
    reads += 1;
    const number = Number(url.searchParams.get('page'));
    await route.fulfill({ json: toOrderResponse({ page: number, total: 2, waitingCount: 25, unknownCount: 1, items: [toOrderItem({ itemKey: `DEMAND-${number}`, itemName: `Demand reagent ${number}`, openDemand: 13, closing: number === 1 ? 4 : null, suggestedQty: number === 1 ? 9 : null, state: number === 1 ? 'order' : 'stock_unknown', waitingOrders: 2, oldestOrderAt: '2026-09-01T00:00:00Z' })] }) });
  });
  await page.goto('/?view=requirements');
  await expect(page.getByText('Demand reagent 1')).toBeVisible();
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(page.getByText('Demand reagent 2')).toBeVisible();
  await expect(page.getByText('Stock unknown, check Tally', { exact: true })).toBeVisible();
  await expect(page.getByText('Demand reagent 1')).toBeVisible();
  await expect(page.getByText('No new stock for waiting orders in the last 7 days.')).toBeVisible();
  expect(reads).toBe(2);
});

test('incomplete quantities fail visibly instead of inventing zero stock', async ({ page }) => {
  await page.route('**/api/requirements?*', async (route) => {
    if (new URL(route.request().url()).searchParams.has('alerts')) { await route.fulfill({ json: emptyAlerts }); return; }
    await route.fulfill({ json: toOrderResponse({ page: 1, total: 1, waitingCount: 1, unknownCount: 0, items: [{ itemKey: 'BAD', itemName: 'Bad data', state: 'order' }] as never }) });
  });
  await page.goto('/?view=requirements');
  await expect(page.getByRole('alert')).toContainText('incomplete');
  await expect(page.getByRole('heading', { name: 'Bad data' })).toHaveCount(0);
});

test('stock arrival alerts load with the section and show exact-key waiting orders', async ({ page }) => {
  let alertReads = 0;
  let waitingUrl = '';
  await page.route('**/api/requirements?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('alerts')) {
      alertReads += 1;
      expect(url.searchParams.get('alerts')).toBe('1');
      expect(url.searchParams.get('page')).toBe('1');
      await route.fulfill({ json: { windowDays: 7, alerts: [{ tallyKey: itemKey, itemName: 'Reported reagent', stockBefore: 2, stockAfter: 7, sourceAt: '2026-10-01T00:00:00Z', affectedOrders: 3, currentStock: 7, waitingOrders: 3, waitingQuantity: 10, coveredOrders: 2 }], pagination: { page: 1, pageCount: 1, total: 1 } } });
      return;
    }
    if (url.searchParams.has('itemKey')) {
      waitingUrl = url.toString();
      await route.fulfill({ json: { orders: [{ orderId: 'alert-order', orderNumber: 'SO-alert', customerName: 'Alert customer', status: 'Open', remainingQuantity: 4, priority: 'high', createdAt: '2026-09-01T00:00:00Z' }], pagination: { page: 1, pageCount: 1, total: 1 } } });
      return;
    }
    await route.fulfill({ json: toOrderResponse({ page: 1, total: 1, waitingCount: 0, unknownCount: 0, items: [toOrderItem({ itemKey: itemKey, itemName: 'Same demand item', openDemand: 4, closing: 7, suggestedQty: 0, state: 'order', waitingOrders: 1, oldestOrderAt: '2026-09-01T00:00:00Z' })] }) });
  });
  await page.goto('/?view=requirements');
  await expect(page.getByText('Reported reagent')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New stock for waiting orders (1)' })).toBeVisible();
  await expect(page.getByText('2 → 7 on', { exact: false })).toBeVisible();
  await expect(page.getByText('Tally now shows 7 · enough for 2 of 3 waiting orders')).toBeVisible();
  expect(alertReads).toBe(1);
  await page.getByRole('heading', { name: 'Reported reagent' }).locator('..').getByRole('button', { name: 'View waiting orders' }).click();
  await expect(page.getByText('Alert customer · SO-alert')).toBeVisible();
  await expect(page.getByText('Alert customer · SO-alert')).toHaveCount(1);
  expect(new URL(waitingUrl).searchParams.get('itemKey')).toBe(itemKey);
});

test('invalid reported stock increases response fails visibly', async ({ page }) => {
  await page.route('**/api/requirements?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('alerts')) {
      await route.fulfill({ json: { windowDays: 7, alerts: [{ tallyKey: itemKey, itemName: 'Invalid increase', stockBefore: 2, stockAfter: 4, sourceAt: '2026-10-01T00:00:00Z', affectedOrders: 1, currentStock: 4, waitingOrders: 1, waitingQuantity: 5, coveredOrders: -1 }], pagination: { page: 1, pageCount: 1, total: 1 } } });
      return;
    }
    await route.fulfill({ json: toOrderResponse({ page: 1, total: 0, waitingCount: 0, unknownCount: 0, items: [] }) });
  });
  await page.goto('/?view=requirements');
  await expect(page.getByRole('alert')).toContainText('incomplete');
  await expect(page.getByRole('heading', { name: 'Invalid increase' })).toHaveCount(0);
});

test('reported stock increase endpoint errors are visible', async ({ page }) => {
  await page.route('**/api/requirements?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('alerts')) {
      await route.fulfill({ status: 503, json: { error: 'Stock increase alerts unavailable.' } });
      return;
    }
    await route.fulfill({ json: toOrderResponse({ page: 1, total: 0, waitingCount: 0, unknownCount: 0, items: [] }) });
  });
  await page.goto('/?view=requirements');
  await expect(page.getByRole('alert')).toContainText('Stock increase alerts unavailable.');
});
