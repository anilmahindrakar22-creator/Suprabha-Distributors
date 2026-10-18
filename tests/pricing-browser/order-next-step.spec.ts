import { expect, test, type Locator, type Page } from '@playwright/test';

const orderId = '61000000-0000-4000-8000-000000000002';
const lineId = '61000000-0000-4000-8000-000000000003';
const exceptionId = '61000000-0000-4000-8000-000000000004';
type Command = { action: string; payload: Record<string, unknown> };

async function mockJourney(page: Page, role: string, initialStatus = 'packed', pending = false) {
  let status = initialStatus;
  let pricingState = status === 'packed' ? pending ? 'approval_required' : 'review_required' : 'approved';
  let version = 1;
  let receivedBy = '';
  const commands: Command[] = [];
  const order = () => ({
    id: orderId, orderNumber: 'SF-NEXT-001', customerName: 'Next Step Laboratory', customerPhone: null,
    status, pricingState, version, source: 'phone', notes: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    lineCount: 1, totalQuantity: 1, reservedQuantity: 0, tallyInvoiceNumber: null,
    lines: [{ id: lineId, tallyKey: 'GLUCOSE', itemName: 'Glucose', itemGroup: 'Diasys', quantity: 1, baseUnit: 'Nos', fulfilledQuantity: 1 }],
    events: [], exceptions: [], installations: [], receivedBy,
    deliveredAt: status === 'delivered' ? new Date().toISOString() : null,
  });
  await page.route('**/api/orders**', async route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST') {
      const command = route.request().postDataJSON() as Command;
      commands.push(command);
      if (command.action === 'save_dispatch') status = 'dispatched';
      if (command.action === 'confirm_delivery') { status = 'delivered'; receivedBy = String(command.payload.receivedBy); }
      version++;
      return route.fulfill({ json: { orderId, status, version } });
    }
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    return route.fulfill({ json: {
      actor: { email: `${role}@example.test`, role, roles: [role] },
      snapshot: { company: 'TEST', fetchedAt: new Date().toISOString(), catalog: [] },
      customers: [], orders: status === 'delivered' ? [] : [order()], operations: {},
      pagination: { total: status === 'delivered' ? 0 : 1, page: 1, pageCount: 1, pageSize: 20 },
    } });
  });
  await page.route('**/api/pricing**', async route => {
    if (route.request().method() === 'POST') {
      const command = route.request().postDataJSON() as Command;
      commands.push(command);
      pricingState = command.action === 'submit_order_pricing' ? 'approval_required' : command.action === 'reject_price_exception' ? 'review_required' : 'approved';
      version++;
      return route.fulfill({ json: { pricingState } });
    }
    return route.fulfill({ json: {
      orderId, orderNumber: order().orderNumber, customerId: null, customerName: order().customerName,
      orderVersion: version, pricingState, currentSnapshotId: null, history: [],
      exceptions: pricingState === 'approval_required' ? [{ id: exceptionId, lineId, enteredRate: 404.66, referenceRate: null, differenceAmount: null, differencePercent: null, reason: 'Customer agreed price', state: 'pending', requestedBy: 'sales@example.test', requestedAt: new Date().toISOString(), version: 7 }] : [],
      lines: [{
        lineId, tallyKey: 'GLUCOSE', itemName: 'Glucose', quantity: 1, fixed: false,
        resolution: 'NO_PRICE_HISTORY', guardrail: 'PRICE_REVIEW_REQUIRED', proposedRate: null,
        lastRate: null, historicCost: null, currentCost: 310, costChange: null, continuityPrice: null,
        recommendedPrice: null, targetMarginPrice: null, recommendationReason: 'No eligible customer history',
        continuityGP: null, continuityMargin: null, recommendedGP: null, recommendedMargin: null,
        differenceToCustomer: null, additionalGP: null, evidenceHash: 'a'.repeat(64), warnings: [],
        source: { type: 'NONE', reference: null, date: null, version: null }, recentRates: [], cost: null,
        margin: { grossProfitAmount: null, grossMarginPercent: null, previousGrossMarginPercent: null, erosionPercentagePoints: null }, suggestion: null,
      }],
    } });
  });
  return commands;
}

async function openOrder(page: Page) {
  await page.goto('/?view=orders-workspace');
  await page.getByRole('button', { name: /^SF-NEXT-001,/ }).click();
  return page.getByRole('dialog', { name: 'Order SF-NEXT-001', exact: true }).getByRole('region', { name: 'Order next step', exact: true });
}

