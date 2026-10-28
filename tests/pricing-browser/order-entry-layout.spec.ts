import { expect, test } from '@playwright/test';
import { orderBootstrap, orderLine, orderSummary } from '../fixtures/api-builders';

for (const width of [320, 375, 768, 1280]) {
  test(`existing order details contain long names and references at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 532 });
    const order = orderSummary({ id: 'test-order', orderNumber: 'SF-TEST-001', customerName: 'Laboratory'.repeat(18), status: 'phone_order_received', source: 'phone', notes: 'Reference'.repeat(18), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), totalQuantity: 2, lines: [orderLine({ tallyKey: 'GLUCOSE', itemName: 'Reagent'.repeat(20), itemGroup: 'Diasys', quantity: 2, baseUnit: 'Nos', fulfilledQuantity: 0 })] });
    await page.route('**/api/orders**', route => route.fulfill({ json: route.request().url().includes('detailsFor=') ? { exceptions: [], installations: [] } : orderBootstrap({ actor: { email: 'staff@example.test', role: 'sales' }, snapshot: { company: 'TEST', fetchedAt: new Date().toISOString(), catalogVersion: 'test', catalog: [] }, orders: [order], pagination: { total: 1, page: 1, pageCount: 1, pageSize: 20 } }) }));
    await page.route('**/api/procurement-requirements**', route => route.fulfill({ json: { requirements: [] } }));
    await page.goto('/?view=orders-workspace');
    // Below 1024 px the list shows compact rows; tapping one opens the order full screen.
    if (width < 1024) {
      const row = page.getByRole('button', { name: new RegExp(order.orderNumber) });
      expect(await row.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await row.click();
      await expect(page.getByRole('dialog', { name: `Order ${order.orderNumber}` })).toBeVisible();
    }
    const tile = width < 1024 ? page.getByRole('dialog', { name: `Order ${order.orderNumber}` }).locator('article') : page.locator('article').filter({ hasText: order.orderNumber });
    await expect(tile).toBeVisible();
    expect(await tile.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await tile.getByText('View order details', { exact: true }).click();
    await expect(tile.getByText(order.notes!, { exact: true })).toBeVisible();
    expect(await tile.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await tile.getByRole('button', { name: '+ Edit order', exact: true }).click();
    const quantity = tile.getByRole('spinbutton').first();
    await quantity.scrollIntoViewIfNeeded();
    await expect(quantity).toBeInViewport();
    expect(await tile.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
}

for (const width of [320, 375, 768, 1280]) {
  test(`order entry keeps product names and controls reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 532 });
    await page.route('**/api/orders**', route => route.fulfill({ json: orderBootstrap({ orders: [], pagination: { total: 0, page: 1, pageCount: 1, pageSize: 20 } }) }));
    await page.goto('/?view=order-entry');
    const dialog = page.getByRole('dialog', { name: 'New order' });
    const product = page.getByRole('combobox', { name: 'Find product' });
    await product.fill('Glucose A');
    await product.press('Enter');
    const quantity = page.getByRole('spinbutton', { name: /^Quantity for Glucose A in / });
    await quantity.scrollIntoViewIfNeeded();
    await expect(quantity).toBeInViewport();
    const card = dialog.locator('div.rounded-xl').filter({ has: page.getByRole('button', { name: 'Remove Glucose A', exact: true }) }).last();
    const name = card.locator('strong');
    await expect(name).toHaveText('Glucose A');
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
