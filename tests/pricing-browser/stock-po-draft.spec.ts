import { expect, test, type Page } from '@playwright/test';
import { purchaseOrder, supplierOption, toOrderItem, toOrderResponse } from '../fixtures/api-builders';

const orderItems = [
  toOrderItem({ itemKey: 'Test Reagent A', itemName: 'Test Reagent A', suggestedQty: 5, lowestSupplier: { supplierName: 'Supplier A lowest' } }),
  toOrderItem({ itemKey: 'Test Reagent B', itemName: 'Test Reagent B', suggestedQty: 2 }),
  toOrderItem({ itemKey: 'Test Reagent C', itemName: 'Test Reagent C', suggestedQty: 3 }),
];
const coverItems = [
  { itemKey: 'Test Reagent A', state: 'runs_out' },
  { itemKey: 'Test Reagent B', state: 'runs_out' },
  { itemKey: 'Test Reagent C', state: 'ok' },
  { itemKey: 'Not loaded', state: 'runs_out' },
];

async function setupPurchase(page: Page, { coverStatus = 200, coverBody = { items: coverItems } as unknown, coverNetworkFailure = false } = {}) {
  const commands: unknown[] = [];
  const coverReads: string[] = [];
  await page.route('**/stockflow.html*', route => route.fulfill({ contentType: 'text/html', body: '<p>Stock fixture</p>' }));
  await page.route('**/api/product-requests*', route => route.fulfill({ json: { requests: [] } }));
  await page.route('**/api/requirements?*', route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('view') === 'cover') {
      coverReads.push(route.request().url());
      if (coverNetworkFailure) return route.abort();
      return route.fulfill({ status: coverStatus, json: coverBody });
    }
    return route.fulfill({ json: params.has('alerts')
      ? { windowDays: 7, alerts: [], pagination: { page: 1, pageCount: 1, total: 0 } }
      : params.get('view') === 'to_order' ? toOrderResponse({ total: 3, waitingCount: 3, items: orderItems })
      : { view: 'late_pos', leadTimeDays: 7, total: 0, items: [] },
    });
  });
  await page.route('**/api/purchase-orders*', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      commands.push(request.postDataJSON());
      await route.fulfill({ json: { purchaseOrders: [purchaseOrder()] } });
      return;
    }
    const params = new URL(request.url()).searchParams;
    if (!params.has('supplierOptions')) {
      await route.fulfill({ json: { page: 1, items: [], total: 0 } });
      return;
    }
    const key = params.get('supplierOptions');
    await route.fulfill({ json: { itemKey: key, suppliers: key === 'Test Reagent A'
      ? [supplierOption({ supplierName: 'Supplier A first', lowest: false }), supplierOption({ supplierName: 'Supplier A lowest', lowest: true })]
      : [supplierOption({ supplierName: 'Supplier B', lowest: false })] } });
  });
  await page.goto('/?view=frame&role=operations');
  await page.getByRole('button', { name: 'Purchase', exact: true }).filter({ visible: true }).click();
  const toOrder = page.getByRole('region', { name: 'To order', exact: true });
  await expect(toOrder.getByRole('article')).toHaveCount(3);
  return { commands, coverReads, toOrder };
}

