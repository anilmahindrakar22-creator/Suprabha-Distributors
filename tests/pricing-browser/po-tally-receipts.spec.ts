import { expect, test, type Page } from '@playwright/test';
import { purchaseOrder, supplierOption, toOrderItem, toOrderResponse } from '../fixtures/api-builders';
import type { TallyReceiptCandidate } from '../../lib/po-tally-receipts';

const candidate: TallyReceiptCandidate = { sourceId: 'purchase-1234', lineKey: '1', date: '2026-10-29', reference: 'Purchase 1234', quantity: 10, unit: 'Nos', selectable: true, reason: null };
type Command = { action: string; payload: { id: string; expectedVersion: number; idempotencyKey: string; links: Array<{ itemKey: string; sourceId: string; lineKey: string }> } };
const orderItems = [
  toOrderItem({ itemKey: 'A', itemName: 'Reagent A', lowestSupplier: { supplierName: 'Supplier A' } }),
  toOrderItem({ itemKey: 'B', itemName: 'Reagent B', lowestSupplier: { supplierName: 'Supplier B' } }),
];

// Same frame URL, fixtures and baseline mocks as purchase-orders.spec.ts.
async function setup(page: Page, width: number, { candidates = [candidate], countsFail = false, receiptsFail = false, failures = [] as number[], orders = [purchaseOrder()] } = {}) {
  const commands: Command[] = [];
  const reads: string[] = [];
  const countsReads: string[][] = [];
  let receiptReads = 0;
  await page.setViewportSize({ width, height: 812 });
  await page.route('**/stockflow.html*', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Stock fixture</p>' }));
  await page.route('**/api/product-requests*', (route) => route.fulfill({ json: { requests: [] } }));
  await page.route('**/api/requirements?*', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: url.searchParams.has('alerts')
      ? { windowDays: 7, alerts: [], pagination: { page: 1, pageCount: 1, total: 0 } }
      : toOrderResponse({ total: 2, items: orderItems }) });
  });
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
      await route.fulfill({ json: { itemKey: key, suppliers: [supplierOption({ supplierName: `Supplier ${key}` })] } });
    } else {
      reads.push(url.search);
      const filtered = orders.filter((po) => po.status === url.searchParams.get('status'));
      const pageNumber = Number(url.searchParams.get('page'));
      await route.fulfill({ json: { page: pageNumber, items: filtered.slice((pageNumber - 1) * 20, pageNumber * 20), total: filtered.length } });
    }
  });
  await page.route('**/api/purchase-orders?**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('tallyReceiptCounts')) {
      const ids = url.searchParams.get('tallyReceiptCounts')!.split(',');
      countsReads.push(ids);
      await route.fulfill({ status: countsFail ? 502 : 200, json: countsFail ? { error: 'Try again' } : { counts: Object.fromEntries(ids.map((id) => [id, 1])) } });
    } else if (url.searchParams.has('tallyReceipts')) {
      receiptReads++;
      await route.fulfill({ status: receiptsFail ? 502 : 200, json: receiptsFail ? { error: 'Try again' } : {
        poId: purchaseOrder().id, version: receiptReads,
        lines: [{ ...purchaseOrder().lines[0], remaining: 13, candidates }],
      } });
    } else await route.fallback();
  });
  await page.goto('/?view=frame&role=operations');
  await page.getByRole('button', { name: /^requests$/i }).click();
  await expect(page.getByRole('heading', { name: 'To order', exact: true })).toBeVisible();
  return { commands, reads, countsReads, receiptReads: () => receiptReads };
}

async function openSheet(page: Page) {
  await page.getByRole('button', { name: 'Mark received PO/26-27/0001' }).click();
  const sheet = page.getByRole('dialog', { name: 'Mark received PO/26-27/0001' });
  await expect(sheet.getByText('Loading Tally receipts…')).toHaveCount(0);
  return sheet;
}

