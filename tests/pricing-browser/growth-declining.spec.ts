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

const decliningSample = () => ({
  ...lapsingSample(), totalLabs: 2,
  rows: lapsingSample().rows.slice(0, 2).map(row => ({
    ...row, previousNinetyPaise: 5000037, lastNinetyPaise: 2000011,
  })),
});

const stoppedItems = (itemName = 'Reagent A') => [
  { itemKey: 'reagent-a', itemName, usualMonthlyQuantity: 4.0004, unit: 'kit', lastBilledOn: '2026-08-05', lastRatePaise: 41152 },
  { itemKey: 'kit-b', itemName: 'Kit B', usualMonthlyQuantity: 2.5, unit: null, lastBilledOn: '2026-08-05', lastRatePaise: null },
];
const stoppedLine = 'Stopped buying: Reagent A (usually 4 kit/month, last ₹411.52 on 5 Aug); Kit B (usually 2.5/month)';

async function fixture(page: Page, options: { emptyDeclining?: boolean; stoppedError?: boolean; malformedStopped?: boolean; longName?: string; manyLabs?: boolean } = {}) {
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
    if (filter === 'declining') {
      const data = decliningSample();
      if (options.emptyDeclining) return route.fulfill({ json: { ...data, rows: [], totalLabs: 0 } });
      if (options.manyLabs) return route.fulfill({ json: { ...data, totalLabs: 12, rows: Array.from({ length: 10 }, (_, i) => ({ ...data.rows[0], labKey: `c|shown-${i}`, name: `Declining lab ${i}` })) } });
      return route.fulfill({ json: data });
    }
    return route.fulfill({ json: filter === 'lapsing' ? lapsingSample() : labMonthsSample() });
  });
  await page.route('**/api/growth/stopped-items?**', route => {
    if (options.stoppedError) return route.fulfill({ status: 500, json: { error: 'Unavailable' } });
    if (options.malformedStopped) return route.fulfill({ json: { labs: 'invalid' } });
    const keys = new URL(route.request().url()).searchParams.getAll('lab');
    return route.fulfill({ json: { labs: keys.map((labKey, i) => ({ labKey, items: i === 0 ? stoppedItems(options.longName) : [] })) } });
  });
  await page.goto('/?view=frame&role=management&roles=management');
}
async function openMonthly(page: Page) {
  const entry = page.getByRole('button', { name: /^growth$/i });
  if (!await entry.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(entry).toBeVisible();
  await entry.click();
  await openGrowthArea(page, 'labs');
  const section = page.getByRole('region', { name: 'Who is buying, month by month', exact: true });
  await expect(page.getByRole('heading', { name: 'Who is buying, month by month' })).toBeVisible();
  return section;
}


test('Buying less chip shows the declining call list, exact paise and caption', async ({ page }) => {
  await fixture(page);
  const section = await openMonthly(page);
  const chip = section.getByRole('button', { name: 'Buying less (2)', exact: true });
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  const list = section.getByRole('list', { name: 'Call list', exact: true });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByRole('listitem').first()).toContainText('Last 90 days ₹20,000.11 vs ₹50,000.37 before (−60%)');
  await expect(list).toContainText('Last bought 14 Sep');
  await expect(list).not.toContainText('Usually');
  await expect(list).not.toContainText('Missed');
  await expect(list.getByRole('link', { name: 'Call', exact: true })).toHaveAttribute('href', 'tel:+919876543210');
  await expect(list.getByRole('button', { name: 'Open customer', exact: true }).first()).toBeEnabled();
  await expect(section).toContainText('Buying less = consumables in the last 90 days at least 30% and ₹10,000 below the 90 days before. Instruments not counted.');
  await section.getByRole('button', { name: 'View as table', exact: true }).click();
  await expect(section.locator('tbody tr')).toHaveCount(2);
});

