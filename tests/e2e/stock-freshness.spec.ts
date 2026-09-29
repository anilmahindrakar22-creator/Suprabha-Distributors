import { expect, test } from '@playwright/test';

const stockPayload = (sourceFetchedAtIso?: Record<string, unknown>) => ({
  company: 'Test company',
  fetchedAtIso: new Date().toISOString(),
  fetchedAt: '29 Sep 2026, 3:30 pm',
  fetchedAtShort: '29 Sep 2026, 3:30 pm',
  rows: [],
  groups: [],
  ...(sourceFetchedAtIso ? { sourceFetchedAtIso } : {}),
});

async function openStockDashboard(page: import('@playwright/test').Page, payload: ReturnType<typeof stockPayload>) {
  await page.route('**/api/stock', (route) => route.fulfill({ json: payload }));
  await page.route('**/api/orders?summary=1', (route) => route.fulfill({ json: {} }));
  await page.goto('/stockflow.html');
  await expect(page.locator('details dl')).toContainText('Stock');
}

test('source update times stay collapsed and safely display per-source timestamps', async ({ page }) => {
  await openStockDashboard(page, stockPayload({
    stock: '2026-09-29T10:00:00Z',
    catalog: '2026-09-28T08:30:00Z',
    customers: '<img src=x onerror=alert(1)>',
  }));

  const details = page.getByText('Source update times').locator('..');
  await expect(details).not.toHaveAttribute('open', '');
  await details.locator('summary').click();
  await expect(details).toContainText('Stock');
  await expect(details).toContainText('Catalog');
  await expect(details).toContainText('Customers');
  await expect(details).toContainText('Not available');
  await expect(details.getByText('Not available')).toHaveCount(1);
  await expect(details.locator('img')).toHaveCount(0);
});

test('older stock payloads without source timestamps remain supported', async ({ page }) => {
  await openStockDashboard(page, stockPayload());

  const details = page.getByText('Source update times').locator('..');
  await details.locator('summary').click();
  await expect(details.getByText('Not available')).toHaveCount(3);
});
