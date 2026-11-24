import { expect, test, type Page } from '@playwright/test';
import { openGrowthArea, type GrowthArea } from './growth-helpers';

const TEAL = 'rgb(26, 154, 108)';
const ORANGE = 'rgb(235, 104, 52)';
const RED = 'rgb(208, 59, 59)';
const levers = { priceSpread: { items: 76, pairs: 164, paise: 19000000 }, lowMargin: { items: 12, paiseToThreshold: 7000000, examples: [] }, freeGoods: { lines: 9, costPaise: 3500000 }, instrumentsGpPaise: -30000000 };
const monthKeys = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2025, 10 + i, 1)).toISOString().slice(0, 7));
const growth = () => ({
  companyCount: 1, window: { from: '2025-11-01', to: '2026-11-01', h1From: '2025-11-01', h2From: '2026-05-01' }, confirmed: true, confirmedReason: null,
  scorecard: { regularLabs: 20, regularPct: 40, top10Pct: 35 },
  months: monthKeys.map(month => ({ month, labsBuying: 68, firstTime: 3, skippedRegulars: 12, salesPaise: 150000000, purchasesRegularPaise: 100000000, purchasesLargePaise: 20000000, largePurchaseInvoices: 1 })),
  tree: { revenuePaise: 1818000000, repeatPaise: 1367000000, bulkPaise: 451000000, bulkInvoices: 10, labsBuying: 164, buyingMonths: 760, perBuyingMonthPaise: 1799200 },
  halves: [
    { half: 'H1', revenuePaise: 715000000, repeatPaise: 579000000, bulkPaise: 136000000, bulkInvoices: 4, labsBuying: 121, buyingMonths: 374, perBuyingMonthPaise: 1548400 },
    { half: 'H2', revenuePaise: 1103000000, repeatPaise: 788000000, bulkPaise: 315000000, bulkInvoices: 6, labsBuying: 130, buyingMonths: 386, perBuyingMonthPaise: 2042200 },
  ],
  bridge: { h1Paise: 715000000, h2Paise: 1103000000, new: { labs: 43, paise: 179000000 }, stopped: { labs: 34, paise: 174000000 }, stoppedRegular: { labs: 4, paise: 21000000 }, grew: { labs: 41, paise: 483000000 }, fell: { labs: 46, paise: 100000000 }, same: { labs: 0, paise: 0 }, other: { labs: 0, paise: 0 } },
  health: { gp: { costedPct: 2, computedAt: null }, history: { firstSaleOn: '2025-10-01', monthsImported: 13 }, itemGroups: { unmappedPct: 21 }, reasons: { visitReasons180: 0, constraints: 0, openActions: 0, visits180: 4 }, catalog: { observedAt: '2026-11-09T00:00:00Z', groups: 30 } },
  gp: { method: 'average_purchase_cost_to_date', window: { salesPaise: 10000000, knownSalesPaise: 8500000, costPaise: 6000000, gpPaise: 2500000, gpPct: 29.4, coveragePct: 85, unreliableLines: 1 }, halves: [{ half: 'H1', salesPaise: 5000000, knownSalesPaise: 4000000, costPaise: 3000000, gpPaise: 1000000, gpPct: 25, coveragePct: 80 }, { half: 'H2', salesPaise: 5000000, knownSalesPaise: 4500000, costPaise: 3000000, gpPaise: 1500000, gpPct: 33, coveragePct: 90 }], repeat: { salesPaise: 8000000, knownSalesPaise: 7000000, costPaise: 5000000, gpPaise: 2000000, gpPct: 25, coveragePct: 87.5 }, bulk: { salesPaise: 2000000, knownSalesPaise: 1500000, costPaise: 1000000, gpPaise: 500000, gpPct: 25, coveragePct: 75 }, consumables: { salesPaise: 8000000, knownSalesPaise: 7000000, costPaise: 5000000, gpPaise: 2000000, gpPct: 28.1, coveragePct: 87.5 }, instruments: { salesPaise: 2000000, knownSalesPaise: 1500000, costPaise: 1800000, gpPaise: -300000, gpPct: -20, coveragePct: 75 }, months: monthKeys.map(month => ({ month, salesPaise: 1000000, knownSalesPaise: 850000, gpPaise: 250000, consumablesKnownSalesPaise: 1000000, consumablesGpPaise: 280000, instrumentsKnownSalesPaise: 500000, instrumentsGpPaise: -100000 })) },
});
const marginList = (p: URLSearchParams) => ({
  view: p.get('view'), sort: p.get('sort') ?? 'sales', filter: p.get('filter') ?? 'all', q: p.get('q'), page: Number(p.get('page')), pageSize: 20, total: p.get('view') === 'items' ? 4 : 1, thresholdPct: 14, consumablesMarginPct: 28.1, levers,
  rows: p.get('view') === 'items'
    ? [
      { itemKey: 'item-a', name: 'Cliniquant CRP', salesPaise: 55000000, knownSalesPaise: 55000000, gpPaise: 7000000, marginPct: 13.2, labs: 13, priceLowPaise: 140000, typicalPricePaise: 250000, priceHighPaise: 322000, spreadPaise: 2904900, low: true, belowCost: false },
      { itemKey: 'item-b', name: 'Healthy item', salesPaise: 45000000, knownSalesPaise: 45000000, gpPaise: 11250000, marginPct: 25, labs: 9, priceLowPaise: 100000, typicalPricePaise: 120000, priceHighPaise: 140000, spreadPaise: 40000, low: false, belowCost: false },
      { itemKey: 'item-c', name: 'Below cost item', salesPaise: 35000000, knownSalesPaise: 35000000, gpPaise: -3500000, marginPct: -10, labs: 7, priceLowPaise: 100000, typicalPricePaise: 125000, priceHighPaise: 150000, spreadPaise: 50000, low: true, belowCost: true },
      { itemKey: 'item-d', name: 'Extreme below cost', salesPaise: 25000000, knownSalesPaise: 25000000, gpPaise: -37500000, marginPct: -150, labs: 5, priceLowPaise: 100000, typicalPricePaise: 125000, priceHighPaise: 150000, spreadPaise: 50000, low: true, belowCost: true },
    ]
    : [{ labKey: 'ledger-a', customerId: 'customer-a', name: 'Lab A', town: 'Town A', salesPaise: 55000000, knownSalesPaise: 55000000, gpPaise: 7000000, marginPct: 13.2, coveragePct: 100, low: true, totalSalesPaise: 80000000, instrumentSalesPaise: 25000000 }],
});
const itemPrices: [string, number][] = [['Lab A', 160800], ['Lab B', 240000], ['Lab C', 250000], ['Lab D', 260000], ['Lab E', 275000]];
const itemDetail = () => ({
  kind: 'item', itemKey: 'item-a', name: 'Cliniquant CRP', typicalPricePaise: 250000, labs: 13, marginPct: 28.1, tallyItemKey: 'tally-a', page: 1, pageSize: 20, total: 13,
  rows: itemPrices.map(([name, unitPricePaise], i) => ({ labKey: `ledger-${i}`, customerId: `customer-${i}`, name, town: null, unitPricePaise, quantity: 4, salesPaise: unitPricePaise * 4, belowTypical: unitPricePaise < 225000, packDifference: false, approvedPricePaise: null })),
});
const measures = (sales: number, marginPct: number) => ({ salesPaise: sales, h1Paise: Math.round(sales * 0.4), h2Paise: sales - Math.round(sales * 0.4), instrumentSalesPaise: 0, consumablesSalesPaise: sales, knownSalesPaise: sales, gpPaise: Math.round(sales * marginPct / 100), marginPct, items: 4 });
const brandSpecs: [string, number, number][] = [['Principal A', 9000000, 30], ['Principal B', 6000000, 15], ['Principal C', 3000000, 25], ['Principal D', 1000000, 10]];
const brands = () => ({
  window: { from: '2025-11-01', to: '2026-11-01', h2From: '2026-05-01' },
  totals: { salesPaise: 19000000, instrumentSalesPaise: 0, consumablesSalesPaise: 19000000, knownSalesPaise: 19000000, gpPaise: 4000000, marginPct: 22.5 },
  rows: brandSpecs.map(([name, sales, margin], i) => ({
    key: `brand:${i}`, kind: 'brand', brandCode: `P${i}`, name, ...measures(sales, margin),
    lines: i === 0 ? [{ kind: 'direct', group: 'Group B', areaCode: null, ...measures(3000000, 30) }, { kind: 'individual', group: null, areaCode: null, ...measures(1000000, 30) }] : [],
  })),
});

