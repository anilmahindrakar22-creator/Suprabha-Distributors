import { expect, test, type Page } from '@playwright/test';
import { openGrowthArea } from './growth-helpers';

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


const cohortSample = () => ({
  asOf: '2026-11-25', historyFrom: '2023-08-01', reconciled: true,
  rows: [
    { cohort: 'existing', label: 'Buying when records start (Aug 2023–Oct 2023)', labs: 114, active: 61, activePct: 54, stopped: 40, lostPaise: 173000000 },
    { cohort: '2025', label: '2025', labs: 167, active: 39, activePct: 23, stopped: 110, lostPaise: 387000000 },
  ],
  totals: { labs: 281, active: 100, activePct: 36, stopped: 150, lostPaise: 560000000 },
});
const cohortLabs = () => ({
  cohort: '2025', label: '2025', totalLabs: 110,
  rows: Array.from({ length: 50 }, (_, i) => ({
    labKey: `c|${i}`, customerId: i === 0 ? 'customer-0' : null, name: `Stopped lab ${i + 1}`,
    town: i === 0 ? 'Pune' : null, firstPurchaseOn: '2025-01-10', lastPurchaseOn: '2026-03-14', lostPaise: 1200037,
  })),
});
async function fixture(page: Page, reconciled = true) {
  await page.route('**/api/me', route => route.fulfill({ json: { roles: ['management'] } }));
  await page.route('**/api/push-subscription**', route => route.fulfill({ json: { enabled: false, publicKey: '' } }));
  await page.route('**/api/wallet?**', route => route.fulfill({ json: { coverage: { certified: true } } }));
  await page.route('**/api/today**', route => route.fulfill({ json: { policyVersion: 'today-v1', generatedAt: '2026-11-01T06:00:00Z', coverageCertified: true, unblock: { total: 0, rows: [] }, grow: { total: 0, rows: [] } } }));
  await page.route('**/api/accounts?**', route => route.fulfill({ json: { accounts: [], page: { page: 1, pageSize: 20, total: 0 }, owners: [], territories: [], classPolicy: { aMinPaise: '10000000', bMinPaise: '3000000' }, canAssign: true, canSeeProspects: true, canSeeMyActions: true, canEraseContacts: false, canSeePowerMap: true, actorEmail: 'manager@example.test', today: '2026-11-09' } }));
  await page.route('**/api/growth', route => route.fulfill({ json: growthSample() }));
  await page.route('**/api/growth/inbox**', route => route.fulfill({ status: 503, json: { error: 'Unavailable in fixture' } }));
  await page.route('**/api/growth/labs?**', route => route.fulfill({ status: 503, json: { error: 'Unavailable in fixture' } }));

  await page.route('**/api/growth/lab-months*', route => {
    const filter = new URL(route.request().url()).searchParams.get('filter');
    return route.fulfill({ json: filter === 'lapsing' ? lapsingSample() : labMonthsSample() });
  });
  await page.route('**/api/growth/stopped-items?**', route => route.fulfill({ json: { labs: [] } }));
  await page.route('**/api/growth/cohorts*', route => route.fulfill({
    json: new URL(route.request().url()).searchParams.has('cohort') ? cohortLabs() : { ...cohortSample(), reconciled },
  }));
  await page.goto('/?view=frame&role=management&roles=management&growthPeriod=rolling12');
}
async function openGrowth(page: Page) {
  const entry = page.getByRole('button', { name: /^growth$/i });
  if (!await entry.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(entry).toBeVisible();
  await entry.click();
}
async function openLabs(page: Page) {
  await openGrowth(page);
  await openGrowthArea(page, 'labs');
  return page.getByRole('region', { name: 'Labs by year first bought', exact: true });
}

// Growth › Labs uses the section navigation on phones.
test.use({ viewport: { width: 600, height: 900 } });
test('grid shows exact cohort counts and paise, including All labs', async ({ page }) => {
  await fixture(page);
  const card = await openLabs(page);
  await expect(card).toBeVisible();
  const rows = card.locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('th, td')).toHaveText(['Buying when records start (Aug 2023–Oct 2023)', '114', '61 (54%)', '40', '₹17,30,000']);
  await expect(rows.nth(1).locator('th, td')).toHaveText(['2025', '167', '39 (23%)', '110', '₹38,70,000']);
  await expect(card.locator('tfoot tr').locator('th, td')).toHaveText(['All labs', '281', '100 (36%)', '150', '₹56,00,000']);
});
test('tapping a cohort requests its list and offers Open customer', async ({ page }) => {
  await fixture(page);
  const card = await openLabs(page);
  const row = card.getByRole('button', { name: /^2025 / });
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  const request = page.waitForRequest(req => new URL(req.url()).pathname === '/api/growth/cohorts' && new URL(req.url()).search === '?cohort=2025');
  await row.click();
  await request;
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await expect(card.getByRole('heading', { name: 'Stopped labs, 2025' })).toBeVisible();
  const list = card.getByRole('list', { name: 'Stopped labs', exact: true });
  await expect(list.getByRole('listitem')).toHaveCount(50);
  await expect(list.getByRole('listitem').first()).toContainText('Stopped lab 1');
  await expect(list.getByRole('listitem').first()).toContainText('Pune · last bought 14 Mar 2026');
  await expect(list.getByRole('listitem').first()).toContainText('₹ lost ₹12,000.37');
  await expect(list.getByRole('button', { name: 'Open customer', exact: true })).toBeEnabled();
  await expect(list.getByRole('listitem').nth(1).getByRole('button')).toHaveCount(0);
  await expect(card).toContainText('Showing 50 of 110');
});
test('shows the unreconciled months notice', async ({ page }) => {
  await fixture(page, false);
  const card = await openLabs(page);
  await expect(card).toContainText('Some months are not reconciled yet, so counts may change slightly.');
});
test('cohort rows support keyboard expansion and collapse', async ({ page }) => {
  await fixture(page);
  const card = await openLabs(page);
  const row = card.getByRole('button', { name: /^2025 / });
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Space');
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await expect(card.getByRole('heading', { name: 'Stopped labs, 2025' })).toHaveCount(0);
});
test.describe('375 px phone', () => {
  test.use({ viewport: { width: 375, height: 900 } });
  test('scrolls the table within the card without horizontal page scroll', async ({ page }) => {
    await fixture(page);
    const card = await openLabs(page);
    await expect(card.locator('tfoot')).toContainText('All labs');
    expect(await card.locator('table').evaluate(el => el.parentElement!.scrollWidth > el.parentElement!.clientWidth)).toBe(true);
    expect(await page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) <= window.innerWidth)).toBe(true);
    expect(await page.locator('[data-growth-scroller]').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
  test('card is absent on the lapsing filter', async ({ page }) => {
    await fixture(page);
    await openGrowth(page);
    await openGrowthArea(page, 'act');
    await page.getByRole('button', { name: 'Lapsing core labs ›', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Who is buying, month by month' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Labs by year first bought', exact: true })).toHaveCount(0);
  });
});
