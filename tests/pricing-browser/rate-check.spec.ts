import { expect, test } from '@playwright/test';
import { orderSummary, orderLine, rateCheck, orderBootstrap } from '../fixtures/api-builders';

const order = orderSummary({
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', orderNumber: 'SO/26-27/0060', customerName: 'Vaatsalya Test Hospital', customerPhone: null, status: 'billed_in_tally', source: 'phone', notes: null, version: 5,
  createdAt: '2026-10-24T05:00:00Z', updatedAt: '2026-10-25T05:00:00Z', lineCount: 1, totalQuantity: 3, reservedQuantity: 0, tallyInvoiceNumber: 'SD/26-27/9001', pricingState: 'approved',
  lines: [orderLine({ tallyKey: 'STROMATOLYSER', itemName: 'Stromatolyser WH 500 Ml', itemGroup: 'Sysmex', quantity: 3, baseUnit: 'Nos', fulfilledQuantity: 2 })],
  events: [], exceptions: [], installations: [],
});
const check = rateCheck({
  view: 'rate_check', orderId: order.id, orderNumber: order.orderNumber, customerName: order.customerName, status: order.status, tolerance: 1, state: 'different', differentCount: 1,
  lines: [
    { lineId: 'l1', tallyKey: 'STROMATOLYSER', itemName: 'Stromatolyser WH 500 Ml', approvedRate: 4450, invoiceRates: [4448.5], difference: -1.5, state: 'different' },
    { lineId: 'l2', tallyKey: 'MATCHING', itemName: 'Matching item', approvedRate: 100, invoiceRates: [100], difference: 0, state: 'matches' },
  ],
});

test('management sees Tally rate differences against the approved price', async ({ page, isMobile }, info) => {
  await page.route('**/api/pricing**', (route) => {
    const url = new URL(route.request().url());
    return url.searchParams.get('view') === 'rate_check' ? route.fulfill({ json: check }) : route.fulfill({ status: 403, json: { error: 'Pricing access is restricted' } });
  });
  await page.route('**/api/orders**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    const orders = url.searchParams.get('status') === 'history' ? [] : [order];
    return route.fulfill({ json: orderBootstrap({ actor: { email: 'management@example.test', role: 'management', roles: ['management'] }, snapshot: { company: 'TEST', fetchedAt: new Date().toISOString(), catalog: [] }, customers: [], orders, operations: {}, pagination: { total: orders.length, page: 1, pageCount: 1, pageSize: 20 } }) });
  });
  await page.goto('/?view=orders-workspace');
  if (isMobile) await page.getByRole('button', { name: /^SO\/26-27\/0060/ }).click();
  const orderTile = isMobile
    ? page.getByRole('dialog', { name: `Order ${order.orderNumber}` })
    : page.locator('article').filter({ hasText: order.orderNumber });
  await orderTile.getByText('View order details', { exact: true }).click();
  const rateCheck = page.getByRole('region', { name: 'Rate check', exact: true });
  await expect(rateCheck).toContainText('1 item differs from the approved price');
  await expect(rateCheck).toContainText('Billed ₹1.5 lower per unit');
  await expect(rateCheck).toContainText('All other items match');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `work/tmp/rate-check-${info.project.name}.png` });
});

test('billing-only actor never requests a rate check', async ({ page, isMobile }) => {
  const pricingReads: string[] = [];
  await page.route('**/api/pricing**', (route) => {
    pricingReads.push(route.request().url());
    return route.fulfill({ status: 403, json: { error: 'Pricing access is restricted' } });
  });
  await page.route('**/api/orders**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    const orders = url.searchParams.get('status') === 'history' ? [] : [order];
    return route.fulfill({ json: orderBootstrap({ actor: { email: 'billing@example.test', role: 'billing', roles: ['billing'] }, snapshot: { company: 'TEST', fetchedAt: new Date().toISOString(), catalog: [] }, customers: [], orders, operations: {}, pagination: { total: orders.length, page: 1, pageCount: 1, pageSize: 20 } }) });
  });
  await page.goto('/?view=orders-workspace');
  if (isMobile) await page.getByRole('button', { name: /^SO\/26-27\/0060/ }).click();
  await expect(page.getByRole('region', { name: 'Billing sheet' })).toContainText('Pricing access is restricted');
  const orderTile = isMobile
    ? page.getByRole('dialog', { name: `Order ${order.orderNumber}` })
    : page.locator('article').filter({ hasText: order.orderNumber });
  await orderTile.getByText('View order details', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Rate check', exact: true })).toHaveCount(0);
  expect(pricingReads.length).toBeGreaterThan(0);
  expect(pricingReads.some((url) => url.includes('rate_check'))).toBe(false);
});