async function expectSheetFits(page: Page, bar: Locator, primary: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await bar.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await primary.scrollIntoViewIfNeeded();
  await expect(primary).toBeInViewport();
  await expect(bar.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
}

test.beforeEach(async ({ isMobile }) => { test.skip(!isMobile, 'phone next-step bar'); });

test('administrator enters and approves a price directly from the next-step bar', async ({ page }) => {
  const commands = await mockJourney(page, 'administrator');
  const bar = await openOrder(page);
  await bar.getByRole('button', { name: 'Enter price', exact: true }).click();
  await bar.getByLabel('Custom selling rate').fill('404.66');
  await bar.getByLabel('Decision reason').fill('Customer agreed price');
  const submit = bar.getByRole('button', { name: 'Submit for approval', exact: true });
  await expectSheetFits(page, bar, submit);
  await submit.click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ action: 'submit_order_pricing', payload: { orderId, expectedVersion: 1, lines: [{ lineId, enteredRate: 404.66, reason: 'Customer agreed price', evidenceHash: 'a'.repeat(64) }] } });
  await bar.getByRole('button', { name: 'Approve ₹404.66', exact: true }).click();
  await expect.poll(() => commands.length).toBe(2);
  expect(commands[1]).toMatchObject({ action: 'approve_price_exception', payload: { exceptionId, expectedVersion: 7, reason: 'Price reviewed and approved' } });
  await expect(bar.getByRole('button', { name: 'Send to Tally billing', exact: true })).toBeVisible();
});

test('sales sees the pending price and waits for management', async ({ page }) => {
  await mockJourney(page, 'sales', 'packed', true);
  const bar = await openOrder(page);
  await expect(bar).toContainText('Waiting for management to approve ₹404.66');
  await expect(bar.getByRole('button')).toHaveCount(0);
});

test('rejecting a price requires a reason and keeps the sheet action reachable', async ({ page }) => {
  const commands = await mockJourney(page, 'administrator', 'packed', true);
  const bar = await openOrder(page);
  await bar.getByRole('button', { name: 'Reject', exact: true }).click();
  const reason = bar.getByLabel('Rejection reason', { exact: true });
  const reject = bar.getByRole('button', { name: 'Reject price', exact: true });
  await expect(reason).toHaveAttribute('required', '');
  await expect(reject).toBeDisabled();
  await reason.fill('No');
  await expect(reject).toBeDisabled();
  expect(commands).toHaveLength(0);
  await reason.fill('Please review the agreed customer rate');
  await expectSheetFits(page, bar, reject);
  await expect(reject).toBeEnabled();
  await reject.click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ action: 'reject_price_exception', payload: { exceptionId, expectedVersion: 7, reason: 'Please review the agreed customer rate' } });
  await expect(bar.getByRole('button', { name: 'Enter price', exact: true })).toBeVisible();
});

test('operations dispatches and confirms delivery through reachable sheets', async ({ page }) => {
  const commands = await mockJourney(page, 'operations', 'ready_for_dispatch');
  const bar = await openOrder(page);
  await bar.getByRole('button', { name: 'Dispatch order', exact: true }).click();
  await bar.getByLabel('Courier / transporter').fill('Test Courier');
  await bar.getByLabel('Tracking / docket number').fill('TRACK-001');
  await bar.getByLabel('Dispatch date').fill('2026-10-18');
  await bar.getByLabel('Vehicle number').fill('KA01AB1234');
  const dispatch = bar.getByRole('button', { name: 'Save and mark dispatched', exact: true });
  await expectSheetFits(page, bar, dispatch);
  await dispatch.click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ action: 'save_dispatch', payload: { orderId, expectedVersion: 1, courierName: 'Test Courier', trackingNumber: 'TRACK-001', dispatchDate: '2026-10-18', vehicleNumber: 'KA01AB1234' } });
  await bar.getByRole('button', { name: 'Confirm delivery', exact: true }).click();
  const deliver = bar.getByRole('button', { name: 'Confirm delivery', exact: true });
  await expect(deliver).toBeDisabled();
  await expect(bar.getByLabel('Delivered at')).not.toHaveValue('');
  await bar.getByLabel('Received by').fill('Dr Rao');
  await bar.getByLabel('Proof of delivery reference').fill('POD-001');
  await expectSheetFits(page, bar, deliver);
  await deliver.click();
  await expect.poll(() => commands.length).toBe(2);
  expect(commands[1]).toMatchObject({ action: 'confirm_delivery', payload: { orderId, expectedVersion: 2, receivedBy: 'Dr Rao', podReference: 'POD-001', deliveredAt: expect.any(String) } });
  // The acknowledgement contains no full order and subsequent list reads omit the delivered order.
  await expect(page.getByRole('dialog', { name: 'Order SF-NEXT-001', exact: true })).toBeVisible();
  await expect(bar).toContainText('Delivered · received by Dr Rao');
});

test('sales sees that dispatch is waiting for Operations', async ({ page }) => {
  await mockJourney(page, 'sales', 'ready_for_dispatch');
  const bar = await openOrder(page);
  await expect(bar).toContainText('Next: Dispatch order · waiting for Operations');
  await expect(bar.getByRole('button')).toHaveCount(0);
});
