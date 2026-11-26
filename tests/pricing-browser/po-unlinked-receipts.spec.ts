import { expect, test, type Page } from '@playwright/test';
import { purchaseOrder, purchaseOrderLine, supplierOption, toOrderItem, toOrderResponse } from '../fixtures/api-builders';
import type { UnlinkedReceipt } from '../../lib/po-unlinked-receipts';

const receipt: UnlinkedReceipt = {
  sourceId: 'purchase-1234', lineKey: '1', date: '2026-10-29', reference: 'Purchase 1234',
  itemKey: 'TEST-ITEM', itemName: 'Test item', quantity: 12.5, linkedQuantity: 0,
  unlinkedQuantity: 12.5, unit: 'kit',
  openPo: { id: purchaseOrder().id, poNumber: purchaseOrder().poNumber, stillDue: 3 },
};
const rows: UnlinkedReceipt[] = [receipt,
  { ...receipt, lineKey: '2', itemName: 'Partially linked item', quantity: 12, linkedQuantity: 10, unlinkedQuantity: 2, openPo: null },
  { ...receipt, lineKey: '3', itemName: 'Another item', quantity: 3, unlinkedQuantity: 3, unit: null, openPo: null },
];
const orderItems = [
  toOrderItem({ itemKey: 'A', itemName: 'Reagent A', lowestSupplier: { supplierName: 'Supplier A' } }),
  toOrderItem({ itemKey: 'B', itemName: 'Reagent B', lowestSupplier: { supplierName: 'Supplier B' } }),
];

// Same frame entry, role sign-in and baseline route mocks as po-tally-receipts.spec.ts.
async function setup(page: Page, { role = 'operations', receipts = rows, failure = 0, laterFailure = false, malformed = false, orders = [purchaseOrder()] } = {}) {
  const reads: string[] = [];
  await page.route('**/stockflow.html*', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Stock fixture</p>' }));
  await page.route('**/api/product-requests*', (route) => route.fulfill({ json: { requests: [] } }));
  await page.route('**/api/requirements?*', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: url.searchParams.has('alerts')
      ? { windowDays: 7, alerts: [], pagination: { page: 1, pageCount: 1, total: 0 } }
      : toOrderResponse({ total: 2, items: orderItems }) });
  });
  await page.route('**/api/purchase-orders*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('unlinked')) {
      reads.push(url.search);
      const nextPage = Number(url.searchParams.get('page'));
      const status = failure || (laterFailure && nextPage === 2 ? 500 : 200);
      await route.fulfill({ status, json: status !== 200 ? { error: 'Try again' } : malformed ? { rows: [] } : {
        page: nextPage, pageSize: 20, total: receipts.length, rows: receipts.slice((nextPage - 1) * 20, nextPage * 20),
      } });
    } else if (url.searchParams.has('tallyReceiptCounts')) {
      await route.fulfill({ json: { counts: {} } });
    } else if (url.searchParams.has('tallyReceipts')) {
      await route.fulfill({ json: { poId: purchaseOrder().id, version: 1, lines: [{ ...purchaseOrder().lines[0], remaining: 13, candidates: [] }] } });
    } else if (url.searchParams.has('supplierOptions')) {
      const key = url.searchParams.get('supplierOptions')!;
      await route.fulfill({ json: { itemKey: key, suppliers: [supplierOption({ supplierName: `Supplier ${key}` })] } });
    } else {
      const filtered = orders.filter((po) => po.status === url.searchParams.get('status'));
      const nextPage = Number(url.searchParams.get('page'));
      await route.fulfill({ json: { page: nextPage, items: filtered.slice((nextPage - 1) * 20, nextPage * 20), total: filtered.length } });
    }
  });
  await page.goto(`/?view=frame&role=${role}`);
  await page.getByRole('button', { name: /^purchase$/i }).click();
  await expect(page.getByRole('heading', { name: 'To order', exact: true })).toBeVisible();
  return { reads };
}

const section = (page: Page) => page.getByRole('region', { name: 'Received without PO', exact: true });
async function expand(page: Page, total = 3) {
  const chip = page.getByRole('button', { name: `${total} received without PO`, exact: true });
  await expect(chip).toHaveAttribute('aria-expanded', 'false');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-expanded', 'true');
  return section(page);
}

