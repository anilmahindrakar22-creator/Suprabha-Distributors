import { expect, test, type Page } from '@playwright/test';
import { purchaseOrder, purchaseOrderLine, supplierOption, toOrderItem, toOrderResponse } from '../fixtures/api-builders';
import type { PurchaseOrder } from '../../lib/purchase-orders';

type Command = { action: string; payload: { idempotencyKey: string; id?: string; expectedVersion?: number; reason?: string; lines?: Array<{ itemKey: string; quantity?: number; supplierName?: string; receivedQuantity?: number }> } };
const orderItems = [
  toOrderItem({ itemKey: 'A', itemName: 'Reagent A', lowestSupplier: { supplierName: 'Supplier A' } }),
  toOrderItem({ itemKey: 'B', itemName: 'Reagent B', lowestSupplier: { supplierName: 'Supplier B' } }),
];

async function setup(page: Page, { role = 'operations', orders = [purchaseOrder()], failures = [] as number[], noSuppliers = false, lateBody = { view: 'late_pos', leadTimeDays: 7, total: 0, items: [] }, lateStatus = 200 }: { role?: string; orders?: PurchaseOrder[]; failures?: number[]; noSuppliers?: boolean; lateBody?: unknown; lateStatus?: number } = {}) {
  const commands: Command[] = [];
  const reads: string[] = [];
  const lateReads: string[] = [];
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/stockflow.html*', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Stock fixture</p>' }));
  await page.route('**/api/product-requests*', (route) => route.fulfill({ json: { requests: [] } }));
  await page.route('**/api/requirements?*', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: url.searchParams.has('alerts')
      ? { windowDays: 7, alerts: [], pagination: { page: 1, pageCount: 1, total: 0 } }
      : toOrderResponse({ total: 2, items: orderItems }) });
  });
  await page.route('**/api/requirements?view=late_pos', (route) => { lateReads.push(route.request().url()); return route.fulfill({ status: lateStatus, json: lateBody }); });
  await page.route('**/api/purchase-orders*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST') {
      const command = request.postDataJSON() as Command;
      commands.push(command);
      const failure = failures.shift();
      if (failure) { await route.fulfill({ status: failure, json: { error: 'Try again' } }); return; }
      await route.fulfill({ json: command.action === 'create_purchase_orders' ? { purchaseOrders: [purchaseOrder(), purchaseOrder({ poNumber: 'PO/26-27/0002' })] } : { purchaseOrder: orders[0] } });
    } else if (url.searchParams.has('supplierOptions')) {
      const key = url.searchParams.get('supplierOptions')!;
      await route.fulfill({ json: { itemKey: key, suppliers: noSuppliers ? [] : [supplierOption({ supplierName: `Supplier ${key}`, ...(role === 'management' ? { rate: 42 } : {}) })] } });
    } else {
      reads.push(url.search);
      const filtered = orders.filter((po) => po.status === url.searchParams.get('status'));
      const pageNumber = Number(url.searchParams.get('page'));
      await route.fulfill({ json: { page: pageNumber, items: filtered.slice((pageNumber - 1) * 20, pageNumber * 20), total: filtered.length } });
    }
  });
  await page.goto(`/?view=frame&role=${role}`);
  await page.getByRole('button', { name: /^purchase$/i }).click();
  await expect(page.getByRole('heading', { name: 'To order', exact: true })).toBeVisible();
  return { commands, reads, lateReads };
}

async function review(page: Page) {
  await page.getByRole('checkbox', { name: 'Select Reagent A', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Select Reagent B', exact: true }).check();
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create purchase orders', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Review purchase orders' });
  await expect(sheet.getByRole('combobox', { name: 'Supplier for Reagent A' })).toHaveValue('Supplier A');
  await expect(sheet.getByRole('combobox', { name: 'Supplier for Reagent B' })).toHaveValue('Supplier B');
  return sheet;
}

