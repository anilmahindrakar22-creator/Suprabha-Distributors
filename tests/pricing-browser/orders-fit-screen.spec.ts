import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { orderBootstrap, orderLine, orderSummary } from '../fixtures/api-builders';
import type { OrderSummary } from '../../lib/order-types';

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const statuses = ['awaiting_confirmation', 'confirmed', 'packed', 'awaiting_tally_billing', 'billed_in_tally', 'ready_for_dispatch'];

function order(index: number, overrides: Partial<OrderSummary> = {}) {
  return orderSummary({
    id: `order-${index}`, orderNumber: `SF-LIST-${String(index).padStart(3, '0')}`, customerName: `Laboratory ${index}`, customerPhone: null,
    status: statuses[index % statuses.length], source: 'phone', notes: null, version: 1, createdAt: hoursAgo(index * 0.2), updatedAt: hoursAgo(0.1),
    lineCount: 1, totalQuantity: 2, reservedQuantity: 0, tallyInvoiceNumber: null, pricingState: 'approved',
    lines: [orderLine({ tallyKey: 'GLUCOSE', itemName: 'Glucose', itemGroup: 'Diasys', quantity: 2, baseUnit: 'Nos', fulfilledQuantity: 2 })],
    ...overrides,
  });
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
    const orders = url.searchParams.get('status') === 'history' ? history() : pending;
    return route.fulfill({ json: orderBootstrap({
      actor: { email: 'staff@example.test', role: 'administrator', roles: ['administrator'] },
      snapshot: { company: 'TEST', fetchedAt: new Date().toISOString(), catalogVersion: 'test', catalog: [] },
      customers: [], orders, operations: { awaitingConfirmation: 2, awaitingTallyBilling: 2, billedNotDispatched: 2, needsAttention: 1 },
      pagination: { total: orders.length, page: 1, pageCount: 1, pageSize: 20 },
    }) });
  });
}

for (const viewport of [{ width: 1280, height: 594 }, { width: 1440, height: 900 }]) {
  test(`desktop Orders fits the available ${viewport.width} × ${viewport.height} frame`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'pricing-desktop', 'Desktop Orders layout');
    await page.setViewportSize(viewport);
    await page.route('**/api/staff-auth', route => route.fulfill({ json: { ok: true, renewAfterSeconds: 3000 } }));
    await page.route('**/api/me', route => route.fulfill({ json: { roles: ['administrator'] } }));
    await page.route('**/api/stock**', route => route.fulfill({ json: { rows: [], groups: [] } }));
    await page.route('**/api/requirements?view=to_order&page=1', route => route.fulfill({
      json: { view: 'to_order', total: 0, waitingCount: 0, unknownCount: 0, page: 1, pageSize: 25, items: [] },
    }));
    await page.route('**/stockflow.html', route => route.fulfill({ contentType: 'text/html', body: readFileSync('public/stockflow.html', 'utf8') }));
    await mockOrders(page);
    await page.goto('/?view=staff-frame');
    await page.getByRole('navigation', { name: 'Application sections' }).getByRole('button', { name: /^orders$/i }).click();
    const queue = page.getByRole('complementary', { name: 'Desktop order queue' });
    await expect(queue).toBeVisible();
    await expect(queue.getByRole('button', { name: /^SF-LIST-0(?:0[1-9]|1[0-2]),/ })).toHaveCount(12);
    await expect(queue.getByRole('region', { name: 'Delivered today' })).toContainText('Delivered Today Lab');

    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight + 1)).toBe(true);
    // The workspace also has its own page scroller, independent of the document.
    expect(await queue.evaluate((element) => {
      const pageScroller = element.parentElement!.closest('.h-full.overflow-y-auto')!;
      return pageScroller.scrollHeight <= pageScroller.clientHeight + 1;
    })).toBe(true);
    const grid = await queue.locator('..').boundingBox();
    expect(grid).not.toBeNull();
    expect(grid!.y + grid!.height).toBeLessThanOrEqual(viewport.height);
    const detail = page.getByLabel('Selected order workspace');
    const detailBox = await detail.boundingBox();
    expect(detailBox).not.toBeNull();
    expect(detailBox!.y + detailBox!.height).toBeLessThanOrEqual(viewport.height);
    expect(await queue.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await queue.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const lastOrder = queue.getByRole('button').last();
    await expect(lastOrder).toBeInViewport({ ratio: 1 });
    expect(await lastOrder.evaluate((element) => {
      const row = element.getBoundingClientRect();
      const pane = element.closest('aside')!.getBoundingClientRect();
      return row.top >= pane.top && row.bottom <= pane.bottom + 1;
    })).toBe(true);
  });
}

test('phone Orders retains the existing list', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockOrders(page);
  await page.goto('/?view=orders-workspace');
  await expect(page.getByRole('button', { name: /^SF-LIST-001/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Urgent & high' })).toContainText('Laboratory 1');
  await expect(page.getByRole('complementary', { name: 'Desktop order queue' })).toHaveCount(0);
  await expect(page.getByLabel('Selected order workspace')).toHaveCount(0);
});
