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


const customerId = '00000000-0000-4000-8000-000000000001';
const newLabsSample = () => ({
  filter: 'new', windowDays: 90, asOf: '2026-11-26', totalLabs: 4, repeatLabs: 1,
  rows: (['overdue', 'due', 'early', 'repeat'] as const).map((status, i) => ({
    labKey: 'c|new-' + i, customerId: i === 0 ? customerId : null, name: i === 2 ? null : 'New lab ' + (i + 1),
    town: 'Pune', phone: i === 0 ? '+919876543210' : null, firstPurchaseOn: '2026-10-05',
    firstOrderPaise: 8000, orderDays: status === 'repeat' ? 3 : 1, lastPurchaseOn: status === 'repeat' ? '2026-11-20' : '2026-10-05',
    daysSinceFirst: 52, totalPaise: status === 'repeat' ? 24000 : 8000, status,
  })),
});

async function fixture(page: Page, options: { longName?: string; empty?: boolean; many?: boolean; failure?: boolean } = {}) {
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
    if (filter === 'new') {
      if (options.failure) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
      const data = newLabsSample();
      if (options.longName) data.rows[0].name = options.longName;
      if (options.empty) return route.fulfill({ json: { ...data, totalLabs: 0, repeatLabs: 0, rows: [] } });
      if (options.many) return route.fulfill({ json: { ...data, totalLabs: 60, rows: Array.from({ length: 50 }, (_, i) => ({ ...data.rows[0], labKey: 'c|' + i })) } });
      return route.fulfill({ json: data });
    }
    return route.fulfill({ json: filter === 'lapsing' ? lapsingSample() : filter === 'declining' ? decliningSample() : labMonthsSample() });
  });
  await page.route('**/api/growth/stopped-items?**', route => route.fulfill({ json: { labs: [] } }));
  await page.goto('/?view=frame&role=management&roles=management&growthPeriod=rolling12');
}
test.use({ viewport: { width: 375, height: 900 } });

async function openCallList(page: Page, name = 'New labs ›') {
  const entry = page.getByRole('button', { name: /^growth$/i });
  if (!await entry.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(entry).toBeVisible();
  await entry.click();
  await openGrowthArea(page, 'act');
  await page.getByRole('button', { name, exact: true }).click();
  return page.getByRole('region', { name: 'New labs, first 90 days', exact: true });
}

test('New labs button opens only the new call list, with summary, ordered pills and contact details', async ({ page }) => {
  await fixture(page);
  const section = await openCallList(page);
  await expect(section).toBeVisible();
  await expect(section).toContainText('1 of 4 new labs have ordered again');
  await expect(section).toContainText('Second order due at 30 days, overdue at 45. Call overdue labs first.');
  const rows = section.getByRole('list', { name: 'Call list', exact: true }).getByRole('listitem');
  await expect(rows).toHaveCount(4);
  for (const [i, label] of ['Overdue', 'Due', 'Early', 'Ordered again'].entries()) {
    await expect(rows.nth(i).locator('p').first()).toHaveText((i === 2 ? 'Unnamed lab' : 'New lab ' + (i + 1)) + label);
  }
  await expect(rows.first()).toContainText('Pune · first order 5 Oct · ₹80 · 52 days ago');
  await expect(rows.first()).not.toContainText('order days');
  await expect(rows.nth(3)).toContainText('3 order days · last 20 Nov');
  await expect(rows.first().getByRole('link', { name: 'Call', exact: true })).toHaveAttribute('href', 'tel:+919876543210');
  await expect(page.getByRole('heading', { name: 'Who is buying, month by month', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Labs buying', exact: true })).toHaveCount(0);
});

test('Open customer calls through to customer navigation', async ({ page }) => {
  const requestedCustomers: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/customer-map' && url.searchParams.has('customer')) requestedCustomers.push(url.searchParams.get('customer')!);
  });
  await page.route('**/api/customer-map?**', route => route.fulfill({ status: 503, json: { error: 'Unavailable in fixture' } }));
  await fixture(page);
  const section = await openCallList(page);
  await section.getByRole('button', { name: 'Open customer', exact: true }).click();
  await expect.poll(() => requestedCustomers.length).toBeGreaterThan(0);
  expect(requestedCustomers).toContain(customerId);
});

test('375 px phone wraps long names without horizontal scroll', async ({ page }) => {
  const longName = 'VeryLongLabName'.repeat(30);
  await fixture(page, { longName });
  const section = await openCallList(page);
  await expect(section).toContainText(longName);
  expect(await section.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) <= window.innerWidth)).toBe(true);
});

test('empty new labs list', async ({ page }) => {
  await fixture(page, { empty: true });
  const section = await openCallList(page);
  await expect(section).toContainText('No labs placed their first order in the last 90 days.');
});

test('truncated new labs list', async ({ page }) => {
  await fixture(page, { many: true });
  const section = await openCallList(page);
  await expect(section.getByRole('listitem')).toHaveCount(50);
  await expect(section).toContainText('Showing 50 of 60');
});

test('failed new labs request offers Retry', async ({ page }) => {
  await fixture(page, { failure: true });
  const section = await openCallList(page);
  await expect(section.getByRole('alert')).toContainText('New labs are unavailable.');
  await page.route('**/api/growth/lab-months?filter=new', route => route.fulfill({ json: newLabsSample() }));
  await section.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(section).toContainText('1 of 4 new labs have ordered again');
});

test('lapsing call list keeps its existing details', async ({ page }) => {
  await fixture(page);
  await openCallList(page, 'Lapsing core labs ›');
  const section = page.getByRole('region', { name: 'Who is buying, month by month', exact: true });
  const list = section.getByRole('list', { name: 'Call list', exact: true });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(list).toContainText('Usually ₹38k/month');
  await expect(list).toContainText('Missed 2 months');
});

test('declining call list keeps its existing comparison', async ({ page }) => {
  await fixture(page);
  await openCallList(page, 'Buying less ›');
  const section = page.getByRole('region', { name: 'Who is buying, month by month', exact: true });
  const list = section.getByRole('list', { name: 'Call list', exact: true });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list).toContainText('Last 90 days ₹20,000.11 vs ₹50,000.37 before (−60%)');
});