const latePurchaseOrders = {
  view: 'late_pos', leadTimeDays: 7, total: 2,
  items: [
    { poNumber: 'PO/26-27/0001', supplierName: 'Test supplier', createdAt: '2026-12-01T00:00:00+05:30', lateDays: 3, dueLines: 2, dueQuantity: 13 },
    { poNumber: 'PO/26-27/0002', supplierName: 'Other supplier', createdAt: '2026-12-03T00:00:00+05:30', lateDays: 1, dueLines: 1, dueQuantity: 5 },
  ],
};

test('late chip opens the late list, tags the open card and copies the supplier and PO', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as unknown as { copied: string }).copied = text; } } });
  });
  await setup(page, { lateBody: latePurchaseOrders });
  const section = page.getByRole('region', { name: 'Purchase orders', exact: true });
  const chip = section.getByRole('button', { name: '2 late', exact: true });
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect(section.getByRole('article', { name: 'PO/26-27/0001', exact: true }).getByText('3 days late', { exact: true })).toBeVisible();
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  const late = section.getByRole('region', { name: 'Late purchase orders', exact: true });
  await expect(late.getByRole('heading', { name: 'Late purchase orders', exact: true })).toBeVisible();
  await expect(late.getByText('Open longer than the 7-day delivery time.', { exact: true })).toBeVisible();
  await expect(late.getByText('PO/26-27/0001 · Test supplier', { exact: true })).toBeVisible();
  await expect(late.getByText('PO/26-27/0002 · Other supplier', { exact: true })).toBeVisible();
  await expect(late.getByText('3 days late · 2 lines due', { exact: true })).toBeVisible();
  await expect(late.getByText('1 day late · 1 line due', { exact: true })).toBeVisible();
  await late.getByRole('button', { name: 'Copy supplier and PO', exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe('Test supplier – PO/26-27/0001, 3 days late');
  await expect(late.getByRole('button', { name: 'Copied', exact: true }).first()).toBeVisible();
  await chip.click();
  await expect(late).toHaveCount(0);
});

for (const failure of [500, 'invalid'] as const) {
  test(`late purchase order ${failure} response is silent and leaves the list usable`, async ({ page }) => {
    await setup(page, { lateStatus: failure === 500 ? 500 : 200, lateBody: failure === 'invalid' ? { ...latePurchaseOrders, items: [{ ...latePurchaseOrders.items[0], lateDays: -1 }] } : { error: 'Unavailable' } });
    const section = page.getByRole('region', { name: 'Purchase orders', exact: true });
    await expect(section.getByRole('button', { name: 'Details for PO/26-27/0001', exact: true })).toBeVisible();
    await expect(section.getByRole('button', { name: /^\d+ late$/ })).toHaveCount(0);
    await expect(section.getByRole('alert')).toHaveCount(0);
    await section.getByRole('button', { name: 'Details for PO/26-27/0001', exact: true }).click();
    await expect(section.getByText('Test item — 13 Nos', { exact: true })).toBeVisible();
  });
}

test('operations late list contains no currency', async ({ page }) => {
  await setup(page, { lateBody: latePurchaseOrders });
  await page.getByRole('button', { name: '2 late', exact: true }).click();
  const late = page.getByRole('region', { name: 'Late purchase orders', exact: true });
  await expect(late).toBeVisible();
  await expect(late.getByText(/₹/)).toHaveCount(0);
});

