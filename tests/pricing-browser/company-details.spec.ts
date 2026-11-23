import { expect, test, type Page, type Route } from '@playwright/test';

async function canvasPng(page: Page, width: number, height: number) {
  const dataUrl = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#093f46';
    context.fillRect(width / 4, height / 4, width / 2, height / 2);
    return canvas.toDataURL('image/png');
  }, { width, height });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

const letterhead = {
  companyName: 'Example Company', address: '12 Market Road, Bengaluru', gstin: null,
  phone: '080 1234 5678', deliveryAddress: '', version: 1, updatedAt: '2026-11-20T10:30:00.000Z',
};

test('extras load on first open and save the uploaded logo and trimmed terms', async ({ page }) => {
  const card = await usersScreen(page, route => route.fulfill({ json: letterhead }));
  let gets = 0;
  let posted: { action: string; payload: { logo: { type: string; base64: string }; terms: string[]; expectedVersion: number } } | undefined;
  await page.route('**/api/letterhead/extras', async route => {
    if (route.request().method() === 'POST') {
      posted = route.request().postDataJSON();
      await route.fulfill({ json: { logo: posted!.payload.logo, terms: posted!.payload.terms, version: 8 } });
    } else {
      gets++;
      await route.fulfill({ json: { logo: null, terms: [], version: 7 } });
    }
  });
  expect(gets).toBe(0);
  await card.locator('summary').click();
  const extras = card.getByRole('region', { name: 'Logo and PO terms', exact: true });
  await expect(extras.getByRole('button', { name: 'Choose logo', exact: true })).toBeVisible();
  expect(gets).toBe(1);
  await extras.getByLabel('Choose logo file', { exact: true }).setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: await canvasPng(page, 900, 300) });
  await expect(extras.locator('img[alt="Company logo"]')).toBeVisible();
  await extras.getByRole('button', { name: 'Add term', exact: true }).click();
  await extras.getByLabel('Term 1', { exact: true }).fill('  Payment within 30 days.  ');
  await extras.getByRole('button', { name: 'Add term', exact: true }).click();
  await extras.getByLabel('Term 2', { exact: true }).fill('  Confirm delivery date.  ');
  await extras.getByRole('button', { name: 'Save logo and terms', exact: true }).click();
  await expect(extras.getByRole('status')).toHaveText('Logo and terms saved');
  expect(posted).toMatchObject({ action: 'set_letterhead_extras', payload: { expectedVersion: 7, terms: ['Payment within 30 days.', 'Confirm delivery date.'] } });
  const bytes = Buffer.from(posted!.payload.logo.base64, 'base64');
  expect(bytes.length).toBeLessThanOrEqual(40960);
  expect(bytes.length).toBeGreaterThanOrEqual(100);
  expect(posted!.payload.logo.type).toBe('image/png');
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
  expect(bytes.readUInt32BE(16)).toBeLessThanOrEqual(600);
  expect(bytes.readUInt32BE(20)).toBeLessThanOrEqual(200);
  await card.locator('summary').click();
  await card.locator('summary').click();
  expect(gets).toBe(1);
});

test('a non-image logo file shows an alert without a preview', async ({ page }) => {
  const card = await usersScreen(page, route => route.fulfill({ json: letterhead }));
  await card.locator('summary').click();
  const extras = card.getByRole('region', { name: 'Logo and PO terms', exact: true });
  await expect(extras.getByRole('button', { name: 'Choose logo', exact: true })).toBeVisible();
  await extras.getByLabel('Choose logo file', { exact: true }).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Company notes') });
  await expect(extras.getByRole('alert')).toHaveText('Choose a PNG or JPEG image under 5 MB');
  await expect(extras.locator('img[alt="Company logo"]')).toHaveCount(0);
});

