import { expect, test, type Page, type Route } from '@playwright/test';

const letterhead = {
  companyName: 'Example Company', address: '12 Market Road, Bengaluru', gstin: null,
  phone: '080 1234 5678', deliveryAddress: '', version: 1, updatedAt: '2026-11-20T10:30:00.000Z',
};

async function usersScreen(page: Page, handler: (route: Route) => Promise<void>) {
  await page.route('**/api/users', route => route.fulfill({ json: { users: [] } }));
  await page.route('**/api/letterhead', handler);
  await page.goto('/?view=staff-users');
  return page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Company details' }) });
}

test('company details are collapsed and load on first open', async ({ page }) => {
  let gets = 0;
  const card = await usersScreen(page, async route => {
    gets++;
    await route.fulfill({ json: letterhead });
  });
  await expect(card).not.toHaveAttribute('open', '');
  await expect(card.getByLabel('Company name', { exact: true })).not.toBeVisible();
  expect(gets).toBe(0);
  await card.locator('summary').click();
  await expect(card.getByLabel('Company name', { exact: true })).toHaveValue(letterhead.companyName);
  await expect(card.getByLabel('Address', { exact: true })).toHaveValue(letterhead.address);
  await expect(card.getByLabel('Phone', { exact: true })).toHaveValue(letterhead.phone);
  await expect(card.getByText(/Last saved/)).toContainText('20 November 2026');
  expect(gets).toBe(1);
  await card.locator('summary').click();
  await card.locator('summary').click();
  await expect(card.getByLabel('Company name', { exact: true })).toBeVisible();
  expect(gets).toBe(1);
});

test('save normalizes GSTIN and sends the loaded version', async ({ page }) => {
  const posts: unknown[] = [];
  const card = await usersScreen(page, async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      posts.push(body);
      await route.fulfill({ json: { ...letterhead, companyName: body.payload.companyName, gstin: body.payload.gstin, version: 2 } });
    } else await route.fulfill({ json: letterhead });
  });
  await card.locator('summary').click();
  await card.getByLabel('Company name', { exact: true }).fill('Updated Company');
  await card.getByLabel('GSTIN', { exact: true }).fill('29abcde1234f1z5');
  await expect(card.getByLabel('Delivery address same as company address', { exact: true })).toBeChecked();
  await expect(card.getByLabel('Delivery address', { exact: true })).toHaveCount(0);
  await card.getByRole('button', { name: 'Save company details' }).click();
  await expect(card.getByRole('status')).toHaveText('Company details saved');
  expect(posts).toEqual([{ action: 'set_letterhead', payload: {
    idempotencyKey: expect.any(String), expectedVersion: 1, companyName: 'Updated Company',
    address: letterhead.address, gstin: '29ABCDE1234F1Z5', phone: letterhead.phone, deliveryAddress: '',
  } }]);
  await expect(card.getByLabel('GSTIN', { exact: true })).toHaveValue('29ABCDE1234F1Z5');
});

test('invalid GSTIN is highlighted on blur and submit without a POST', async ({ page }) => {
  let posts = 0;
  const card = await usersScreen(page, async route => {
    if (route.request().method() === 'POST') posts++;
    await route.fulfill({ json: letterhead });
  });
  await card.locator('summary').click();
  await card.getByLabel('GSTIN', { exact: true }).fill('12345');
  await card.getByLabel('Phone', { exact: true }).focus();
  await expect(card.getByText('Enter a 15-character GSTIN, for example 29ABCDE1234F1Z5')).toBeVisible();
  await card.getByRole('button', { name: 'Save company details' }).click();
  await expect(card.getByRole('alert')).toHaveText('Check the highlighted fields');
  await expect(card.getByLabel('GSTIN', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  expect(posts).toBe(0);
});

test('503 locks every field and Retry sends the identical request body', async ({ page }) => {
  const bodies: (string | null)[] = [];
  const card = await usersScreen(page, async route => {
    if (route.request().method() === 'POST') {
      bodies.push(route.request().postData());
      await route.fulfill(bodies.length === 1 ? { status: 503, json: { error: 'Temporarily unavailable' } } : { json: { ...letterhead, version: 2 } });
    } else await route.fulfill({ json: letterhead });
  });
  await card.locator('summary').click();
  await card.getByLabel('Delivery address same as company address', { exact: true }).uncheck();
  await card.getByLabel('Delivery address', { exact: true }).fill('Warehouse 2, Peenya');
  await card.getByRole('button', { name: 'Save company details' }).click();
  await expect(card.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  for (const name of ['Company name', 'Address', 'GSTIN', 'Phone', 'Delivery address']) {
    await expect(card.getByLabel(name, { exact: true })).toBeDisabled();
  }
  await expect(card.getByLabel('Delivery address same as company address', { exact: true })).toBeDisabled();
  await card.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(card.getByRole('status')).toHaveText('Company details saved');
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(JSON.parse(bodies[0]!).payload.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
  await expect(card.getByLabel('Company name', { exact: true })).toBeEnabled();
});

test('409 offers Reload and refetches the changed letterhead', async ({ page }) => {
  let gets = 0;
  const card = await usersScreen(page, async route => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 409, json: { error: 'Version conflict' } });
    } else {
      gets++;
      await route.fulfill({ json: gets === 1 ? letterhead : { ...letterhead, companyName: 'Other administrator company', version: 2 } });
    }
  });
  await card.locator('summary').click();
  await card.getByRole('button', { name: 'Save company details' }).click();
  await expect(card.getByRole('alert')).toHaveText('Someone else changed these details. Reload to see them.');
  await card.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(card.getByLabel('Company name', { exact: true })).toHaveValue('Other administrator company');
  expect(gets).toBe(2);
  await expect(card.getByRole('button', { name: 'Save company details' })).toBeEnabled();
});