test('phone late list has no horizontal scroll', async ({ page }) => {
  await setup(page, { lateBody: { ...latePurchaseOrders, items: latePurchaseOrders.items.map((po) => ({ ...po, supplierName: 'A supplier with a very long name and a long unbroken reference ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ' })) } });
  await page.getByRole('button', { name: '2 late', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Late purchase orders', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('loading another purchase order page does not fetch late purchase orders again', async ({ page }) => {
  const orders = Array.from({ length: 21 }, (_, index) => purchaseOrder({ id: String(index), poNumber: `PO/26-27/${index + 1}` }));
  const { lateReads } = await setup(page, { orders, lateBody: { view: 'late_pos', leadTimeDays: 7, total: 1, items: [{ ...latePurchaseOrders.items[0], dueLines: 1 }] } });
  await expect.poll(() => lateReads.length).toBe(1);
  const section = page.getByRole('region', { name: 'Purchase orders', exact: true });
  await section.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(section.getByRole('article')).toHaveCount(21);
  expect(lateReads).toHaveLength(1);
});

test('operations groups two suppliers, creates both POs and never sees rates', async ({ page }) => {
  const { commands } = await setup(page);
  const sheet = await review(page);
  await expect(sheet.getByRole('heading', { name: 'Supplier A', exact: true })).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Supplier B', exact: true })).toBeVisible();
  await expect(sheet.getByText(/₹/)).toHaveCount(0);
  await expect(sheet.locator('select option').first()).toHaveText('Supplier A (lowest)');
  await expect(sheet.locator('label select')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Create 2 purchase orders' }).click();
  await expect(page.getByText('Created PO/26-27/0001, PO/26-27/0002', { exact: true })).toBeVisible();
  expect(commands[0]).toMatchObject({ action: 'create_purchase_orders', payload: { lines: [
    { itemKey: 'A', quantity: 13, supplierName: 'Supplier A' }, { itemKey: 'B', quantity: 13, supplierName: 'Supplier B' },
  ] } });
  await expect(page.getByText('2 selected', { exact: true })).toHaveCount(0);
});

test('operations PO section contains no currency when rate and totalValue keys are omitted', async ({ page }) => {
  await setup(page);
  const section = page.getByRole('region', { name: 'Purchase orders', exact: true });
  await section.getByRole('button', { name: 'Details for PO/26-27/0001' }).click();
  await expect(section.getByText('Test item — 13 Nos', { exact: true })).toBeVisible();
  await expect(section.getByText(/₹/)).toHaveCount(0);
});

test('management sees the supplied line rate, total and supplier option rate', async ({ page }) => {
  await setup(page, { role: 'management', orders: [purchaseOrder({ totalValue: 546, lines: [purchaseOrderLine({ rate: 42 })] })] });
  const section = page.getByRole('region', { name: 'Purchase orders', exact: true });
  await section.getByRole('button', { name: 'Details for PO/26-27/0001' }).click();
  await expect(section.getByText('Total ₹546', { exact: true })).toBeVisible();
  await expect(section.getByText(/Test item.*₹42/)).toBeVisible();
  const sheet = await review(page);
  await expect(sheet.locator('select option').first()).toHaveText('Supplier A (lowest) · ₹42');
});

test('share copies the share text then marks the current PO version shared', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as unknown as { copied: string }).copied = text; } } });
  });
  const { commands } = await setup(page);
  await page.getByRole('button', { name: 'Share PO/26-27/0001', exact: true }).click();
  await expect(page.getByText('Copied', { exact: true })).toBeVisible();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ action: 'mark_purchase_order_shared', payload: { id: purchaseOrder().id, expectedVersion: 1 } });
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe('Purchase order PO/26-27/0001\nSupplier: Test supplier\nTest item — 13 Nos\nSuprabha Distributors');
});

