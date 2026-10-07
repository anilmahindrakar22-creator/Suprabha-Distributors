import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page) {
  await page.route('**/api/offline-catalog?kind=*', (route) => route.fulfill({ json: {
    actorEmail: 'staff@example.test', rows: route.request().url().includes('products')
      ? [{ tallyKey: 'GLUCOSE', item: 'Glucose', group: 'Diasys', baseUnit: 'Nos' }]
      : [{ id: '11111111-1111-4111-8111-111111111111', name: 'Test Laboratory' }, { id: '22222222-2222-4222-8222-222222222222', name: 'Other Laboratory' }],
  } }));
  await page.goto('/?view=offline-preparation');
  await page.getByLabel('Offline PIN').fill('123456');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Prepare / refresh encrypted copy' }).click();
  await expect(page.getByRole('status')).toContainText('Encrypted copy verified');
  await page.getByRole('link', { name: 'Open offline orders' }).click();
  await unlock(page);
}
async function unlock(page: Page, pin = '123456') {
  await page.getByLabel('Offline PIN').fill(pin);
  await page.getByRole('button', { name: 'Unlock saved data' }).click();
  if (pin === '123456') await expect(page.locator('#editor')).toBeVisible();
}
async function draft(page: Page) {
  await page.getByRole('combobox', { name: 'Customer', exact: true }).selectOption('11111111-1111-4111-8111-111111111111');
  await page.getByRole('combobox', { name: 'Product', exact: true }).selectOption('GLUCOSE');
  await page.getByRole('button', { name: 'Add product' }).click();
  await page.getByRole('button', { name: 'Save encrypted draft — not submitted' }).click();
  await expect(page.getByRole('status')).toContainText('Encrypted draft saved');
}
test('saves and reopens an encrypted draft offline without protected response caching', async ({ page, context }) => {
  await prepare(page);
  await draft(page);
  const raw = await page.evaluate(() => localStorage.getItem('stockflow:encrypted-offline:v1'));
  expect(raw).not.toContain('Test Laboratory'); expect(raw).not.toContain('GLUCOSE');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Offline orders', exact: true })).toBeVisible();
  await unlock(page);
  await expect(page.locator('#drafts')).toContainText('Test Laboratory');
  await expect(page.locator('#drafts')).toContainText('Not submitted');
});
test('rejects wrong PIN and locks sensitive details when hidden', async ({ page }) => {
  await prepare(page); await draft(page);
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await unlock(page, '654321');
  await expect(page.getByRole('status')).toContainText('Unable to unlock');
  await expect(page.locator('#editor')).toBeHidden();
  await unlock(page);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('#drafts')).toBeEmpty();
  await expect(page.getByLabel('Offline PIN')).toHaveValue('');
});
test('refuses other-account submission without posting an order', async ({ page }) => {
  await prepare(page); await draft(page);
  await page.route('**/api/offline-session', (route) => route.fulfill({ json: { actorEmail: 'other@example.test' } }));
  let posts = 0;
  await page.route('**/api/orders', (route) => { posts += 1; return route.fulfill({ json: { orderNumber: 'BAD' } }); });
  await page.getByRole('button', { name: 'Verify account and submit' }).click();
  await expect(page.getByRole('status')).toContainText('Sign in with the account');
  expect(posts).toBe(0);
  await expect(page.locator('#drafts')).toContainText('Not submitted');
});
test('retains uncertain submission and retries the exact original command', async ({ page }) => {
  await prepare(page); await draft(page);
  await page.route('**/api/offline-session', (route) => route.fulfill({ json: { actorEmail: 'staff@example.test' } }));
  const commands: string[] = [];
  await page.route('**/api/orders', (route) => {
    expect(route.request().headers()['x-stockflow-actor']).toBe('staff@example.test');
    commands.push(route.request().postData()!);
    return route.fulfill({ status: commands.length === 1 ? 503 : 200, json: commands.length === 1 ? { error: 'unavailable' } : { orderNumber: 'SF-OFFLINE-1' } });
  });
  await page.getByRole('button', { name: 'Verify account and submit' }).click();
  await expect(page.getByRole('status')).toContainText('Submission is unresolved');
  await expect(page.getByRole('button', { name: 'Edit draft' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Verify account and retry' }).click();
  await expect(page.getByRole('status')).toContainText('SF-OFFLINE-1');
  expect(commands).toHaveLength(2); expect(commands[1]).toBe(commands[0]);
  await expect(page.locator('#drafts')).toBeEmpty();
});
test('reset requires explicit destructive confirmation and preserves data when cancelled', async ({ page }) => {
  await prepare(page); await draft(page);
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Forgot PIN / reset local offline data' }).click();
  expect(await page.evaluate(() => localStorage.getItem('stockflow:encrypted-offline:v1'))).not.toBeNull();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Forgot PIN / reset local offline data' }).click();
  await expect(page.getByRole('status')).toContainText('Encrypted offline data reset');
  expect(await page.evaluate(() => localStorage.getItem('stockflow:encrypted-offline:v1'))).toBeNull();
  await expect(page.locator('#editor')).toBeHidden();
});
test('storage quota failure retains the prior encrypted draft', async ({ page }) => {
  await prepare(page); await draft(page);
  const before = await page.evaluate(() => localStorage.getItem('stockflow:encrypted-offline:v1'));
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await page.getByLabel('Notes', { exact: true }).fill('changed note');
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === 'stockflow:encrypted-offline:v1') throw new DOMException('Storage full', 'QuotaExceededError'); setItem.call(this, key, value); };
  });
  await page.getByRole('button', { name: 'Save encrypted draft — not submitted' }).click();
  await expect(page.getByRole('status')).toContainText('Storage full');
  expect(await page.evaluate(() => localStorage.getItem('stockflow:encrypted-offline:v1'))).toBe(before);
});
test('migrates an original pending draft only after encrypted verification', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('stockflow:encrypted-offline:v1')) localStorage.setItem('stockflow:order-draft:v1:staff@example.test', JSON.stringify({ schemaVersion: 1, actorEmail: 'staff@example.test', state: 'pending', updatedAt: new Date().toISOString(), command: { action: 'create_order', payload: { idempotencyKey: 'legacy-original-key', customerName: 'Test Laboratory', source: 'phone', lines: [{ tallyKey: 'GLUCOSE', quantity: 2 }] } } }));
  });
  await prepare(page);
  await expect(page.locator('#drafts')).toContainText('Submission unresolved');
  expect(await page.evaluate(() => localStorage.getItem('stockflow:order-draft:v1:staff@example.test'))).toBeNull();
  await expect(page.getByRole('button', { name: 'Edit draft' })).toHaveCount(0);
});
test('changing a draft customer does not reuse the previous customer contact or address', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('stockflow:encrypted-offline:v1')) localStorage.setItem('stockflow:order-draft:v1:staff@example.test', JSON.stringify({ schemaVersion: 1, actorEmail: 'staff@example.test', state: 'draft', updatedAt: new Date().toISOString(), command: { action: 'create_order', payload: { idempotencyKey: 'never-submitted-original-key', customerId: '11111111-1111-4111-8111-111111111111', customerName: 'Test Laboratory', customerPhone: 'old-phone', customerCity: 'old-city', deliveryAddress: 'old-address', source: 'whatsapp', priority: 'urgent', lines: [{ tallyKey: 'GLUCOSE', quantity: 2 }] } } }));
  });
  await prepare(page);
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await page.getByLabel('Search customer', { exact: true }).fill('Other');
  await page.getByRole('combobox', { name: 'Customer', exact: true }).selectOption('22222222-2222-4222-8222-222222222222');
  await page.getByRole('button', { name: 'Save encrypted draft — not submitted' }).click();
  await expect(page.getByRole('status')).toContainText('Encrypted draft saved');
  await page.route('**/api/offline-session', (route) => route.fulfill({ json: { actorEmail: 'staff@example.test' } }));
  let submitted: { payload: Record<string, unknown> } | undefined;
  await page.route('**/api/orders', (route) => { submitted = route.request().postDataJSON(); return route.fulfill({ json: { orderNumber: 'SF-CHANGED-CUSTOMER' } }); });
  await page.getByRole('button', { name: 'Verify account and submit' }).click();
  await expect(page.getByRole('status')).toContainText('SF-CHANGED-CUSTOMER');
  expect(submitted?.payload.customerName).toBe('Other Laboratory');
  for (const field of ['customerPhone', 'customerCity', 'deliveryAddress']) expect(submitted?.payload).not.toHaveProperty(field);
  expect(submitted?.payload.priority).toBe('urgent');
  expect(submitted?.payload.source).toBe('whatsapp');
});
