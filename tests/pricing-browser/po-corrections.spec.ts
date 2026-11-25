import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { purchaseOrder, purchaseOrderLine, toOrderResponse } from '../fixtures/api-builders';
import type { PendingCorrection } from '../../lib/purchase-orders';

type Command = { action: string; payload: Record<string, unknown> };
const pending: PendingCorrection = { requestId: '62000000-0000-4000-8000-000000000001', itemKey: 'TEST-ITEM', fromQuantity: 10, toQuantity: 13, reasonCode: 'supplier_changed', note: 'Supplier pack size changed', requestedByEmail: 'other@example.test', requestedAt: '2026-11-24T06:00:00Z' };
const base = () => purchaseOrder({ lines: [purchaseOrderLine({ quantity: 10, originalQuantity: 10 })] });
const week = { view: 'po_corrections', since: '2026-11-18T00:00:00Z', items: [
  { poId: purchaseOrder().id, poNumber: 'PO/26-27/0001', supplierName: 'Test supplier', status: 'open', createdByEmail: 'staff@example.test', corrections: 3, pending: 1, flags: { byCreator: true, moreThanTwo: true, beforeReceipt: true, notResent: true } },
  { poId: '61000000-0000-4000-8000-000000000002', poNumber: 'PO/26-27/0002', supplierName: 'Other supplier', status: 'open', createdByEmail: 'other@example.test', corrections: 1, pending: 0, flags: { byCreator: false, moreThanTwo: false, beforeReceipt: false, notResent: false } },
] };

async function setup(page: Page, po = base(), role = 'operations') {
  const commands: Command[] = [];
  const reads: string[] = [];
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } });
  });
  await page.route('**/stockflow.html*', route => route.fulfill({ contentType: 'text/html', body: '<p>Stock fixture</p>' }));
  await page.route('**/api/product-requests*', route => route.fulfill({ json: { requests: [] } }));
  await page.route('**/api/requirements?*', route => {
    const params = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: params.get('view') === 'late_pos' ? { view: 'late_pos', leadTimeDays: 7, total: 0, items: [] } : params.has('alerts') ? { windowDays: 7, alerts: [], pagination: { page: 1, pageCount: 1, total: 0 } } : toOrderResponse({ items: [], total: 0 }) });
  });
  await page.route('**/api/letterhead*', route => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/purchase-orders*', async route => {
    const request = route.request();
    const params = new URL(request.url()).searchParams;
    if (request.method() === 'POST') {
      commands.push(request.postDataJSON() as Command);
      await route.fulfill({ json: { purchaseOrder: po, applied: !po.sharedAt } });
      return;
    }
    reads.push(new URL(request.url()).search);
    await route.fulfill({ json: params.get('corrections') === 'week' ? week : params.has('tallyReceiptCounts') ? { counts: {} } : { items: [po], total: 1 } });
  });
  // The frame preview uses staff@example.test, as in sign-out.spec.ts.
  await page.goto(`/?view=frame&role=${role}`);
  await page.getByRole('button', { name: /^requests$/i }).click();
  await expect(page.getByRole('article', { name: po.poNumber, exact: true })).toBeVisible();
  return { commands, reads };
}

async function correct(page: Page) {
  await page.getByRole('button', { name: 'Details for PO/26-27/0001', exact: true }).click();
  await page.getByRole('button', { name: 'Correct quantity for Test item', exact: true }).click();
  return page.getByRole('dialog', { name: 'Correct quantity', exact: true });
}

