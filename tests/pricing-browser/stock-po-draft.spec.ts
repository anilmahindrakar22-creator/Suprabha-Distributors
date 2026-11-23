import { expect, test, type Page } from '@playwright/test';
import { purchaseOrder, supplierOption, toOrderResponse } from '../fixtures/api-builders';

async function setupStockDraft(page: Page) {
  const commands: unknown[] = [];
  await page.route('**/api/requirements?*', route => route.fulfill({ json:
    new URL(route.request().url()).searchParams.has('alerts')
      ? { windowDays: 7, alerts: [], pagination: { page: 1, pageCount: 1, total: 0 } }
      : toOrderResponse({ total: 0, items: [] }),
  }));
  await page.route('**/api/purchase-orders*', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      commands.push(request.postDataJSON());
      await route.fulfill({ json: { purchaseOrders: [purchaseOrder()] } });
      return;
    }
    const key = new URL(request.url()).searchParams.get('supplierOptions');
    await route.fulfill({ json: { itemKey: key, suppliers: key === 'Test Reagent A'
      ? [supplierOption({ supplierName: 'Supplier A first', lowest: false }), supplierOption({ supplierName: 'Supplier A lowest', lowest: true })]
      : [supplierOption({ supplierName: 'Supplier B', lowest: false })] } });
  });
  await page.goto('/?view=requirements-stock-draft');
  const sheet = page.getByRole('dialog', { name: 'Review purchase orders' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel('Supplier for Test Reagent A')).toHaveValue('Supplier A lowest');
  await expect(sheet.getByLabel('Supplier for Test Reagent B')).toBeEnabled();
  return { sheet, commands };
}

test('Stock draft opens review with rounded quantities and only marked lowest suppliers', async ({ page }) => {
  const { sheet } = await setupStockDraft(page);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __stockDraftUsed?: number }).__stockDraftUsed ?? 0)).toBe(1);
  await expect(sheet.getByLabel('Quantity for Test Reagent A')).toHaveValue('5');
  await expect(sheet.getByLabel('Quantity for Test Reagent B')).toHaveValue('2');
  await expect(sheet.getByLabel('Supplier for Test Reagent B')).toHaveValue('');
  await expect(sheet.getByLabel('Supplier for Test Reagent B').locator('option:checked')).toHaveText('Choose a supplier');
});

test('Stock draft creates purchase orders with the reviewed suppliers and quantities', async ({ page }) => {
  const { sheet, commands } = await setupStockDraft(page);
  await sheet.getByLabel('Supplier for Test Reagent B').selectOption('Supplier B');
  await sheet.getByRole('button', { name: 'Create 2 purchase orders' }).click();
  await expect(page.getByText('Created PO/26-27/0001', { exact: true })).toBeVisible();
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({ action: 'create_purchase_orders', payload: { lines: [
    { itemKey: 'Test Reagent A', quantity: 5, supplierName: 'Supplier A lowest' },
    { itemKey: 'Test Reagent B', quantity: 2, supplierName: 'Supplier B' },
  ] } });
  await expect(page.locator('[data-po-selection-bar]')).toHaveCount(0);
});

test('closing a Stock draft leaves no ghost selection or reopened review', async ({ page }) => {
  const { sheet, commands } = await setupStockDraft(page);
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator('[data-po-selection-bar]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(sheet).toBeHidden();
  expect(commands).toHaveLength(0);
});

test('Stock draft review fits a 375px phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { sheet } = await setupStockDraft(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await sheet.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});
