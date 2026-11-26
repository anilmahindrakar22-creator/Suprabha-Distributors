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


const tierSample = () => ({
  month: '2026-11-01', stale: false,
  bands: { diamond: 100000000, platinum: 30000000, gold: 10000000, silver: 2500000 },
  tiers: [
    { tier: 'diamond', labs: 3, consumablesPaise: 335000000, sharePct: 24, withInstrument: 3 },
    { tier: 'platinum', labs: 12, consumablesPaise: 420000000, sharePct: 30, withInstrument: 8 },
    { tier: 'gold', labs: 30, consumablesPaise: 400000000, sharePct: 28, withInstrument: 14 },
    { tier: 'silver', labs: 40, consumablesPaise: 200000000, sharePct: 14, withInstrument: 5 },
    { tier: 'untiered', labs: 50, consumablesPaise: 55000000, sharePct: 4, withInstrument: 1 },
  ],
  movers: { up: 4, down: 2 }, placement: { labs: 21, consumablesPaise: 470000000 },
});
const tierLabs = (list: string) => ({
  list, totalLabs: list === 'gold' ? 110 : 2,
  rows: Array.from({ length: list === 'gold' ? 100 : 2 }, (_, i) => ({
    labKey: `c|${i}`, customerId: i === 0 ? 'customer-0' : null,
    name: i === 0 ? 'Lab A' : i === 1 ? null : `Lab ${i + 1}`,
    town: i === 0 ? 'Pune' : null, phone: i === 0 ? '+919876543210' : null,
    tier: list === 'placement' && i === 1 ? 'platinum' : 'gold',
    consumablesPaise: 1200037, hasInstrument: list !== 'placement' && i === 0,
    previousTier: i === 0 ? 'silver' : 'platinum', change: i === 0 ? 'up' : 'down',
  })),
});
async function fixture(page: Page, stale = false) {
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
  await page.route('**/api/growth/cohorts*', route => route.fulfill({ status: 503, json: { error: 'Unavailable in fixture' } }));
  await page.route('**/api/growth/tiers*', route => {
    const params = new URL(route.request().url()).searchParams;
    const selected = params.get('tier') ?? params.get('list');
    return route.fulfill({ json: selected ? tierLabs(selected) : { ...tierSample(), stale } });
  });
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
  return page.getByRole('region', { name: 'Lab tiers', exact: true });
}

