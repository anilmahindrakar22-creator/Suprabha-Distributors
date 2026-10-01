import { test, expect } from '@playwright/test';

const itemKey = 'Chem & β';

test('waiting orders load only on request, encode the exact key and paginate', async ({ page }) => {
  let summaryReads = 0;
  const waitingPages: number[] = [];
  await page.route('**/api/requirements?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('itemKey')) {
      expect(url.searchParams.get('itemKey')).toBe(itemKey);
      const number = Number(url.searchParams.get('page'));
      waitingPages.push(number);
      await route.fulfill({ json: { orders: [{ orderId: `order-${number}`, orderNumber: `SO-${number}`, customerName: `Customer ${number}`, status: 'Open', remainingQuantity: number * 2, priority: 'high', createdAt: '2026-09-01T00:00:00Z' }], pagination: { page: number, pageCount: 2, total: 21 } } });
      return;
    }
    summaryReads += 1;
    const number = Number(url.searchParams.get('page'));
    await route.fulfill({ json: { fetchedAt: '2026-10-01T00:00:00Z', rows: [{ tallyKey: itemKey, itemName: 'Demand reagent', openDemand: 13, currentStock: null, shortage: null, affectedOrders: 2, priority: 'high', oldestOrderAt: '2026-09-01T00:00:00Z' }], pagination: { page: number, pageCount: 1, total: 1 } } });
  });
  await page.goto('/?view=requirements');
  expect(summaryReads).toBe(0);
  expect(waitingPages).toEqual([]);
  await page.getByRole('button', { name: 'Customer demand / requirements' }).click();
  await expect(page.getByText('Demand reagent')).toBeVisible();
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
    if (url.searchParams.has('itemKey')) {
      await route.fulfill({ status: 503, json: { error: 'Waiting orders unavailable.' } });
      return;
    }
    await route.fulfill({ json: { fetchedAt: null, rows: [{ tallyKey: itemKey, itemName: 'Demand reagent', openDemand: 13, currentStock: null, shortage: null, affectedOrders: 2, priority: 'high', oldestOrderAt: '2026-09-01T00:00:00Z' }], pagination: { page: 1, pageCount: 1, total: 1 } } });
  });
  await page.goto('/?view=requirements');
  await page.getByRole('button', { name: 'Customer demand / requirements' }).click();
  await page.getByRole('button', { name: 'View waiting orders' }).click();
  await expect(page.getByRole('alert')).toContainText('Waiting orders unavailable.');
  await expect(page.getByText(/Customer 1|SO-1|Remaining:/)).toHaveCount(0);
});

test('malformed waiting order quantities fail visibly', async ({ page }) => {
  await page.route('**/api/requirements?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('itemKey')) {
      await route.fulfill({ json: { orders: [{ orderId: 'order-1', orderNumber: 'SO-1', customerName: 'Customer', status: 'Open', remainingQuantity: 'unknown', priority: 'high', createdAt: '2026-09-01T00:00:00Z' }], pagination: { page: 1, pageCount: 1, total: 1 } } });
      return;
    }
    await route.fulfill({ json: { fetchedAt: null, rows: [{ tallyKey: itemKey, itemName: 'Demand reagent', openDemand: 13, currentStock: null, shortage: null, affectedOrders: 2, priority: 'high', oldestOrderAt: '2026-09-01T00:00:00Z' }], pagination: { page: 1, pageCount: 1, total: 1 } } });
  });
  await page.goto('/?view=requirements');
  await page.getByRole('button', { name: 'Customer demand / requirements' }).click();
  await page.getByRole('button', { name: 'View waiting orders' }).click();
  await expect(page.getByRole('alert')).toContainText('incomplete');
  await expect(page.getByText('Customer · SO-1')).toHaveCount(0);
});

test('customer requirements load lazily, keep unknown stock explicit and paginate', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/requirements?*', async (route) => {
    reads += 1;
    const number = Number(new URL(route.request().url()).searchParams.get('page'));
    await route.fulfill({ json: { fetchedAt: '2026-10-01T00:00:00Z', rows: [{ tallyKey: `DEMAND-${number}`, itemName: `Demand reagent ${number}`, openDemand: 13, currentStock: number === 1 ? null : 4, shortage: number === 1 ? null : 9, affectedOrders: 2, priority: 'high', oldestOrderAt: '2026-09-01T00:00:00Z' }], pagination: { page: number, pageCount: 2, total: 26 } } });
  });
  await page.goto('/?view=requirements');
  expect(reads).toBe(0);
  await page.getByRole('button', { name: 'Customer demand / requirements' }).click();
  await expect(page.getByText('Unknown · review')).toHaveCount(2);
  await expect(page.getByText('Demand reagent 1')).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).last().click();
  await expect(page.getByText('Demand reagent 2')).toBeVisible();
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  expect(reads).toBe(2);
});

test('incomplete quantities fail visibly instead of inventing zero stock', async ({ page }) => {
  await page.route('**/api/requirements?*', async (route) => route.fulfill({ json: { rows: [{ tallyKey: 'BAD', itemName: 'Bad data' }], pagination: { page: 1, pageCount: 1, total: 1 } } }));
  await page.goto('/?view=requirements');
  await page.getByRole('button', { name: 'Customer demand / requirements' }).click();
  await expect(page.getByRole('alert')).toContainText('incomplete');
  await expect(page.getByRole('heading', { name: 'Bad data' })).toHaveCount(0);
});
