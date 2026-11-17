import { expect, test, type Page } from '@playwright/test';

const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2025, 10 + i, 1)).toISOString().slice(0, 7));
const growthSample = () => ({
  companyCount: 1, window: { from: '2025-11-01', to: '2026-11-01', h1From: '2025-11-01', h2From: '2026-05-01' },
  confirmed: true, confirmedReason: null,
  scorecard: { regularLabs: 20, regularPct: 40, top10Pct: 35 },
  months: months.map(month => ({ month, labsBuying: 68, firstTime: 3, skippedRegulars: 12, salesPaise: 150000000, purchasesRegularPaise: 100000000, purchasesLargePaise: 20000000, largePurchaseInvoices: 1 })),
  tree: { revenuePaise: 1818000000, repeatPaise: 1367000000, bulkPaise: 451000000, bulkInvoices: 10, labsBuying: 164, buyingMonths: 760, perBuyingMonthPaise: 1799200 },
  halves: [
    { half: 'H1', revenuePaise: 715000000, repeatPaise: 579000000, bulkPaise: 136000000, bulkInvoices: 4, labsBuying: 121, buyingMonths: 374, perBuyingMonthPaise: 1548400 },
    { half: 'H2', revenuePaise: 1103000000, repeatPaise: 788000000, bulkPaise: 315000000, bulkInvoices: 6, labsBuying: 130, buyingMonths: 386, perBuyingMonthPaise: 2042200 },
  ],
  bridge: { h1Paise: 715000000, h2Paise: 1103000000, new: { labs: 43, paise: 179000000 }, stopped: { labs: 34, paise: 174000000 }, stoppedRegular: { labs: 4, paise: 21000000 }, grew: { labs: 41, paise: 483000000 }, fell: { labs: 46, paise: 100000000 }, same: { labs: 0, paise: 0 }, other: { labs: 0, paise: 0 } },
  health: { gp: { costedPct: 2, computedAt: null }, history: { firstSaleOn: '2025-10-01', monthsImported: 13 }, itemGroups: { unmappedPct: 21 }, reasons: { visitReasons180: 0, constraints: 0, openActions: 0, visits180: 4 }, catalog: { observedAt: '2026-11-09T00:00:00Z', groups: 30 } },
  gp: { method: 'average_purchase_cost_to_date', window: { salesPaise: 10000000, knownSalesPaise: 8500000, costPaise: 6000000, gpPaise: 2500000, gpPct: 29.4, coveragePct: 85, unreliableLines: 1 }, halves: [{ half: 'H1', salesPaise: 5000000, knownSalesPaise: 4000000, costPaise: 3000000, gpPaise: 1000000, gpPct: 25, coveragePct: 80 }, { half: 'H2', salesPaise: 5000000, knownSalesPaise: 4500000, costPaise: 3000000, gpPaise: 1500000, gpPct: 33, coveragePct: 90 }], repeat: { salesPaise: 8000000, knownSalesPaise: 7000000, costPaise: 5000000, gpPaise: 2000000, gpPct: 25, coveragePct: 87.5 }, bulk: { salesPaise: 2000000, knownSalesPaise: 1500000, costPaise: 1000000, gpPaise: 500000, gpPct: 25, coveragePct: 75 }, months: months.map(month => ({ month, salesPaise: 1000000, knownSalesPaise: 850000, gpPaise: 250000 })) },
});

const labMonthsSample = () => {
  const rows = Array.from({ length: 20 }, (_, i) => {
    const name = i === 19 ? null : `Lab ${String(i + 1).padStart(2, '0')}`;
    let monthsPaise: number[] = Array<number>(12).fill(100000 * (21 - i));
    if (i === 0) monthsPaise = monthsPaise.map((_, m) => (m === 5 ? 500000 : 100000));
    if (i === 1) monthsPaise = monthsPaise.map((v, m) => (m >= 10 ? 0 : v));
    const totalPaise = monthsPaise.reduce((a, b) => a + b, 0);
    return { labKey: i === 19 ? 'c|' : `c|${i}`, customerId: null, name, town: null, totalPaise, monthsPaise, buyingMonths: monthsPaise.filter(v => v > 0).length };
  });
  return { window: { from: '2025-11-01', to: '2026-11-01' }, months, totalLabs: 75, rows };
};

