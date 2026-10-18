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
  const urgentChip = page.getByRole('region', { name: 'Needs action' }).getByText('Urgent', { exact: true }).first();
  await expect(urgentChip).toHaveText('Urgent');
  await expect(urgentChip.locator('svg[aria-hidden="true"]')).toHaveCount(1);
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

test('administrator opens Active orders and searches across the Pack stage', async ({ page }) => {
  const packOrder = order(2, { status: 'packed', customerName: 'Pack Search Laboratory' });
  const listQueries: Array<{ status: string | null; query: string | null }> = [];
  await page.route('**/api/orders**', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    if (url.searchParams.has('summary')) return route.fulfill({ json: { operations: {} } });
    const status = url.searchParams.get('status');
    const query = url.searchParams.get('query');
    listQueries.push({ status, query });
    const orders = status === 'open' || !status ? [packOrder] : [];
    return route.fulfill({ json: {
      actor: { email: 'administrator@example.test', role: 'administrator', roles: ['administrator'] },
      snapshot: { company: 'TEST', fetchedAt: new Date().toISOString(), catalog: [] }, customers: [], orders,
      operations: {}, pagination: { total: orders.length, page: 1, pageCount: 1, pageSize: 20 },
    } });
  });
  await page.goto('/?view=frame&role=administrator');
  await page.getByRole('button', { name: /^orders/i }).click();
  await expect(page.getByRole('heading', { name: /Active orders/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Active(?:\s|$)/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Find existing order').fill('Pack Search');
  await expect.poll(() => listQueries.some(item => item.query === 'Pack Search' && item.status === 'open')).toBe(true);
  await expect(page.getByText('Pack Search Laboratory', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /Active orders/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Active(?:\s|$)/ })).toHaveAttribute('aria-pressed', 'true');
});

test('administrator filters active orders waiting for price approval', async ({ page }) => {
  const activeOrders = [
    order(201, { pricingState: 'approval_required' }),
    order(202, { pricingState: 'approved' }),
    order(203, { pricingState: 'approval_required' }),
  ];
  await page.route('**/api/orders**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    const orders = url.searchParams.get('status') === 'history' ? [] : activeOrders;
    return route.fulfill({ json: {
      actor: { email: 'admin@example.test', role: 'administrator', roles: ['administrator'] },
      snapshot: { company: 'TEST', fetchedAt: new Date().toISOString(), catalog: [] }, customers: [], orders,
      operations: {}, pagination: { total: orders.length, page: 1, pageCount: 1, pageSize: 20 },
    } });
  });
  await page.goto('/?view=orders-workspace');
  const approvalChip = page.getByRole('button', { name: 'Prices to approve, 2 orders' });
  await expect(approvalChip).toBeVisible();
  await expect(approvalChip.locator('svg[aria-hidden="true"]')).toHaveCount(1);
  await approvalChip.click();
  await expect(approvalChip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Prices to approve' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(?:SF-LIST-201, )?Laboratory 201(?:,| )/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(?:SF-LIST-203, )?Laboratory 203(?:,| )/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(?:SF-LIST-202, )?Laboratory 202(?:,| )/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Active(?:\s|$)/ }).click();
  await expect(approvalChip).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: /^(?:SF-LIST-20[123], )?Laboratory 20[123](?:,| )/ })).toHaveCount(3);
  await approvalChip.click();
  activeOrders[0] = order(201, { pricingState: 'approved' });
  activeOrders[2] = order(203, { pricingState: 'approved' });
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(approvalChip).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Active(?:\s|$)/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^(?:SF-LIST-20[123], )?Laboratory 20[123](?:,| )/ })).toHaveCount(3);
});

test('sales does not see the price approval chip', async ({ page }) => {
  await page.route('**/api/orders**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    const orders = url.searchParams.get('status') === 'history' ? [] : [
      order(211, { pricingState: 'approval_required' }), order(212, { pricingState: 'approved' }), order(213, { pricingState: 'approval_required' }),
    ];
    return route.fulfill({ json: {
      actor: { email: 'sales@example.test', role: 'sales', roles: ['sales'] },
      snapshot: { company: 'TEST', fetchedAt: new Date().toISOString(), catalog: [] }, customers: [], orders,
      operations: {}, pagination: { total: orders.length, page: 1, pageCount: 1, pageSize: 20 },
    } });
  });
  await page.goto('/?view=orders-workspace');
  await expect(page.getByRole('button', { name: /Prices to approve/ })).toHaveCount(0);
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
  const firstDate = rows.first().locator('time');
  await expect(firstDate).toHaveAttribute('datetime', pending[0].createdAt);
  await expect(firstDate).toHaveAttribute('title', /^Ordered \d{1,2} [A-Z][a-z]{2} \d{4}, /);
  await expect(firstDate).not.toHaveText('');

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
