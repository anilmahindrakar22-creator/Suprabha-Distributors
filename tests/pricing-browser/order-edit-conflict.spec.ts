import { expect, test } from '@playwright/test';
import type { OrderCommand } from '../../lib/order-types';

test('order editor preserves its base version during live refresh and can load the latest drafts', async ({ page, isMobile }) => {
  const current = {
    id: '61000000-0000-4000-8000-000000000002', orderNumber: 'SF-EDIT-001', customerName: 'Edit Conflict Lab', status: 'phone_order_received',
    version: 1, customerPhone: null, source: 'phone', notes: 'Original note', pricingState: 'approved', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    lineCount: 1, totalQuantity: 2, reservedQuantity: 0, tallyInvoiceNumber: null,
    lines: [{ tallyKey: 'G', itemName: 'Glucose', itemGroup: 'Diasys', quantity: 2, baseUnit: 'Nos', fulfilledQuantity: 0 }], events: [], exceptions: [], installations: [],
  };
  let latest = { ...current, lines: current.lines.map((line) => ({ ...line })) };
  let editCommand: Extract<OrderCommand, { action: 'edit_order' }> | undefined;

  await page.setViewportSize({ width: isMobile ? 375 : 1280, height: 800 });
  await page.clock.install();
  await page.route('**/api/orders**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST') {
      editCommand = route.request().postDataJSON();
      return route.fulfill({ status: 409, json: { error: 'Order changed; refresh and retry.' } });
    }
    if (url.searchParams.has('summary')) {
      return route.fulfill({ json: { operations: {}, orderRevision: latest.version.toString(16).padStart(32, '0') } });
    }
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    return route.fulfill({ json: {
      actor: { email: 'sales@example.test', role: 'sales', roles: ['sales'] },
      snapshot: { company: 'TEST', fetchedAt: new Date().toISOString(), catalog: [] }, customers: [], operations: {}, orders: [latest],
      pagination: { total: 1, page: 1, pageCount: 1, pageSize: 20 },
    } });
  });

  await page.goto('/?view=orders-workspace&actor=sales@example.test');
  await expect(page.getByText('Edit Conflict Lab', { exact: true }).first()).toBeVisible();
  const compactRow = page.getByRole('button', { name: /SF-EDIT-001, Edit Conflict Lab/ });
  if (isMobile && await compactRow.count()) await compactRow.click();
  await page.clock.runFor(2_000);
  const orderTile = isMobile
    ? page.getByRole('dialog', { name: 'Order SF-EDIT-001' })
    : page.locator('article').filter({ hasText: 'SF-EDIT-001' });
  await orderTile.getByText('View order details', { exact: true }).click();
  await orderTile.getByRole('button', { name: '+ Edit order', exact: true }).click();
  const quantity = orderTile.getByRole('spinbutton').first();
  await quantity.fill('3');

  // Match the cross-session test's live summary polling trigger after another session commits version 2.
  latest = { ...latest, version: 2, notes: 'Updated in another session', updatedAt: new Date().toISOString() };
  await page.clock.runFor(16_000);
  await expect(orderTile.getByText('This order changed since you started editing.', { exact: true })).toBeVisible();

  await orderTile.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => editCommand?.payload?.expectedVersion).toBe(1);
  expect(editCommand?.action).toBe('edit_order');
  await expect(orderTile.getByText('This order changed since you started editing.', { exact: true })).toBeVisible();
  await expect(orderTile.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
  await expect(quantity).toHaveValue('3');

  await page.getByRole('button', { name: 'Load latest', exact: true }).click();
  await expect(orderTile.getByRole('spinbutton').first()).toHaveValue('2');
  await expect(orderTile.getByLabel('Notes')).toHaveValue('Updated in another session');
  await expect(orderTile.getByText('This order changed since you started editing.', { exact: true })).toHaveCount(0);
});
