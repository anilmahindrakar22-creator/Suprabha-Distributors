import { expect, test } from '@playwright/test';
import { orderSummary, orderLine, pricingWorkspace, pricingLine, orderBootstrap } from '../fixtures/api-builders';

const order = orderSummary({
  id: 'approval-order', orderNumber: 'SF-260920-00034', customerName: 'Vaatsalya Test Hospital', customerPhone: '0800000000', status: 'packed', source: 'phone', notes: null, version: 3,
  createdAt: '2026-09-20T06:56:00Z', updatedAt: '2026-09-20T07:00:00Z', lineCount: 1, totalQuantity: 2, reservedQuantity: 0, tallyInvoiceNumber: null, pricingState: 'approval_required',
  lines: [orderLine({ tallyKey: 'STROMATOLYSER', itemName: 'Stromatolyser WH 500 Ml 3 Part Sysmex', itemGroup: 'Sysmex', quantity: 2, baseUnit: 'Nos', fulfilledQuantity: 2 })],
  events: [], exceptions: [], installations: [],
});
const pricing = pricingWorkspace({
  orderId: order.id, orderNumber: order.orderNumber, customerId: 'c1', customerName: order.customerName, orderVersion: 3, pricingState: 'approval_required', currentSnapshotId: null,
  lines: [pricingLine({
    lineId: 'l1', tallyKey: 'STROMATOLYSER', itemName: 'Stromatolyser WH 500 Ml 3 Part Sysmex', quantity: 2, fixed: false, lastRate: null, historicCost: 3465, currentCost: 3465, costChange: 0,
    resolution: 'PRICE_REVIEW_REQUIRED', guardrail: 'PRICE_REVIEW_REQUIRED', proposedRate: null, source: { type: 'LAST_TALLY_INVOICE', reference: 'SD/26-27/0715', date: '2026-10-15', version: null },
    recentRates: [
      { rate: 4510, invoiceDate: '2026-10-15', invoiceReference: 'SD/26-27/0715', sourceVersion: 'a' },
      { rate: 4450, invoiceDate: '2026-09-19', invoiceReference: 'SD/26-27/0622', sourceVersion: 'b' },
    ],
    cost: { id: 'k', amount: 3465, kind: 'purchase_price', effectiveAt: '2026-09-26', sourceReference: '222/26-27', sourceVersion: 'v', previousAmount: 3465, changeAmount: 0, changePercent: 0 },
    margin: { grossProfitAmount: null, grossMarginPercent: null, previousGrossMarginPercent: null, erosionPercentagePoints: null }, suggestion: null, warnings: [],
    policy: { version: 'general-gross-margin-25-v1', minimumMarginPercent: 25, targetMarginPercent: null },
  })],
  exceptions: [{ id: 'e1', lineId: 'l1', referenceRate: 4450, enteredRate: 4450, differenceAmount: 0, differencePercent: 0, reason: 'Preserve the last customer rate.', state: 'pending', requestedBy: 'sales@example.test', requestedAt: '2026-09-20T06:57:01Z', version: 1 }],
  history: [],
});

test('management approval removes the pending card and refreshes the approved price on phone', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone approval journey');
  let approved = false;
  let approvedReads = 0;
  let command: unknown;
  const pending = pricingWorkspace({
    ...pricing,
    lines: [pricingLine({ ...pricing.lines[0], proposedRate: 590 })],
    exceptions: [{ ...pricing.exceptions[0], enteredRate: 590, referenceRate: 590 }],
  });
  await page.route('**/api/orders**', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    const orders = url.searchParams.get('status') === 'history' ? [] : [orderSummary({
      ...order, version: approved ? order.version + 1 : order.version,
      pricingState: approved ? 'approved' : 'approval_required',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })];
    return route.fulfill({ json: orderBootstrap({
      actor: { email: 'management@example.test', role: 'management', roles: ['management'] }, orders,
      pagination: { total: orders.length, page: 1, pageCount: 1, pageSize: 20 },
    }) });
  });
  await page.route('**/api/pricing**', route => {
    if (route.request().method() === 'POST') {
      command = route.request().postDataJSON();
      approved = true;
      return route.fulfill({ json: { pricingState: 'approved' } });
    }
    if (!approved) return route.fulfill({ json: pending });
    approvedReads++;
    return route.fulfill({ json: pricingWorkspace({
      ...pending, orderVersion: order.version + 1, pricingState: 'approved', exceptions: [],
      lines: [pricingLine({
        ...pending.lines[0], proposedRate: 591, guardrail: 'PRICE_OK',
        source: { type: 'APPROVED_CONTRACT', reference: 'Approved customer price ₹591', date: '2026-10-28', version: '2' },
      })],
    }) });
  });
  await page.goto('/?view=orders-workspace');
  await page.getByRole('button', { name: /^SF-260920-00034/ }).click();
  const card = page.getByRole('region', { name: 'Price waiting for approval' });
  await expect(card).toContainText('₹590');
  const bar = page.getByRole('region', { name: 'Order next step', exact: true });
  await bar.getByRole('button', { name: 'Change price…', exact: true }).click();
  await bar.getByRole('spinbutton', { name: `New price per unit (₹) for ${order.orderNumber}`, exact: true }).fill('591');
  await bar.getByRole('textbox', { name: `Reason for the change for ${order.orderNumber}`, exact: true }).fill('Use the agreed customer rate');
  await bar.getByRole('button', { name: 'Approve ₹591', exact: true }).click();
  await expect.poll(() => command).toMatchObject({ action: 'approve_price_exception', payload: { changedRate: 591 } });
  await expect(card).toHaveCount(0);
  await page.getByText('View order details', { exact: true }).click();
  const review = page.getByRole('region', { name: 'Price review', exact: true });
  await expect(review).toContainText('Verified');
  await expect(review).toContainText('Approved customer price ₹591');
  await expect.poll(() => approvedReads).toBeGreaterThan(0);
});

test('price approval shows the item, recent bills, cost and margin before Approve', async ({ page, isMobile }, info) => {
  await page.route('**/api/pricing**', (route) => route.request().method() === 'GET' ? route.fulfill({ json: pricing }) : route.abort());
  await page.route('**/api/orders**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    const orders = url.searchParams.get('status') === 'history' ? [] : [order];
    return route.fulfill({ json: orderBootstrap({
      actor: { email: 'admin@example.test', role: 'administrator', roles: ['administrator'] },
      snapshot: { company: 'TEST', fetchedAt: new Date().toISOString(), catalog: [] }, customers: [], orders,
      operations: {}, pagination: { total: orders.length, page: 1, pageCount: 1, pageSize: 20 },
    }) });
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
