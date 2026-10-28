import { expect, test, type Page } from '@playwright/test';
import { billingSheet, orderBootstrap, orderSummary } from '../fixtures/api-builders';

test.use({ viewport: { width: 375, height: 812 } });
const orderId = '61000000-0000-4000-8000-000000000002';
type Command = { action: string; payload: Record<string, unknown> };

async function mockChallan(page: Page, role: 'operations' | 'warehouse' | 'billing', overrides: Parameters<typeof orderSummary>[0] = {}, failures: number[] = []) {
  const commands: Command[] = [];
  let order = orderSummary({ id: orderId, pricingState: 'approved', createdAt: new Date().toISOString(), ...overrides });
  await page.route('**/api/orders**', async route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST') {
      const command = route.request().postDataJSON() as Command;
      commands.push(command);
      const failure = failures.shift();
      if (failure) return route.fulfill({ status: failure, json: { error: 'Please retry' } });
      order = { ...order, version: order.version + 1, ...(command.action === 'send_on_challan' ? { status: 'ready_for_dispatch', challanNumber: String(command.payload.challanNumber) } : { tallyInvoiceNumber: String(command.payload.invoiceNumber), challanBilledAt: new Date().toISOString() }) };
      return route.fulfill({ json: { orderId, status: order.status, version: order.version } });
    }
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    const orders = url.searchParams.get('status') === 'history' ? [] : [order];
    return route.fulfill({ json: orderBootstrap({ actor: { email: `${role}@example.test`, role, roles: [role] }, orders, pagination: { total: orders.length, page: 1, pageCount: 1, pageSize: 20 } }) });
  });
  await page.route('**/api/pricing**', route => route.fulfill({ json: billingSheet({ orderId, ready: true, lines: [], total: 0 }) }));
  await page.route('**/api/procurement-requirements**', route => route.fulfill({ json: { requirements: [] } }));
  await page.goto('/?view=orders-workspace');
  await page.getByRole('button', { name: /^SF-TEST-001,/ }).click();
  return { commands, dialog: page.getByRole('dialog', { name: 'Order SF-TEST-001', exact: true }) };
}

test('operations sends an approved packed order on challan on a phone', async ({ page }) => {
  const { commands, dialog } = await mockChallan(page, 'operations');
  const bar = dialog.getByRole('region', { name: 'Order next step' });
  await bar.getByRole('button', { name: 'Send on challan', exact: true }).click();
  await bar.getByLabel(/^Tally delivery challan number/).fill('DC-101');
  await bar.getByRole('button', { name: 'Send on challan', exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ action: 'send_on_challan', payload: { orderId, expectedVersion: 1, challanNumber: 'DC-101', idempotencyKey: expect.any(String) } });
  await expect(dialog.getByText('On challan DC-101', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const scenario of [
  { role: 'operations', pricingState: 'review_required' },
  { role: 'operations', pricingState: 'approval_required' },
  { role: 'warehouse', pricingState: 'approved' },
] as const) test(`hides send challan for ${scenario.role} with ${scenario.pricingState}`, async ({ page }) => {
  const { dialog } = await mockChallan(page, scenario.role, { pricingState: scenario.pricingState });
  await expect(dialog.getByRole('button', { name: 'Send on challan', exact: true })).toHaveCount(0);
});

for (const status of ['ready_for_dispatch', 'dispatched', 'delivered']) test(`billing records a challan invoice when ${status}`, async ({ page }) => {
  const { commands, dialog } = await mockChallan(page, 'billing', { status, challanNumber: 'DC-101', challanOverdue: true });
  await expect(dialog.getByText('On challan DC-101', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Challan not billed', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Bill challan', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Copy for Tally' })).toBeVisible();
  await dialog.getByLabel(/^Tally invoice number for/).fill('INV-55');
  await dialog.getByRole('button', { name: 'Record invoice', exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ action: 'bill_challan', payload: { orderId, expectedVersion: 1, invoiceNumber: 'INV-55', idempotencyKey: expect.any(String) } });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const failure of [500, 408, 429, 409, 400, 403]) test(`challan retry key after HTTP ${failure}`, async ({ page }) => {
  const { commands, dialog } = await mockChallan(page, 'operations', {}, [failure]);
  const bar = dialog.getByRole('region', { name: 'Order next step' });
  await bar.getByRole('button', { name: 'Send on challan', exact: true }).click();
  await bar.getByLabel(/^Tally delivery challan number/).fill('DC-101');
  const send = bar.getByRole('button', { name: 'Send on challan', exact: true });
  await send.click();
  await expect(bar.getByRole('alert')).toContainText('Please retry');
  await send.click();
  await expect.poll(() => commands.length).toBe(2);
  if ([500, 408, 429].includes(failure)) expect(commands[1]).toEqual(commands[0]);
  else expect(commands[1].payload.idempotencyKey).not.toBe(commands[0].payload.idempotencyKey);
});

test('network failure preserves the pending challan command after closing the sheet', async ({ page }) => {
  const { commands, dialog } = await mockChallan(page, 'operations');
  let interrupted: Command | undefined;
  await page.route('**/api/orders', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    interrupted = route.request().postDataJSON() as Command;
    await route.abort('failed');
  }, { times: 1 });
  const bar = dialog.getByRole('region', { name: 'Order next step' });
  await bar.getByRole('button', { name: 'Send on challan', exact: true }).click();
  await bar.getByLabel(/^Tally delivery challan number/).fill('DC-101');
  await bar.getByRole('button', { name: 'Send on challan', exact: true }).click();
  await expect(bar.getByRole('alert')).toBeVisible();
  await bar.getByRole('button', { name: 'Cancel', exact: true }).click();
  await bar.getByRole('button', { name: 'Send on challan', exact: true }).click();
  await expect(bar.getByLabel(/^Tally delivery challan number/)).toBeDisabled();
  await bar.getByRole('button', { name: 'Send on challan', exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toEqual(interrupted);
});
