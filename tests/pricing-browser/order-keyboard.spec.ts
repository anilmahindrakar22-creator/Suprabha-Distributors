import { test, expect } from '@playwright/test';

test('order desk can select customer and products, enter quantities, and keep the order unsent', async ({ page }) => {
  let submissions = 0;
  await page.route('**/api/orders**', async (route) => {
    if (route.request().method() === 'POST') submissions += 1;
    await route.fulfill({ json: { orders: [], pagination: { total: 0 } } });
  });
  await page.goto('/?view=order-entry');
  const customer = page.getByRole('combobox', { name: 'Name' });
  await customer.fill('Test');
  await customer.press('ArrowDown');
  await customer.press('Enter');
  await expect(customer).toHaveValue('Test Beta Laboratory');

  const product = page.getByRole('combobox', { name: 'Find product' });
  await expect(product).toBeFocused();
  await product.fill('Glucose');
  await product.press('ArrowDown');
  await product.press('Enter');
  const glucoseQuantity = page.getByRole('spinbutton', { name: 'Quantity for Glucose B' });
  await expect(glucoseQuantity).toBeFocused();
  await glucoseQuantity.fill('3');
  await glucoseQuantity.press('Enter');
  await expect(product).toBeFocused();

  await product.fill('CRP');
  await product.press('Enter');
  await expect(page.getByRole('spinbutton', { name: 'Quantity for CRP' })).toBeFocused();
  await expect(glucoseQuantity).toHaveValue('3');
  await expect(page.getByText('2 products · ready to save')).toBeVisible();
  expect(submissions).toBe(0);
});

test('optional order details stay compact and retain entered values', async ({ page }) => {
  await page.goto('/?view=order-entry');
  const details = page.locator('details').filter({ hasText: 'Order details' });
  await expect(details).toBeVisible();
  await expect(page.getByLabel('Received via')).toBeHidden();
  await details.locator('summary').click();
  await page.getByLabel('Received via').selectOption('whatsapp');
  await page.getByLabel('Order priority').selectOption('urgent');
  await page.getByLabel('Promised delivery').fill('2026-10-05');
  await page.getByLabel('Order notes').fill('Call before delivery');
  await details.locator('summary').click();
  await expect(page.getByLabel('Received via')).toBeHidden();
  await expect(details.locator('summary')).toContainText('WhatsApp');
  await expect(details.locator('summary')).toContainText('Urgent');
  await expect(details.locator('summary')).toContainText('Promised delivery');
  await expect(details.locator('summary')).toContainText('Notes added');
  await details.locator('summary').click();
  await expect(page.getByLabel('Received via')).toHaveValue('whatsapp');
  await expect(page.getByLabel('Order priority')).toHaveValue('urgent');
  await expect(page.getByLabel('Promised delivery')).toHaveValue('2026-10-05');
  await expect(page.getByLabel('Order notes')).toHaveValue('Call before delivery');
});

test('device draft protection stays explicit without dominating the form', async ({ page }) => {
  await page.goto('/?view=order-entry');
  const consent = page.getByRole('checkbox', { name: 'Save draft on this device' });
  await expect(consent).not.toBeChecked();
  const explanation = page.locator('details').filter({ hasText: 'About device drafts' });
  await expect(explanation).toBeVisible();
  await expect(explanation.getByText('Unsubmitted drafts expire after seven days.')).toBeHidden();
  await explanation.locator('summary').click();
  await expect(explanation.getByText('Unsubmitted drafts expire after seven days.')).toBeVisible();
  await consent.check();
  await page.reload();
  await expect(consent).toBeChecked();
  await consent.uncheck();
  await page.reload();
  await expect(consent).not.toBeChecked();
});

test('recent customer products can be added from the existing history response', async ({ page }) => {
  let historyRequests = 0;
  let submissions = 0;
  await page.route('**/api/orders?list=1*', async (route) => {
    historyRequests += 1;
    await route.fulfill({ json: { orders: [{
      id: '33333333-3333-4333-8333-333333333333', orderNumber: 'SF-TEST-1', customerName: 'Test Beta Laboratory',
      customerPhone: null, status: 'delivered', source: 'phone', notes: null, version: 1,
      createdAt: '2026-09-20T10:00:00Z', updatedAt: '2026-09-20T10:00:00Z', lineCount: 3,
      totalQuantity: 3, reservedQuantity: 0, tallyInvoiceNumber: null,
      lines: [
        { tallyKey: 'GLUCOSE-B', itemName: 'Glucose B', quantity: 1 },
        { tallyKey: 'CRP', itemName: 'CRP', quantity: 1 },
        { tallyKey: 'OLD-ITEM', itemName: 'Old item', quantity: 1 },
      ], events: [], exceptions: [], installations: [],
    }], pagination: { total: 1 } } });
  });
  await page.route('**/api/orders', async (route) => {
    if (route.request().method() === 'POST') submissions += 1;
    await route.fulfill({ json: {} });
  });
  await page.goto('/?view=order-entry');
  const customer = page.getByRole('combobox', { name: 'Name' });
  await customer.fill('Beta');
  await customer.press('Enter');
  const recent = page.getByRole('region', { name: 'Recently ordered products' });
  await expect(recent.getByRole('button', { name: 'Add Glucose B' })).toBeVisible();
  await expect(recent.getByRole('button', { name: 'Add CRP' })).toBeVisible();
  await expect(recent.getByRole('button', { name: 'Add Old item' })).toHaveCount(0);
  await recent.getByRole('button', { name: 'Add Glucose B' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Quantity for Glucose B' })).toBeFocused();
  await expect(recent.getByRole('button', { name: 'Add Glucose B' })).toHaveCount(0);
  expect(historyRequests).toBe(1);
  expect(submissions).toBe(0);
});
