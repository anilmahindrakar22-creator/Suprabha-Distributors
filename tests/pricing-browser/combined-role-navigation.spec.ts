import { expect, test, type Page } from '@playwright/test';

// Phones show Stock / Orders / Requests / More at the bottom; the other sections live under More.
async function showAllSections(page: Page) {
  const more = page.getByRole('button', { name: 'More' });
  if (await more.isVisible()) await more.click();
}

test('secondary Accounts role offers Pricing without Administrator controls', async ({ page }) => {
  await page.goto('/?view=frame&role=sales&roles=sales,accounts');
  await showAllSections(page);
  await expect(page.getByRole('button', { name: /^pricing$/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^users$/i })).toHaveCount(0);
});

test('Sales and Warehouse union does not expose commercial or administrator navigation', async ({ page }) => {
  await page.goto('/?view=frame&role=sales&roles=sales,warehouse');
  await showAllSections(page);
  await expect(page.getByRole('button', { name: /^orders$/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^pricing$/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^users$/i })).toHaveCount(0);
});

test('secondary Administrator role offers Users while invalid sets fail closed', async ({ page }) => {
  await page.goto('/?view=frame&role=viewer&roles=administrator,viewer');
  await showAllSections(page);
  await expect(page.getByRole('button', { name: /^users$/i })).toBeVisible();
  await page.goto('/?view=frame&role=administrator&roles=administrator,unknown');
  await showAllSections(page);
  await expect(page.getByRole('button', { name: /^users$/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^pricing$/i })).toHaveCount(0);
});
