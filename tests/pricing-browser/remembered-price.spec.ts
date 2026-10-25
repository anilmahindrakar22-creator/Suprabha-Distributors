import { expect, test, type Locator, type Page } from '@playwright/test';

const orderId = '61000000-0000-4000-8000-000000000002';
const lineId = '61000000-0000-4000-8000-000000000003';
const exceptionId = '61000000-0000-4000-8000-000000000004';
type Command = { action: string; payload: Record<string, unknown> };

// The same pending-approval journey as order-next-step.spec.ts, with actor roles
// supplied by the orders response and refreshed pricing after the decision.
async function mockPendingApproval(page: Page, role: string) {
  let pricingState = 'approval_required';
  let version = 1;
  const commands: Command[] = [];
  const order = () => ({
    id: orderId, orderNumber: 'SF-NEXT-001', customerName: 'Next Step Laboratory', customerPhone: null,
    status: 'packed', pricingState, version, source: 'phone', notes: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    lineCount: 1, totalQuantity: 1, reservedQuantity: 0, tallyInvoiceNumber: null,
    lines: [{ id: lineId, tallyKey: 'GLUCOSE', itemName: 'Glucose', itemGroup: 'Diasys', quantity: 1, baseUnit: 'Nos', fulfilledQuantity: 1 }],
    events: [], exceptions: [], installations: [], receivedBy: '', deliveredAt: null,
  });
  await page.route('**/api/orders**', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    return route.fulfill({ json: {
      actor: { email: `${role}@example.test`, role, roles: [role] },
      snapshot: { company: 'TEST', fetchedAt: new Date().toISOString(), catalog: [] },
      customers: [], orders: [order()], operations: {},
      pagination: { total: 1, page: 1, pageCount: 1, pageSize: 20 },
    } });
  });
  await page.route('**/api/pricing**', route => {
    if (route.request().method() === 'POST') {
      commands.push(route.request().postDataJSON() as Command);
      pricingState = 'approved';
      version++;
      return route.fulfill({ json: { pricingState } });
    }
    return route.fulfill({ json: {
      orderId, orderNumber: order().orderNumber, customerId: null, customerName: order().customerName,
      orderVersion: version, pricingState, currentSnapshotId: null, history: [],
      exceptions: pricingState === 'approval_required' ? [{ id: exceptionId, lineId, enteredRate: 4450, referenceRate: 4510, differenceAmount: -60, differencePercent: null, reason: 'Keep the earlier customer rate', state: 'pending', requestedBy: 'sales@example.test', requestedAt: new Date().toISOString(), version: 7 }] : [],
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

async function mockEnterPrice(page: Page, overrides: Record<string, unknown> = {}) {
  await page.route('**/api/orders**', route => {
    if (new URL(route.request().url()).searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    return route.fulfill({ json: {
      actor: { email: 'management@example.test', role: 'management', roles: ['management'] },
      snapshot: { company: 'TEST', fetchedAt: new Date().toISOString(), catalog: [] },
      customers: [], operations: {}, pagination: { total: 1, page: 1, pageCount: 1, pageSize: 20 },
      orders: [{
        id: orderId, orderNumber: 'SF-NEXT-001', customerName: 'Next Step Laboratory', customerPhone: null,
        status: 'packed', pricingState: 'review_required', version: 1, source: 'phone', notes: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        lineCount: 1, totalQuantity: 1, reservedQuantity: 0, tallyInvoiceNumber: null,
        lines: [{ id: lineId, tallyKey: 'GLUCOSE', itemName: 'Glucose', itemGroup: 'Diasys', quantity: 1, baseUnit: 'Nos', fulfilledQuantity: 1 }],
        events: [], exceptions: [], installations: [], receivedBy: '', deliveredAt: null,
      }],
    } });
  });
  await page.route('**/api/pricing**', route => route.fulfill({ json: {
    orderId, orderNumber: 'SF-NEXT-001', customerId: null, customerName: 'Next Step Laboratory',
    orderVersion: 1, pricingState: 'review_required', currentSnapshotId: null, history: [], exceptions: [],
    lines: [{
      lineId, tallyKey: 'GLUCOSE', itemName: 'Glucose', quantity: 1, fixed: false,
      resolution: 'NO_PRICE_HISTORY', guardrail: 'PRICE_REVIEW_REQUIRED', proposedRate: null,
      lastRate: null, historicCost: null, currentCost: 3465, costChange: null, continuityPrice: null,
      recommendedPrice: null, targetMarginPrice: null, recommendationReason: 'No eligible customer history',
      continuityGP: null, continuityMargin: null, recommendedGP: null, recommendedMargin: null,
      differenceToCustomer: null, additionalGP: null, evidenceHash: 'a'.repeat(64), warnings: [],
      source: { type: 'NONE', reference: null, date: null, version: null }, cost: null,
      recentRates: [
        { rate: 4510, invoiceDate: '2026-10-15', invoiceReference: 'SD/26-27/0715', sourceVersion: 'a' },
        { rate: 4450, invoiceDate: '2026-10-15', invoiceReference: 'SD/26-27/0715', sourceVersion: 'a' },
        { rate: 4450, invoiceDate: '2026-10-01', invoiceReference: 'SD/26-27/0622', sourceVersion: 'b' },
      ],
      margin: { grossProfitAmount: null, grossMarginPercent: null, previousGrossMarginPercent: null, erosionPercentagePoints: null }, suggestion: null,
      ...overrides,
    }],
  } }));
}

test.beforeEach(async ({ isMobile }) => { test.skip(!isMobile, 'phone next-step bar'); });

test('management saves an approved customer price by default in one tap', async ({ page }) => {
  const commands = await mockPendingApproval(page, 'management');
  const bar = await openOrder(page);
  const save = bar.getByRole('checkbox', { name: "Save as Next Step Laboratory's price for Glucose", exact: true });
  await expect(save).toBeChecked();
  await expect(bar).toContainText('Next orders use this price without approval until purchase cost rises over 2%.');
  await bar.getByRole('button', { name: 'Approve ₹4,450', exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ action: 'approve_price_exception', payload: { exceptionId, expectedVersion: 7, saveAsCustomerPrice: true } });
});

test('management can approve a price for this order only', async ({ page }) => {
  const commands = await mockPendingApproval(page, 'management');
  const bar = await openOrder(page);
  const save = bar.getByRole('checkbox', { name: "Save as Next Step Laboratory's price for Glucose", exact: true });
  await expect(save).toBeChecked();
  await save.uncheck();
  await bar.getByRole('button', { name: 'Approve ₹4,450', exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ action: 'approve_price_exception', payload: { exceptionId, expectedVersion: 7, saveAsCustomerPrice: false } });
});

test('changing the save choice after a failed change-price approval uses a new idempotency key', async ({ page }) => {
  const commands = await mockPendingApproval(page, 'management');
  const attempts: Command[] = [];
  await page.route('**/api/pricing**', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    attempts.push(route.request().postDataJSON() as Command);
    if (attempts.length === 1) return route.fulfill({ status: 500, json: { error: 'Please retry the price decision' } });
    return route.fallback();
  });
  const bar = await openOrder(page);
  await bar.getByRole('button', { name: 'Change price…', exact: true }).click();
  const save = bar.getByRole('checkbox', { name: "Save as Next Step Laboratory's price for Glucose", exact: true });
  await expect(save).toBeChecked();
  await bar.getByLabel('New price per unit (₹) for SF-NEXT-001', { exact: true }).fill('4510');
  await bar.getByLabel('Reason for the change for SF-NEXT-001', { exact: true }).fill('Use the agreed customer rate');
  const approve = bar.getByRole('button', { name: 'Approve ₹4,510', exact: true });
  await approve.click();
  await expect(bar.getByRole('alert')).toContainText('Please retry the price decision');
  await expect(save).toBeEnabled();
  await save.uncheck();
  await approve.click();
  await expect.poll(() => commands.length).toBe(1);
  expect(attempts).toHaveLength(2);
  expect(attempts[0].payload.saveAsCustomerPrice).toBe(true);
  expect(attempts[1].payload.saveAsCustomerPrice).toBe(false);
  expect(attempts[1].payload.idempotencyKey).not.toBe(attempts[0].payload.idempotencyKey);
  expect(commands[0]).toMatchObject({ action: 'approve_price_exception', payload: { changedRate: 4510, saveAsCustomerPrice: false } });
});

test('earlier bill chips fill an ambiguous Enter price without preselecting a rate', async ({ page }, info) => {
  await mockEnterPrice(page);
  const bar = await openOrder(page);
  await bar.getByRole('button', { name: 'Enter price', exact: true }).click();
  await expect(bar).toContainText('No usable selling price');
  await expect(bar.getByText('Earlier prices for this customer', { exact: true })).toBeVisible();
  const chips = bar.getByRole('button', { name: /^Use ₹/ });
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(0)).toHaveText('Use ₹4,510 · 15 Oct · SD/26-27/0715');
  await expect(chips.nth(1)).toHaveText('Use ₹4,450 · 15 Oct · SD/26-27/0715');
  const rate = bar.getByLabel('Custom selling rate', { exact: true });
  const reason = bar.getByLabel('Decision reason', { exact: true });
  const submit = bar.getByRole('button', { name: 'Submit for approval', exact: true });
  await expect(rate).toHaveValue('');
  await expect(reason).toHaveValue('');
  await expect(submit).toBeDisabled();
  await bar.getByRole('button', { name: 'Use ₹4,450 · 15 Oct · SD/26-27/0715', exact: true }).click();
  await expect(rate).toHaveValue('4450');
  await expect(reason).toHaveValue('Same as SD/26-27/0715, 15 Oct');
  await expect(submit).toBeEnabled();
  await expectSheetFits(page, bar, submit);
  await page.screenshot({ path: `work/tmp/remembered-price-${info.project.name}.png`, fullPage: true });
  await rate.fill('4440');
  await reason.fill('Customer agreed a different rate');
  await expect(rate).toHaveValue('4440');
  await expect(reason).toHaveValue('Customer agreed a different rate');
  await expect(submit).toBeEnabled();
});

for (const source of ['LAST_TALLY_INVOICE', 'APPROVED_CONTRACT']) {
  test(`earlier ${source} price opens the editable custom field in the normal branch`, async ({ page }) => {
    await mockEnterPrice(page, {
      proposedRate: 4510, continuityPrice: 4510, recommendedPrice: 4600, lastRate: 4450,
      source: { type: source, reference: 'SD/26-27/0715', date: '2026-10-15', version: 'a' },
    });
    const bar = await openOrder(page);
    await bar.getByRole('button', { name: 'Enter price', exact: true }).click();
    await expect(bar.getByLabel('Custom selling rate', { exact: true })).toHaveCount(0);
    const approved = source === 'APPROVED_CONTRACT';
    await bar.getByRole('button', { name: approved ? 'Use ₹4,450 · approved price' : 'Use ₹4,450 · 15 Oct · SD/26-27/0715', exact: true }).click();
    await expect(bar.getByLabel('Custom selling rate', { exact: true })).toHaveValue('4450');
    await expect(bar.getByLabel('Decision reason', { exact: true })).toHaveValue(approved ? 'Same as approved customer price' : 'Same as SD/26-27/0715, 15 Oct');
    await expectSheetFits(page, bar, bar.getByRole('button', { name: 'Submit for approval', exact: true }));
  });
}

test('earlier prices are newest first, distinct, and limited to four chips', async ({ page }) => {
  await mockEnterPrice(page, { recentRates: [
    { rate: 4200, invoiceDate: '2026-09-01', invoiceReference: 'OLD', sourceVersion: 'a' },
    { rate: 4450, invoiceDate: '2026-10-01', invoiceReference: 'OLDER-4450', sourceVersion: 'b' },
    { rate: 4510, invoiceDate: '2026-10-16', invoiceReference: 'LATEST', sourceVersion: 'c' },
    { rate: 4450, invoiceDate: '2026-10-15', invoiceReference: 'SD/26-27/0715', sourceVersion: 'd' },
    { rate: 4400, invoiceDate: '2026-10-14', invoiceReference: 'THIRD', sourceVersion: 'e' },
    { rate: 4300, invoiceDate: '2026-10-13', invoiceReference: 'FOURTH', sourceVersion: 'f' },
  ] });
  const bar = await openOrder(page);
  await bar.getByRole('button', { name: 'Enter price', exact: true }).click();
  await expect(bar.getByRole('button', { name: /^Use ₹/ })).toHaveText([
    'Use ₹4,510 · 16 Oct · LATEST',
    'Use ₹4,450 · 15 Oct · SD/26-27/0715',
    'Use ₹4,400 · 14 Oct · THIRD',
    'Use ₹4,300 · 13 Oct · FOURTH',
  ]);
  await expect(bar.getByLabel('Custom selling rate', { exact: true })).toHaveValue('');
});
