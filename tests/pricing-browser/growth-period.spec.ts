import { expect, test, type Page } from '@playwright/test';
import type { GrowthData } from '../../lib/growth-types';
import type { GrowthPeriodData } from '../../lib/growth-period-types';
import { isPhoneGrowth, openGrowthArea } from './growth-helpers';

const tree = { revenuePaise: 120000000, repeatPaise: 100000000, bulkPaise: 20000000, bulkInvoices: 1, labsBuying: 10, buyingMonths: 20, perBuyingMonthPaise: 5000000 };
const contribution = { labs: 0, paise: 0 };
const bridge = { h1Paise: 100000000, h2Paise: 120000000, new: { labs: 2, paise: 20000000 }, stopped: contribution, stoppedRegular: contribution, grew: contribution, fell: contribution, same: contribution, other: contribution };
function rollingSample(): GrowthData {
  return {
    companyCount: 1, confirmed: true, confirmedReason: null,
    window: { from: '2025-11-01', to: '2026-11-01', h1From: '2025-11-01', h2From: '2026-05-01' },
    tree, halves: [{ ...tree, half: 'H1' }, { ...tree, half: 'H2' }], bridge,
    scorecard: { regularLabs: 5, regularPct: 50, top10Pct: 80 },
    months: Array.from({ length: 12 }, (_, i) => ({ month: new Date(Date.UTC(2025, 10 + i, 1)).toISOString().slice(0, 7), labsBuying: 10, firstTime: 1, skippedRegulars: 0, salesPaise: 10000000, purchasesRegularPaise: 5000000, purchasesLargePaise: 0, largePurchaseInvoices: 0 })),
    health: { gp: { costedPct: null, computedAt: null }, history: { firstSaleOn: '2025-01-01', monthsImported: 22 }, itemGroups: { unmappedPct: 0 }, reasons: { visitReasons180: 0, constraints: 0, openActions: 0, visits180: 0 }, catalog: { observedAt: null, groups: 0 } },
  };
}
function periodSample(fy = false): GrowthPeriodData {
  const label = fy ? 'FY 2026-27 to 24 Nov' : 'Q3 FY 2026-27 to 24 Nov';
  const from = fy ? '2026-04-01' : '2026-10-01';
  const check: GrowthPeriodData['current']['check'] = { days: 55, historyDays: 55, historySharePct: 100, coverageComplete: true, months: [{ month: '2026-10', state: 'matches' }], state: 'confirmed' };
  return {
    view: 'period', period: { kind: fy ? 'fy' : 'quarter', fy: 2026, quarter: fy ? null : 3, label, from, to: '2026-11-24', running: true },
    current: { key: 'current', label, from, to: '2026-11-24', tree, check },
    comparisons: [
      { key: 'last_year', label: fy ? 'FY 2025-26' : 'Q3 FY 2025-26', from: '2025-10-01', to: '2025-11-24', tree: { ...tree, revenuePaise: 100000000 }, bridge, check },
      ...fy ? [] : [{ key: 'previous' as const, label: 'Q2 FY 2026-27', from: '2026-07-01', to: '2026-08-24', tree: { ...tree, revenuePaise: 80000000 }, bridge: { ...bridge, h1Paise: 80000000, new: { labs: 4, paise: 40000000 } }, check }],
    ],
  };
}