test('open company details fit a 375px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const card = await usersScreen(page, route => route.fulfill({ json: letterhead }));
  await card.locator('summary').click();
  await expect(card.getByText(/Last saved/)).toBeVisible();
  await card.getByLabel('Delivery address same as company address', { exact: true }).uncheck();
  await expect(card.getByLabel('Delivery address', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('separate delivery address preserves its draft when toggled and stays unticked after saving', async ({ page }) => {
  const posts: unknown[] = [];
  const card = await usersScreen(page, async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      posts.push(body);
      await route.fulfill({ json: { ...letterhead, deliveryAddress: body.payload.deliveryAddress, version: 2 } });
    } else await route.fulfill({ json: letterhead });
  });
  await card.locator('summary').click();
  const sameDelivery = card.getByLabel('Delivery address same as company address', { exact: true });
  await sameDelivery.uncheck();
  const delivery = card.getByLabel('Delivery address', { exact: true });
  await delivery.fill('Warehouse 2, Peenya');
  await sameDelivery.check();
  await expect(delivery).toHaveCount(0);
  await sameDelivery.uncheck();
  await expect(delivery).toHaveValue('Warehouse 2, Peenya');
  await expect(card.getByText('Leave empty to use the address above.')).toHaveCount(0);
  await card.getByRole('button', { name: 'Save company details' }).click();
  await expect(card.getByRole('status')).toHaveText('Company details saved');
  expect(posts).toEqual([expect.objectContaining({ payload: expect.objectContaining({ deliveryAddress: 'Warehouse 2, Peenya' }) })]);
  await expect(sameDelivery).not.toBeChecked();
  await expect(delivery).toHaveValue('Warehouse 2, Peenya');
});

for (const deliveryAddress of ['', '   ']) {
  test(`unticked ${deliveryAddress ? 'whitespace' : 'empty'} delivery address prevents saving`, async ({ page }) => {
    let posts = 0;
    const card = await usersScreen(page, async route => {
      if (route.request().method() === 'POST') posts++;
      await route.fulfill({ json: letterhead });
    });
    await card.locator('summary').click();
    await card.getByLabel('Delivery address same as company address', { exact: true }).uncheck();
    await card.getByLabel('Delivery address', { exact: true }).fill(deliveryAddress);
    await card.getByRole('button', { name: 'Save company details' }).click();
    await expect(card.getByText('Enter the delivery address, or tick "same as company address"', { exact: true })).toBeVisible();
    await expect(card.getByLabel('Delivery address', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    expect(posts).toBe(0);
  });
}

test('a loaded separate delivery address starts unticked and displays the value', async ({ page }) => {
  const card = await usersScreen(page, route => route.fulfill({ json: { ...letterhead, deliveryAddress: 'Warehouse 2, Peenya' } }));
  await card.locator('summary').click();
  await expect(card.getByLabel('Delivery address same as company address', { exact: true })).not.toBeChecked();
  await expect(card.getByLabel('Delivery address', { exact: true })).toHaveValue('Warehouse 2, Peenya');
});
