import { expect, test } from '@playwright/test';

const order = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', orderNumber: 'SO/26-27/0060', customerName: 'Vaatsalya Test Hospital', customerPhone: null, status: 'awaiting_tally_billing', source: 'phone', notes: null, version: 5,
  createdAt: '2026-10-24T05:00:00Z', updatedAt: '2026-10-25T05:00:00Z', lineCount: 1, totalQuantity: 3, reservedQuantity: 0, tallyInvoiceNumber: null, pricingState: 'approved',
  lines: [{ tallyKey: 'STROMATOLYSER', itemName: 'Stromatolyser WH 500 Ml', itemGroup: 'Sysmex', quantity: 3, baseUnit: 'Nos', fulfilledQuantity: 2 }],
  events: [], exceptions: [], installations: [],
};
const sheet = { view: 'billing', orderId: order.id, orderNumber: order.orderNumber, customerName: order.customerName, status: order.status, ready: true, total: 8900,
  lines: [{ lineId: 'l1', itemName: 'Stromatolyser WH 500 Ml', unit: 'Nos', orderedQuantity: 3, packedQuantity: 2, billQuantity: 2, approvedRate: 4450, amount: 8900 }] };

test('billing sees one billing sheet with approved prices, never the full pricing data', async ({ page, isMobile }, info) => {
  const pricingReads: string[] = [];
  await page.route('**/api/pricing**', (route) => {
    const url = new URL(route.request().url());
    pricingReads.push(url.search);
    return url.searchParams.get('view') === 'billing' ? route.fulfill({ json: sheet }) : route.fulfill({ status: 403, json: { error: 'Pricing access is restricted' } });
  });
  await page.route('**/api/orders**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    const orders = url.searchParams.get('status') === 'history' ? [] : [order];
    return route.fulfill({ json: { actor: { email: 'billing@example.test', role: 'billing', roles: ['billing'] }, snapshot: { company: 'TEST', fetchedAt: new Date().toISOString(), catalog: [] }, customers: [], orders, operations: {}, pagination: { total: orders.length, page: 1, pageCount: 1, pageSize: 20 } } });
  });
  await page.goto('/?view=orders-workspace');
  if (isMobile) await page.getByRole('button', { name: /^SO\/26-27\/0060/ }).click();
  const billing = page.getByRole('region', { name: 'Billing sheet' });
  await expect(billing).toContainText('Vaatsalya Test Hospital');
  await expect(billing).toContainText('₹4,450');
  await expect(billing).toContainText('₹8,900');
  await expect(billing).toContainText('ordered 3');
  await expect(billing.getByRole('button', { name: 'Copy for Tally' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Price waiting for approval' })).toHaveCount(0);
  await expect(page.getByLabel('Tally invoice number(s)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark billed', exact: true })).toBeVisible();
  expect(pricingReads.length).toBeGreaterThan(0);
  expect(pricingReads.every((search) => search.includes('view=billing'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `work/tmp/billing-${info.project.name}.png` });
});
