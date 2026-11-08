import { expect, test, type Page } from '@playwright/test';
const sample = () => ({
  companyCount: 1, window: { from: '2025-11-01', to: '2026-11-01', h1From: '2025-11-01', h2From: '2026-05-01' },
  confirmed: true, confirmedReason: null,
  scorecard: { regularLabs: 20, regularPct: 40, top10Pct: 35 },
  months: Array.from({ length: 12 }, (_, i) => ({ month: new Date(Date.UTC(2025, 10 + i, 1)).toISOString().slice(0, 7), labsBuying: 68, firstTime: 3, skippedRegulars: 12, salesPaise: 150000000, purchasesRegularPaise: 100000000, purchasesLargePaise: 20000000, largePurchaseInvoices: 1 })),
  tree: { revenuePaise: 1818000000, repeatPaise: 1367000000, bulkPaise: 451000000, bulkInvoices: 10, labsBuying: 164, buyingMonths: 760, perBuyingMonthPaise: 1799200 },
  halves: [
    { half: 'H1', revenuePaise: 715000000, repeatPaise: 579000000, bulkPaise: 136000000, bulkInvoices: 4, labsBuying: 121, buyingMonths: 374, perBuyingMonthPaise: 1548400 },
    { half: 'H2', revenuePaise: 1103000000, repeatPaise: 788000000, bulkPaise: 315000000, bulkInvoices: 6, labsBuying: 130, buyingMonths: 386, perBuyingMonthPaise: 2042200 },
  ],
  bridge: { h1Paise: 715000000, h2Paise: 1103000000, new: { labs: 43, paise: 179000000 }, stopped: { labs: 34, paise: 174000000 }, stoppedRegular: { labs: 4, paise: 21000000 }, grew: { labs: 41, paise: 483000000 }, fell: { labs: 46, paise: 100000000 }, same: { labs: 0, paise: 0 }, other: { labs: 0, paise: 0 } },
  health: { gp: { costedPct: 2, computedAt: null }, history: { firstSaleOn: '2025-10-01', monthsImported: 13 }, itemGroups: { unmappedPct: 21 }, reasons: { visitReasons180: 0, constraints: 0, openActions: 0, visits180: 4 }, catalog: { observedAt: '2026-11-09T00:00:00Z', groups: 30 } },
});
async function fixture(page: Page, options: { role?: string; status?: number; confirmed?: boolean; malformed?: boolean; labsTotal?: number } = {}) {
  const role = options.role ?? 'management';
  await page.route('**/api/me', route => route.fulfill({ json: { roles: [role] } }));
  await page.route('**/api/push-subscription**', route => route.fulfill({ json: { enabled: false, publicKey: '' } }));
  await page.route('**/api/wallet?**', route => route.fulfill({ json: { coverage: { certified: true } } }));
  await page.route('**/api/today**', route => route.fulfill({ json: { policyVersion: 'today-v1', generatedAt: '2026-11-01T06:00:00Z', coverageCertified: true, unblock: { total: 0, rows: [] }, grow: { total: 0, rows: [] } } }));
  await page.route('**/api/accounts?**', route => route.fulfill({ json: { accounts: [], page: { page: 1, pageSize: 20, total: 0 }, owners: [], territories: [], classPolicy: { aMinPaise: '10000000', bMinPaise: '3000000' }, canAssign: true, canSeeProspects: true, canSeeMyActions: true, canEraseContacts: false, canSeePowerMap: true, actorEmail: 'manager@example.test', today: '2026-11-09' } }));
  await page.route('**/api/growth', route => route.fulfill({ status: options.status ?? 200, json: options.malformed ? {} : { ...sample(), confirmed: options.confirmed ?? true, confirmedReason: options.confirmed === false ? 'Sales import is pending' : null } }));
  await page.route('**/api/growth/labs?**', route => {
    const params = new URL(route.request().url()).searchParams;
    const list = params.get('list'), pageNumber = Number(params.get('page'));
    const rows = list === 'bulk_invoices'
      ? [{ invoice: true, name: 'Lab A', customerId: 'customer-a', valuePaise: 25000000, date: '2026-10-02' }]
      : list === 'month_large_purchases'
      ? [{ supplierName: 'Supplier A', valuePaise: 20000000, date: '2026-10-02' }]
      : pageNumber === 1
        ? Array.from({ length: Math.min(20, options.labsTotal ?? 12) }, (_, i) => ({ labKey: `ledger-${i}`, customerId: i === 1 ? null : `customer-${i}`, name: i === 1 ? null : i === 0 ? 'Lab A' : `Lab ${i + 1}`, town: i === 0 ? 'Town A' : null, valuePaise: null, monthsBought: 10, lastBoughtOn: '2026-09-02', trend: 'down' }))
        : [{ labKey: 'ledger-b', customerId: 'customer-b', name: 'Lab B', town: null, valuePaise: null, monthsBought: 9, lastBoughtOn: '2026-08-02', trend: 'flat' }];
    return route.fulfill({ json: { list, month: params.get('month'), ...(params.has('half') ? { half: params.get('half') } : {}), total: list === 'month_large_purchases' || list === 'bulk_invoices' ? 1 : options.labsTotal ?? 12, page: pageNumber, pageSize: 20, rows } });
  });
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
    test('scorecard and skipped segment open compact lab actions and restore keyboard focus', async ({ page }) => {
      await fixture(page); await openGrowth(page);
      const scorecard = page.getByRole('region', { name: 'Scorecard', exact: true });
      await expect(scorecard).toBeVisible();
      await expect(scorecard.locator('[data-scorecard-tile]')).toHaveCount(6);
      for (const label of ['Revenue', 'Labs buying', '₹ per buying month', 'Regular labs', "Top 10 labs' share", 'Gross profit']) {
        await expect(scorecard.getByText(label, { exact: true })).toBeVisible();
      }
      const skipped = page.getByRole('region', { name: 'Labs buying each month', exact: true }).getByRole('button', { name: /Oct.*skipped|skipped.*Oct/i });
      await skipped.focus();
      const request = page.waitForRequest(r => { const p = new URL(r.url()).searchParams; return r.url().includes('/api/growth/labs?') && p.get('list') === 'month_skipped' && p.get('month') === '2026-10' && p.get('page') === '1'; });
      await skipped.press('Enter'); await request;
      const panel = page.getByRole('dialog');
      await expect(panel.getByRole('heading', { name: 'Regulars who skipped Oct 2026 · 12', exact: true })).toBeVisible();
      await expect(panel.getByText('Lab A', { exact: true })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Plan visit', exact: true }).first()).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Open', exact: true }).first()).toBeVisible();
      await expect(panel.getByText('Tally ledger not linked', { exact: true })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Link', exact: true })).toBeVisible();
      if (width === 375) expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
      await expect(skipped).toBeFocused();
    });
    test('Load more appends page 2', async ({ page }) => {
      await fixture(page, { labsTotal: 21 }); await openGrowth(page);
      await page.getByRole('region', { name: 'Labs buying each month', exact: true }).getByRole('button', { name: /Oct.*skipped|skipped.*Oct/i }).click();
      const panel = page.getByRole('dialog');
      const request = page.waitForRequest(r => { const p = new URL(r.url()).searchParams; return r.url().includes('/api/growth/labs?') && p.get('list') === 'month_skipped' && p.get('page') === '2'; });
      await panel.getByRole('button', { name: 'Load more', exact: true }).click(); await request;
      await expect(panel.getByText('Lab B', { exact: true })).toBeVisible();
      await expect(panel.getByText('Lab A', { exact: true })).toBeVisible();
      await expect(panel.getByText('Showing 21 of 21', { exact: true })).toBeVisible();
    });
    test('Stopped starts with regular only and refetches when toggled off', async ({ page }) => {
      await fixture(page); await openGrowth(page);
      const request = page.waitForRequest(r => { const p = new URL(r.url()).searchParams; return r.url().includes('/api/growth/labs?') && p.get('list') === 'bridge_stopped' && p.get('regularOnly') === 'true'; });
      await page.getByRole('region', { name: 'Where growth came from', exact: true }).getByRole('button', { name: /stopped/i }).click(); await request;
      const regular = page.getByRole('dialog').getByRole('checkbox', { name: 'Regular only', exact: true });
      await expect(regular).toBeChecked();
      const unfiltered = page.waitForRequest(r => { const p = new URL(r.url()).searchParams; return r.url().includes('/api/growth/labs?') && p.get('list') === 'bridge_stopped' && p.get('regularOnly') === 'false'; });
      await regular.uncheck(); await unfiltered;
    });
    test('large-purchase segments show suppliers and the Economics action', async ({ page }) => {
      await fixture(page); await openGrowth(page);
      await page.getByRole('region', { name: 'Purchases against sales', exact: true }).getByRole('button', { name: /Oct.*large|large.*Oct/i }).click();
      const panel = page.getByRole('dialog');
      await expect(panel.getByText('Supplier A', { exact: true })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Check in Economics', exact: true })).toBeVisible();
    });
    test('tree spend drilldown requests per-month sorting across the window', async ({ page }) => {
      await fixture(page); await openGrowth(page);
      const request = page.waitForRequest(r => { const p = new URL(r.url()).searchParams; return r.url().includes('/api/growth/labs?') && p.get('list') === 'window_labs' && p.get('sort') === 'per_month' && p.get('page') === '1' && !p.has('half'); });
      await page.locator('#tree-chart').getByRole('button', { name: /₹ per buying month/ }).click();
      await request;
      await expect(page.getByRole('dialog').getByText('Lab A', { exact: true })).toBeVisible();
    });
    test('H2 instrument and bulk cell requests half-scoped invoices', async ({ page }) => {
      await fixture(page); await openGrowth(page);
      const row = page.getByRole('region', { name: 'Where revenue comes from', exact: true }).getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Instrument & bulk', exact: true }) });
      const request = page.waitForRequest(r => { const p = new URL(r.url()).searchParams; return r.url().includes('/api/growth/labs?') && p.get('list') === 'bulk_invoices' && p.get('half') === 'H2' && p.get('page') === '1'; });
      await row.getByRole('cell').nth(1).getByRole('button').click(); await request;
      await expect(page.getByRole('dialog').getByText('Lab A', { exact: true })).toBeVisible();
      await expect(page.getByRole('dialog').getByRole('button', { name: 'Open', exact: true })).toBeVisible();
    });
    test('sales and regular purchase bars carry no drilldown button role', async ({ page }) => {
      await fixture(page); await openGrowth(page);
      const purchases = page.getByRole('region', { name: 'Purchases against sales', exact: true });
      await expect(purchases.getByRole('button', { name: /sales|regular purchases/i })).toHaveCount(0);
      await expect(purchases.locator('svg rect[role="button"]')).toHaveCount(12);
      await purchases.getByRole('button', { name: 'View as table', exact: true }).click();
      for (const row of await purchases.locator('tbody tr').all()) {
        await expect(row.getByRole('cell').nth(0).getByRole('button')).toHaveCount(0);
        await expect(row.getByRole('cell').nth(1).getByRole('button')).toHaveCount(0);
      }
    });
    test('Brand setup health action reaches Accounts Prospects', async ({ page }) => {
      await fixture(page); await openGrowth(page);
      await page.route('**/api/customer-map?**', route => route.fulfill({ status: 503, json: { error: 'Unavailable in fixture' } }));
      await page.locator('#data-health').getByRole('button', { name: /Open Brand setup/i }).click();
      await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Prospects', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Brands setup', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Growth', exact: true })).toHaveCount(0);
    });
    test('unconfirmed figures stay visible', async ({ page }) => {
      await fixture(page, { confirmed: false }); await openGrowth(page);
      await expect(page.getByText('Not confirmed: Sales import is pending', { exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Where revenue comes from' }).getByText('₹181.8 L', { exact: true })).toBeVisible();
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
      await expect(page.getByRole('region', { name: 'Where revenue comes from' }).getByText('₹181.8 L', { exact: true })).toBeVisible();
    });
  });
}