test('receive submits entered quantities and cancellation requires a reason', async ({ page }) => {
  const { commands } = await setup(page);
  await page.getByRole('button', { name: 'Mark received PO/26-27/0001' }).click();
  const received = page.getByRole('dialog', { name: 'Mark received PO/26-27/0001' });
  await expect(received.getByLabel('Received now for Test item')).toHaveValue('');
  await received.getByLabel('Received now for Test item').fill('7');
  await received.getByRole('button', { name: 'Confirm received' }).click();
  await expect(received).toBeHidden();
  expect(commands[0]).toMatchObject({ action: 'receive_purchase_order', payload: { lines: [{ itemKey: 'TEST-ITEM', receivedQuantity: purchaseOrder().lines[0].receivedQuantity + 7 }] } });
  await page.getByRole('button', { name: 'Cancel PO PO/26-27/0001' }).click();
  const cancelled = page.getByRole('dialog', { name: 'Cancel PO PO/26-27/0001' });
  await expect(cancelled.getByRole('button', { name: 'Confirm cancellation' })).toBeDisabled();
  await cancelled.getByLabel('Reason', { exact: true }).fill('Duplicate purchase order');
  await cancelled.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(cancelled).toBeHidden();
  expect(commands[1]).toMatchObject({ action: 'cancel_purchase_order', payload: { reason: 'Duplicate purchase order' } });
});

test('manual receipt shows still due and rejects a delivery larger than the remainder', async ({ page }) => {
  const { commands } = await setup(page, { orders: [purchaseOrder({ lines: [purchaseOrderLine({ quantity: 10, receivedQuantity: 6 })] })] });
  await page.getByRole('button', { name: 'Mark received PO/26-27/0001' }).click();
  const sheet = page.getByRole('dialog', { name: 'Mark received PO/26-27/0001' });
  await expect(sheet.getByText('Ordered 10 Nos · received 6 · still due 4', { exact: true })).toBeVisible();
  await sheet.getByLabel('Received now for Test item').fill('5');
  await sheet.getByRole('button', { name: 'Confirm received' }).click();
  await expect(sheet.getByText('More than still due (4)', { exact: true })).toBeVisible();
  expect(commands).toHaveLength(0);
});

