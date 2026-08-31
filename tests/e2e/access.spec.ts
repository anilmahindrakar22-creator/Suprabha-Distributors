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
