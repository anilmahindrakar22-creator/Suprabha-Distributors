import { expect, test, type Page } from '@playwright/test';

const pendingWorkspace = (approved: boolean) => ({
  orderId: 'o-wait', orderNumber: 'SO/26-27/0050', customerId: 'c1', customerName: 'Inbox Test Hospital', orderVersion: 2, pricingState: approved ? 'approved' : 'approval_required', currentSnapshotId: null,
  lines: [{ lineId: 'l1', tallyKey: 'STROMATOLYSER', itemName: 'Stromatolyser WH 500 Ml', quantity: 1, recentRates: [{ rate: 4510, invoiceDate: '2026-10-15', invoiceReference: 'SD/26-27/0715', sourceVersion: 'a' }], cost: { id: 'k', amount: 3465, kind: 'purchase_price', effectiveAt: '2026-09-26', sourceReference: '222/26-27', sourceVersion: 'v', previousAmount: 3465, changeAmount: 0, changePercent: 0 }, warnings: [], policy: { version: 'p', minimumMarginPercent: 25, targetMarginPercent: null } }],
  exceptions: approved ? [] : [{ id: 'ex1', lineId: 'l1', referenceRate: 4450, enteredRate: 4450, differenceAmount: 0, differencePercent: 0, reason: 'Keep the last rate.', state: 'pending', requestedBy: 'sales@example.test', requestedAt: '2026-10-18T06:00:00Z', version: 4 }],
  history: [],
});

async function mock(page: Page, posts: Array<Record<string, unknown>>) {
  let approved = false;
  await page.route('**/api/orders**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('list') === '1') return route.fulfill({ json: { orders: [
      { id: 'o-ok', orderNumber: 'SO/26-27/0049', customerName: 'Priced Lab', createdAt: '2026-10-17T06:00:00Z', pricingState: 'approved' },
      { id: 'o-wait', orderNumber: 'SO/26-27/0050', customerName: 'Inbox Test Hospital', createdAt: '2026-10-18T06:00:00Z', pricingState: approved ? 'approved' : 'approval_required' },
    ], pagination: { page: 1, pageCount: 1, pageSize: 20, total: 2 } } });
    return route.fulfill({ json: { customers: [] } });
  });
  await page.route('**/api/pricing**', (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST') { const body = JSON.parse(route.request().postData() || '{}'); posts.push(body); approved = true; return route.fulfill({ json: { ok: true } }); }
    if (url.searchParams.get('orderId') === 'o-wait') return route.fulfill({ json: pendingWorkspace(approved) });
    return route.fulfill({ json: url.searchParams.has('policies') ? { policies: [] } : { contracts: [] } });
  });
}

test('Pricing inbox lists order prices with the facts and approves them', async ({ page }, info) => {
  const posts: Array<Record<string, unknown>> = [];
  await mock(page, posts);
  await page.goto('/?view=workspace');
  const inbox = page.getByRole('region', { name: 'Order prices waiting for approval' });
  const order = inbox.getByRole('article', { name: 'SO/26-27/0050, Inbox Test Hospital' });
  await expect(order).toBeVisible();
  await expect(inbox.getByText('Priced Lab')).toHaveCount(0);
  await expect(order).toContainText('Stromatolyser WH 500 Ml');
  await expect(order).toContainText('₹60 below the latest bill');
  await expect(order).toContainText('22.1%');
  await expect(page.getByText('Customer and order prices')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `work/tmp/pricing-inbox-${info.project.name}.png`, fullPage: true });
  await expect(order.getByRole('button', { name: 'Reject' })).toBeDisabled();
  await order.getByRole('button', { name: 'Approve ₹4,450' }).click();
  await expect(inbox.getByText('SO/26-27/0050: price approved.')).toBeVisible();
  await expect(inbox.getByText('No order prices are waiting for approval.')).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ action: 'approve_price_exception', payload: { exceptionId: 'ex1', expectedVersion: 4, reason: 'Price reviewed and approved' } });
});

test('management changes and approves an inbox price with a required reason', async ({ page }) => {
  const posts: Array<Record<string, unknown>> = [];
  await mock(page, posts);
  // The workspace fixture supplies the management actor, as in the existing inbox test.
  await page.goto('/?view=workspace');
  const inbox = page.getByRole('region', { name: 'Order prices waiting for approval' });
  const order = inbox.getByRole('article', { name: 'SO/26-27/0050, Inbox Test Hospital' });
  await order.getByRole('button', { name: 'Change price…', exact: true }).click();
  const rate = order.getByRole('spinbutton', { name: 'New price for SO/26-27/0050', exact: true });
  await expect(rate).toHaveValue('4450');
  await rate.fill('4510');
  const reason = order.getByRole('textbox', { name: 'Reason for SO/26-27/0050', exact: true });
  const approve = order.getByRole('button', { name: 'Approve ₹4,510', exact: true });
  await expect(reason).toHaveValue('');
  await expect(approve).toBeDisabled();
  await expect(order.getByText('Reason required to change the price', { exact: true })).toBeVisible();
  expect(posts).toHaveLength(0);
  await reason.fill('Use the latest agreed customer rate');
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ action: 'approve_price_exception', payload: { exceptionId: 'ex1', expectedVersion: 4, changedRate: 4510, reason: 'Use the latest agreed customer rate' } });
  await expect(inbox.getByText('SO/26-27/0050: price changed to ₹4,510 and approved.', { exact: true })).toBeVisible();
});

test('an empty capped inbox explains that later orders have not been checked', async ({ page }) => {
  await page.route('**/api/orders**', route => route.fulfill({ json: new URL(route.request().url()).searchParams.has('list') ? { orders: [], pagination: { pageCount: 11 } } : { customers: [] } }));
  await page.route('**/api/pricing**', route => route.fulfill({ json: new URL(route.request().url()).searchParams.has('policies') ? { policies: [] } : { contracts: [] } }));
  await page.goto('/?view=workspace');
  const inbox = page.getByRole('region', { name: 'Order prices waiting for approval' });
  await expect(inbox).toContainText('first 200 active orders');
  await expect(inbox).toContainText('No order prices are waiting for approval in the loaded orders.');
});
