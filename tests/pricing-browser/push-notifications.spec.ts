import { expect, test, type Page } from '@playwright/test';

const orderId = '22222222-2222-4222-8222-222222222222';
const order = { id: orderId, orderNumber: 'SF-26-1043', customerName: 'Care Hospital', customerPhone: null, status: 'awaiting_tally_billing', source: 'phone', notes: null, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lineCount: 1, totalQuantity: 2, reservedQuantity: 0, tallyInvoiceNumber: null, pricingState: 'approved', lines: [], events: [], exceptions: [], installations: [] };

async function mockOrders(page: Page) {
  await page.route('**/api/orders**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('summary') === '1') return route.fulfill({ json: { operations: {} } });
    const query = url.searchParams.get('query') || '';
    const orders = query.startsWith('assignee:') ? [] : !query || query === order.orderNumber ? [order] : [];
    return route.fulfill({ json: { actor: { email: 'staff@example.test', role: 'accounts', roles: ['accounts'] }, snapshot: { company: 'T', fetchedAt: new Date().toISOString(), catalog: [] }, customers: [], operations: {}, orders, pagination: { total: orders.length, page: 1, pageCount: 1, pageSize: 20 } } });
  });
}

test('phone alerts stay hidden until the server enables push', async ({ page }) => {
  await mockOrders(page);
  await page.route('**/api/push-subscription', (route) => route.fulfill({ status: 404, json: { error: 'Not found' } }));
  await page.goto('/?view=frame&role=accounts');
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByText('Device alerts')).toHaveCount(0);
});

test('phone alerts appear once push is enabled', async ({ page }) => {
  await mockOrders(page);
  await page.route('**/api/push-subscription', (route) => route.fulfill({ json: { enabled: true, publicKey: 'B'.repeat(87) } }));
  await page.goto('/?view=frame&role=accounts');
  await page.getByRole('button', { name: /^Notifications/ }).click();
  const panel = page.getByRole('dialog', { name: 'Notifications' });
  await expect(panel.getByText('Device alerts')).toBeVisible();
  await expect(panel.getByRole('switch', { name: 'Get alerts on this device' })).toHaveAttribute('aria-checked', 'false');
});

test('a tapped phone notification opens that exact order', async ({ page, isMobile }) => {
  await mockOrders(page);
  await page.goto(`/?view=frame&role=accounts&openOrder=${orderId}&n=SF-26-1043`);
  if (isMobile) await expect(page.getByRole('dialog', { name: 'Order SF-26-1043' })).toBeVisible();
  else await expect(page.getByLabel('Selected order workspace')).toContainText('SF-26-1043');
});