async function setupPurchaseDraft(page: Page) {
  const result = await setupPurchase(page);
  await result.toOrder.getByRole('button', { name: 'Select all that run out before delivery (2)', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review purchase orders' })).toHaveCount(0);
  await page.getByRole('button', { name: /^Create purchase orders?$/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Review purchase orders' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel('Supplier for Test Reagent A')).toHaveValue('Supplier A lowest');
  await expect(sheet.getByLabel('Supplier for Test Reagent B')).toBeEnabled();
  return { sheet, ...result };
}

test('Purchase draft opens review with rounded quantities and only marked lowest suppliers', async ({ page }) => {
  const { sheet } = await setupPurchaseDraft(page);
  await expect(sheet.getByLabel('Quantity for Test Reagent A')).toHaveValue('5');
  await expect(sheet.getByLabel('Quantity for Test Reagent B')).toHaveValue('2');
  await expect(sheet.getByLabel('Supplier for Test Reagent B')).toHaveValue('');
  await expect(sheet.getByLabel('Supplier for Test Reagent B').locator('option:checked')).toHaveText('Choose a supplier');
});

test('Purchase draft creates purchase orders with the reviewed suppliers and quantities', async ({ page }) => {
  const { sheet, commands } = await setupPurchaseDraft(page);
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

test('closing a Purchase draft leaves no ghost selection or reopened review', async ({ page }) => {
  const { sheet, commands, toOrder } = await setupPurchaseDraft(page);
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator('[data-po-selection-bar]')).toHaveCount(0);
  await expect(toOrder.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await toOrder.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(sheet).toBeHidden();
  expect(commands).toHaveLength(0);
});

test('Purchase draft review fits a 375px phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { sheet } = await setupPurchaseDraft(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await sheet.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('Purchase tags only runs-out items alongside their waiting information', async ({ page }) => {
  const { toOrder, coverReads } = await setupPurchase(page);
  for (const name of ['Test Reagent A', 'Test Reagent B']) {
    const item = toOrder.getByRole('article', { name, exact: true });
    await expect(item.getByText('Runs out before delivery', { exact: true })).toBeVisible();
    await expect(item.getByText(/3 customer orders waiting/)).toBeVisible();
  }
  await expect(toOrder.getByRole('article', { name: 'Test Reagent C', exact: true }).getByText('Runs out before delivery', { exact: true })).toHaveCount(0);
  expect(coverReads).toHaveLength(1);
});

test('Purchase select-all counts unselected loaded runs-out items and adds exactly those without duplicates', async ({ page }) => {
  const { toOrder, coverReads } = await setupPurchase(page);
  await expect(toOrder.getByRole('button', { name: 'Select all that run out before delivery (2)', exact: true })).toBeVisible();
  await toOrder.getByRole('checkbox', { name: 'Select Test Reagent A', exact: true }).check();
  const pick = toOrder.getByRole('button', { name: 'Select all that run out before delivery (1)', exact: true });
  await expect(pick).toBeVisible();
  await pick.click();
  const picked = toOrder.getByRole('button', { name: 'Select all that run out before delivery (0)', exact: true });
  await expect(picked).toBeVisible();
  await picked.click();
  await expect(toOrder.getByRole('checkbox', { name: 'Select Test Reagent A', exact: true })).toBeChecked();
  await expect(toOrder.getByRole('checkbox', { name: 'Select Test Reagent B', exact: true })).toBeChecked();
  await expect(toOrder.getByRole('checkbox', { name: 'Select Test Reagent C', exact: true })).not.toBeChecked();
  await expect(page.locator('[data-po-selection-bar]')).toContainText('2 selected');
  await expect(page.getByRole('dialog', { name: 'Review purchase orders' })).toHaveCount(0);
  expect(coverReads).toHaveLength(1);
});

for (const failure of ['http', 'malformed', 'network'] as const) {
  test(`Purchase cover ${failure} failure hides tags and select-all while To order remains usable`, async ({ page }) => {
    const { toOrder } = await setupPurchase(page, {
      coverStatus: failure === 'http' ? 503 : 200,
      coverNetworkFailure: failure === 'network',
      coverBody: failure === 'malformed' ? { items: [{ itemKey: 'Test Reagent A', state: 42 }] } : { items: coverItems },
    });
    await expect(toOrder.getByText('Runs out before delivery', { exact: true })).toHaveCount(0);
    await expect(toOrder.getByRole('button', { name: /Select all that run out before delivery/ })).toHaveCount(0);
    await toOrder.getByRole('checkbox', { name: 'Select Test Reagent A', exact: true }).check();
    await page.getByRole('button', { name: /^Create purchase orders?$/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Review purchase orders' });
    await expect(sheet.getByLabel('Quantity for Test Reagent A')).toHaveValue('5');
    await expect(sheet.getByLabel('Supplier for Test Reagent A')).toHaveValue('Supplier A lowest');
  });
}
