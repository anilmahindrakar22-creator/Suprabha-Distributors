import { expect, test, type Page } from '@playwright/test';
const marginLevers = { priceSpread: { items: 76, pairs: 164, paise: 19000000 }, lowMargin: { items: 12, paiseToThreshold: 7000000, examples: [{ name: 'HIV Tridot', marginPct: 13.2, salesPaise: 55000000, labs: 35 }] }, freeGoods: { lines: 9, costPaise: 3500000 }, instrumentsGpPaise: -30000000 };
const marginSample = (p: URLSearchParams) => ({
  view: p.get('view'), sort: p.get('sort') ?? 'sales', filter: p.get('filter') ?? 'all', q: p.get('q'), page: Number(p.get('page')), pageSize: 20, total: 1, thresholdPct: 14, consumablesMarginPct: 28.1, levers: marginLevers,
  rows: p.get('view') === 'items' ? [{ itemKey: 'item-a', name: 'Cliniquant CRP', salesPaise: 55000000, knownSalesPaise: 55000000, gpPaise: 7000000, marginPct: 13.2, labs: 13, priceLowPaise: 140000, typicalPricePaise: 250000, priceHighPaise: 322000, spreadPaise: 2904900, low: true, belowCost: false }] : [{ labKey: 'ledger-a', customerId: 'customer-a', name: 'Lab A', town: 'Town A', salesPaise: 55000000, knownSalesPaise: 55000000, gpPaise: 7000000, marginPct: 13.2, coveragePct: 100, low: true, totalSalesPaise: 80000000, instrumentSalesPaise: 25000000 }],
});
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
  gp: { method: 'average_purchase_cost_to_date', window: { salesPaise: 10000000, knownSalesPaise: 8500000, costPaise: 6000000, gpPaise: 2500000, gpPct: 29.4, coveragePct: 85, unreliableLines: 1 }, halves: [{ half: 'H1', salesPaise: 5000000, knownSalesPaise: 4000000, costPaise: 3000000, gpPaise: 1000000, gpPct: 25, coveragePct: 80 }, { half: 'H2', salesPaise: 5000000, knownSalesPaise: 4500000, costPaise: 3000000, gpPaise: 1500000, gpPct: 33, coveragePct: 90 }], repeat: { salesPaise: 8000000, knownSalesPaise: 7000000, costPaise: 5000000, gpPaise: 2000000, gpPct: 25, coveragePct: 87.5 }, bulk: { salesPaise: 2000000, knownSalesPaise: 1500000, costPaise: 1000000, gpPaise: 500000, gpPct: 25, coveragePct: 75 }, months: Array.from({ length: 12 }, (_, i) => ({ month: new Date(Date.UTC(2025, 10 + i, 1)).toISOString().slice(0, 7), salesPaise: 1000000, knownSalesPaise: 850000, gpPaise: 250000 })) },
});
const measures = (sales: number) => ({ salesPaise: sales, h1Paise: Math.round(sales * 0.4), h2Paise: sales - Math.round(sales * 0.4), instrumentSalesPaise: 0, consumablesSalesPaise: sales, knownSalesPaise: sales, gpPaise: Math.round(sales * 0.2), marginPct: 20, items: 4 });
const brandsSample = () => ({
  window: { from: '2025-11-01', to: '2026-11-01', h2From: '2026-05-01' },
  totals: { salesPaise: 90000000, instrumentSalesPaise: 5000000, consumablesSalesPaise: 85000000, knownSalesPaise: 80000000, gpPaise: 18000000, marginPct: 22.5 },
  rows: [
    ...Array.from({ length: 11 }, (_, i) => ({
      key: `brand:P${i}`, kind: 'brand', brandCode: `P${i}`, name: `Principal ${String.fromCharCode(65 + i)}`, ...measures(9000000 - i * 100000),
      lines: i === 0 ? [
        { kind: 'line', group: 'Group A', areaCode: 'BIOCHEM', ...measures(5000000) },
        { kind: 'direct', group: 'Group B', areaCode: null, ...measures(3000000) },
        { kind: 'individual', group: null, areaCode: null, ...measures(1000000) },
        { kind: 'direct', group: '', areaCode: null, ...measures(500000) },
      ] : [],
    })),
    { key: 'none', kind: 'none', brandCode: null, name: 'Not a principal product', ...measures(1000000), lines: [] },
    { key: 'unmapped', kind: 'unmapped', brandCode: null, name: 'Not mapped', ...measures(2000000), lines: [] },
  ],
});
async function fixture(page: Page, options: { brands?: 'ok' | 'error-once' } = {}) {
  await page.route('**/api/me', route => route.fulfill({ json: { roles: ['management'] } }));
  await page.route('**/api/push-subscription**', route => route.fulfill({ json: { enabled: false, publicKey: '' } }));
  await page.route('**/api/wallet?**', route => route.fulfill({ json: { coverage: { certified: true } } }));
  await page.route('**/api/today**', route => route.fulfill({ json: { policyVersion: 'today-v1', generatedAt: '2026-11-01T06:00:00Z', coverageCertified: true, unblock: { total: 0, rows: [] }, grow: { total: 0, rows: [] } } }));
  await page.route('**/api/accounts?**', route => route.fulfill({ json: { accounts: [], page: { page: 1, pageSize: 20, total: 0 }, owners: [], territories: [], classPolicy: { aMinPaise: '10000000', bMinPaise: '3000000' }, canAssign: true, canSeeProspects: true, canSeeMyActions: true, canEraseContacts: false, canSeePowerMap: true, actorEmail: 'manager@example.test', today: '2026-11-09' } }));
  await page.route('**/api/growth', route => route.fulfill({ json: { ...sample(), confirmed: true, confirmedReason: null } }));
  await page.route('**/api/growth/margin?**', route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.has('billedBelow')) return route.fulfill({ json: { lines: 0, gapPaise: 0, unitMismatchLines: 0, approvedPricesInUse: 0, page: 1, pageSize: 20, total: 0, rows: [] } });
    return route.fulfill({ json: marginSample(params) });
  });
  await page.route('**/api/growth/inbox**', route => route.fulfill({ status: 503, json: { error: 'Unavailable in fixture' } }));
  await page.route('**/api/growth/labs?**', route => route.fulfill({ status: 503, json: { error: 'Unavailable in fixture' } }));
  let brandRequests = 0;
  await page.route('**/api/growth/brands', route => {
    if (options.brands === 'error-once' && brandRequests++ === 0) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    return route.fulfill({ json: brandsSample() });
  });
  await page.goto('/?view=frame&role=management&roles=management');
}
async function openProfit(page: Page) {
  const entry = page.getByRole('button', { name: /^growth$/i });
  if (!await entry.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(entry).toBeVisible();
  await entry.click();
  await page.getByRole('tab', { name: 'Profit', exact: true }).click();
  const section = page.getByRole('region', { name: 'Sales by principal', exact: true });
  return section;
}

for (const width of [375, 1280]) {
  test.describe('Growth sales by principal at ' + width, () => {
    test.use({ viewport: { width, height: 900 } });
    test('shows the first ten principals, then all on request', async ({ page }) => {
      await fixture(page);
      const section = await openProfit(page);
      await expect(section.locator('[data-brand-row]').first()).toBeAttached();
      await expect(section.getByRole('heading', { name: 'Sales by principal', exact: true })).toBeVisible();
      await expect(section).toContainText('12 months · sales include instruments · margin is consumables only, average purchase cost');
      const rows = section.locator('[data-brand-row]');
      await expect(rows).toHaveCount(12);
      await expect(rows.getByText('Principal K', { exact: true })).toHaveCount(0);
      const first = rows.first();
      expect(await first.getByText(/^Sales .* · H2 vs H1/).count()).toBeGreaterThanOrEqual(1);
      expect(await first.locator('span[aria-hidden="true"]').count()).toBeGreaterThanOrEqual(4);
      await section.getByRole('button', { name: 'Show all 11 principals', exact: true }).click();
      await expect(rows).toHaveCount(13);
      await expect(rows.getByText('Principal K', { exact: true })).toBeVisible();
      await expect(section.getByRole('button', { name: /Show all/ })).toHaveCount(0);
      await expect(section.getByText('Not a principal product', { exact: true })).toBeVisible();
      await expect(section).toContainText('Total ₹9,00,000 · instruments ₹50,000 · consumables margin 22.5%. Same 12 months as Gross profit.');
    });
    test('expands a principal to its lines with the test area', async ({ page }) => {
      await fixture(page);
      const section = await openProfit(page);
      const toggle = section.getByRole('button', { name: 'Lines (4)', exact: true });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(section.getByText('Group A · Biochemistry', { exact: true })).toBeVisible();
      await expect(section.getByText('Directly under Group B', { exact: true })).toBeVisible();
      await expect(section.getByText('Set individually', { exact: true })).toBeVisible();
      await expect(section.getByText('No group', { exact: true })).toBeVisible();
      await toggle.click();
      await expect(section.getByText('Group A · Biochemistry', { exact: true })).toHaveCount(0);
    });
    test('Map in Brand setup opens Brand setup', async ({ page }) => {
      await fixture(page);
      const section = await openProfit(page);
      await page.route('**/api/customer-map?**', route => route.fulfill({ status: 503, json: { error: 'Unavailable in fixture' } }));
      await section.getByRole('button', { name: 'Map in Brand setup', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Prospects', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Brands setup', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Growth', exact: true })).toHaveCount(0);
    });
    test('an error offers Retry', async ({ page }) => {
      await fixture(page, { brands: 'error-once' });
      const section = await openProfit(page);
      await expect(section.getByRole('alert')).toContainText('Principals are unavailable.');
      await section.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect(section.getByRole('alert')).toHaveCount(0);
      await expect(section.locator('[data-brand-row]')).toHaveCount(12);
    });
    test('fits the screen and keeps buttons tappable', async ({ page }) => {
      await fixture(page);
      const section = await openProfit(page);
      await section.getByRole('button', { name: 'Lines (4)', exact: true }).click();
      await section.getByRole('button', { name: 'Show all 11 principals', exact: true }).click();
      await expect(section.getByText('Group A · Biochemistry', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) <= window.innerWidth)).toBe(true);
      for (const button of await section.getByRole('button').all()) {
        const box = await button.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(35.5);
      }
    });
  });
}
