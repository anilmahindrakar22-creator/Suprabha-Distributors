import { expect, test } from '@playwright/test';
import { toOrderItem, toOrderResponse } from '../fixtures/api-builders';

test('To order is expanded, keeps unknown stock last and opens waiting orders on phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const waitingKeys: string[] = [];
  await page.route('**/api/requirements?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('alerts')) {
      await route.fulfill({ json: { windowDays: 7, alerts: [], pagination: { page: 1, pageCount: 1, total: 0 } } });
    } else if (url.searchParams.has('itemKey')) {
      waitingKeys.push(url.searchParams.get('itemKey')!);
      await route.fulfill({ json: { orders: [{ orderId: 'order-1', orderNumber: 'SO-1', customerName: 'Waiting customer', status: 'Open', remainingQuantity: 10, priority: 'normal', createdAt: '2026-10-01T00:00:00Z' }], pagination: { page: 1, pageCount: 1, total: 1 } } });
    } else {
      expect(url.searchParams.get('view')).toBe('to_order');
      expect(url.searchParams.get('page')).toBe('1');
      await route.fulfill({ json: toOrderResponse({ total: 2, unknownCount: 1, items: [
        toOrderItem({ itemKey: 'UNKNOWN', itemName: 'Unknown reagent', state: 'stock_unknown', closing: null, suggestedQty: null, waitingOrders: 0, reasons: [] }),
        toOrderItem({ itemKey: 'Chem & β', itemName: 'Demand reagent' }),
      ] }) });
    }
  });
  await page.goto('/?view=requirements');
  const section = page.getByRole('region', { name: 'To order', exact: true });
  await expect(section.getByRole('heading', { name: 'To order', exact: true })).toBeVisible();
  await expect(section.getByText('2 to order', { exact: true })).toBeVisible();
  await expect(section.getByText('1 with customers waiting', { exact: true })).toBeVisible();
  await expect(section.getByText('1 stock unknown', { exact: true })).toBeVisible();
  const row = section.getByRole('article', { name: 'Demand reagent' });
  await expect(row.getByText('Order 13', { exact: true })).toBeVisible();
  await expect(row.getByText('3 customer orders waiting · Below reorder level', { exact: true })).toBeVisible();
  await expect(row.getByText('In stock 2 · reorder level 5', { exact: true })).toBeVisible();
  await expect(section.getByRole('article').last()).toHaveAccessibleName('Unknown reagent');
  await expect(section.getByRole('article').last().getByText('Order —', { exact: true })).toBeVisible();
  expect(waitingKeys).toEqual([]);
  await row.getByRole('button', { name: 'View waiting orders' }).click();
  await expect(row.getByLabel('Waiting orders for Demand reagent')).toContainText('Waiting customer · SO-1');
  expect(waitingKeys).toEqual(['Chem & β']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const button of await section.getByRole('button').all()) {
    expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
});
