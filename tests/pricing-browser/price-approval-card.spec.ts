import { expect, test } from '@playwright/test';

const order = {
  id: 'approval-order', orderNumber: 'SF-260920-00034', customerName: 'Vaatsalya Test Hospital', customerPhone: '0800000000', status: 'packed', source: 'phone', notes: null, version: 3,
  createdAt: '2026-09-20T06:56:00Z', updatedAt: '2026-09-20T07:00:00Z', lineCount: 1, totalQuantity: 2, reservedQuantity: 0, tallyInvoiceNumber: null, pricingState: 'approval_required',
  lines: [{ tallyKey: 'STROMATOLYSER', itemName: 'Stromatolyser WH 500 Ml 3 Part Sysmex', itemGroup: 'Sysmex', quantity: 2, baseUnit: 'Nos', fulfilledQuantity: 2 }],
  events: [], exceptions: [], installations: [],
};
const pricing = {
  orderId: order.id, orderNumber: order.orderNumber, customerId: 'c1', customerName: order.customerName, orderVersion: 3, pricingState: 'approval_required', currentSnapshotId: null,
  lines: [{
    lineId: 'l1', tallyKey: 'STROMATOLYSER', itemName: 'Stromatolyser WH 500 Ml 3 Part Sysmex', quantity: 2, fixed: false, lastRate: null, historicCost: 3465, currentCost: 3465, costChange: 0,
    resolution: 'PRICE_REVIEW_REQUIRED', guardrail: 'PRICE_REVIEW_REQUIRED', proposedRate: null, source: { type: 'LAST_TALLY_INVOICE', reference: 'SD/26-27/0715', date: '2026-10-15', version: null },
    recentRates: [
      { rate: 4510, invoiceDate: '2026-10-15', invoiceReference: 'SD/26-27/0715', sourceVersion: 'a' },
      { rate: 4450, invoiceDate: '2026-09-19', invoiceReference: 'SD/26-27/0622', sourceVersion: 'b' },
    ],
    cost: { id: 'k', amount: 3465, kind: 'purchase_price', effectiveAt: '2026-09-26', sourceReference: '222/26-27', sourceVersion: 'v', previousAmount: 3465, changeAmount: 0, changePercent: 0 },
    margin: { grossProfitAmount: null, grossMarginPercent: null, previousGrossMarginPercent: null, erosionPercentagePoints: null }, suggestion: null, warnings: [],
    policy: { version: 'general-gross-margin-25-v1', minimumMarginPercent: 25, targetMarginPercent: null },
  }],
  exceptions: [{ id: 'e1', lineId: 'l1', referenceRate: 4450, enteredRate: 4450, differenceAmount: 0, differencePercent: 0, reason: 'Preserve the last customer rate.', state: 'pending', requestedBy: 'sales@example.test', requestedAt: '2026-09-20T06:57:01Z', version: 1 }],
  history: [],
};

test('price approval shows the item, recent bills, cost and margin before Approve', async ({ page, isMobile }, info) => {
  await page.route('**/api/pricing**', (route) => route.request().method() === 'GET' ? route.fulfill({ json: pricing }) : route.abort());
  await page.route('**/api/orders**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    const orders = url.searchParams.get('status') === 'history' ? [] : [order];
    return route.fulfill({ json: {
      actor: { email: 'admin@example.test', role: 'administrator', roles: ['administrator'] },
      snapshot: { company: 'TEST', fetchedAt: new Date().toISOString(), catalog: [] }, customers: [], orders,
      operations: {}, pagination: { total: orders.length, page: 1, pageCount: 1, pageSize: 20 },
    } });
  });
  await page.goto('/?view=orders-workspace');
  await page.getByRole('button', { name: 'Prices to approve, 1 orders' }).click();
  await expect(page.getByText('1 to approve')).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: /^SF-260920-00034/ }).click();
  const card = page.getByRole('region', { name: 'Price waiting for approval' });
  await expect(card).toContainText('Stromatolyser WH 500 Ml 3 Part Sysmex');
  await expect(card).toContainText('₹4,450');
  await expect(card).toContainText('₹8,900 total');
  await expect(card).toContainText('₹4,510');
  await expect(card).toContainText('SD/26-27/0715');
  await expect(card).toContainText('₹60 below the latest bill');
  await expect(card).toContainText('22.1%');
  await expect(card).toContainText('Below the 25% minimum');
  await expect(card).toContainText('Cost ₹3,465 · bill 222/26-27');
  await expect(card).toContainText('Preserve the last customer rate.');
  await expect(page.getByRole('button', { name: 'Approve ₹4,450' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `work/tmp/approval-${info.project.name}.png`, fullPage: false });
});
