import { expect, test } from '@playwright/test';

const actor = 'order-desk@example.test';
const key = `stockflow:order-draft:v1:${actor}`;
const command = { action: 'create_order', payload: { idempotencyKey: '11111111-1111-4111-8111-111111111111', customerName: 'Test Alpha Laboratory', source: 'phone', lines: [{ tallyKey: 'CRP', quantity: 3 }] } };

test('saved draft restores customer and quantities without submitting on reload', async ({ page }) => {
  let writes = 0;
  await page.route('**/api/orders**', async route => {
    if (route.request().method() === 'POST') writes += 1;
    await route.fulfill({ json: { orders: [] } });
  });
  await page.addInitScript(({ key, actor, command }) => {
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, actorEmail: actor, state: 'draft', updatedAt: new Date().toISOString(), command }));
  }, { key, actor, command });
  await page.goto('/?view=order-recovery');
  await expect(page.getByRole('combobox', { name: 'Name', exact: true })).toHaveValue('Test Alpha Laboratory');
  await expect(page.getByRole('spinbutton', { name: 'Quantity for CRP', exact: true })).toHaveValue('3');
  await expect(page.getByRole('checkbox', { name: 'Save draft on this device' })).toBeChecked();
  await page.reload();
  await expect(page.getByRole('spinbutton', { name: 'Quantity for CRP', exact: true })).toHaveValue('3');
  expect(writes).toBe(0);
});

test('another account cannot restore or submit the previous account pending draft', async ({ page }) => {
  let writes = 0;
  await page.route('**/api/orders**', async route => { if (route.request().method() === 'POST') writes += 1; await route.fulfill({ json: { orders: [] } }); });
  await page.addInitScript(({ key, actor, command }) => {
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, actorEmail: actor, state: 'pending', updatedAt: new Date().toISOString(), command }));
  }, { key, actor, command });
  await page.goto('/?view=order-recovery&actor=second@example.test');
  await expect(page.getByRole('combobox', { name: 'Name', exact: true })).toHaveValue('');
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Save draft on this device' })).not.toBeChecked();
  expect(writes).toBe(0);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).command, key)).toEqual(command);
});

test('repeated reconnect events send one unchanged pending command and clear it after acknowledgement', async ({ page }) => {
  const writes: unknown[] = [];
  let acknowledge!: () => void;
  const held = new Promise<void>(resolve => { acknowledge = resolve; });
  await page.route('**/api/orders', async route => { writes.push(route.request().postDataJSON()); await held; await route.fulfill({ json: { orderNumber: 'SF-RECOVERED' } }); });
  await page.addInitScript(({ key, actor, command }) => {
    (window as unknown as { connected: boolean }).connected = false;
    Object.defineProperty(navigator, 'onLine', { get: () => (window as unknown as { connected: boolean }).connected });
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, actorEmail: actor, state: 'pending', updatedAt: new Date().toISOString(), command }));
  }, { key, actor, command });
  await page.goto('/?view=order-recovery');
  await expect(page.getByRole('button', { name: 'Retry order', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as unknown as { connected: boolean }).connected = true; for (let i=0; i<3; i++) window.dispatchEvent(new Event('online')); });
  await expect.poll(() => writes.length).toBeGreaterThan(0);
  acknowledge();
  await expect(page.getByText('Accepted SF-RECOVERED')).toBeVisible();
  expect(writes).toEqual([command]);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
});

