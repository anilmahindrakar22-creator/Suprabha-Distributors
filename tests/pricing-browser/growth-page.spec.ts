import { expect, test, type Page } from '@playwright/test';
const sample = () => ({
  companyCount: 1, window: { from: '2025-11-01', to: '2026-11-01', h1From: '2025-11-01', h2From: '2026-05-01' },
  confirmed: true, confirmedReason: null,
  tree: { revenuePaise: 1818000000, repeatPaise: 1367000000, bulkPaise: 451000000, bulkInvoices: 10, labsBuying: 164, buyingMonths: 760, perBuyingMonthPaise: 1799200 },
  halves: [
    { half: 'H1', revenuePaise: 715000000, repeatPaise: 579000000, bulkPaise: 136000000, bulkInvoices: 4, labsBuying: 121, buyingMonths: 374, perBuyingMonthPaise: 1548400 },
    { half: 'H2', revenuePaise: 1103000000, repeatPaise: 788000000, bulkPaise: 315000000, bulkInvoices: 6, labsBuying: 130, buyingMonths: 386, perBuyingMonthPaise: 2042200 },
  ],
  bridge: { h1Paise: 715000000, h2Paise: 1103000000, new: { labs: 43, paise: 179000000 }, stopped: { labs: 34, paise: 174000000 }, stoppedRegular: { labs: 4, paise: 21000000 }, grew: { labs: 41, paise: 483000000 }, fell: { labs: 46, paise: 100000000 }, same: { labs: 0, paise: 0 }, other: { labs: 0, paise: 0 } },
  health: { gp: { costedPct: 2, computedAt: null }, history: { firstSaleOn: '2025-10-01', monthsImported: 13 }, itemGroups: { unmappedPct: 21 }, reasons: { visitReasons180: 0, constraints: 0, openActions: 0, visits180: 4 }, catalog: { observedAt: '2026-11-09T00:00:00Z', groups: 30 } },
});
async function fixture(page: Page, options: { role?: string; status?: number; confirmed?: boolean; malformed?: boolean } = {}) {
  const role = options.role ?? 'management';
  await page.route('**/api/me', route => route.fulfill({ json: { roles: [role] } }));
  await page.route('**/api/push-subscription**', route => route.fulfill({ json: { enabled: false, publicKey: '' } }));
  await page.route('**/api/wallet?**', route => route.fulfill({ json: { coverage: { certified: true } } }));
  await page.route('**/api/today**', route => route.fulfill({ json: { policyVersion: 'today-v1', generatedAt: '2026-11-01T06:00:00Z', coverageCertified: true, unblock: { total: 0, rows: [] }, grow: { total: 0, rows: [] } } }));
  await page.route('**/api/growth', route => route.fulfill({ status: options.status ?? 200, json: options.malformed ? {} : { ...sample(), confirmed: options.confirmed ?? true, confirmedReason: options.confirmed === false ? 'Sales import is pending' : null } }));
  await page.goto('/?view=frame&role=' + role + '&roles=' + role);
}
async function openGrowth(page: Page) {
  const entry = page.getByRole('button', { name: /^growth$/i });
  if (!await entry.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(entry).toBeVisible();
  await entry.click();
}
for (const width of [375, 1280]) {
  test.describe('Growth at ' + width, () => {
    test.use({ viewport: { width, height: 900 } });
    test('management sees the figures, waterfall, table toggles and six health rows', async ({ page }) => {
      await fixture(page); await openGrowth(page);
      await expect(page.getByRole('heading', { name: 'Growth', exact: true })).toBeVisible();
      const tree = page.getByRole('region', { name: 'Where revenue comes from' });
      await expect(tree.getByText('₹181.8 L', { exact: true })).toBeVisible();
      await expect(tree.getByText('₹136.7 L', { exact: true })).toBeVisible();
      await expect(tree.getByText('₹45.1 L', { exact: true })).toBeVisible();
      await expect(tree.getByText('10 invoices of ₹2 L or more', { exact: true })).toBeVisible();
      await expect(tree.getByText('164 × 4.6 × ₹17,992 = ₹136.7 L', { exact: true })).toBeVisible();
      await expect(tree.getByText('Growth came from labs spending more each time, not from more labs.', { exact: true })).toBeVisible();
      const bridge = page.getByRole('region', { name: 'Where growth came from' });
      await expect(bridge.locator('svg rect[data-growth-bar]')).toHaveCount(6);
      await expect(bridge.getByLabel('Bridge identity')).toHaveText('71.5 + 17.9 − 17.4 + 48.3 − 10.0 = 110.3.');
      await expect(bridge.getByText('Most labs that stopped were occasional buyers; 4 regular labs stopped (₹2.1 L). Growth came from 41 existing labs.', { exact: true })).toBeVisible();
      await expect(bridge.getByText('Regular = bought in 3 or more of the 6 months before. 30 of the labs that stopped had bought only once or twice.', { exact: true })).toBeVisible();
      await expect(page.locator('#data-health li')).toHaveCount(6);
      for (const section of [tree, bridge]) {
        await section.getByRole('button', { name: 'View as table' }).click();
        await expect(section.locator('table').first()).toBeVisible();
        await section.getByRole('button', { name: 'View as chart' }).click();
      }
      if (width === 375) expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
    test('unconfirmed figures stay visible', async ({ page }) => {
      await fixture(page, { confirmed: false }); await openGrowth(page);
      await expect(page.getByText('Not confirmed: Sales import is pending', { exact: true })).toBeVisible();
      await expect(page.getByText('₹181.8 L', { exact: true })).toBeVisible();
    });
    test('sales has no Growth entry and never fetches management data', async ({ page }) => {
      const requests: string[] = [];
      page.on('request', request => { if (new URL(request.url()).pathname === '/api/growth') requests.push(request.url()); });
      await fixture(page, { role: 'sales' });
      if (width === 375) await page.getByRole('button', { name: 'More', exact: true }).click();
      await expect(page.getByRole('button', { name: /^growth$/i })).toHaveCount(0);
      expect(requests).toHaveLength(0);
    });
    test('403 shows the management-only message', async ({ page }) => {
      await fixture(page, { status: 403 }); await openGrowth(page);
      await expect(page.getByText('Growth is for management only.', { exact: true })).toBeVisible();
      await expect(page.getByText('₹181.8 L', { exact: true })).toHaveCount(0);
    });
    test('malformed responses show Retry', async ({ page }) => {
      await fixture(page, { malformed: true }); await openGrowth(page);
      await expect(page.getByText('Growth is unavailable. Try again.', { exact: true })).toBeVisible();
      await page.route('**/api/growth', route => route.fulfill({ json: sample() }));
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect(page.getByText('₹181.8 L', { exact: true })).toBeVisible();
    });
  });
}

