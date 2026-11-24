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

async function fixture(page: Page, options: { param?: string; state?: GrowthPeriodData['current']['check']['state']; failOnce?: boolean; urls?: string[]; labsNoHistory?: boolean; brandsNoHistory?: boolean } = {}) {
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
  await page.route('**/api/growth/lab-months*', route => {
    const url = new URL(route.request().url());
    options.urls?.push(url.href);
    const param = url.searchParams.get('period');
    const period = periodSample(param?.startsWith('fy-')).period;
    const months = param
      ? Array.from({ length: period.kind === 'fy' ? 8 : 2 }, (_, i) => `2026-${String((period.kind === 'fy' ? 4 : 10) + i).padStart(2, '0')}`)
      : rollingSample().months.map(m => m.month);
    return route.fulfill({ json: {
      window: param ? { from: period.from, to: period.to } : { from: '2025-11-01', to: '2026-11-01' },
      months, totalLabs: 1,
      rows: [{ labKey: 'c|lab', customerId: null, name: 'Period lab', town: null, totalPaise: 10000000, monthsPaise: months.map(() => 1000000), buyingMonths: months.length,
        ...(url.searchParams.get('filter') === 'declining' ? { previousNinetyPaise: 2000000, lastNinetyPaise: 1000000 } : {}),
      }],
    } });
  });
  await page.route('**/api/growth/labs?period=*', route => {
    const url = new URL(route.request().url());
    options.urls?.push(url.href);
    return route.fulfill({ json: {
      list: url.searchParams.get('list'), comparison: url.searchParams.get('comparison'), page: Number(url.searchParams.get('page')), pageSize: 20,
      period: periodSample(url.searchParams.get('period')?.startsWith('fy-')).period,
      total: options.labsNoHistory ? 0 : 1,
      ...(options.labsNoHistory ? { reason: 'no_history' } : {}),
      rows: options.labsNoHistory ? [] : [{ labKey: 'c|lab', customerId: null, name: 'Period lab', town: 'Pune', valuePaise: 2000000, comparisonPaise: url.searchParams.get('list') === 'window_labs' ? null : 1000000, currentPaise: 3000000, monthsBought: url.searchParams.get('list') === 'bridge_stopped' ? 0 : 2, lastBoughtOn: '2026-11-20' }],
    } });
  });
  await page.route('**/api/growth/margin?**', route => {
    const url = new URL(route.request().url());
    options.urls?.push(url.href);
    const p = url.searchParams;
    const param = p.get('period');
    const period = param ? periodSample(param.startsWith('fy-')).period : undefined;
    if (p.get('gp') === '1' && period) {
      const window = { salesPaise: 10000000, knownSalesPaise: 10000000, costPaise: 7000000, gpPaise: 3000000, gpPct: 30, coveragePct: 100 };
      const months = Array.from({ length: period.kind === 'fy' ? 8 : 2 }, (_, i) => ({
        month: `2026-${String((period.kind === 'fy' ? 4 : 10) + i).padStart(2, '0')}`,
        salesPaise: 10000000, knownSalesPaise: 10000000, gpPaise: 3000000,
        consumablesKnownSalesPaise: 10000000, consumablesGpPaise: 3000000, instrumentsKnownSalesPaise: 0, instrumentsGpPaise: 0,
      }));
      return route.fulfill({ json: { period, method: 'average_purchase_cost_to_date', window, repeat: window, bulk: window, consumables: window, instruments: window, halves: [{ ...window, half: 'H1' }, { ...window, half: 'H2' }], months } });
    }
    if (p.get('billedBelow') === '1') return route.fulfill({ json: { ...(period ? { period } : {}), lines: 0, gapPaise: 0, unitMismatchLines: 0, approvedPricesInUse: 0, page: Number(p.get('page')), pageSize: 20, total: 0, rows: [] } });
    return route.fulfill({ json: {
      ...(period ? { period } : {}), view: p.get('view'), page: Number(p.get('page')), pageSize: 20, total: 0, rows: [],
      sort: p.get('sort') ?? 'sales', filter: p.get('filter') ?? 'all', q: p.get('q'), thresholdPct: 20, consumablesMarginPct: 30,
      levers: { priceSpread: { items: 0, pairs: 0, paise: 0 }, lowMargin: { items: 0, paiseToThreshold: 0, examples: [] }, freeGoods: { lines: 0, costPaise: 0 }, instrumentsGpPaise: 0 },
    } });
  });
  await page.route('**/api/growth/brands*', route => {
    const url = new URL(route.request().url());
    options.urls?.push(url.href);
    const param = url.searchParams.get('period');
    const sample = periodSample(param?.startsWith('fy-'));
    const comparison = sample.comparisons.find(c => c.key === url.searchParams.get('comparison')) ?? sample.comparisons[0];
    const measures = { salesPaise: 12000000, h1Paise: 10000000, h2Paise: 12000000, instrumentSalesPaise: 0, consumablesSalesPaise: 12000000, knownSalesPaise: 12000000, gpPaise: 3600000, marginPct: 30, items: 1 };
    return route.fulfill({ json: {
      ...(param ? { period: sample.period, comparison: { key: comparison.key, label: comparison.label, state: options.brandsNoHistory ? 'no_history' : 'confirmed' }, comparisonWindow: { from: comparison.from, to: comparison.to } } : {}),
      window: { from: sample.period.from, to: sample.period.to, h2From: sample.period.from }, totals: measures,
      rows: [
        { ...measures, key: 'principal', kind: 'brand', brandCode: 'principal', name: 'Period principal', lines: [] },
        { ...measures, h1Paise: 0, marginPct: 20, key: 'second-principal', kind: 'brand', brandCode: 'second-principal', name: 'Second principal', lines: [] },
      ],
    } });
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

test('Q3 updates URL, table, shared comparison and bridge with drill buttons', async ({ page }) => {
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
  await expect(page.locator('#bridge-chart [role=button]')).toHaveCount(4);
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
    await expect(page.locator('#growth-panel').getByText('Last 12 months', { exact: true })).toHaveCount(2);
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

test('remaining rolling cards retain their Last 12 months captions in period mode', async ({ page }) => {
  await fixture(page);
  await selectQuarter(page);
  const phone = await isPhoneGrowth(page);
  const captions = () => page.locator('p').filter({ hasText: /^Last 12 months$/ });
  // Scorecard and RevenueMonths, plus PurchasesCard on the phone.
  await expect(captions()).toHaveCount(phone ? 3 : 2);
  await openGrowthArea(page, 'labs');
  // Lab months now follows the period; LabsBuyingCard and PurchasesCard remain rolling.
  await expect(captions()).toHaveCount(phone ? 1 : 3);
  await openGrowthArea(page, 'profit');
  // Profit and Brands now follow the period; desktop retains the Scorecard caption.
  await expect(captions()).toHaveCount(phone ? 0 : 1);
  if (phone) {
    await openGrowthArea(page, 'brands');
    await expect(captions()).toHaveCount(0);
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

test('period lab months uses returned months and keeps call lists as of today', async ({ page }) => {
  const urls: string[] = [];
  await fixture(page, { param: 'q3-2026', urls });
  await expect(page.getByRole('table', { name: 'Revenue comparison' })).toBeVisible();
  await openGrowthArea(page, 'labs');
  const card = page.getByRole('region', { name: 'Who is buying, month by month', exact: true });
  await expect(card.locator('[data-month-header]')).toHaveCount(2);
  await expect(card.locator('[data-month-header]').nth(0)).toContainText('Oct');
  await expect(card.locator('[data-month-header]').nth(1)).toContainText('Nov');
  await expect(card).toContainText("Top 1 lab by sales · Q3 FY 2026-27 to 24 Nov · darker = more of that lab's usual monthly business");
  await expect(card).toContainText('Includes instrument and bulk sales.');
  await expect(card.getByText('Lapsing', { exact: true })).toHaveCount(0);
  expect(urls.some(url => new URL(url).searchParams.get('period') === 'q3-2026')).toBe(true);
  await card.getByRole('button', { name: 'View as table', exact: true }).click();
  await expect(card.getByRole('columnheader')).toHaveCount(4); // Lab, Oct, Nov, Total
  await card.getByRole('button', { name: /^Lapsing core labs/ }).click();
  await expect(card.locator('p').filter({ hasText: /^As of today · 12 months/ })).toBeVisible();
  await card.getByRole('button', { name: /^Buying less/ }).click();
  await expect(card.locator('p').filter({ hasText: /^As of today · 12 months/ })).toBeVisible();
});

test('period bridge drills with the shared comparison', async ({ page }) => {
  const urls: string[] = [];
  await fixture(page, { param: 'q3-2026', urls });
  await expect(page.getByRole('table', { name: 'Revenue comparison' })).toBeVisible();
  await openBridge(page);
  await page.locator('#bridge-chart [data-growth-bar="up"]').first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('listitem')).toContainText('change ·');
  await expect(drawer.getByRole('listitem')).toContainText('→');
  await expect(drawer.getByRole('listitem')).toContainText('bought in 2 months · last 20 Nov');
  await expect(drawer.getByRole('combobox')).toHaveCount(0);
  await expect(drawer).not.toContainText('compares the last 3 months');
  expect(urls.some(url => url.includes('period=q3-2026&list=bridge_new&page=1&comparison=last_year'))).toBe(true);
  await drawer.getByRole('button', { name: 'Close drilldown' }).click();
  await page.getByRole('tab', { name: 'Revenue', exact: true }).click();
  await page.getByRole('radio', { name: 'vs Q2 FY 2026-27', exact: true }).click();
  await openBridge(page);
  await page.locator('#bridge-chart [data-growth-bar="up"]').first().click();
  await expect(drawer.getByRole('listitem')).toContainText('change ·');
  expect(urls.some(url => url.includes('period=q3-2026&list=bridge_new&page=1&comparison=previous'))).toBe(true);
  for (const url of urls.filter(url => new URL(url).pathname === '/api/growth/labs')) {
    const params = new URL(url).searchParams;
    for (const key of ['sort', 'month', 'half', 'regularOnly']) expect(params.has(key)).toBe(false);
  }
  await drawer.getByRole('button', { name: 'Close drilldown' }).click();
  await page.getByRole('tab', { name: 'Revenue', exact: true }).click();
  await openBridge(page);
  await page.locator('#bridge-chart [data-growth-bar="down"]').first().click();
  await expect(page.getByRole('dialog').getByRole('listitem')).toContainText('no purchases in period');
});

test('period Labs buying opens all sales without a comparison', async ({ page }) => {
  const urls: string[] = [];
  await fixture(page, { param: 'q3-2026', urls });
  const table = page.getByRole('table', { name: 'Revenue comparison' });
  await table.getByRole('row', { name: /^Labs buying / }).getByRole('button').click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('heading')).toContainText('Labs with sales (incl. instrument & bulk)');
  await expect(drawer.getByRole('listitem')).toContainText('in period · bought in 2 months');
  const url = new URL(urls.find(url => new URL(url).pathname === '/api/growth/labs')!);
  expect(url.searchParams.get('period')).toBe('q3-2026');
  expect(url.searchParams.get('list')).toBe('window_labs');
  expect(url.searchParams.has('comparison')).toBe(false);
});

test('period labs shows the no-history explanation', async ({ page }) => {
  await fixture(page, { param: 'q3-2026', labsNoHistory: true });
  await expect(page.getByRole('table', { name: 'Revenue comparison' })).toBeVisible();
  await openBridge(page);
  await page.locator('#bridge-chart [data-growth-bar="up"]').first().click();
  await expect(page.getByRole('dialog')).toContainText('No sales history for this comparison yet.');
  await expect(page.getByRole('dialog')).not.toContainText('No labs in this list');
});

test('rolling lab months retains twelve headers and no period parameter', async ({ page }) => {
  const urls: string[] = [];
  await fixture(page, { urls });
  await openGrowthArea(page, 'labs');
  const card = page.getByRole('region', { name: 'Who is buying, month by month', exact: true });
  await expect(card.locator('[data-month-header]')).toHaveCount(12);
  const requests = urls.filter(url => new URL(url).pathname === '/api/growth/lab-months');
  expect(requests.length).toBeGreaterThan(0);
  for (const url of requests) expect(new URL(url).searchParams.has('period')).toBe(false);
});

test('period Profit reads GP and margin lists for Q3 with period captions', async ({ page }) => {
  const urls: string[] = [];
  await fixture(page, { param: 'q3-2026', urls });
  await expect(page.getByRole('table', { name: 'Revenue comparison' })).toBeVisible();
  await openGrowthArea(page, 'profit');
  const gp = page.getByRole('region', { name: 'Gross profit by month', exact: true });
  await expect(gp).toContainText('Q3 FY 2026-27 to 24 Nov');
  const explorer = page.getByRole('region', { name: 'Margin by lab and item', exact: true });
  await expect(explorer).toContainText('Q3 FY 2026-27 to 24 Nov');
  await expect(explorer.getByRole('status')).toContainText('Showing 0');
  const grow = page.getByRole('region', { name: 'Where margin can grow', exact: true });
  await expect(grow).toContainText('Consumables · Q3 FY 2026-27 to 24 Nov · ranked by ₹ in this period');
  for (const region of [gp, grow, explorer]) await expect(region).not.toContainText('12 months');
  await expect.poll(() => urls.some(url => url.includes('period=q3-2026&gp=1'))).toBe(true);
  for (const view of ['items', 'labs']) {
    await expect.poll(() => urls.some(url => { const p = new URL(url).searchParams; return p.get('period') === 'q3-2026' && p.get('view') === view; })).toBe(true);
  }
  await expect.poll(() => urls.some(url => { const p = new URL(url).searchParams; return p.get('period') === 'q3-2026' && p.get('billedBelow') === '1'; })).toBe(true);
});

test('period GP months outside rolling history have no drill', async ({ page }) => {
  await fixture(page, { param: 'fy-2026' });
  await expect(page.getByRole('table', { name: 'Revenue comparison' })).toBeVisible();
  await openGrowthArea(page, 'profit');
  const gp = page.getByRole('region', { name: 'Gross profit by month', exact: true });
  await expect(gp).toContainText('FY 2026-27 to 24 Nov');
  // Rolling months end in Oct 2026; November remains visible without a drill.
  await expect(gp.getByRole('button', { name: /^Nov: / })).toHaveCount(0);
  await expect(gp.getByRole('button', { name: /^Oct: / })).toHaveCount(2);
  await gp.getByRole('button', { name: 'View as table', exact: true }).click();
  const table = gp.getByRole('table');
  await expect(table.getByRole('rowheader', { name: 'Nov 2026', exact: true })).toBeVisible();
  await expect(table.getByRole('button', { name: 'Nov 2026', exact: true })).toHaveCount(0);
  await expect(table.getByRole('button', { name: 'Oct 2026', exact: true })).toBeVisible();
});

test('Brands shares the selected period and Revenue comparison', async ({ page }) => {
  const urls: string[] = [];
  await fixture(page, { param: 'q3-2026', urls });
  await expect(page.getByRole('table', { name: 'Revenue comparison' })).toBeVisible();
  await openGrowthArea(page, 'brands');
  const brands = page.getByRole('region', { name: 'Sales by principal', exact: true });
  await expect(brands.getByRole('group', { name: 'Principals: sales against margin', exact: true })).toBeVisible();
  await expect(brands.locator('[data-scatter-dot]')).toHaveCount(2);
  await expect(brands.getByText('vs Q3 FY 2025-26', { exact: true })).toHaveCount(1);
  await expect(brands).toContainText('Same period as Gross profit.');
  await expect.poll(() => urls.some(url => url.includes('/api/growth/brands?period=q3-2026&comparison=last_year'))).toBe(true);
  if (await isPhoneGrowth(page)) await openGrowthArea(page, 'revenue');
  else await page.getByRole('tab', { name: 'Revenue', exact: true }).click();
  await page.getByRole('radio', { name: 'vs Q2 FY 2026-27', exact: true }).click();
  await openGrowthArea(page, 'brands');
  await expect(brands.getByText('vs Q2 FY 2026-27', { exact: true })).toHaveCount(1);
  await expect.poll(() => urls.some(url => url.includes('/api/growth/brands?period=q3-2026&comparison=previous'))).toBe(true);
});

test('Brands explains missing comparison history and hides change', async ({ page }) => {
  await fixture(page, { param: 'q3-2026', brandsNoHistory: true });
  await expect(page.getByRole('table', { name: 'Revenue comparison' })).toBeVisible();
  await openGrowthArea(page, 'brands');
  const brands = page.getByRole('region', { name: 'Sales by principal', exact: true });
  await expect(brands).toContainText('No sales history for Q3 FY 2025-26 yet.');
  await expect(brands.getByRole('group', { name: 'Principals: sales against margin', exact: true })).toBeVisible();
  for (const row of await brands.locator('[data-brand-row]').all()) {
    await expect(row).toContainText('vs Q3 FY 2025-26 —');
    await expect(row).not.toContainText('+20%');
  }
});

test('rolling Profit and Brands requests have no period', async ({ page }) => {
  const urls: string[] = [];
  await fixture(page, { urls });
  await openGrowthArea(page, 'profit');
  await expect(page.getByRole('region', { name: 'Margin by lab and item' }).getByRole('status')).toContainText('Showing 0');
  await openGrowthArea(page, 'brands');
  await expect(page.getByRole('region', { name: 'Sales by principal' })).toContainText('Same 12 months as Gross profit.');
  const reads = urls.filter(url => /\/api\/growth\/(margin|brands)/.test(new URL(url).pathname));
  expect(reads.some(url => new URL(url).pathname.endsWith('/margin'))).toBe(true);
  expect(reads.some(url => new URL(url).pathname.endsWith('/brands'))).toBe(true);
  for (const url of reads) expect(new URL(url).searchParams.has('period')).toBe(false);
});
