import { expect, test, type Page } from '@playwright/test';

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const statuses = ['awaiting_confirmation', 'confirmed', 'packed', 'awaiting_tally_billing', 'billed_in_tally', 'ready_for_dispatch'];

function order(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `order-${index}`, orderNumber: `SF-LIST-${String(index).padStart(3, '0')}`, customerName: `Laboratory ${index}`, customerPhone: null,
    status: statuses[index % statuses.length], source: 'phone', notes: null, version: 1, createdAt: hoursAgo(index * 0.2), updatedAt: hoursAgo(0.1),
    lineCount: 1, totalQuantity: 2, reservedQuantity: 0, tallyInvoiceNumber: null, pricingState: 'approved',
    lines: [{ tallyKey: 'GLUCOSE', itemName: 'Glucose', itemGroup: 'Diasys', quantity: 2, baseUnit: 'Nos', fulfilledQuantity: 2 }],
    events: [], exceptions: [], installations: [], ...overrides,
  };
}

const pending = Array.from({ length: 12 }, (_, index) => order(index + 1, index === 0 ? { priority: 'urgent' } : {}));
// Built per request so "delivered today" never straddles midnight IST.
const history = () => [
  order(90, { status: 'delivered', customerName: 'Delivered Today Lab', deliveredAt: new Date().toISOString(), createdAt: hoursAgo(40) }),
  order(91, { status: 'delivered', customerName: 'Delivered Last Week Lab', deliveredAt: hoursAgo(24 * 7), createdAt: hoursAgo(24 * 8), updatedAt: hoursAgo(24 * 7) }),
  order(92, { status: 'cancelled', customerName: 'Cancelled Lab', createdAt: hoursAgo(5) }),
];

async function mockOrders(page: Page) {
  await page.route('**/api/orders**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    const isHistory = url.searchParams.get('status') === 'history';
    const orders = isHistory ? history() : pending;
    return route.fulfill({ json: {
      actor: { email: 'staff@example.test', role: 'administrator', roles: ['administrator'] },
      snapshot: { company: 'TEST', fetchedAt: new Date().toISOString(), catalogVersion: 'test', catalog: [] },
      customers: [], orders, operations: { awaitingConfirmation: 2, awaitingTallyBilling: 2, billedNotDispatched: 2, needsAttention: 1 },
      pagination: { total: orders.length, page: 1, pageCount: 1, pageSize: 20 },
    } });
  });
}

test('Active shows pending orders first and only orders delivered today', async ({ page }) => {
  await mockOrders(page);
  await page.goto('/?view=orders-workspace');
  await expect(page.getByRole('region', { name: 'Needs action' })).toContainText('Laboratory 1');
  await expect(page.getByRole('region', { name: 'Delivered today' })).toContainText('Delivered Today Lab');
  await expect(page.getByText('Delivered Last Week Lab')).toHaveCount(0);
  await expect(page.getByText('Cancelled Lab')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Issues/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Old orders stays reachable from Filters', async ({ page }) => {
  await mockOrders(page);
  await page.goto('/?view=orders-workspace');
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('button', { name: 'Old orders' }).click();
  await expect(page.getByText('Delivered Last Week Lab').first()).toBeVisible();
  await expect(page.getByText('Cancelled Lab').first()).toBeVisible();
});

test('phone list fits about ten orders on one screen and opens one order full screen', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout');
  await mockOrders(page);
  await page.goto('/?view=orders-workspace');
  const rows = page.getByRole('button', { name: /^SF-LIST-/ });
  await expect(rows.first()).toBeVisible();
  const firstTop = (await rows.first().boundingBox())?.y ?? 999;
  expect(firstTop).toBeLessThan(260);
  const height = page.viewportSize()?.height ?? 0;
  const visible = await rows.evaluateAll((elements, viewport) => elements.filter((element) => element.getBoundingClientRect().bottom <= viewport).length, height);
  expect(visible).toBeGreaterThanOrEqual(8);
  for (const row of await rows.all()) expect((await row.boundingBox())?.height ?? 0).toBeLessThan(76);

  await page.getByRole('button', { name: /^SF-LIST-001/ }).click();
  const detail = page.getByRole('dialog', { name: 'Order SF-LIST-001' });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('list', { name: 'Order progress' })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Pick & pack complete' })).toBeInViewport();
  await detail.getByRole('button', { name: 'Back to orders' }).click();
  await expect(detail).toBeHidden();
});

test('web list keeps keyboard navigation in the grouped queue', async ({ page, isMobile }) => {
  test.skip(isMobile, 'web layout');
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockOrders(page);
  await page.goto('/?view=orders-workspace');
  const queue = page.getByRole('complementary', { name: 'Desktop order queue' });
  const first = queue.getByRole('button').first();
  await first.focus();
  await page.keyboard.press('ArrowDown');
  await expect(queue.locator('[aria-current="true"]')).toContainText('Laboratory');
  await expect(page.getByLabel('Selected order workspace').getByRole('list', { name: 'Order progress' })).toBeVisible();
  const rowsInView = await queue.getByRole('button').evaluateAll((elements) => elements.filter((element) => element.getBoundingClientRect().bottom <= innerHeight).length);
  expect(rowsInView).toBeGreaterThanOrEqual(10);
  const searchBox = await page.getByLabel('Find existing order').boundingBox();
  const newOrder = await page.getByRole('button', { name: /^\+ Order|Continue order|Loading products/ }).boundingBox();
  expect(searchBox && newOrder && Math.abs(searchBox.y - newOrder.y) < 16).toBeTruthy();
});