test('five terms hide Add term and removal makes it available again', async ({ page }) => {
  const card = await usersScreen(page, route => route.fulfill({ json: letterhead }));
  await card.locator('summary').click();
  for (let index = 1; index <= 5; index++) {
    await card.getByRole('button', { name: 'Add term', exact: true }).click();
    await card.getByLabel(`Term ${index}`, { exact: true }).fill(`Term ${index} text`);
  }
  await expect(card.getByRole('button', { name: 'Add term', exact: true })).toHaveCount(0);
  await card.getByRole('button', { name: 'Remove term 3', exact: true }).click();
  await expect(card.getByLabel('Term 3', { exact: true })).toHaveValue('Term 4 text');
  await expect(card.getByRole('button', { name: 'Add term', exact: true })).toBeVisible();
});

test('extras conflict offers Reload and loads the latest terms', async ({ page }) => {
  const card = await usersScreen(page, route => route.fulfill({ json: letterhead }));
  let gets = 0;
  await page.route('**/api/letterhead/extras', async route => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 409, json: { error: 'Version conflict' } });
    else await route.fulfill({ json: { logo: null, terms: ++gets === 1 ? [] : ['Latest term'], version: gets } });
  });
  await card.locator('summary').click();
  const extras = card.getByRole('region', { name: 'Logo and PO terms', exact: true });
  await extras.getByRole('button', { name: 'Save logo and terms', exact: true }).click();
  await expect(extras.getByRole('alert')).toHaveText('Someone else changed the logo or terms. Reload to see them.');
  await extras.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(extras.getByLabel('Term 1', { exact: true })).toHaveValue('Latest term');
  expect(gets).toBe(2);
});

test('extras load failure leaves the company form able to save', async ({ page }) => {
  const card = await usersScreen(page, route => route.fulfill({ json: letterhead }));
  await page.route('**/api/letterhead/extras', route => route.fulfill({ status: 500, json: { error: 'Unavailable' } }));
  await card.locator('summary').click();
  await expect(card.getByText('Logo and terms could not load', { exact: true })).toBeVisible();
  await expect(card.getByRole('region', { name: 'Logo and PO terms', exact: true }).getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Save company details', exact: true }).click();
  await expect(card.getByRole('status')).toHaveText('Company details saved');
});

test('extras retry preserves the request body and locks inputs', async ({ page }) => {
  const card = await usersScreen(page, route => route.fulfill({ json: letterhead }));
  const bodies: string[] = [];
  await page.route('**/api/letterhead/extras', async route => {
    if (route.request().method() === 'POST') {
      bodies.push(route.request().postData()!);
      await route.fulfill(bodies.length === 1 ? { status: 503, json: { error: 'Unavailable' } } : { json: { logo: null, terms: ['Delivery term'], version: 8 } });
    } else await route.fulfill({ json: { logo: null, terms: [], version: 7 } });
  });
  await card.locator('summary').click();
  const extras = card.getByRole('region', { name: 'Logo and PO terms', exact: true });
  await extras.getByRole('button', { name: 'Add term', exact: true }).click();
  await extras.getByLabel('Term 1', { exact: true }).fill('Delivery term');
  await extras.getByRole('button', { name: 'Save logo and terms', exact: true }).click();
  await expect(extras.getByLabel('Term 1', { exact: true })).toBeDisabled();
  await extras.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(extras.getByRole('status')).toHaveText('Logo and terms saved');
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
});

async function usersScreen(page: Page, handler: (route: Route) => Promise<void>) {
  await page.route('**/api/users', route => route.fulfill({ json: { users: [] } }));
  await page.route('**/api/letterhead', handler);
  await page.route('**/api/letterhead/extras', route => route.fulfill({ json: { logo: null, terms: [], version: 7 } }));
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
  await card.getByRole('button', { name: 'Add term', exact: true }).click();
  await card.getByLabel('Term 1', { exact: true }).fill('A'.repeat(200));
  await card.getByLabel('Choose logo file', { exact: true }).setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: await canvasPng(page, 900, 300) });
  await expect(card.locator('img[alt="Company logo"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 375)).toBe(true);
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