// Growth › Labs uses the section navigation on phones.
test.use({ viewport: { width: 600, height: 900 } });
test('summary table shows exact values and caption bands', async ({ page }) => {
  await fixture(page);
  const card = await openLabs(page);
  await expect(card).toBeVisible();
  await expect(card).toContainText('By consumables bought from us in the last 12 months. Diamond ₹10 L+ · Platinum ₹3–10 L · Gold ₹1–3 L · Silver ₹25k–1 L.');
  await expect(card.locator('thead th')).toHaveText(['Tier', 'Labs', 'Consumables', 'Share', 'With our instrument']);
  const rows = card.locator('tbody tr');
  await expect(rows).toHaveCount(5);
  const values = [
    ['Diamond', '3', '₹33,50,000', '24%', '3'],
    ['Platinum', '12', '₹42,00,000', '30%', '8'],
    ['Gold', '30', '₹40,00,000', '28%', '14'],
    ['Silver', '40', '₹20,00,000', '14%', '5'],
    ['Untiered', '50', '₹5,50,000', '4%', '1'],
  ];
  for (let i = 0; i < values.length; i++) await expect(rows.nth(i).locator('th, td')).toHaveText(values[i]);
  await expect(card.getByRole('button', { name: 'Moved up 4 · down 2 this month ›', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Placement targets: 21 labs · ₹47,00,000 ›', exact: true })).toBeVisible();
});

test('tapping Gold requests its list and shows instrument flags and actions', async ({ page }) => {
  await fixture(page);
  const card = await openLabs(page);
  const row = card.getByRole('button', { name: /^Gold / });
  const request = page.waitForRequest(req => new URL(req.url()).pathname === '/api/growth/tiers' && new URL(req.url()).search === '?tier=gold');
  await row.click();
  await request;
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  const list = card.getByRole('list', { name: 'Gold labs', exact: true });
  await expect(list.getByRole('listitem')).toHaveCount(100);
  const first = list.getByRole('listitem').first();
  await expect(first).toContainText('Lab A');
  await expect(first).toContainText('Pune · ₹12,000.37 consumables');
  await expect(first).toContainText('Our instrument');
  await expect(first.getByRole('button', { name: 'Open customer' })).toBeEnabled();
  await expect(first.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:+919876543210');
  await expect(list.getByRole('listitem').nth(1)).toContainText('Unnamed lab');
  await expect(list.getByRole('listitem').nth(1)).toContainText('Open lab');
  await expect(list.getByRole('listitem').nth(1).getByRole('button')).toHaveCount(0);
  await expect(card).toContainText('Showing 100 of 110');
  await card.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(list).toHaveCount(0);
});

test('movers chip shows up and down markers and replaces the previous list', async ({ page }) => {
  await fixture(page);
  const card = await openLabs(page);
  await card.getByRole('button', { name: /^Gold / }).click();
  await expect(card.getByRole('heading', { name: 'Gold labs' })).toBeVisible();
  const request = page.waitForRequest(req => new URL(req.url()).search === '?list=movers');
  await card.getByRole('button', { name: /^Moved up / }).click();
  await request;
  const list = card.getByRole('list', { name: 'Moved tier this month', exact: true });
  await expect(list).toContainText('▲ from Silver');
  await expect(list).toContainText('▼ from Platinum');
  await expect(card.getByRole('heading', { name: 'Gold labs' })).toHaveCount(0);
});

test('placement chip shows its title and rows', async ({ page }) => {
  await fixture(page);
  const card = await openLabs(page);
  const request = page.waitForRequest(req => new URL(req.url()).search === '?list=placement');
  await card.getByRole('button', { name: /^Placement targets:/ }).click();
  await request;
  const title = 'Placement targets: Gold and Platinum labs without our instrument';
  await expect(card.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const list = card.getByRole('list', { name: title, exact: true });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByRole('listitem').first()).toContainText('Gold');
  await expect(list.getByRole('listitem').nth(1)).toContainText('Platinum');
  await expect(list.getByRole('listitem').first()).toContainText('Open lab');
  await expect(list).not.toContainText('Our instrument');
});

test('stale summary shows the refresh line', async ({ page }) => {
  await fixture(page, true);
  const card = await openLabs(page);
  await expect(card).toContainText('Tiers are being refreshed; figures are live estimates.');
});

test('tier rows support keyboard expansion and collapse', async ({ page }) => {
  await fixture(page);
  const card = await openLabs(page);
  const row = card.getByRole('button', { name: /^Gold / });
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await expect(card.getByRole('heading', { name: 'Gold labs' })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await expect(card.getByRole('heading', { name: 'Gold labs' })).toHaveCount(0);
});

test.describe('375 px phone', () => {
  test.use({ viewport: { width: 375, height: 900 } });
  test('scrolls the table inside the card without horizontal page scroll', async ({ page }) => {
    await fixture(page);
    const card = await openLabs(page);
    await expect(card.locator('tbody tr')).toHaveCount(5);
    expect(await card.locator('table').evaluate(el => !!el.parentElement && el.parentElement.scrollWidth > el.parentElement.clientWidth)).toBe(true);
    expect(await page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) <= window.innerWidth)).toBe(true);
    expect(await page.locator('[data-growth-scroller]').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
  test('card is absent on the lapsing filter', async ({ page }) => {
    await fixture(page);
    await openGrowth(page);
    await openGrowthArea(page, 'act');
    await page.getByRole('button', { name: 'Lapsing core labs ›', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Who is buying, month by month' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Lab tiers', exact: true })).toHaveCount(0);
  });
});

