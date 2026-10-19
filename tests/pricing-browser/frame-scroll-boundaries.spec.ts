import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('phone frame stays pinned while embedded stock views scroll and resize', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 532 });
  await page.route('**/api/staff-auth', route => route.fulfill({ json: { ok: true, renewAfterSeconds: 3000 } }));
  await page.route('**/api/stock**', route => route.fulfill({ json: { rows: [], groups: [] } }));
  await page.route('**/api/orders**', route => route.fulfill({ json: { operations: {} } }));
  await page.route('**/stockflow.html', route => route.fulfill({ contentType: 'text/html', body: readFileSync('public/stockflow.html', 'utf8') }));

  await page.goto('/?view=staff-frame');
  const header = page.locator('main > header');
  const appNav = page.getByRole('navigation', { name: 'Application sections' });
  const stock = page.frameLocator('iframe');
  const stockViews = stock.getByRole('navigation', { name: 'Stock views' });

  async function expectShellPinned() {
    const viewportHeight = page.viewportSize()!.height;
    const headerBox = await header.boundingBox();
    const navBox = await appNav.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect(headerBox!.y).toBeGreaterThanOrEqual(0);
    expect(headerBox!.y + headerBox!.height).toBeLessThan(120);
    expect(navBox!.y).toBeGreaterThan(400);
    expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(viewportHeight);
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  }

  await expect(stock.getByRole('heading', { name: 'Stock & reorder', exact: true })).toBeVisible();
  await expectShellPinned();
  await page.evaluate(() => {
    document.documentElement.style.minHeight = '160vh';
    window.scrollTo(0, 96);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expectShellPinned();

  for (const [label, view] of [['Daily', 'operations'], ['Insights', 'insights'], ['Groups', 'groups'], ['Reorder list', 'orders']]) {
    await stockViews.getByRole('button', { name: label, exact: true }).click();
    await expect(stock.locator(`#${view}View`)).toHaveClass('view active');
    await page.waitForTimeout(300);
    await expectShellPinned();
  }

  const hero = stock.locator('.hero');
  await hero.scrollIntoViewIfNeeded();
  await expect(hero).toBeInViewport();
  await expectShellPinned();
  const footer = stock.locator('.footer');
  await footer.scrollIntoViewIfNeeded();
  await expect(footer).toBeInViewport();
  await expectShellPinned();
  await page.screenshot({ path: testInfo.outputPath('phone-stock-bottom.png') });

  await page.setViewportSize({ width: 375, height: 700 });
  await expectShellPinned();
  await footer.scrollIntoViewIfNeeded();
  await expect(footer).toBeInViewport();
  await expectShellPinned();

  await page.setViewportSize({ width: 375, height: 532 });
  await expectShellPinned();
  await hero.scrollIntoViewIfNeeded();
  await expect(hero).toBeInViewport();
  await expectShellPinned();
});
