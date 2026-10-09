import { expect, test } from '@playwright/test';

for (const width of [320, 375, 768, 1280]) {
  test(`order entry keeps product names and controls reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 532 });
    await page.route('**/api/orders**', route => route.fulfill({ json: { orders: [], pagination: { total: 0 } } }));
    await page.goto('/?view=order-entry');
    const dialog = page.getByRole('dialog', { name: 'New order' });
    const product = page.getByRole('combobox', { name: 'Find product' });
    await product.fill('Glucose A');
    await product.press('Enter');
    const quantity = page.getByRole('spinbutton', { name: 'Quantity for Glucose A', exact: true });
    await quantity.scrollIntoViewIfNeeded();
    await expect(quantity).toBeInViewport();
    const card = quantity.locator('..');
    const name = card.locator('strong');
    expect(await name.evaluate(element => getComputedStyle(element).textOverflow)).not.toBe('ellipsis');
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    for (const button of [dialog.getByRole('button', { name: 'Close', exact: true }), dialog.getByRole('button', { name: 'Remove Glucose A', exact: true }), dialog.getByRole('button', { name: 'Save order', exact: true })]) {
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport();
      expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