const lapsingSample = () => ({
  ...labMonthsSample(), totalLabs: 3,
  rows: labMonthsSample().rows.slice(0, 3).map((row, i) => ({
    ...row, customerId: i === 2 ? null : `customer-${i}`, town: 'Pune',
    monthsPaise: [...Array<number>(9).fill(3800000), 3800000, 0, 0], buyingMonths: 10,
    totalPaise: 38000000, lastPurchaseOn: '2026-09-14', usualMonthlyPaise: 3800000,
    monthsMissed: 2, phone: i === 1 ? null : `+91987654321${i}`,
  })),
});

async function fixture(page: Page, options: { error?: boolean; emptyLapsing?: boolean } = {}) {
  await page.route('**/api/me', route => route.fulfill({ json: { roles: ['management'] } }));
  await page.route('**/api/push-subscription**', route => route.fulfill({ json: { enabled: false, publicKey: '' } }));
  await page.route('**/api/wallet?**', route => route.fulfill({ json: { coverage: { certified: true } } }));
  await page.route('**/api/today**', route => route.fulfill({ json: { policyVersion: 'today-v1', generatedAt: '2026-11-01T06:00:00Z', coverageCertified: true, unblock: { total: 0, rows: [] }, grow: { total: 0, rows: [] } } }));
  await page.route('**/api/accounts?**', route => route.fulfill({ json: { accounts: [], page: { page: 1, pageSize: 20, total: 0 }, owners: [], territories: [], classPolicy: { aMinPaise: '10000000', bMinPaise: '3000000' }, canAssign: true, canSeeProspects: true, canSeeMyActions: true, canEraseContacts: false, canSeePowerMap: true, actorEmail: 'manager@example.test', today: '2026-11-09' } }));
  await page.route('**/api/growth', route => route.fulfill({ json: growthSample() }));
  await page.route('**/api/growth/inbox**', route => route.fulfill({ status: 503, json: { error: 'Unavailable in fixture' } }));
  await page.route('**/api/growth/labs?**', route => route.fulfill({ status: 503, json: { error: 'Unavailable in fixture' } }));
  let requests = 0;
  await page.route('**/api/growth/lab-months*', route => {
    if (new URL(route.request().url()).searchParams.get('filter') === 'lapsing') {
      return route.fulfill({ json: options.emptyLapsing ? { ...lapsingSample(), rows: [], totalLabs: 0 } : lapsingSample() });
    }
    if (options.error && requests++ === 0) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    return route.fulfill({ json: labMonthsSample() });
  });
  await page.goto('/?view=frame&role=management&roles=management');
}
async function openMonthly(page: Page) {
  const entry = page.getByRole('button', { name: /^growth$/i });
  if (!await entry.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(entry).toBeVisible();
  await entry.click();
  await page.getByRole('tab', { name: 'Monthly', exact: true }).click();
  const section = page.getByRole('region', { name: 'Who is buying, month by month', exact: true });
  await expect(page.getByRole('heading', { name: 'Who is buying, month by month' })).toBeVisible();
  return section;
}

for (const width of [375, 1280]) {
  test.describe('Growth lab months heatmap at ' + width, () => {
    test.use({ viewport: { width, height: 900 } });
    test('renders 20 rows, the Lapsing flag and the best-month colour', async ({ page }) => {
      await fixture(page);
      const section = await openMonthly(page);
      const rows = section.locator('[data-lab-row]');
      await expect(rows).toHaveCount(20);
      await expect(section).toContainText('Top 20 labs by sales · 12 months · darker = more of that lab\'s usual monthly business');
      await expect(section).toContainText('75 labs bought in these 12 months; showing the top 20.');
      await expect(rows.filter({ hasText: 'Lapsing' })).toHaveCount(1);
      await expect(rows.nth(1)).toContainText('Lapsing');
      await expect(rows.nth(0)).not.toContainText('Lapsing');
      const best = rows.nth(0).locator('[data-heat]').nth(5);
      await expect(best).toHaveCSS('background-color', 'rgb(13, 75, 52)');
      await expect(rows.nth(1).locator('[data-heat="0"]').first()).toHaveCSS('border-style', 'dashed');
      await expect(best).toHaveAttribute('title', 'Lab 01, Apr 2026: ₹5,000');
      await expect(best).toContainText('Lab 01, Apr 2026: ₹5,000');
      await expect(rows.nth(19)).toContainText('(unlinked ledger)');
      await expect(rows.nth(19).locator('[data-heat]').first()).toHaveAttribute('title', /^\(unlinked ledger\), Nov 2025: /);
    });
    test('shows a short lapsing call list and switches back to top labs', async ({ page }) => {
      const requests = { top: 0, lapsing: 0 };
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname === '/api/growth/lab-months') requests[url.searchParams.get('filter') === 'lapsing' ? 'lapsing' : 'top']++;
      });
      await fixture(page);
      const section = await openMonthly(page);
      const lapsingChip = section.getByRole('button', { name: 'Lapsing core labs (3)', exact: true });
      await expect(lapsingChip).toHaveAttribute('aria-pressed', 'false');
      await lapsingChip.click();
      await expect(section.getByRole('button', { name: 'Lapsing core labs (3)', exact: true })).toHaveAttribute('aria-pressed', 'true');
      const list = section.getByRole('list', { name: 'Call list', exact: true });
      await expect(list.getByRole('listitem')).toHaveCount(3);
      await expect(list.getByRole('link', { name: 'Call', exact: true })).toHaveCount(2);
      await expect(list.getByRole('listitem').nth(1).getByRole('link', { name: 'Call', exact: true })).toHaveCount(0);
      await expect(list.getByRole('link', { name: 'Call', exact: true }).first()).toHaveAttribute('href', 'tel:+919876543210');
      await expect(list.getByRole('button', { name: 'Open customer', exact: true })).toHaveCount(2);
      for (const openCustomer of await list.getByRole('button', { name: 'Open customer', exact: true }).all()) {
        await expect(openCustomer).toBeEnabled();
      }
      await expect(list).toContainText('Last bought 14 Sep');
      await expect(list).toContainText('Usually ₹38k/month');
      await expect(list).toContainText('Missed 2 months');
      await expect(section.locator('[data-lab-row]')).toHaveCount(3);
      expect(await page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) <= window.innerWidth)).toBe(true);
      await section.getByRole('button', { name: 'View as table', exact: true }).click();
      await expect(section.locator('tbody tr')).toHaveCount(3);
      expect(await page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) <= window.innerWidth)).toBe(true);
      await section.getByRole('button', { name: 'Top labs', exact: true }).click();
      await expect(section.locator('[data-lab-row]')).toHaveCount(20);
      await expect(section.getByRole('list', { name: 'Call list', exact: true })).toHaveCount(0);
      expect(requests).toEqual({ top: 1, lapsing: 1 });
    });
    test('shows the lapsing empty state', async ({ page }) => {
      await fixture(page, { emptyLapsing: true });
      const section = await openMonthly(page);
      await section.getByRole('button', { name: /^Lapsing core labs(?: \(0\))?$/ }).click();
      await expect(section).toContainText('No lapsing core labs right now.');
      await expect(section.getByRole('button', { name: 'Lapsing core labs (0)', exact: true })).toBeVisible();
    });
    test('the table view shows the same labs', async ({ page }) => {
      await fixture(page);
      const section = await openMonthly(page);
      await section.getByRole('button', { name: 'View as table', exact: true }).click();
      await expect(section.locator('table')).toBeVisible();
      await expect(section.locator('tbody tr')).toHaveCount(20);
      await section.getByRole('button', { name: 'View as chart', exact: true }).click();
      await expect(section.locator('[data-lab-row]')).toHaveCount(20);
    });
    test('an error offers Retry', async ({ page }) => {
      await fixture(page, { error: true });
      const section = await openMonthly(page);
      await expect(section.getByRole('alert')).toContainText('Lab months are unavailable.');
      await section.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect(section.locator('[data-lab-row]')).toHaveCount(20);
    });
    test('month headers never wrap', async ({ page }) => {
      await fixture(page);
      const section = await openMonthly(page);
      const headers = section.locator('[data-month-header]');
      await expect(headers).toHaveCount(12);
      for (const header of await headers.all()) {
        const box = await header.boundingBox();
        expect(box?.height ?? 99).toBeLessThanOrEqual(16);
      }
      expect(await headers.first().innerText()).toBe(width === 375 ? 'N' : 'Nov');
    });
    test('does not overflow the page', async ({ page }) => {
      await fixture(page);
      const section = await openMonthly(page);
      await expect(section.locator('[data-lab-row]')).toHaveCount(20);
      expect(await page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) <= window.innerWidth)).toBe(true);
      await section.getByRole('button', { name: 'View as table', exact: true }).click();
      await expect(section.locator('table')).toBeVisible();
      expect(await page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) <= window.innerWidth)).toBe(true);
    });
  });
}
