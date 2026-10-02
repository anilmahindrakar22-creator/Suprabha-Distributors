import { test, expect } from '@playwright/test';

test('trusted-device request resumes the exact command after restart without automatic sending', async ({ page }) => {
  const commands: unknown[] = [];
  await page.route('**/api/product-requests', async (route) => {
    commands.push(route.request().postDataJSON());
    await route.fulfill(commands.length === 1 ? { status: 502, json: { error: 'Unknown outcome' } } : { json: { requestId: 'confirmed-request' } });
  });
  await page.goto('/?view=product-request-recovery');
  await page.getByRole('button', { name: 'Request new product', exact: true }).click();
  await page.getByLabel('Product request details').fill('50-test pack');
  await page.getByLabel('Keep request retry on this trusted device').check();
  await page.getByRole('button', { name: 'Send product request' }).click();
  await expect(page.getByText(/Unknown outcome/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Recovered request for this account/)).toBeVisible();
  expect(commands).toHaveLength(1);
  await page.getByRole('button', { name: 'Retry product request' }).click();
  await expect(page.getByText('Product request saved for office review. No product was added to Tally.')).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[0]).toEqual(commands[1]);
  expect(await page.evaluate(() => localStorage.getItem('stockflow:product-request-retry:v1:sales@example.test'))).toBeNull();
});

test('request recovery is account separated and opt-in', async ({ page }) => {
  await page.route('**/api/product-requests', async (route) => route.fulfill({ status: 502, json: { error: 'Unknown outcome' } }));
  await page.goto('/?view=product-request-recovery');
  await page.getByRole('button', { name: 'Request new product', exact: true }).click();
  await page.getByRole('button', { name: 'Send product request' }).click();
  await expect(page.getByText(/Unknown outcome/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await page.reload();
  await page.getByRole('button', { name: 'Request new product', exact: true }).click();
  await page.getByLabel('Keep request retry on this trusted device').check();
  await page.getByRole('button', { name: 'Send product request' }).click();
  await expect(page.getByText(/Unknown outcome/)).toBeVisible();
  await page.goto('/?view=product-request-recovery&actor=other@example.test');
  await expect(page.getByRole('button', { name: 'Retry product request' })).toHaveCount(0);
  await expect(page.getByText(/Recovered request/)).toHaveCount(0);
});

test('trusted-device storage failure prevents sending an unprotected request', async ({ page }) => {
  let writes = 0;
  await page.route('**/api/product-requests', async (route) => { writes += 1; await route.fulfill({ json: { requestId: 'unexpected' } }); });
  await page.goto('/?view=product-request-recovery');
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('Quota unavailable'); }; });
  await page.getByRole('button', { name: 'Request new product', exact: true }).click();
  await page.getByLabel('Keep request retry on this trusted device').check();
  await page.getByRole('button', { name: 'Send product request' }).click();
  await expect(page.getByText(/nothing new was sent/)).toBeVisible();
  expect(writes).toBe(0);
});