test('chip expands quantity rows, date and PO suggestion', async ({ page }) => {
  await setup(page);
  const group = await expand(page);
  await expect(group.getByRole('listitem')).toHaveCount(3);
  for (const text of ['12.5 kit not on a PO', '2 of 12 kit not on a PO', '3 not on a PO', '29 Oct · Tally Purchase 1234', '3 still due on that PO']) {
    await expect(group.getByText(text, { exact: true }).first()).toBeVisible();
  }
  await group.getByRole('button', { name: '3 received without PO' }).click();
  await expect(group.getByRole('list')).toHaveCount(0);
});

test('Mark received opens the loaded open PO sheet once', async ({ page }) => {
  await setup(page);
  const group = await expand(page);
  await group.getByRole('button', { name: 'Mark received on PO/26-27/0001', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Mark received PO/26-27/0001', exact: true });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await group.getByRole('button', { name: 'Mark received on PO/26-27/0001', exact: true }).click();
  await expect(sheet).toBeVisible();
});

test('suggestion switches from Received to Open before opening the sheet', async ({ page }) => {
  await setup(page);
  const panel = page.getByRole('region', { name: 'Purchase orders', exact: true });
  await panel.getByRole('button', { name: 'Received', exact: true }).click();
  await expect(panel.getByText('No received purchase orders.', { exact: true })).toBeVisible();
  await expand(page);
  await section(page).getByRole('button', { name: 'Mark received on PO/26-27/0001' }).click();
  await expect(panel.getByRole('button', { name: 'Open', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('dialog', { name: 'Mark received PO/26-27/0001', exact: true })).toBeVisible();
});

test('missing suggested PO shows a muted notice after switching to Open', async ({ page }) => {
  await setup(page, { orders: [] });
  const panel = page.getByRole('region', { name: 'Purchase orders', exact: true });
  await panel.getByRole('button', { name: 'Received', exact: true }).click();
  await expand(page);
  await section(page).getByRole('button', { name: 'Mark received on PO/26-27/0001' }).click();
  await expect(panel.getByText('Find PO/26-27/0001 in Open and use Mark received.', { exact: true })).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

for (const scenario of ['empty', '500', 'invalid'] as const) test(`${scenario} response silently hides the chip`, async ({ page }) => {
  const { reads } = await setup(page, { receipts: scenario === 'empty' ? [] : rows, failure: scenario === '500' ? 500 : 0, malformed: scenario === 'invalid' });
  await expect.poll(() => reads.length).toBe(1);
  const panel = page.getByRole('region', { name: 'Purchase orders', exact: true });
  await expect(panel.getByRole('article')).toHaveCount(1);
  await expect(section(page)).toHaveCount(0);
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

const manyRows = Array.from({ length: 21 }, (_, index) => ({ ...receipt, lineKey: String(index), itemName: `Item ${index + 1}` }));
test('Show more requests page 2 and appends the twenty-first row', async ({ page }) => {
  const { reads } = await setup(page, { receipts: manyRows });
  const group = await expand(page, 21);
  await expect(group.getByRole('listitem')).toHaveCount(20);
  await group.getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(group.getByRole('listitem')).toHaveCount(21);
  expect(reads).toEqual(['?unlinked=1&page=1', '?unlinked=1&page=2']);
  await expect(group.getByRole('button', { name: 'Show more' })).toHaveCount(0);
});

test('later-page failure preserves loaded rows and allows retry', async ({ page }) => {
  const { reads } = await setup(page, { receipts: manyRows, laterFailure: true });
  const group = await expand(page, 21);
  await group.getByRole('button', { name: 'Show more' }).click();
  await expect.poll(() => reads.length).toBe(2);
  await expect(group.getByRole('button', { name: 'Show more' })).toBeEnabled();
  await expect(group.getByRole('listitem')).toHaveCount(20);
  await expect(group.getByRole('alert')).toHaveCount(0);
});

for (const role of ['operations', 'management']) test(`${role} sees quantities without money`, async ({ page }) => {
  await setup(page, { role, orders: [purchaseOrder(role === 'management' ? { totalValue: 546, lines: [purchaseOrderLine({ rate: 42 })] } : {})] });
  const group = await expand(page);
  await expect(group).not.toContainText('₹');
  await expect(group.getByText('12.5 kit not on a PO', { exact: true })).toBeVisible();
});

test('expanded section wraps long text at 375px without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setup(page, { receipts: [{ ...receipt, itemName: 'LongItem'.repeat(40), reference: 'LongReference'.repeat(40), unit: 'LongUnit'.repeat(20), openPo: { ...receipt.openPo!, poNumber: 'LongPO'.repeat(40) } }] });
  const group = await expand(page, 1);
  await expect(group.getByRole('listitem')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