test('warehouse sees neither selection controls nor purchase orders', async ({ page }) => {
  await setup(page, { role: 'warehouse' });
  await expect(page.getByRole('article', { name: 'Reagent A', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'To order', exact: true }).getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Purchase orders', exact: true })).toHaveCount(0);
});

test('phone has no horizontal scroll and the selection bar leaves the last row reachable', async ({ page }) => {
  await setup(page);
  await page.getByRole('checkbox', { name: 'Select Reagent A', exact: true }).check();
  const bar = page.locator('[data-po-selection-bar]');
  const last = page.getByRole('region', { name: 'To order', exact: true }).getByRole('article').last();
  await last.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await expect(last).toBeInViewport();
  const rowBox = await last.boundingBox();
  const barBox = await bar.boundingBox();
  expect(rowBox!.y + rowBox!.height).toBeLessThanOrEqual(barBox!.y);
  expect(barBox!.height).toBeGreaterThanOrEqual(48);
  expect(barBox!.x).toBeGreaterThanOrEqual(0);
  expect(barBox!.x + barBox!.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const failure of [502, 408, 429]) {
  test(`creation retains the exact command after ${failure} and locks editing`, async ({ page }) => {
    const { commands } = await setup(page, { failures: [failure] });
    const sheet = await review(page);
    await sheet.getByRole('button', { name: 'Create 2 purchase orders' }).click();
    await expect(sheet.getByLabel('Quantity for Reagent A')).toBeDisabled();
    await expect(sheet.getByLabel('Supplier for Reagent B')).toBeDisabled();
    await sheet.getByRole('button', { name: 'Retry creation' }).click();
    await expect(sheet).toBeHidden();
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual(commands[1]);
  });
}

test('no purchase price excludes the line and prevents an empty submission', async ({ page }) => {
  await setup(page, { noSuppliers: true });
  await page.getByRole('checkbox', { name: 'Select Reagent A', exact: true }).check();
  await page.getByRole('button', { name: 'Create purchase order', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Review purchase orders' });
  await expect(sheet.getByText(/No purchase price in Tally for Reagent A/)).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Create 0 purchase orders' })).toBeDisabled();
});

test('network failure retries the same creation command', async ({ page }) => {
  const { commands } = await setup(page);
  let first: unknown;
  await page.route('**/api/purchase-orders', async (route) => {
    if (route.request().method() !== 'POST') { await route.fallback(); return; }
    if (!first) { first = route.request().postDataJSON(); await route.abort('failed'); }
    else await route.fallback();
  });
  const sheet = await review(page);
  await sheet.getByRole('button', { name: 'Create 2 purchase orders' }).click();
  await expect(sheet.getByLabel('Quantity for Reagent A')).toBeDisabled();
  await sheet.getByRole('button', { name: 'Retry creation' }).click();
  await expect(sheet).toBeHidden();
  expect(commands[0]).toEqual(first);
});

for (const failure of [400, 409]) {
  test(`creation drops the key and unlocks after definite ${failure}`, async ({ page }) => {
    const { commands } = await setup(page, { failures: [failure] });
    const sheet = await review(page);
    await sheet.getByRole('button', { name: 'Create 2 purchase orders' }).click();
    await expect(sheet.getByLabel('Quantity for Reagent A')).toBeEnabled();
    if (failure === 409) await expect(sheet.getByText('This purchase order changed. Reload.', { exact: true })).toBeVisible();
    await sheet.getByLabel('Quantity for Reagent A').fill('5');
    await sheet.getByRole('button', { name: 'Create 2 purchase orders' }).click();
    await expect(sheet).toBeHidden();
    expect(commands).toHaveLength(2);
    expect(commands[0].payload.idempotencyKey).not.toBe(commands[1].payload.idempotencyKey);
    expect(commands[1].payload.lines![0].quantity).toBe(5);
  });
}

test('receive keeps quantities locked and retries with the same command', async ({ page }) => {
  const { commands } = await setup(page, { failures: [502] });
  await page.getByRole('button', { name: 'Mark received PO/26-27/0001' }).click();
  const sheet = page.getByRole('dialog', { name: 'Mark received PO/26-27/0001' });
  await sheet.getByLabel('Received now for Test item').fill('2');
  await sheet.getByRole('button', { name: 'Confirm received' }).click();
  await expect(sheet.getByLabel('Received now for Test item')).toBeDisabled();
  await expect(sheet.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  await sheet.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(sheet).toBeHidden();
  expect(commands[0]).toEqual(commands[1]);
  expect(commands[1].payload.lines![0].receivedQuantity).toBe(purchaseOrder().lines[0].receivedQuantity + 2);
});

test('PO conflict shows the reload message and refreshes the list', async ({ page }) => {
  const { reads } = await setup(page, { failures: [409] });
  await page.getByRole('button', { name: 'Cancel PO PO/26-27/0001' }).click();
  const sheet = page.getByRole('dialog', { name: 'Cancel PO PO/26-27/0001' });
  await sheet.getByLabel('Reason', { exact: true }).fill('Duplicate request');
  const before = reads.length;
  await sheet.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(sheet.getByText('This purchase order changed. Reload.', { exact: true })).toBeVisible();
  await expect.poll(() => reads.length).toBeGreaterThan(before);
  await expect(sheet.getByLabel('Reason', { exact: true })).toBeEnabled();
});

test('PO status chips and pagination use the status and page query', async ({ page }) => {
  const orders = Array.from({ length: 21 }, (_, index) => purchaseOrder({ id: String(index), poNumber: `PO/26-27/${index + 1}` }));
  const { reads } = await setup(page, { orders });
  const section = page.getByRole('region', { name: 'Purchase orders', exact: true });
  await expect(section.getByRole('button', { name: 'Open', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await section.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(section.getByRole('article')).toHaveCount(21);
  await expect(section.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0);
  await section.getByRole('button', { name: 'Received', exact: true }).click();
  await expect(section.getByText('No received purchase orders.')).toBeVisible();
  expect(reads).toContain('?page=2&status=open');
  expect(reads).toContain('?page=1&status=received');
});
