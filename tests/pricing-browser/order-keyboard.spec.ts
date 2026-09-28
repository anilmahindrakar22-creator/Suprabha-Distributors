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
