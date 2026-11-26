import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';
import { purchaseOrder, purchaseOrderLine, supplierOption, toOrderItem, toOrderResponse } from '../fixtures/api-builders';
import type { PurchaseOrder } from '../../lib/purchase-orders';

type Command = { action: string; payload: { idempotencyKey: string; id?: string; expectedVersion?: number; reason?: string; lines?: Array<{ itemKey: string; quantity?: number; supplierName?: string; receivedQuantity?: number }> } };
const orderItems = [
  toOrderItem({ itemKey: 'A', itemName: 'Reagent A', lowestSupplier: { supplierName: 'Supplier A' } }),
  toOrderItem({ itemKey: 'B', itemName: 'Reagent B', lowestSupplier: { supplierName: 'Supplier B' } }),
];

async function setup(page: Page, { role = 'operations', orders = [purchaseOrder()], failures = [] as number[], noSuppliers = false }: { role?: string; orders?: PurchaseOrder[]; failures?: number[]; noSuppliers?: boolean } = {}) {
  const commands: Command[] = [];
  const reads: string[] = [];
  let letterheadRequests = 0;
  let companyName = 'Suprabha Distributors';
  await page.setViewportSize({ width: 375, height: 812 });
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
      await route.fulfill({ json: { itemKey: key, suppliers: noSuppliers ? [] : [supplierOption({ supplierName: `Supplier ${key}`, ...(role === 'management' ? { rate: 42 } : {}) })] } });
    } else {
      reads.push(url.search);
      const filtered = orders.filter((po) => po.status === url.searchParams.get('status'));
      const pageNumber = Number(url.searchParams.get('page'));
      await route.fulfill({ json: { page: pageNumber, items: filtered.slice((pageNumber - 1) * 20, pageNumber * 20), total: filtered.length } });
    }
  });
  await page.route('**/api/letterhead', (route) => route.fulfill({ json: {
    companyName: (letterheadRequests++, companyName), address: '12 Market Road\nKolkata', gstin: '19ABCDE1234F1Z5',
    phone: '9876543210', deliveryAddress: 'Warehouse\nKolkata', version: 1, updatedAt: '2026-11-01T00:00:00Z',
  } }));
  await page.route('**/api/letterhead/extras', route => route.fulfill({ json: { logo: null, terms: [], version: 1 } }));
  await page.route('**/fonts/noto-sans-po-subset.ttf', (route) => route.fulfill({
    body: readFileSync(path.resolve('public/fonts/noto-sans-po-subset.ttf')), contentType: 'font/ttf',
  }));
  await page.route('**/fonts/noto-sans-po-bold-subset.ttf', (route) => route.fulfill({ status: 404, body: 'Not found' }));
  await page.goto(`/?view=frame&role=${role}`);
  await page.getByRole('button', { name: /^purchase$/i }).click();
  await expect(page.getByRole('heading', { name: 'To order', exact: true })).toBeVisible();
  return { commands, reads, get letterheadRequests() { return letterheadRequests; }, setCompanyName: (value: string) => { companyName = value; } };
}

const pdfButton = (page: Page) => page.getByRole('button', { name: 'PDF PO/26-27/0001', exact: true });
async function desktop(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined }));
}
async function checkDownload(download: Download) {
  expect(download.suggestedFilename()).toBe('PO-26-27-0001.pdf');
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
}
async function downloadPdf(page: Page) {
  const downloaded = page.waitForEvent('download');
  await pdfButton(page).click();
  await checkDownload(await downloaded);
}

test('desktop management downloads the PO PDF with a missing bold font and records a PDF share', async ({ page }) => {
  const order = purchaseOrder({ totalValue: 546, lines: [purchaseOrderLine({ rate: 42 })] });
  const { commands } = await setup(page, { role: 'management', orders: [order] });
  await desktop(page);
  await downloadPdf(page);
  await expect.poll(() => commands.length).toBe(1);
  expect(commands).toEqual([{ action: 'mark_purchase_order_shared', payload: { id: order.id, expectedVersion: order.version, channel: 'pdf', idempotencyKey: expect.any(String) } }]);
});