test('manual retry keeps a pending submission immutable until its outcome is known', async ({ page }) => {
  const writes: unknown[] = [];
  await page.route('**/api/orders', async route => { writes.push(route.request().postDataJSON()); await route.fulfill({ json: { orderNumber: 'SF-MANUAL-RECOVERED' } }); });
  await page.addInitScript(({ key, actor, command }) => {
    Object.defineProperty(navigator, 'onLine', { get: () => false });
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, actorEmail: actor, state: 'pending', updatedAt: new Date().toISOString(), command }));
  }, { key, actor, command });
  await page.goto('/?view=order-recovery');
  await expect(page.getByRole('combobox', { name: 'Name', exact: true })).toBeDisabled();
  await expect(page.getByRole('spinbutton', { name: 'Quantity for CRP', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry order', exact: true }).click();
  await expect(page.getByText('Accepted SF-MANUAL-RECOVERED')).toBeVisible();
  expect(writes).toEqual([command]);
});

test('incomplete acknowledgement retains the draft and manual retry sends the exact command', async ({ page }) => {
  const writes: unknown[] = [];
  await page.route('**/api/orders', async route => {
    writes.push(route.request().postDataJSON());
    await route.fulfill({ json: writes.length === 1 ? {} : { orderNumber: 'SF-ACKNOWLEDGED' } });
  });
  await page.addInitScript(({ key, actor, command }) => {
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, actorEmail: actor, state: 'pending', updatedAt: new Date().toISOString(), command }));
  }, { key, actor, command });
  await page.goto('/?view=order-recovery');
  await expect.poll(() => writes.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Retry order', exact: true })).toBeEnabled();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).command, key)).toEqual(command);
  await expect(page.getByRole('spinbutton', { name: 'Quantity for CRP', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry order', exact: true }).click();
  await expect(page.getByText('Accepted SF-ACKNOWLEDGED')).toBeVisible();
  expect(writes).toEqual([command, command]);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
});

test('revoked order access stops reconnect retries and keeps a draft needing attention', async ({ page }) => {
  let writes = 0;
  await page.route('**/api/orders', async route => { writes += 1; await route.fulfill({ status: 403, json: { error: 'Denied' } }); });
  await page.addInitScript(({ key, actor, command }) => {
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, actorEmail: actor, state: 'pending', updatedAt: new Date().toISOString(), command }));
  }, { key, actor, command });
  await page.goto('/?view=order-recovery');
  await expect(page.getByRole('alert')).toContainText('no longer has permission');
  await expect(page.getByRole('spinbutton', { name: 'Quantity for CRP', exact: true })).toBeEnabled();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, key)).toBe('error');
  await page.evaluate(() => { for (let i=0; i<3; i++) window.dispatchEvent(new Event('online')); });
  expect(writes).toBe(1);
});

test('missing saved Tally product blocks saving until an explicit catalogue replacement', async ({ page }) => {
  let writes = 0;
  await page.route('**/api/orders**', async route => { if (route.request().method() === 'POST') writes += 1; await route.fulfill({ json: { orders: [] } }); });
  await page.addInitScript(({ key, actor, command }) => {
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, actorEmail: actor, state: 'draft', updatedAt: new Date().toISOString(), command: { ...command, payload: { ...command.payload, lines: [{ tallyKey: 'RETIRED-REAGENT', quantity: 3 }] } } }));
  }, { key, actor, command });
  await page.goto('/?view=order-recovery');
  await expect(page.getByText('Unavailable Tally item (RETIRED-REAGENT)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save order', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Remove RETIRED-REAGENT', exact: true }).click();
  const product = page.getByRole('combobox', { name: 'Find product', exact: true });
  await product.fill('CRP'); await product.press('Enter');
  await expect(page.getByRole('button', { name: 'Save order', exact: true })).toBeEnabled();
  expect(writes).toBe(0);
});

test('parent rerender cannot lose a pending retry acknowledgement', async ({ page }) => {
  let writes = 0;
  let acknowledge!: () => void;
  const held = new Promise<void>(resolve => { acknowledge = resolve; });
  await page.route('**/api/orders', async route => { writes += 1; await held; await route.fulfill({ json: { orderNumber: 'SF-RERENDER-RECOVERED' } }); });
  await page.addInitScript(({ key, actor, command }) => {
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, actorEmail: actor, state: 'pending', updatedAt: new Date().toISOString(), command }));
  }, { key, actor, command });
  await page.goto('/?view=order-recovery');
  await expect.poll(() => writes).toBe(1);
  // Simulate an unrelated parent update while the real order-entry overlay is open.
  await page.getByRole('button', { name: 'Refresh fixture props 0' }).dispatchEvent('click');
  await expect(page.getByRole('button', { name: 'Refresh fixture props 1' })).toBeAttached();
  acknowledge();
  await expect(page.getByText('Accepted SF-RERENDER-RECOVERED')).toBeVisible();
  expect(writes).toBe(1);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
});