test('operations correct an unshared quantity with the exact command and no mobile overflow', async ({ page }) => {
  const { commands, reads } = await setup(page);
  const sheet = await correct(page);
  await sheet.getByLabel('New quantity', { exact: true }).fill('11');
  await sheet.getByRole('radio', { name: 'Typing mistake' }).check();
  await sheet.getByLabel('Note', { exact: true }).fill('Count was mistyped');
  await expect(sheet.getByText('This change applies now.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await sheet.getByRole('button', { name: 'Save correction', exact: true }).click();
  await expect(sheet).toBeHidden();
  expect(commands).toEqual([{ action: 'request_po_quantity_correction', payload: { id: base().id, expectedVersion: 1, itemKey: 'TEST-ITEM', quantity: 11, reasonCode: 'typing_mistake', note: 'Count was mistyped', idempotencyKey: expect.any(String) } }]);
  expect(reads.some(read => read.includes('corrections=week'))).toBe(false);
});

test('a 30 percent increase asks for management approval', async ({ page }) => {
  await setup(page);
  const sheet = await correct(page);
  await sheet.getByLabel('New quantity', { exact: true }).fill('13');
  await expect(sheet.getByText('More than 20% above the first order. A manager must approve.', { exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Send for approval', exact: true })).toBeVisible();
});

test('management reviews a shared request and approves without an empty note', async ({ page }) => {
  const { commands } = await setup(page, { ...base(), sharedAt: '2026-11-23T06:00:00Z', pendingCorrections: [pending] }, 'management');
  await page.getByRole('button', { name: 'Review correction for Test item', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Review correction', exact: true });
  await expect(sheet.getByText('Approving marks this PO Re-send needed.', { exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(sheet).toBeHidden();
  expect(commands[0]).toEqual({ action: 'decide_po_quantity_correction', payload: { requestId: pending.requestId, expectedVersion: 1, decision: 'approve', idempotencyKey: expect.any(String) } });
});

test('the requester cannot review their own correction, ignoring email case', async ({ page }) => {
  await setup(page, { ...base(), sharedAt: '2026-11-23T06:00:00Z', pendingCorrections: [{ ...pending, requestedByEmail: 'STAFF@example.test' }] }, 'management');
  await expect(page.getByText('Correction waiting', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review correction for Test item', exact: true })).toHaveCount(0);
});

test('Re-send needed uses the text share channel', async ({ page }) => {
  const { commands } = await setup(page, { ...base(), sharedAt: '2026-11-23T06:00:00Z', resendNeeded: true });
  await expect(page.getByText('Re-send needed', { exact: true })).toBeVisible();
  const share = page.getByRole('button', { name: 'Share PO/26-27/0001', exact: true });
  await expect(share).toHaveText('Re-send');
  await share.click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toEqual({ action: 'mark_purchase_order_shared', payload: { id: base().id, expectedVersion: 1, channel: 'text', idempotencyKey: expect.any(String) } });
});

test('PDF download records a PDF share for an open PO', async ({ page }) => {
  const { commands } = await setup(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined }));
  await page.route('**/api/letterhead', route => route.fulfill({ json: {
    companyName: 'Suprabha Distributors', address: '12 Market Road\nKolkata', gstin: '19ABCDE1234F1Z5',
    phone: '9876543210', deliveryAddress: 'Warehouse\nKolkata', version: 1, updatedAt: '2026-11-01T00:00:00Z',
  } }));
  await page.route('**/api/letterhead/extras', route => route.fulfill({ json: { logo: null, terms: [], version: 1 } }));
  await page.route('**/fonts/noto-sans-po-subset.ttf', route => route.fulfill({
    body: readFileSync(path.resolve('public/fonts/noto-sans-po-subset.ttf')), contentType: 'font/ttf',
  }));
  await page.route('**/fonts/noto-sans-po-bold-subset.ttf', route => route.fulfill({ status: 404, body: 'Not found' }));
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF PO/26-27/0001', exact: true }).click();
  await download;
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toEqual({ action: 'mark_purchase_order_shared', payload: { id: base().id, expectedVersion: 1, channel: 'pdf', idempotencyKey: expect.any(String) } });
});

test('supplier confirmation records the optional note', async ({ page }) => {
  const { commands } = await setup(page, { ...base(), sharedAt: '2026-11-23T06:00:00Z' });
  await page.getByRole('button', { name: 'Supplier confirmed', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Supplier confirmed', exact: true });
  await sheet.getByLabel('Note', { exact: true }).fill('Confirmed by phone');
  await sheet.getByRole('button', { name: 'Record confirmation', exact: true }).click();
  await expect(sheet).toBeHidden();
  expect(commands[0]).toEqual({ action: 'confirm_purchase_order_supplier', payload: { id: base().id, expectedVersion: 1, note: 'Confirmed by phone', idempotencyKey: expect.any(String) } });
});

test('management sees the weekly corrections and only true flags', async ({ page }) => {
  await setup(page, base(), 'management');
  const chip = page.getByRole('button', { name: '2 corrections this week', exact: true });
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  const section = page.getByRole('region', { name: 'Corrections this week', exact: true });
  for (const flag of ['Raised by PO creator', 'More than 2 corrections', 'Corrected within 24 h before receipt', 'Not re-sent']) await expect(section.getByText(flag, { exact: true })).toHaveCount(1);
  await expect(section.getByText('Corrected or requested in the last 7 days.', { exact: true })).toBeVisible();
});

test('a Tally locked line has no correction control', async ({ page }) => {
  await setup(page, { ...base(), lines: [purchaseOrderLine({ locked: true })] });
  await page.getByRole('button', { name: 'Details for PO/26-27/0001', exact: true }).click();
  await expect(page.getByText('Locked: Tally receipt', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Correct quantity for Test item', exact: true })).toHaveCount(0);
});
