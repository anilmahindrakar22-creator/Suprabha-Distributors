import { test, expect } from '@playwright/test';
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
  await page.getByRole('button', { name: 'Next', exact: true }).click();
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
