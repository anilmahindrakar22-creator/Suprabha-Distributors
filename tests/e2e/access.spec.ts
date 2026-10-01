import { expect, test } from '@playwright/test';

test('unapproved visitors see a controlled access screen', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/Suprabha StockFlow/);
  await expect(
    page.getByRole('heading', {
      name: /This account is not approved|StockFlow/,
    }),
  ).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
});

test('stock data endpoint fails closed for an unapproved visitor', async ({
  request,
}) => {
  const response = await request.get('/api/stock');

  expect([401, 403]).toContain(response.status());
  expect(response.headers()['cache-control']).toBe('private, no-store');
  expect(await response.json()).toMatchObject({
    error: expect.stringMatching(/Sign in required|Access denied/),
  });
});

test('order endpoint fails closed for an unapproved visitor', async ({ request }) => {
  const response = await request.get('/api/orders');

  expect([401, 403]).toContain(response.status());
  expect(response.headers()['cache-control']).toBe('private, no-store');
  expect(await response.json()).toMatchObject({
    error: expect.stringMatching(/Sign in required|Access denied/),
  });
});

test('restricted pricing endpoint fails closed for an unapproved visitor', async ({ request }) => {
  const response = await request.get('/api/pricing?orderId=11111111-1111-4111-8111-111111111111');
  expect([401, 403]).toContain(response.status());
  expect(response.headers()['cache-control']).toContain('no-store');
  const body = await response.json();
  expect(body).not.toHaveProperty('proposedRate');
  expect(body).not.toHaveProperty('cost');
  expect(body).not.toHaveProperty('margin');
});

for (const endpoint of ['/api/product-requests', '/api/requirements', '/api/requirements?alerts=1', '/api/requirements?itemKey=TEST']) {
  test(`${endpoint} fails closed for an unapproved visitor`, async ({ request }) => {
    const response = await request.get(endpoint);
    expect([401, 403]).toContain(response.status());
    expect(response.headers()['cache-control']).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({ error: expect.stringMatching(/Sign in required|Access denied/) });
    expect(body).not.toHaveProperty('requests');
    expect(body).not.toHaveProperty('rows');
    expect(body).not.toHaveProperty('alerts');
    expect(body).not.toHaveProperty('orders');
  });
}

test('product request mutation is denied before any command is accepted for a visitor', async ({ request }) => {
  const response = await request.post('/api/product-requests', { data: { action: 'create_product_request', payload: {
    productName: 'Acceptance request', details: '', idempotencyKey: '11111111-1111-4111-8111-111111111111',
  } } });
  expect([401, 403]).toContain(response.status());
  expect(response.headers()['cache-control']).toBe('private, no-store');
  expect(await response.json()).not.toHaveProperty('requestId');
});
