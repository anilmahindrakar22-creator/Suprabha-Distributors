import { expect, type Page } from '@playwright/test';

export type GrowthArea = 'act' | 'revenue' | 'bridge' | 'monthly' | 'labs' | 'purchases' | 'profit' | 'brands' | 'health';

export async function isPhoneGrowth(page: Page): Promise<boolean> {
  const menu = page.getByRole('navigation', { name: 'Growth sections', exact: true });
  const back = page.getByRole('button', { name: '‹ Back to Growth', exact: true });
  await expect(menu.or(back).or(page.getByRole('tablist', { name: 'Growth analysis', exact: true }))).toBeVisible();
  return await menu.isVisible() || await back.isVisible();
}

export async function openGrowthArea(page: Page, area: GrowthArea): Promise<void> {
  if (await isPhoneGrowth(page)) {
    const title = { act: 'Act now', revenue: 'Revenue', bridge: 'Revenue', purchases: 'Revenue', monthly: 'Labs', labs: 'Labs', profit: 'Profit', brands: 'Brands & items', health: 'Data health' }[area];
    const heading = page.getByRole('heading', { name: title, exact: true, level: 2 }).first();
    if (!await heading.isVisible()) {
      const menu = page.getByRole('navigation', { name: 'Growth sections', exact: true });
      const back = page.getByRole('button', { name: '‹ Back to Growth', exact: true });
      // Scorecard jumps can add more than one section to browser history.
      while (await back.isVisible()) {
        if (await page.evaluate(() => Boolean(history.state?.growthSection))) {
          const popped = page.evaluate(() => new Promise<void>(resolve => {
            window.addEventListener('popstate', () => requestAnimationFrame(() => resolve()), { once: true });
          }));
          await Promise.all([popped, back.click()]);
        } else {
          await back.click();
          await expect(menu).toBeVisible();
        }
      }
      await expect(menu).toBeVisible();
      // Revenue, Labs and Profit include a live figure in their accessible name.
      await menu.getByRole('button', { name: new RegExp(`^${title}(?: .*)?$`), exact: true }).click();
    }
    await expect(heading).toBeVisible();
    if (area === 'bridge' || area === 'revenue') {
      await page.getByRole('tab', { name: area === 'bridge' ? 'H1 → H2' : 'Revenue', exact: true }).click();
    }
    return;
  }
  const tabs: Partial<Record<GrowthArea, string>> = { bridge: 'H1 → H2', monthly: 'Monthly', labs: 'Monthly', purchases: 'Monthly', profit: 'Profit', brands: 'Profit' };
  const tab = tabs[area];
  if (tab) await page.getByRole('tab', { name: tab, exact: true }).click();
}