test('stopped items request contains exactly the shown lab keys and formats nullable fields', async ({ page }) => {
  const requests: string[][] = [];
  page.on('request', req => {
    if (new URL(req.url()).pathname === '/api/growth/stopped-items') requests.push(new URL(req.url()).searchParams.getAll('lab'));
  });
  await fixture(page);
  const section = await openMonthly(page);
  await section.getByRole('button', { name: 'Buying less (2)', exact: true }).click();
  const cards = section.getByRole('list', { name: 'Call list', exact: true }).getByRole('listitem');
  await expect(cards.first()).toContainText(stoppedLine);
  await expect(cards.nth(1)).not.toContainText('Stopped buying');
  expect(requests).toEqual([decliningSample().rows.map(row => row.labKey)]);
});

test('only the first eight cards request stopped items', async ({ page }) => {
  const requests: string[][] = [];
  page.on('request', req => {
    if (new URL(req.url()).pathname === '/api/growth/stopped-items') requests.push(new URL(req.url()).searchParams.getAll('lab'));
  });
  await fixture(page, { manyLabs: true });
  const section = await openMonthly(page);
  await section.getByRole('button', { name: 'Buying less (12)', exact: true }).click();
  await expect(section.getByRole('list', { name: 'Call list', exact: true }).getByRole('listitem')).toHaveCount(8);
  await expect(section).toContainText(stoppedLine);
  expect(requests).toEqual([Array.from({ length: 8 }, (_, i) => `c|shown-${i}`)]);
  await expect(section).toContainText('Showing 10 of 12 labs buying less.');
});

test('lapsing cards keep their usual monthly details and show stopped items', async ({ page }) => {
  await fixture(page);
  const section = await openMonthly(page);
  await section.getByRole('button', { name: 'Lapsing core labs (3)', exact: true }).click();
  const list = section.getByRole('list', { name: 'Call list', exact: true });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(list.getByRole('listitem').first()).toContainText(stoppedLine);
  await expect(list).toContainText('Usually ₹38k/month');
  await expect(list).toContainText('Missed 2 months');
  await expect(list).toContainText('Last bought 14 Sep');
});

for (const failure of ['500', 'parse error'] as const) {
  test(`stopped-items ${failure} leaves the call cards visible without an alert`, async ({ page }) => {
    await fixture(page, { stoppedError: failure === '500', malformedStopped: failure === 'parse error' });
    const section = await openMonthly(page);
    const response = page.waitForResponse(res => new URL(res.url()).pathname === '/api/growth/stopped-items');
    await section.getByRole('button', { name: 'Buying less (2)', exact: true }).click();
    await (await response).finished();
    const list = section.getByRole('list', { name: 'Call list', exact: true });
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list).toContainText('Last 90 days ₹20,000.11');
    await expect(section).not.toContainText('Stopped buying');
    await expect(section.getByRole('alert')).toHaveCount(0);
  });
}

test('declining empty state', async ({ page }) => {
  await fixture(page, { emptyDeclining: true });
  const section = await openMonthly(page);
  await section.getByRole('button', { name: 'Buying less (0)', exact: true }).click();
  await expect(section).toContainText('No labs buying less right now.');
  await expect(section.getByRole('list', { name: 'Call list', exact: true })).toHaveCount(0);
});

test.describe('Buying less on a phone', () => {
  test.use({ viewport: { width: 375, height: 900 } });
  test('long item names wrap without horizontal page scroll', async ({ page }) => {
    const longName = 'VeryLongReagentName'.repeat(25);
    await fixture(page, { longName });
    const section = await openMonthly(page);
    await section.getByRole('button', { name: 'Buying less (2)', exact: true }).click();
    const line = section.getByRole('list', { name: 'Call list', exact: true }).getByRole('listitem').first().locator('p').filter({ hasText: 'Stopped buying:' });
    await expect(line).toContainText(longName);
    await expect(line).toHaveCSS('overflow-wrap', 'break-word');
    const bounds = await line.boundingBox();
    expect(bounds?.height ?? 0).toBeGreaterThan(32);
    expect(await line.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) <= window.innerWidth)).toBe(true);
  });
});