async function fixture(page: Page) {
  await page.route('**/api/me', route => route.fulfill({ json: { roles: ['management'] } }));
  await page.route('**/api/push-subscription**', route => route.fulfill({ json: { enabled: false, publicKey: '' } }));
  await page.route('**/api/wallet?**', route => route.fulfill({ json: { coverage: { certified: true } } }));
  await page.route('**/api/today**', route => route.fulfill({ json: { policyVersion: 'today-v1', generatedAt: '2026-11-01T06:00:00Z', coverageCertified: true, unblock: { total: 0, rows: [] }, grow: { total: 0, rows: [] } } }));
  await page.route('**/api/accounts?**', route => route.fulfill({ json: { accounts: [], page: { page: 1, pageSize: 20, total: 0 }, owners: [], territories: [], classPolicy: { aMinPaise: '10000000', bMinPaise: '3000000' }, canAssign: true, canSeeProspects: true, canSeeMyActions: true, canEraseContacts: false, canSeePowerMap: true, actorEmail: 'manager@example.test', today: '2026-11-09' } }));
  await page.route('**/api/growth', route => route.fulfill({ json: growth() }));
  await page.route('**/api/growth/margin?**', route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.has('billedBelow')) return route.fulfill({ json: { lines: 0, gapPaise: 0, unitMismatchLines: 0, approvedPricesInUse: 0, page: 1, pageSize: 20, total: 0, rows: [] } });
    return route.fulfill({ json: params.has('itemKey') ? itemDetail() : marginList(params) });
  });
  await page.route('**/api/growth/inbox**', route => route.fulfill({ status: 503, json: { error: 'Unavailable in fixture' } }));
  await page.route('**/api/growth/labs?**', route => route.fulfill({ status: 503, json: { error: 'Unavailable in fixture' } }));
  await page.route('**/api/growth/lab-months**', route => route.fulfill({ status: 503, json: { error: 'Unavailable in fixture' } }));
  await page.route('**/api/growth/brands', route => route.fulfill({ json: brands() }));
  await page.goto('/?view=frame&role=management&roles=management&growthPeriod=rolling12');
}
async function openTab(page: Page, area: GrowthArea) {
  const entry = page.getByRole('button', { name: /^growth$/i });
  if (!await entry.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(entry).toBeVisible();
  await entry.click();
  await openGrowthArea(page, area);
}
const fillOf = (locator: ReturnType<Page['locator']>) => locator.evaluate(element => getComputedStyle(element).fill);
const blackMarks = (page: Page) => page.evaluate(() => [...document.querySelectorAll('svg rect, svg circle')].filter(el => getComputedStyle(el).fill === 'rgb(0, 0, 0)').length);

for (const width of [375, 1280]) {
  test.describe('Growth chart colours at ' + width, () => {
    test.use({ viewport: { width, height: 900 } });
    test('gross profit bars use the chart palette', async ({ page }) => {
      await fixture(page);
      await openTab(page, 'profit');
      const section = page.getByRole('region', { name: 'Gross profit by month', exact: true });
      await expect(section.locator('rect[aria-label*="consumables gross profit"]').first()).toBeAttached();
      expect(await fillOf(section.locator('rect[aria-label*="consumables gross profit"]').first())).toBe(TEAL);
      expect(await fillOf(section.locator('rect[aria-label*="instruments and bulk gross profit"]').first())).toBe(ORANGE);
      await expect(section.locator('i.bg-sf-chart-1')).toHaveCount(1);
      await expect(section.locator('i.bg-sf-chart-2')).toHaveCount(1);
    });
    test('no chart mark in Growth is black', async ({ page }) => {
      await fixture(page);
      for (const tab of ['monthly', 'purchases', 'bridge', 'profit', 'brands'] as const) {
        await openTab(page, tab);
        await expect(page.locator('svg rect, svg circle').first()).toBeAttached();
        expect(await blackMarks(page), tab).toBe(0);
      }
    });
    test('monthly and bridge charts use the palette', async ({ page }) => {
      await fixture(page);
      await openTab(page, 'purchases');
      const purchases = page.locator('#purchases-chart');
      await expect(purchases.locator('rect[aria-label*="sales"]').first()).toBeAttached();
      expect(await fillOf(purchases.locator('rect[aria-label*="sales"]').first())).toBe(TEAL);
      expect(await fillOf(purchases.locator('rect[aria-label*="large purchases"]').first())).toBe(ORANGE);
      expect(await fillOf(purchases.locator('rect[aria-label*="regular purchases"]').first())).toBe('rgb(42, 120, 214)');
      await openTab(page, 'bridge');
      const bridge = page.locator('#bridge-chart');
      expect(await fillOf(bridge.locator('rect[data-growth-bar="up"]').first())).toBe('rgb(12, 163, 12)');
      expect(await fillOf(bridge.locator('rect[data-growth-bar="down"]').first())).toBe(RED);
    });
    test('principal scatter shows one dot per brand and clicking expands its lines', async ({ page }) => {
      await fixture(page);
      await openTab(page, 'brands');
      const section = page.getByRole('region', { name: 'Sales by principal', exact: true });
      const dots = section.locator('[data-scatter-dot]');
      await expect(dots).toHaveCount(4);
      await expect(section.getByText('Average 22.5%', { exact: true })).toBeVisible();
      await expect(section.getByText('Right and low = big principals to renegotiate; left and high = push for volume.', { exact: true })).toBeVisible();
      await expect(section.locator('[data-scatter-dot="above"]')).toHaveCount(2);
      await expect(section.locator('[data-scatter-dot="below"]')).toHaveCount(2);
      const a = section.getByRole('button', { name: 'Principal A: sales ₹0.9 L, margin 30.0%, above average', exact: true });
      const b = section.getByRole('button', { name: 'Principal B: sales ₹0.6 L, margin 15.0%, below average', exact: true });
      expect(await fillOf(a.locator('circle[r="6"]'))).toBe(TEAL);
      expect(await fillOf(b.locator('circle[r="6"]'))).toBe(ORANGE);
      const toggle = section.getByRole('button', { name: 'Lines (2)', exact: true });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await a.dispatchEvent('click');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(section.getByText('Directly under Group B', { exact: true })).toBeVisible();
      expect(await blackMarks(page)).toBe(0);
    });
    test('item detail shows the price strip with an orange dot under 90 percent', async ({ page }) => {
      await fixture(page);
      await openTab(page, 'profit');
      const explorer = page.getByRole('region', { name: 'Margin by lab and item', exact: true });
      await explorer.getByRole('tab', { name: 'Items', exact: true }).click();
      await explorer.getByRole('button', { name: 'Cliniquant CRP: open labs and prices', exact: true }).click();
      const panel = page.getByRole('dialog');
      const strip = panel.locator('[data-price-strip]');
      await expect(strip).toBeVisible();
      await expect(strip).toContainText('Typical ₹2,500');
      await expect(strip).toContainText('Showing 5 of 13 labs · band ₹2,250–₹2,750 (90–110% of typical) · orange = below the band');
      await expect(strip).toContainText('Lower ₹2,250');
      await expect(strip).toContainText('Upper ₹2,750');
      await expect(strip.locator('[data-price-dot]')).toHaveCount(5);
      const under = strip.locator('[data-price-dot="under"]');
      await expect(under).toHaveCount(1);
      await expect(under).toHaveAttribute('aria-label', 'Lab A: ₹1,608, 64% of typical');
      expect(await fillOf(under.locator('circle[r="5"]'))).toBe(ORANGE);
      expect(await under.locator('circle[r="5"]').evaluate(element => getComputedStyle(element).stroke)).toBe(RED);
      expect(await fillOf(strip.locator('[data-price-dot="ok"] circle[r="5"]').first())).toBe('rgb(42, 120, 214)');
      await under.dispatchEvent('click');
      await expect(panel.locator('li[data-lab-row="selected"]')).toContainText('Lab A');
      if (width === 375) expect(await page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) <= window.innerWidth)).toBe(true);
    });
    test('item scatter colours healthy, low and below-cost items', async ({ page }) => {
      await fixture(page);
      await openTab(page, 'profit');
      const section = page.locator('[data-item-scatter]');
      const ok = section.locator('[data-item-dot="ok"]');
      const low = section.locator('[data-item-dot="low"]');
      const below = section.locator('[data-item-dot="below-cost"]');
      await expect(ok).toHaveCount(1);
      await expect(low).toHaveCount(1);
      await expect(below).toHaveCount(2);
      expect(await fillOf(ok.locator('circle[r="6"]'))).toBe(TEAL);
      expect(await fillOf(low.locator('circle[r="6"]'))).toBe(ORANGE);
      expect(await fillOf(below.first().locator('circle[r="6"]'))).toBe(RED);
      await expect(section.locator('[data-item-threshold]')).toBeAttached();
      await expect(section.locator('[data-item-average]')).toBeAttached();
      await expect(section.locator('svg text[y="198"]')).toHaveText(['0', '2', '4', '6', '8']);
      const extreme = section.locator('[data-item-dot][aria-label^="Extreme below cost"]');
      await expect(extreme).toHaveAttribute('data-item-clamped');
      await expect(extreme).toHaveAttribute('aria-label', /-150\.0%/);
      await expect(section.locator('[data-item-direct-label]')).toContainText('(−150%)');
      const thresholdY = Number(await section.locator('[data-item-threshold]').getAttribute('y')) + 4;
      const bottomY = Number(await section.locator('svg > line').last().getAttribute('y1'));
      expect(Math.abs(thresholdY - bottomY)).toBeGreaterThan(20);
    });
    test('tapping an item dot opens its lab prices', async ({ page }) => {
      await fixture(page);
      await openTab(page, 'profit');
      await page.locator('[data-item-scatter] [data-item-dot="low"]').press('Enter');
      const panel = page.getByRole('dialog');
      const strip = panel.locator('[data-price-strip]');
      await expect(strip).toBeVisible();
      await expect(strip).toContainText('Typical ₹2,500');
      await expect(strip).toContainText('Showing 5 of 13 labs · band ₹2,250–₹2,750 (90–110% of typical) · orange = below the band');
    });
    test('item scatter tooltip stays within its section', async ({ page }) => {
      await fixture(page);
      await openTab(page, 'profit');
      const section = page.locator('[data-item-scatter]');
      await section.locator('[data-item-dot]').first().hover();
      const tip = section.locator('[data-chart-tip]');
      await expect(tip).toBeVisible();
      const tipBox = await tip.boundingBox();
      const sectionBox = await section.boundingBox();
      expect(tipBox).not.toBeNull();
      expect(sectionBox).not.toBeNull();
      expect(tipBox!.x + tipBox!.width).toBeLessThanOrEqual(sectionBox!.x + sectionBox!.width);
    });
    test('charts do not overflow the page width', async ({ page }) => {
      await fixture(page);
      for (const tab of ['monthly', 'purchases', 'bridge', 'profit', 'brands'] as const) {
        await openTab(page, tab);
        await expect(page.locator('svg').first()).toBeAttached();
        expect(await page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) <= window.innerWidth), tab).toBe(true);
      }
    });
  });
}