async function fixture(page: Page, options: { param?: string; state?: GrowthPeriodData['current']['check']['state']; failOnce?: boolean } = {}) {
  const requests: string[] = [];
  await page.clock.setFixedTime(new Date('2026-11-24T06:00:00Z'));
  await page.addInitScript(() => { localStorage.removeItem('sf-growth-tab'); localStorage.removeItem('sf-growth-inbox-open'); });
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/me', route => route.fulfill({ json: { roles: ['management'] } }));
  await page.route('**/api/push-subscription**', route => route.fulfill({ json: { enabled: false, publicKey: '' } }));
  await page.route('**/api/wallet?**', route => route.fulfill({ json: { coverage: { certified: true } } }));
  await page.route('**/api/today**', route => route.fulfill({ json: { policyVersion: 'today-v1', generatedAt: '2026-11-24T06:00:00Z', coverageCertified: true, unblock: { total: 0, rows: [] }, grow: { total: 0, rows: [] } } }));
  await page.route('**/api/accounts?**', route => route.fulfill({ json: { accounts: [], page: { page: 1, pageSize: 20, total: 0 }, owners: [], territories: [], classPolicy: { aMinPaise: '10000000', bMinPaise: '3000000' }, canAssign: true, canSeeProspects: true, canSeeMyActions: true, canEraseContacts: false, canSeePowerMap: true, actorEmail: 'manager@example.test', today: '2026-11-24' } }));
  await page.route(/\/api\/growth(?:\?|$)/, route => {
    const param = new URL(route.request().url()).searchParams.get('period');
    if (!param) return route.fulfill({ json: rollingSample() });
    requests.push(param);
    if (options.failOnce && requests.length === 1) return route.fulfill({ status: 500, json: {} });
    const data = periodSample(param.startsWith('fy-'));
    if (options.state) {
      const c = data.comparisons[0];
      c.check = { ...c.check, state: options.state, months: [{ month: '2025-10', state: options.state === 'differs' ? 'differs' : 'no_control' }] };
      if (options.state === 'no_history') { c.tree = null; c.bridge = null; }
    }
    return route.fulfill({ json: data });
  });
  await page.goto('/?view=frame&role=management&roles=management' + (options.param ? `&growthPeriod=${options.param}` : ''));
  const entry = page.getByRole('button', { name: /^growth$/i });
  if (!await entry.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await entry.click();
  await openGrowthArea(page, 'revenue');
  await expect(page.getByRole('heading', { name: 'Revenue by month', exact: true })).toBeVisible();
  return requests;
}
async function selectQuarter(page: Page) {
  await page.getByRole('button', { name: 'Q3', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Revenue comparison', exact: true })).toBeVisible();
}
async function openBridge(page: Page) {
  await page.getByRole('tab', { name: 'Bridge', exact: true }).click();
}

test('rolling is the default and makes no period request', async ({ page }) => {
  const requests = await fixture(page);
  await expect(page.getByRole('button', { name: 'Last 12 months', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Financial year', { exact: true })).toBeDisabled();
  await expect(page.getByText('12 months', { exact: true })).toHaveCount(1); // picker chip
  expect(requests).toEqual([]);
  await page.getByRole('tab', { name: 'H1 → H2', exact: true }).click();
  await expect(page.locator('#bridge-svg-title')).toHaveText('H1 to H2 revenue bridge in ₹ lakh');
});

test('Q3 updates URL, table, shared comparison and bridge without drill buttons', async ({ page }) => {
  const requests = await fixture(page);
  await selectQuarter(page);
  expect(requests).toEqual(['q3-2026']);
  await expect(page).toHaveURL(/growthPeriod=q3-2026/);
  const table = page.getByRole('table', { name: 'Revenue comparison' });
  await expect(table.getByRole('columnheader', { name: 'Q3 FY 2026-27 to 24 Nov', exact: true })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Q3 FY 2025-26', exact: true })).toBeVisible();
  await expect(table.getByRole('row', { name: /^Revenue / })).toContainText('+20%');
  await expect(page.locator('header').getByText('Q3 FY 2026-27 to 24 Nov · one Tally company · management only', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: /Scorecard/ }).locator('xpath=preceding-sibling::p[1]')).toHaveText('Last 12 months');
  await expect(page.getByText('1 invoice of ₹2 L or more this period.', { exact: true })).toBeVisible();
  await openBridge(page);
  await expect(page.locator('#bridge-svg-desc')).toContainText('Q3 FY 2025-26 total');
  await expect(page.getByText('Regular = bought in 3 or more months of Q3 FY 2025-26.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Revenue', exact: true }).click();
  await page.getByRole('radio', { name: 'vs Q2 FY 2026-27', exact: true }).click();
  await expect(table.getByRole('columnheader', { name: 'Q2 FY 2026-27', exact: true })).toBeVisible();
  await expect(table.getByRole('row', { name: /^Revenue / })).toContainText('+50%');
  await openBridge(page);
  await expect(page.locator('#bridge-svg-desc')).toContainText('Q2 FY 2026-27 total');
  await expect(page.locator('#bridge-svg-desc')).toContainText('Q3 FY 2026-27 to 24 Nov total');
  await expect(page.locator('#bridge-chart [role=button]')).toHaveCount(0);
});

test('comparison arrows move selection and focus', async ({ page }) => {
  await fixture(page);
  await selectQuarter(page);
  const first = page.getByRole('radio', { name: 'vs Q3 FY 2025-26', exact: true });
  await first.focus();
  await first.press('ArrowRight');
  const previous = page.getByRole('radio', { name: 'vs Q2 FY 2026-27', exact: true });
  await expect(previous).toBeFocused();
  await expect(previous).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'FY to date', exact: true }).click();
  await page.getByRole('button', { name: 'Q3', exact: true }).click();
  await expect(first).toHaveAttribute('aria-checked', 'true');
});

for (const state of ['no_history', 'differs', 'unconfirmed'] as const) {
  test(`${state} follows the Tally and change rules`, async ({ page }) => {
    await fixture(page, { state });
    await selectQuarter(page);
    const note = state === 'no_history' ? 'No sales history for Q3 FY 2025-26 yet.' : state === 'differs' ? 'Differs from Tally in Oct 2025. Change hidden.' : 'Not yet confirmed against Tally.';
    await expect(page.getByText(note, { exact: true })).toBeVisible();
    const cells = page.getByRole('table', { name: 'Revenue comparison' }).getByRole('row', { name: /^Revenue / }).getByRole('cell');
    await expect(cells.nth(1)).toHaveText(state === 'no_history' ? '—' : '₹10.0 L');
    await expect(cells.nth(2)).toHaveText(state === 'unconfirmed' ? '+20%' : '—');
    await openBridge(page);
    await expect(page.getByText(state === 'no_history' ? 'No sales history for Q3 FY 2025-26 yet, so there is nothing to compare.' : note, { exact: true })).toBeVisible();
  });
}

test('future Q4 is disabled and FY change falls back to Full year or FY to date', async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole('button', { name: 'Q4', exact: true })).toBeDisabled();
  await selectQuarter(page);
  await page.getByLabel('Financial year', { exact: true }).selectOption('2025');
  await page.getByRole('button', { name: 'Q4', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Full year', exact: true })).toBeVisible();
  await page.getByLabel('Financial year', { exact: true }).selectOption('2026');
  await expect(page.getByRole('button', { name: 'FY to date', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('rolling cards are labelled only in period mode and survive period failure and retry', async ({ page }) => {
  await fixture(page, { failOnce: true });
  const monthly = page.getByRole('heading', { name: 'Revenue by month', exact: true }).locator('..');
  await expect(monthly.locator('xpath=..').getByText('Last 12 months', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Q3', exact: true }).click();
  await expect(page.getByText('This period could not load. Try again.', { exact: true })).toBeVisible();
  await expect(monthly).toBeVisible();
  await expect(monthly.locator('xpath=..').getByText('Last 12 months', { exact: true })).toBeVisible();
  await page.getByRole('region', { name: 'Where revenue comes from', exact: true }).getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Revenue comparison' })).toBeVisible();
  if (!await isPhoneGrowth(page)) {
    await page.getByRole('tab', { name: 'Monthly', exact: true }).click();
    await expect(page.locator('#growth-panel').getByText('Last 12 months', { exact: true })).toHaveCount(3);
  }
  await page.getByRole('button', { name: 'Last 12 months', exact: true }).click();
  if (!await isPhoneGrowth(page)) await page.getByRole('tab', { name: 'Revenue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Where revenue comes from', exact: true })).toBeVisible();
  await expect(page.getByText('Last 12 months', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Last 12 months', exact: true })).toHaveText('12 months');
  await expect(page).not.toHaveURL(/growthPeriod=/);
});

test('loads FY from the URL once, preserving other parameters and the hash on change', async ({ page }) => {
  const requests = await fixture(page, { param: 'fy-2026' });
  await expect(page.getByRole('table', { name: 'Revenue comparison' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'FY to date', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(requests).toEqual(['fy-2026']);
  const before = new URL(page.url());
  await page.getByRole('button', { name: 'Q3', exact: true }).click();
  await expect(page).toHaveURL(/growthPeriod=q3-2026/);
  const after = new URL(page.url());
  expect(after.hash).toBe(before.hash);
  for (const [key, value] of before.searchParams) if (key !== 'growthPeriod') expect(after.searchParams.get(key)).toBe(value);
});

test('all six rolling cards retain their Last 12 months captions in period mode', async ({ page }) => {
  await fixture(page);
  await selectQuarter(page);
  const phone = await isPhoneGrowth(page);
  const captions = () => page.locator('p').filter({ hasText: /^Last 12 months$/ });
  // Scorecard and RevenueMonths, plus PurchasesCard on the phone.
  await expect(captions()).toHaveCount(phone ? 3 : 2);
  await openGrowthArea(page, 'labs');
  // Phone Labs has LabsBuyingCard and GrowthLabMonths; desktop Monthly also counts the visible Scorecard caption and PurchasesCard.
  await expect(captions()).toHaveCount(phone ? 2 : 4);
  await openGrowthArea(page, 'profit');
  // Phone Profit has GrowthProfit; desktop also counts the persistent Scorecard and GrowthBrands captions.
  await expect(captions()).toHaveCount(phone ? 1 : 3);
  if (phone) {
    await openGrowthArea(page, 'brands');
    await expect(captions()).toHaveCount(1);
  }
  await page.getByRole('button', { name: 'Last 12 months', exact: true }).click();
  await expect(captions()).toHaveCount(0);
});

test('375px picker scrolls its chips without horizontal page scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await fixture(page);
  await selectQuarter(page);
  const picker = page.locator('[aria-label="Growth period"]');
  await expect(picker).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('[data-growth-scroller]').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const chips = picker.locator('.overflow-x-auto');
  expect(await chips.evaluate(el => getComputedStyle(el).flexWrap)).toBe('nowrap');
  await chips.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  expect(await chips.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await openBridge(page);
  await expect(page.locator('#bridge-chart')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('[data-growth-scroller]').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});
