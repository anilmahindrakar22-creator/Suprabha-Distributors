import { expect, test, type Locator, type Page } from '@playwright/test';
import { orderSummary, orderLine, orderBootstrap, pricingWorkspace, pricingLine } from '../fixtures/api-builders';

const orderId = '61000000-0000-4000-8000-000000000002';
const lineId = '61000000-0000-4000-8000-000000000003';
const exceptionId = '61000000-0000-4000-8000-000000000004';
type Command = { action: string; payload: Record<string, unknown> };

// The same pending-approval journey as order-next-step.spec.ts, with actor roles
// supplied by the orders response and refreshed pricing after the decision.
async function mockPendingApproval(page: Page, role: 'management' | 'accounts' | 'administrator' | 'sales' | 'operations' | 'warehouse') {
  let pricingState: ReturnType<typeof pricingWorkspace>['pricingState'] = 'approval_required';
  let version = 1;
  const commands: Command[] = [];
  const order = () => orderSummary({
    id: orderId, orderNumber: 'SF-NEXT-001', customerName: 'Next Step Laboratory', customerPhone: null,
    status: 'packed', pricingState, version, source: 'phone', notes: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    lineCount: 1, totalQuantity: 1, reservedQuantity: 0, tallyInvoiceNumber: null,
    lines: [orderLine({ tallyKey: 'GLUCOSE', itemName: 'Glucose', itemGroup: 'Diasys', quantity: 1, baseUnit: 'Nos', fulfilledQuantity: 1 })],
    events: [], exceptions: [], installations: [], receivedBy: '', deliveredAt: null,
  });
  await page.route('**/api/orders**', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    return route.fulfill({ json: orderBootstrap({
      actor: { email: `${role}@example.test`, role, roles: [role] },
      snapshot: { company: 'TEST', fetchedAt: new Date().toISOString(), catalog: [] },
      customers: [], orders: [order()], operations: {},
      pagination: { total: 1, page: 1, pageCount: 1, pageSize: 20 },
    }) });
  });
  await page.route('**/api/pricing**', route => {
    if (route.request().method() === 'POST') {
      commands.push(route.request().postDataJSON() as Command);
      pricingState = 'approved';
      version++;
      return route.fulfill({ json: { pricingState } });
    }
    return route.fulfill({ json: pricingWorkspace({
      orderId, orderNumber: order().orderNumber, customerId: null, customerName: order().customerName,
      orderVersion: version, pricingState, currentSnapshotId: null, history: [],
      exceptions: pricingState === 'approval_required' ? [{ id: exceptionId, lineId, enteredRate: 4450, referenceRate: 4510, differenceAmount: -60, differencePercent: null, reason: 'Keep the earlier customer rate', state: 'pending', requestedBy: 'sales@example.test', requestedAt: new Date().toISOString(), version: 7 }] : [],
      lines: [pricingLine({
        lineId, tallyKey: 'GLUCOSE', itemName: 'Glucose', quantity: 1, fixed: false,
        resolution: 'NO_PRICE_HISTORY', guardrail: 'PRICE_REVIEW_REQUIRED', proposedRate: null,
        lastRate: null, historicCost: null, currentCost: 310, costChange: null, continuityPrice: null,
        recommendedPrice: null, targetMarginPrice: null, recommendationReason: 'No eligible customer history',
        continuityGP: null, continuityMargin: null, recommendedGP: null, recommendedMargin: null,
        differenceToCustomer: null, additionalGP: null, evidenceHash: 'a'.repeat(64), warnings: [],
        source: { type: 'NONE', reference: null, date: null, version: null }, recentRates: [], cost: null,
        margin: { grossProfitAmount: null, grossMarginPercent: null, previousGrossMarginPercent: null, erosionPercentagePoints: null }, suggestion: null,
      })],
    }) });
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

test('management changes and immediately approves the rate from the next-step bar', async ({ page }, info) => {
  const commands = await mockPendingApproval(page, 'management');
  const bar = await openOrder(page);
  await bar.getByRole('button', { name: 'Change price…', exact: true }).click();
  const rate = page.getByRole('spinbutton', { name: 'New price per unit (₹) for SF-NEXT-001', exact: true });
  await expect(rate).toHaveCount(1);
  await expect(rate).toHaveValue('4450');
  await rate.fill('4510');
  await page.getByRole('textbox', { name: 'Reason for the change for SF-NEXT-001', exact: true }).fill('Use the agreed customer rate');
  const approve = bar.getByRole('button', { name: 'Approve ₹4,510', exact: true });
  await expect(approve).toBeEnabled();
  await expectSheetFits(page, bar, approve);
  await page.screenshot({ path: `work/tmp/price-change-${info.project.name}.png`, fullPage: true });
  await approve.click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ action: 'approve_price_exception', payload: { exceptionId, expectedVersion: 7, changedRate: 4510, reason: 'Use the agreed customer rate', idempotencyKey: expect.any(String), saveAsCustomerPrice: true } });
  await expect(bar).toContainText('Price changed and approved');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('changing a price requires the approver to enter a reason of at least three characters', async ({ page }) => {
  const commands = await mockPendingApproval(page, 'management');
  const bar = await openOrder(page);
  await bar.getByRole('button', { name: 'Change price…', exact: true }).click();
  await bar.getByLabel('New price per unit (₹) for SF-NEXT-001', { exact: true }).fill('4510');
  const reason = bar.getByLabel('Reason for the change for SF-NEXT-001', { exact: true });
  const approve = bar.getByRole('button', { name: 'Approve ₹4,510', exact: true });
  await expect(reason).toHaveAttribute('required', '');
  await expect(reason).toHaveAttribute('minlength', '3');
  await expect(reason).toHaveValue('');
  await expect(approve).toBeDisabled();
  await reason.fill('No');
  await expect(approve).toBeDisabled();
  expect(commands).toHaveLength(0);
});

test('accounts cannot change a price while it waits for management approval', async ({ page }) => {
  await mockPendingApproval(page, 'accounts');
  const bar = await openOrder(page);
  await expect(bar.getByText('Waiting for management to approve ₹4,450', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change price…', exact: true })).toHaveCount(0);
});