test('operations downloads with no rate keys or totalValue', async ({ page }) => {
  const order = purchaseOrder();
  expect(Object.hasOwn(order, 'totalValue')).toBe(false);
  expect(order.lines.every((line) => !Object.hasOwn(line, 'rate'))).toBe(true);
  await setup(page, { orders: [order] });
  await desktop(page);
  await downloadPdf(page);
});

test('letterhead 500 still downloads a PDF', async ({ page }) => {
  await setup(page);
  await desktop(page);
  await page.route('**/api/letterhead', (route) => route.fulfill({ status: 500, json: { error: 'Unavailable' } }));
  await downloadPdf(page);
});

test('extras with two terms download a valid PDF and are fetched for every download', async ({ page }) => {
  await setup(page);
  await desktop(page);
  let gets = 0;
  await page.route('**/api/letterhead/extras', route => {
    gets++;
    return route.fulfill({ json: { logo: null, terms: ['Payment within 30 days.', 'Confirm the delivery date.'], version: gets } });
  });
  await downloadPdf(page);
  await downloadPdf(page);
  expect(gets).toBe(2);
});

test('extras 500 still downloads a PDF', async ({ page }) => {
  await setup(page);
  await desktop(page);
  await page.route('**/api/letterhead/extras', route => route.fulfill({ status: 500, json: { error: 'Unavailable' } }));
  await downloadPdf(page);
});

test('font 500 shows the preparation note and does not download', async ({ page }) => {
  await setup(page);
  await page.route('**/fonts/noto-sans-po-subset.ttf', (route) => route.fulfill({ status: 500, body: 'Unavailable' }));
  const download = page.waitForEvent('download', { timeout: 1500 }).catch(() => null);
  await pdfButton(page).click();
  await expect(page.getByText('PDF could not be prepared. Try again.', { exact: true })).toBeVisible();
  expect(await download).toBeNull();
});

test('fetches fresh letterhead for every PDF', async ({ page }) => {
  const state = await setup(page);
  await desktop(page);
  await downloadPdf(page);
  state.setCompanyName('New Company');
  await downloadPdf(page);
  expect(state.letterheadRequests).toBe(2);
});

test('received has PDF and cancelled does not', async ({ page }) => {
  await setup(page, { orders: [purchaseOrder({ status: 'received' }), purchaseOrder({ id: 'cancelled', status: 'cancelled' })] });
  const section = page.getByRole('region', { name: 'Purchase orders', exact: true });
  await section.getByRole('button', { name: 'Received', exact: true }).click();
  await expect(pdfButton(page)).toBeVisible();
  await section.getByRole('button', { name: 'Cancelled', exact: true }).click();
  await expect(section.getByRole('article')).toHaveCount(1);
  await expect(pdfButton(page)).toHaveCount(0);
});

test('phone shares one named PDF without downloading', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => {
      (window as unknown as { pdfShare: unknown }).pdfShare = { title: data.title, files: data.files?.map((file) => ({ name: file.name, type: file.type, size: file.size })) };
    } });
  });
  let downloads = 0;
  page.on('download', () => { downloads++; });
  const order = purchaseOrder();
  const { commands } = await setup(page, { orders: [order] });
  await pdfButton(page).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { pdfShare: unknown }).pdfShare)).toMatchObject({
    title: 'PO/26-27/0001', files: [{ name: 'PO-26-27-0001.pdf', type: 'application/pdf', size: expect.any(Number) }],
  });
  await expect(pdfButton(page)).toBeEnabled();
  expect(downloads).toBe(0);
  await expect.poll(() => commands.length).toBe(1);
  expect(commands).toEqual([{ action: 'mark_purchase_order_shared', payload: { id: order.id, expectedVersion: order.version, channel: 'pdf', idempotencyKey: expect.any(String) } }]);
});

test('phone downloads when sharing is refused with NotAllowedError', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new DOMException('Refused', 'NotAllowedError'); } });
  });
  await setup(page);
  await downloadPdf(page);
});

test('375px card with PDF has no horizontal scroll', async ({ page }) => {
  await setup(page);
  await expect(pdfButton(page)).toBeVisible();
  const card = page.getByRole('article', { name: 'PO/26-27/0001', exact: true });
  expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const box = await card.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