for (const width of [375, 1280]) test.describe(`${width}px`, () => {
  test('chip fetches once per loaded page with at most 20 open PO IDs', async ({ page }) => {
    const orders = Array.from({ length: 21 }, (_, index) => purchaseOrder({ id: `61000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, poNumber: `PO/26-27/${index + 1}` }));
    const { countsReads } = await setup(page, width, { orders });
    await expect(page.getByText('Tally shows a receipt', { exact: true })).toHaveCount(20);
    expect(countsReads).toEqual([orders.slice(0, 20).map((po) => po.id)]);
    await page.getByRole('button', { name: 'Load more', exact: true }).click();
    await expect(page.getByText('Tally shows a receipt', { exact: true })).toHaveCount(21);
    expect(countsReads).toEqual([orders.slice(0, 20).map((po) => po.id), [orders[20].id]]);
  });

  test('single candidate is preselected and Record posts links and a UUID key', async ({ page }) => {
    const { commands } = await setup(page, width);
    const sheet = await openSheet(page);
    await expect(sheet.getByRole('checkbox', { name: '29 Oct · Purchase 1234 · 10 Nos' })).toBeChecked();
    await expect(sheet.getByLabel('Received quantity for Test item')).toHaveCount(0);
    await sheet.getByRole('checkbox').uncheck();
    await expect(sheet.getByRole('button', { name: 'Record Tally receipt' })).toBeDisabled();
    await sheet.getByRole('checkbox').check();
    await sheet.getByRole('button', { name: 'Record Tally receipt' }).click();
    await expect(sheet).toBeHidden();
    expect(commands[0]).toMatchObject({ action: 'receive_from_tally', payload: { id: purchaseOrder().id, expectedVersion: 1, links: [{ itemKey: 'TEST-ITEM', sourceId: candidate.sourceId, lineKey: candidate.lineKey }] } });
    expect(commands[0].payload.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  test('unit mismatch shows muted reason without a checkbox and permits manual entry', async ({ page }) => {
    await setup(page, width, { candidates: [{ ...candidate, unit: 'Box', selectable: false, reason: 'unit_mismatch' }] });
    const sheet = await openSheet(page);
    await expect(sheet.getByText(/different unit, enter by hand/)).toBeVisible();
    await expect(sheet.getByRole('checkbox')).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: 'Record Tally receipt' })).toBeDisabled();
    await sheet.getByRole('button', { name: 'Enter quantities by hand' }).click();
    await expect(sheet.getByLabel('Received quantity for Test item')).toHaveValue('13');
  });

  test('409 keeps the sheet open, reloads candidates and PO, and drops the key', async ({ page }) => {
    const { commands, reads, receiptReads } = await setup(page, width, { failures: [409] });
    const sheet = await openSheet(page);
    const before = reads.length;
    await sheet.getByRole('button', { name: 'Record Tally receipt' }).click();
    await expect(sheet.getByText('This PO changed; check and try again', { exact: true })).toBeVisible();
    await expect.poll(receiptReads).toBe(2);
    await expect.poll(() => reads.length).toBeGreaterThan(before);
    await expect(sheet.getByRole('checkbox')).toBeChecked();
    await sheet.getByRole('button', { name: 'Record Tally receipt' }).click();
    await expect(sheet).toBeHidden();
    expect(commands[1].payload.expectedVersion).toBe(2);
    expect(commands[1].payload.idempotencyKey).not.toBe(commands[0].payload.idempotencyKey);
  });

  test('no candidates shows the existing manual form', async ({ page }) => {
    await setup(page, width, { candidates: [] });
    const sheet = await openSheet(page);
    await expect(sheet.getByLabel('Received quantity for Test item')).toHaveValue('13');
    await expect(sheet.getByRole('button', { name: 'Confirm received' })).toBeEnabled();
    await expect(sheet.getByText('From Tally', { exact: true })).toHaveCount(0);
  });

  test('counts failure shows neither chip nor error', async ({ page }) => {
    const { countsReads } = await setup(page, width, { countsFail: true });
    await expect.poll(() => countsReads.length).toBe(1);
    const section = page.getByRole('region', { name: 'Purchase orders', exact: true });
    await expect(section.getByRole('button', { name: 'Mark received PO/26-27/0001' })).toBeVisible();
    await expect(section.getByText('Tally shows a receipt')).toHaveCount(0);
    await expect(section.getByRole('alert')).toHaveCount(0);
  });

  test('candidate read failure shows the manual form with a muted notice', async ({ page }) => {
    await setup(page, width, { receiptsFail: true });
    const sheet = await openSheet(page);
    await expect(sheet.getByText('Tally receipts could not load', { exact: true })).toBeVisible();
    await expect(sheet.getByLabel('Received quantity for Test item')).toHaveValue('13');
  });

  for (const failure of [502, 408, 429]) test(`retry after ${failure} retains the exact command and locks selection`, async ({ page }) => {
    const { commands } = await setup(page, width, { failures: [failure] });
    const sheet = await openSheet(page);
    await sheet.getByRole('button', { name: 'Record Tally receipt' }).click();
    await expect(sheet.getByRole('checkbox')).toBeDisabled();
    await expect(sheet.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
    await sheet.getByRole('button', { name: 'Record Tally receipt' }).click();
    await expect(sheet).toBeHidden();
    expect(commands[1]).toEqual(commands[0]);
  });

  test('sheet scrolls without horizontal overflow and the primary button is reachable', async ({ page }) => {
    await setup(page, width, { candidates: Array.from({ length: 20 }, (_, index) => ({ ...candidate, lineKey: String(index), reference: `Purchase ${index} ${'long-reference'.repeat(8)}` })) });
    const sheet = await openSheet(page);
    const submit = sheet.getByRole('button', { name: 'Record Tally receipt' });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
    expect(await sheet.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await sheet.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  });
});
