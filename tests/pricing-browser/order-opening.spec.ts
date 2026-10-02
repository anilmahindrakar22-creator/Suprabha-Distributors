import { expect, test } from '@playwright/test';

test('slow order masters show a cancellable preparation panel without opening a cancelled order', async ({ page }) => {
  let releaseMasters: () => void = () => undefined;
  let catalogRequests = 0;
  let customerRequests = 0;
  const mastersReady = new Promise<void>((resolve) => { releaseMasters = resolve; });
  const list = {
    actor: { email: 'order-desk@example.test', role: 'sales' },
    snapshot: { company: 'TEST', fetchedAt: '2026-09-29T00:00:00Z', catalogVersion: 'test-v1', catalog: [] },
    customers: [], customerVersion: 'test-v1', orders: [], operations: {},
  };
  await page.route('**/api/orders?list=1', (route) => route.fulfill({ json: list }));
  await page.route('**/api/orders?catalog=1', async (route) => {
    catalogRequests += 1;
    await mastersReady;
    await route.fulfill({ json: { catalogVersion: 'test-v1', catalog: [{ tallyKey: 'GLUCOSE', item: 'Glucose', group: 'Diasys', baseUnit: 'Nos', closing: 10, active: true }] } });
  });
  await page.route('**/api/orders?customers=1', async (route) => {
    customerRequests += 1;
    await mastersReady;
    await route.fulfill({ json: { customerVersion: 'test-v1', customers: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Test Laboratory', tallyKey: 'TEST' }] } });
  });

  await page.goto('/?view=orders-workspace');
  await page.getByRole('button', { name: '+ Order' }).click();
  const preparing = page.getByRole('dialog', { name: 'Preparing order' });
  await expect(preparing).toBeVisible();
  const cancel = preparing.getByRole('button', { name: 'Cancel' });
  await expect(cancel).toBeFocused();
  await cancel.click();
  releaseMasters();
  await expect(preparing).toBeHidden();
  await expect(page.getByRole('heading', { name: 'New order' })).toBeHidden();

  await page.getByRole('button', { name: '+ Order' }).click();
  await expect(page.getByRole('heading', { name: 'New order' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Find product' })).toBeVisible();
  expect(catalogRequests).toBe(1);
  expect(customerRequests).toBe(1);
});
