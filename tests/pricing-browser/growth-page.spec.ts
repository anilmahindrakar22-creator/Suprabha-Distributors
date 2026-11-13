import { expect, test, type Page } from '@playwright/test';
const billedBelowSample = (page = 1, approvedPricesInUse = 2) => ({
  lines: approvedPricesInUse ? 2 : 0, gapPaise: approvedPricesInUse ? 65000 : 0, unitMismatchLines: approvedPricesInUse ? 1 : 0, approvedPricesInUse,
  page, pageSize: 20, total: approvedPricesInUse ? 2 : 0,
  rows: approvedPricesInUse ? [
    { date: '2026-10-02', customerId: 'customer-a', name: 'Lab A', town: 'Town A', itemName: 'Reagent A', quantity: 2, billedRatePaise: 100000, approvedRatePaise: 125000, gapPaise: 50000, voucherRef: 'INV-1' },
    { date: '2026-10-03', customerId: 'customer-b', name: 'Lab B', town: null, itemName: 'Reagent B', quantity: 1.5, billedRatePaise: 90000, approvedRatePaise: 100000, gapPaise: 15000, voucherRef: 'INV-2' },
  ] : [],
});
const marginLevers = { priceSpread: { items: 76, pairs: 164, paise: 19000000 }, lowMargin: { items: 12, paiseToThreshold: 7000000, examples: [{ name: 'HIV Tridot', marginPct: 13.2, salesPaise: 55000000, labs: 35 }] }, freeGoods: { lines: 9, costPaise: 3500000 }, instrumentsGpPaise: -30000000 };
const marginSample = (p: URLSearchParams) => ({
  view: p.get('view'), sort: p.get('sort') ?? 'sales', filter: p.get('filter') ?? 'all', q: p.get('q'), page: Number(p.get('page')), pageSize: 20, total: 1, thresholdPct: 14, consumablesMarginPct: 28.1, levers: marginLevers,
  rows: p.get('view') === 'items' ? [{ itemKey: 'item-a', name: 'Cliniquant CRP', salesPaise: 55000000, knownSalesPaise: 55000000, gpPaise: 7000000, marginPct: 13.2, labs: 13, priceLowPaise: 140000, typicalPricePaise: 250000, priceHighPaise: 322000, spreadPaise: 2904900, low: true, belowCost: false }] : [{ labKey: 'ledger-a', customerId: 'customer-a', name: 'Lab A', town: 'Town A', salesPaise: 55000000, knownSalesPaise: 55000000, gpPaise: 7000000, marginPct: 13.2, coveragePct: 100, low: true }],
});
const itemDetail = () => ({
  kind: 'item', itemKey: 'item-a', name: 'Cliniquant CRP', typicalPricePaise: 250000, labs: 13, marginPct: 28.1, tallyItemKey: 'tally-a', page: 1, pageSize: 20, total: 3,
  rows: [
    { labKey: 'ledger-a', customerId: 'customer-a', name: 'Lab A', town: 'Town A', unitPricePaise: 160800, quantity: 6, salesPaise: 964800, belowTypical: true, packDifference: false, approvedPricePaise: 170000 },
    { labKey: 'ledger-pack', customerId: 'customer-pack', name: 'Pack Lab', town: null, unitPricePaise: 50000, quantity: 2, salesPaise: 100000, belowTypical: false, packDifference: true, approvedPricePaise: null },
    { labKey: 'ledger-unlinked', customerId: null, name: null, town: null, unitPricePaise: 140000, quantity: 4, salesPaise: 560000, belowTypical: true, packDifference: false, approvedPricePaise: null },
  ],
});
const inboxSample = (filter = 'all', page = 1, inProgress = false, viewerEmail = 'manager@example.test') => ({
  runMonth: '2026-11', salesTo: '2026-10-31', confirmed: true, confirmedReason: null,
  counts: { all: 2, R1: 2, R2: 0, R3: 0, R4: 0, R5: 0, toReview: inProgress ? 1 : 2, inProgress: inProgress ? 1 : 0, done: 1 },
  stakeToReviewPaise: 4000000, filter, page, pageSize: 10, total: filter === 'done' ? 1 : 2,
  viewerEmail, owners: [{ email: 'sales@example.test' }, { email: 'manager@example.test' }],
  rows: filter === 'done' ? [{
    cardKey: 'done-a', labKey: 'ledger-a', customerId: 'customer-a', name: 'Lab A', town: 'Town A', rule: 'R1', period: '2026-10',
    action: { actionType: 'visit', ownerEmail: 'manager@example.test', result: 'done', note: 'Stock checked, follow-up agreed.', closedOn: '2026-11-03' },
    outcome: { status: 'bought', on: '2026-11-06', valuePaise: 820000, daysLeft: null },
  }] : [
    { cardKey: 'card-a', labKey: 'ledger-a', customerId: 'customer-a', name: 'Lab A', town: 'Town A', rule: 'R1', ruleVersion: 1, period: '2026-10', stakePaise: 2000000, inputs: { monthsBoughtPrev11: 7, lastBoughtOn: '2026-09-02', typicalPaise: 2000000 }, alsoMatches: [], lastReason: null, state: inProgress ? 'in_progress' : 'review', action: inProgress ? { id: 'action-a', actionType: 'visit', ownerEmail: 'manager@example.test', dueOn: '2026-11-16' } : null },
    { cardKey: 'card-unlinked', labKey: 'ledger-unlinked', customerId: null, name: null, town: null, rule: 'R1', ruleVersion: 1, period: '2026-10', stakePaise: 2000000, inputs: { monthsBoughtPrev11: 6, lastBoughtOn: '2026-09-01', typicalPaise: 2000000 }, alsoMatches: [], lastReason: null, state: 'review', action: null },
  ],
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
async function fixture(page: Page, options: { role?: string; status?: number; confirmed?: boolean; malformed?: boolean; labsTotal?: number; inboxViewerEmail?: string; billedBelow?: 'lines' | 'error' } = {}) {
  const role = options.role ?? 'management';
  await page.route('**/api/me', route => route.fulfill({ json: { roles: [role] } }));
  await page.route('**/api/push-subscription**', route => route.fulfill({ json: { enabled: false, publicKey: '' } }));
  await page.route('**/api/wallet?**', route => route.fulfill({ json: { coverage: { certified: true } } }));
  await page.route('**/api/today**', route => route.fulfill({ json: { policyVersion: 'today-v1', generatedAt: '2026-11-01T06:00:00Z', coverageCertified: true, unblock: { total: 0, rows: [] }, grow: { total: 0, rows: [] } } }));
  await page.route('**/api/accounts?**', route => route.fulfill({ json: { accounts: [], page: { page: 1, pageSize: 20, total: 0 }, owners: [], territories: [], classPolicy: { aMinPaise: '10000000', bMinPaise: '3000000' }, canAssign: true, canSeeProspects: true, canSeeMyActions: true, canEraseContacts: false, canSeePowerMap: true, actorEmail: 'manager@example.test', today: '2026-11-09' } }));
  await page.route('**/api/growth', route => route.fulfill({ status: options.status ?? 200, json: options.malformed ? {} : { ...sample(), confirmed: options.confirmed ?? true, confirmedReason: options.confirmed === false ? 'Sales import is pending' : null } }));
  let billedRequests = 0;
  await page.route('**/api/growth/margin?**', route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.has('billedBelow')) {
      if (options.billedBelow === 'error' && billedRequests++ === 0) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
      return route.fulfill({ json: billedBelowSample(Number(params.get('page')), options.billedBelow ? 2 : 0) });
    }
    return route.fulfill({ json: params.has('itemKey') ? itemDetail() : params.has('labKey') ? { kind: 'lab', labKey: 'ledger-a', customerId: 'customer-a', name: 'Lab A', town: 'Town A', salesPaise: 964800, gpPaise: 100000, marginPct: 10.4, page: 1, pageSize: 20, total: 1, rows: [{ itemKey: 'item-a', name: 'Cliniquant CRP', tallyItemKey: 'tally-a', unitPricePaise: 160800, typicalPricePaise: 250000, quantity: 6, salesPaise: 964800, gpPaise: 100000, marginPct: 10.4, belowTypical: true, packDifference: false, approvedPricePaise: null }] } : marginSample(params) });
  });
  let inboxInProgress = false;
  await page.route('**/api/growth/inbox**', route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      if (body.decision === 'accept') inboxInProgress = true;
      return route.fulfill({ json: { cardKey: body.cardKey, decision: body.decision, state: body.decision === 'accept' ? 'in_progress' : body.decision === 'undo' ? 'review' : body.decision === 'reject' ? 'rejected' : 'snoozed', ...(body.decision === 'accept' ? { opportunityId: 'opportunity-a', actionId: 'action-a' } : {}), ...(body.decision === 'snooze' ? { snoozeUntil: '2027-02-03' } : {}) } });
    }
    const params = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: inboxSample(params.get('filter') ?? 'all', Number(params.get('page') ?? 1), inboxInProgress, options.inboxViewerEmail) });
  });
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

const priceInputs = { items: 4, annualGapPaise: 1200000, lastBoughtOn: '2026-10-12', lines: [
  { itemKey: 'item-a', name: 'Cliniquant CRP', tallyItemKey: 'tally-a', unitPricePaise: 160800, typicalPricePaise: 250000, quantity: 6, gapPaise: 535200 },
  { itemKey: 'item-b', name: 'Other reagent', tallyItemKey: null, unitPricePaise: 10000, typicalPricePaise: 20000, quantity: 3, gapPaise: 30000 },
] };
async function priceFixture(page: Page, unlinked = false) {
  await fixture(page);
  await page.route('**/api/growth/inbox**', route => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      return route.fulfill({ json: { cardKey: body.cardKey, decision: body.decision, state: body.decision === 'review' ? 'hidden' : body.decision === 'undo' ? 'review' : 'rejected' } });
    }
    const params = new URL(request.url()).searchParams;
    const data = inboxSample(params.get('filter') ?? 'all', Number(params.get('page') ?? 1));
    return route.fulfill({ json: { ...data, counts: { ...data.counts, R5: 1 }, rows: [
      { ...data.rows[0], cardKey: 'price-card', rule: 'R5', customerId: unlinked ? null : 'customer-a', name: unlinked ? null : 'Lab A', state: 'review', action: null, inputs: priceInputs, stakePaise: 100000 },
      data.rows[1],
    ] } });
  });
}

for (const width of [375, 1280]) {
  test.describe('Growth at ' + width, () => {
    test.use({ viewport: { width, height: 900 } });
    test('billed below has a muted zero-prices state without money or action', async ({ page }) => {
      await fixture(page); await openGrowth(page); await page.getByRole('tab', { name: 'Profit', exact: true }).click();
      const card = page.getByRole('region', { name: 'Where margin can grow', exact: true });
      const row = card.getByRole('listitem').filter({ has: page.getByText('Billed below approved price.', { exact: true }) });
      await expect(row).toContainText('No approved customer prices yet. Once prices are approved through Review prices, invoices billed below them appear here.');
      await expect(row).not.toContainText('₹');
      await expect(row.getByRole('button')).toHaveCount(0);
      await expect(card.getByText('Low-margin consumables.', { exact: true })).toBeVisible();
      expect(await row.evaluate(element => element.previousElementSibling?.textContent)).toContain('Low-margin consumables.');
      await expect(card).toContainText("Tally invoices aren't changed by StockFlow; this check finds lines billed below an approved price so billing can correct them.");
    });
    test('billed below opens both invoice lines and restores focus', async ({ page }) => {
      await fixture(page, { billedBelow: 'lines' }); await openGrowth(page); await page.getByRole('tab', { name: 'Profit', exact: true }).click();
      const card = page.getByRole('region', { name: 'Where margin can grow', exact: true });
      await expect(card.getByText('2 invoice lines billed under the approved price. · 1 skipped: unit looks different', { exact: true })).toBeVisible();
      await expect(card.getByText('₹650 so far', { exact: true })).toBeVisible();
      const trigger = card.getByRole('button', { name: 'See lines', exact: true });
      await trigger.click();
      const drawer = page.getByRole('dialog');
      await expect(drawer.getByRole('heading', { name: 'Billed below approved price', exact: true })).toBeVisible();
      await expect(drawer.getByRole('listitem')).toHaveCount(2);
      await expect(drawer.getByText('2026-10-02 · Lab A · Town A', { exact: true })).toBeVisible();
      await expect(drawer.getByText('2026-10-03 · Lab B', { exact: true })).toBeVisible();
      await expect(drawer.getByText('Reagent A · billed ₹1,000 per unit vs approved ₹1,250 · 2 units · ₹500 short', { exact: true })).toBeVisible();
      await expect(drawer.getByText('Reagent B · billed ₹900 per unit vs approved ₹1,000 · 1.5 units · ₹150 short', { exact: true })).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Open', exact: true })).toHaveCount(2);
      if (width === 375) expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0); await expect(trigger).toBeFocused();
    });
    test('billed below failure stays inline and Retry recovers', async ({ page }) => {
      await fixture(page, { billedBelow: 'error' }); await openGrowth(page); await page.getByRole('tab', { name: 'Profit', exact: true }).click();
      const card = page.getByRole('region', { name: 'Where margin can grow', exact: true });
      const row = card.getByRole('listitem').filter({ has: page.getByText('Billed below approved price.', { exact: true }) });
      await expect(row.getByRole('alert')).toContainText("Couldn't load this check");
      await expect(card.getByText('9 lines given free.', { exact: true })).toBeVisible();
      await row.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect(row.getByRole('button', { name: 'See lines', exact: true })).toBeVisible();
      await expect(row.getByRole('alert')).toHaveCount(0);
    });
    test('billed below drawer appends pages and retries a failed page', async ({ page }) => {
      await fixture(page, { billedBelow: 'lines' });
      let failPageTwo = true;
      await page.route('**/api/growth/margin?billedBelow=1&**', route => {
        const pageNumber = Number(new URL(route.request().url()).searchParams.get('page'));
        if (pageNumber === 2 && failPageTwo) { failPageTwo = false; return route.fulfill({ status: 503, json: {} }); }
        const value = billedBelowSample(pageNumber);
        return route.fulfill({ json: { ...value, rows: [value.rows[pageNumber - 1]] } });
      });
      await openGrowth(page); await page.getByRole('tab', { name: 'Profit', exact: true }).click();
      await page.getByRole('button', { name: 'See lines', exact: true }).click();
      const drawer = page.getByRole('dialog');
      await drawer.getByRole('button', { name: 'Load more', exact: true }).click();
      await expect(drawer.getByRole('alert')).toContainText("Couldn't load this check");
      await expect(drawer.getByText('Lab A', { exact: true })).toBeVisible();
      await drawer.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect(drawer.getByText('Lab B', { exact: true })).toBeVisible();
      await expect(drawer.getByText('Showing 2 of 2', { exact: true })).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0);
    });
    test('P3 month chart toggles table and opens the existing monthly labs', async ({ page }) => {
      await fixture(page);
      const data = sample();
      const gp = { ...data.gp, consumables: { ...data.gp.repeat, gpPct: 28.1 }, instruments: { ...data.gp.bulk, gpPaise: -30000000, gpPct: -20 }, months: data.gp.months.map(m => ({ ...m, consumablesKnownSalesPaise: 1000000, consumablesGpPaise: 280000, instrumentsKnownSalesPaise: 500000, instrumentsGpPaise: -100000 })) };
      await page.route('**/api/growth', route => route.fulfill({ json: { ...data, gp } }));
      await openGrowth(page); await page.getByRole('tab', { name: 'Profit', exact: true }).click();
      const section = page.getByRole('region', { name: 'Gross profit by month', exact: true });
      await expect(section.getByText(/Consumables earn 28.0–28.0% a month/)).toBeVisible();
      await expect(section.locator('svg text').filter({ hasText: /^−/ })).toHaveCount(1);
      await section.getByRole('button', { name: 'View as table', exact: true }).click();
      await expect(section.locator('tbody tr')).toHaveCount(12);
      const request = page.waitForRequest(r => r.url().includes('/api/growth/labs?') && new URL(r.url()).searchParams.get('list') === 'month_buying');
      await section.getByRole('button', { name: 'Nov 2025', exact: true }).click(); await request;
      await expect(page.getByRole('dialog').getByText('Lab A', { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await section.getByRole('button', { name: 'View as chart', exact: true }).click();
      await expect(section.locator('svg')).toBeVisible();
      if (width === 375) expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
    test('P3 levers show live figures and jump to the matching item list', async ({ page }) => {
      await fixture(page); await openGrowth(page); await page.getByRole('tab', { name: 'Profit', exact: true }).click();
      const levers = page.getByRole('region', { name: 'Where margin can grow', exact: true });
      await expect(levers.getByText('up to ₹1.9 L a year', { exact: true })).toBeVisible();
      await expect(levers.getByText('₹0.7 L a year', { exact: true })).toBeVisible();
      await expect(levers.getByText('₹0.35 L a year', { exact: true })).toBeVisible();
      await expect(levers.getByText('9 lines given free.', { exact: true })).toBeVisible();
      await expect(levers.getByText(/76 items.*164 lab–item pairs/)).toBeVisible();
      await expect(levers.getByText('Lines are listed in a later step', { exact: true })).toBeVisible();
      await expect(levers.getByText(/deliberate volume rates/)).toBeVisible();
      const spread = page.waitForRequest(r => r.url().includes('/api/growth/margin?') && new URL(r.url()).searchParams.get('sort') === 'spread');
      await levers.getByRole('button', { name: 'See items with different prices by lab' }).click(); await spread;
      const explorer = page.getByRole('region', { name: 'Margin by lab and item', exact: true });
      await expect(explorer.getByRole('tab', { name: 'Items', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(explorer.getByLabel('Sort', { exact: true })).toHaveValue('spread');
      const low = page.waitForRequest(r => r.url().includes('/api/growth/margin?') && new URL(r.url()).searchParams.get('filter') === 'low');
      await levers.getByRole('button', { name: 'See low-margin consumable items' }).click(); await low;
      await expect(explorer.getByRole('button', { name: 'Low margin items', exact: true })).toHaveAttribute('aria-pressed', 'true');
      if (width === 375) expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
    test('P3 labs sort low margin first and items filter low', async ({ page }) => {
      await fixture(page); await openGrowth(page); await page.getByRole('tab', { name: 'Profit', exact: true }).click();
      const explorer = page.getByRole('region', { name: 'Margin by lab and item', exact: true });
      const sorted = page.waitForRequest(r => r.url().includes('/api/growth/margin?') && new URL(r.url()).searchParams.get('sort') === 'margin_asc');
      await explorer.getByLabel('Sort', { exact: true }).selectOption('margin_asc'); await sorted;
      if (width !== 375) await expect(explorer.locator('th[aria-sort="ascending"]')).toHaveText('Margin %');
      await explorer.getByRole('tab', { name: 'Items', exact: true }).click();
      const filtered = page.waitForRequest(r => r.url().includes('/api/growth/margin?') && new URL(r.url()).searchParams.get('view') === 'items' && new URL(r.url()).searchParams.get('filter') === 'low');
      await explorer.getByRole('button', { name: 'Low margin items', exact: true }).click(); await filtered;
      await expect(explorer.getByText('Showing 1 of 1 items', { exact: true })).toBeVisible();
    });
    test('P3 older Growth data hides the chart and a margin failure stays local', async ({ page }) => {
      await fixture(page);
      await page.route('**/api/growth/margin?**', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
      await openGrowth(page);
      await page.getByRole('tab', { name: 'Monthly', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Purchases against sales', exact: true })).toBeVisible();
      await page.getByRole('tab', { name: 'Profit', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Gross profit by month', exact: true })).toHaveCount(0);
      const explorer = page.getByRole('region', { name: 'Margin by lab and item', exact: true });
      await expect(explorer.getByRole('alert')).toContainText('Margins are unavailable.');
      await page.route('**/api/growth/margin?**', route => route.fulfill({ json: marginSample(new URL(route.request().url()).searchParams) }));
      await explorer.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect(explorer.getByText('Showing 1 of 1 labs', { exact: true })).toBeVisible();
    });
    test('P3 search is debounced and Load more appends the next page', async ({ page }) => {
      await fixture(page);
      const searches: string[] = [];
      await page.route('**/api/growth/margin?**', route => {
        const p = new URL(route.request().url()).searchParams;
        if (p.has('q')) searches.push(p.get('q')!);
        const value = marginSample(p);
        return route.fulfill({ json: { ...value, total: 2, rows: p.get('page') === '2' ? [{ ...value.rows[0], labKey: 'ledger-b', name: 'Lab B' }] : value.rows } });
      });
      await openGrowth(page); await page.getByRole('tab', { name: 'Profit', exact: true }).click();
      const explorer = page.getByRole('region', { name: 'Margin by lab and item', exact: true });
      await explorer.getByLabel('Search labs', { exact: true }).fill('La');
      await explorer.getByLabel('Search labs', { exact: true }).fill('Lab');
      await expect(explorer.getByText('Showing 1 of 2 labs', { exact: true })).toBeVisible();
      await expect.poll(() => searches).toEqual(['Lab']);
      await explorer.getByRole('button', { name: 'Load more', exact: true }).click();
      await expect(explorer.getByText('Showing 2 of 2 labs', { exact: true })).toBeVisible();
      await expect(explorer.getByText('Lab A', { exact: true })).toBeVisible();
      await expect(explorer.getByText('Lab B', { exact: true })).toBeVisible();
      if (width === 375) expect(await explorer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    });
    test('P3 item detail distinguishes price reviews, packs and unlinked labs', async ({ page }) => {
      await fixture(page); await openGrowth(page); await page.getByRole('tab', { name: 'Profit', exact: true }).click();
      const explorer = page.getByRole('region', { name: 'Margin by lab and item', exact: true });
      await explorer.getByRole('tab', { name: 'Items', exact: true }).click();
      const trigger = explorer.getByRole('button', { name: 'Cliniquant CRP: open labs and prices', exact: true });
      await trigger.click();
      const panel = page.getByRole('dialog');
      await expect(panel.getByRole('heading', { name: 'Cliniquant CRP · price per unit by lab' })).toBeVisible();
      await expect(panel.getByText(/Typical \(median\) ₹2,500 across 13 labs/)).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Review prices', exact: true })).toHaveCount(1);
      await expect(panel.getByText(/Approved ₹1,700/)).toBeVisible();
      const pack = panel.getByRole('listitem').filter({ hasText: 'Pack Lab' });
      await expect(pack.getByText('Probably a different pack · not counted', { exact: true })).toBeVisible();
      await expect(pack.getByRole('button', { name: 'Review prices' })).toHaveCount(0);
      await expect(pack.getByRole('button', { name: 'Open', exact: true })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Link', exact: true })).toBeVisible();
      if (width === 375) expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
    });
    test('P3 Review prices hands the exact item, suggested price and sales-only reason to Pricing', async ({ page }) => {
      await fixture(page);
      await page.route('**/api/orders?**', route => route.fulfill({ json: { customerVersion: '1', catalogVersion: '1', customers: [{ id: 'customer-a', name: 'Lab A' }], catalog: [] } }));
      const priceRow = { customerId: 'customer-a', customerName: 'Lab A', tallyKey: 'tally-a', itemName: 'Cliniquant CRP', currentDecisionId: null, evidenceHash: 'evidence', currentPrice: 1608, currentPriceSource: 'LAST_TALLY_INVOICE', riskStatus: 'AMBER', pricingDate: '2026-11-09', fixed: false, lastRate: 1608, lastInvoiceDate: null, lastInvoiceReference: null, historicCost: null, currentCost: null, costChange: null, continuity: 1608, target: 2500, recommended: 2500, continuityGP: null, continuityMargin: null, recommendedGP: null, recommendedMargin: null, differenceToCustomer: null, additionalGP: null, status: 'review', warnings: [] };
      await page.route('**/api/pricing?**', route => {
        const p = new URL(route.request().url()).searchParams;
        return route.fulfill({ json: p.has('book') ? { rows: [priceRow], hasMore: false, offset: 0, bulkEligibleKeys: [] } : { contracts: [], policies: [] } });
      });
      let posts = 0;
      page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/pricing') posts++; });
      await openGrowth(page); await page.getByRole('tab', { name: 'Profit', exact: true }).click();
      const explorer = page.getByRole('region', { name: 'Margin by lab and item', exact: true });
      await explorer.getByRole('tab', { name: 'Items', exact: true }).click();
      await explorer.getByRole('button', { name: 'Cliniquant CRP: open labs and prices', exact: true }).click();
      const bookRequest = page.waitForRequest(r => r.url().includes('/api/pricing?') && new URL(r.url()).searchParams.get('customerId') === 'customer-a');
      await page.getByRole('dialog').getByRole('button', { name: 'Review prices', exact: true }).click(); await bookRequest;
      const review = page.getByRole('article', { name: 'Price review for Cliniquant CRP', exact: true });
      await expect(review.getByLabel('Custom rate', { exact: true })).toHaveValue('2500');
      await expect(review.getByLabel(/Decision note/)).toHaveValue('Growth review: pays ₹1,608 per unit for 6; typical ₹2,500 across 13 labs.');
      expect(await review.getByLabel(/Decision note/).inputValue()).not.toMatch(/cost|margin|gross profit|GP/i);
      expect(posts).toBe(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    test('price card Review prices opens rows and hands the exact item and suggested price to Pricing', async ({ page }) => {
      await priceFixture(page);
      await page.route('**/api/orders?**', route => route.fulfill({ json: { customerVersion: '1', catalogVersion: '1', customers: [{ id: 'customer-a', name: 'Lab A' }], catalog: [] } }));
      const priceRow = { customerId: 'customer-a', customerName: 'Lab A', tallyKey: 'tally-a', itemName: 'Cliniquant CRP', currentDecisionId: null, evidenceHash: 'evidence', currentPrice: 1608, currentPriceSource: 'LAST_TALLY_INVOICE', riskStatus: 'AMBER', pricingDate: '2026-11-09', fixed: false, lastRate: 1608, lastInvoiceDate: null, lastInvoiceReference: null, historicCost: null, currentCost: null, costChange: null, continuity: 1608, target: 2500, recommended: 2500, continuityGP: null, continuityMargin: null, recommendedGP: null, recommendedMargin: null, differenceToCustomer: null, additionalGP: null, status: 'review', warnings: [] };
      await page.route('**/api/pricing?**', route => {
        const p = new URL(route.request().url()).searchParams;
        return route.fulfill({ json: p.has('book') ? { rows: [priceRow], hasMore: false, offset: 0, bulkEligibleKeys: [] } : { contracts: [], policies: [] } });
      });
      let posts = 0;
      page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/pricing') posts++; });
      await openGrowth(page);
      const card = page.getByRole('region', { name: 'Action inbox', exact: true }).getByRole('article', { name: 'Lab A', exact: true });
      const trigger = card.getByRole('button', { name: 'Review prices: Lab A', exact: true });
      await trigger.click();
      const panel = page.getByRole('dialog');
      await expect(panel.getByRole('heading', { name: 'Lab A · items under typical price', exact: true })).toBeVisible();
      await expect(panel).toContainText('Some low prices are agreed volume rates. Check the quantity before proposing a change.');
      await expect(panel).toContainText('₹1,608 per unit vs typical ₹2,500 · 6 bought · ₹5,352 a year');
      await expect(panel.getByRole('button', { name: 'Not in price book', exact: true })).toBeDisabled();
      await expect(panel).toContainText('+2 more items not listed');
      await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
      await trigger.click();
      const bookRequest = page.waitForRequest(r => r.url().includes('/api/pricing?') && new URL(r.url()).searchParams.get('customerId') === 'customer-a');
      await page.getByRole('dialog').getByRole('button', { name: 'Review prices: Cliniquant CRP for Lab A', exact: true }).click(); await bookRequest;
      const review = page.getByRole('article', { name: 'Price review for Cliniquant CRP', exact: true });
      await expect(review.getByLabel('Custom rate', { exact: true })).toHaveValue('2500');
      await expect(review.getByLabel(/Decision note/)).toHaveValue('Growth review: pays ₹1,608 per unit for 6; typical ₹2,500 across labs.');
      expect(await review.getByLabel(/Decision note/).inputValue()).not.toMatch(/cost|margin|gross profit|GP/i);
      expect(posts).toBe(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
    test('price card renders chip, reason, stake, buttons and rule evidence', async ({ page }) => {
      await priceFixture(page); await openGrowth(page);
      const inbox = page.getByRole('region', { name: 'Action inbox', exact: true });
      await inbox.getByRole('button', { name: 'Price 1', exact: true }).click();
      const card = inbox.getByRole('article', { name: 'Lab A', exact: true });
      await expect(card).toContainText('Pays under typical price · Price');
      await expect(card).toContainText('Pays under 90% of the typical price on 4 items · last bought 12 Oct');
      await expect(card).toContainText('₹1,000 a month at stake (₹12,000 a year) · no reason recorded');
      for (const name of ['Review prices', 'Done', 'Snooze', 'Reject', 'Why this card']) await expect(card.getByRole('button', { name: name + ': Lab A', exact: true })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Accept: Lab A', exact: true })).toHaveCount(0);
      if (width === 375) expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await card.getByRole('button', { name: 'Why this card: Lab A', exact: true }).click();
      await expect(card).toContainText('typical = median price across labs (3+ labs)');
      await expect(card).toContainText('Cliniquant CRP · ₹1,608 per unit vs typical ₹2,500 · 6 bought · ₹5,352 a year');
      await expect(card).toContainText('+1 more items');
    });
    test('unlinked price card offers Link without Review prices', async ({ page }) => {
      await priceFixture(page, true); await openGrowth(page);
      const card = page.getByRole('region', { name: 'Action inbox', exact: true }).getByRole('article').first();
      await expect(card.getByRole('button', { name: /^Link:/ })).toBeVisible();
      await expect(card.getByRole('button', { name: /^Review prices:/ })).toHaveCount(0);
      await expect(card).toContainText('Link it to a customer to open its price book');
    });
    test('price card Done submits review and keeps Reviewed with Undo', async ({ page }) => {
      await priceFixture(page); await openGrowth(page);
      const card = page.getByRole('region', { name: 'Action inbox', exact: true }).getByRole('article', { name: 'Lab A', exact: true });
      await card.getByRole('button', { name: 'Done: Lab A', exact: true }).click();
      await expect(card.getByLabel('What did you change?', { exact: true })).toBeFocused();
      await card.getByLabel('What did you change?', { exact: true }).fill('Changed the rate');
      const submitted = page.waitForRequest(r => r.url().includes('/api/growth/inbox') && r.method() === 'POST');
      await card.getByRole('button', { name: 'Mark reviewed: Lab A', exact: true }).click();
      expect((await submitted).postDataJSON()).toEqual({ requestId: expect.any(String), cardKey: 'price-card', decision: 'review', note: 'Changed the rate' });
      await expect(card).toContainText('Reviewed');
      const today = await page.evaluate(() => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
      await expect(card).toContainText(today);
      const undone = page.waitForRequest(r => r.url().includes('/api/growth/inbox') && r.method() === 'POST');
      await card.getByRole('button', { name: 'Undo: Lab A', exact: true }).click();
      expect((await undone).postDataJSON()).toEqual({ requestId: expect.any(String), cardKey: 'price-card', decision: 'undo' });
      await expect(card.getByRole('button', { name: 'Done: Lab A', exact: true })).toBeVisible();
    });
    test('price card alone offers Agreed volume rate in Reject', async ({ page }) => {
      await priceFixture(page); await openGrowth(page);
      const inbox = page.getByRole('region', { name: 'Action inbox', exact: true });
      const price = inbox.getByRole('article', { name: 'Lab A', exact: true });
      await price.getByRole('button', { name: 'Reject: Lab A', exact: true }).click();
      await expect(price.getByLabel('Reason', { exact: true }).locator('option')).toHaveCount(13);
      await expect(price.getByLabel('Reason', { exact: true }).locator('option[value="agreed_volume_rate"]')).toHaveText('Agreed volume rate');
      const other = inbox.getByRole('article').last();
      await other.getByRole('button', { name: /^Reject:/ }).click();
      await expect(other.getByLabel('Reason', { exact: true }).locator('option[value="agreed_volume_rate"]')).toHaveCount(0);
    });

    test('action inbox renders counts, cards, and the phone reading order', async ({ page }) => {
      await fixture(page); await openGrowth(page);
      const inbox = page.getByRole('region', { name: 'Action inbox', exact: true });
      await expect(inbox.getByText('2 to review', { exact: true })).toBeVisible();
      await expect(inbox.getByRole('button', { name: 'All 2', exact: true })).toBeVisible();
      await expect(inbox.getByRole('button', { name: 'Skipped 2', exact: true })).toBeVisible();
      await expect(inbox.getByText('Lab A', { exact: true })).toBeVisible();
      await expect(inbox.getByText('Bought in 7 of the previous 11 months, nothing in Oct · last bought Sep', { exact: true })).toBeVisible();
      if (width === 375) {
        const scorecard = page.getByRole('region', { name: 'Scorecard', exact: true });
        expect(await scorecard.evaluate(element => element.nextElementSibling?.getAttribute('aria-labelledby'))).toBe(await inbox.getAttribute('aria-labelledby'));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    });
    test('accept submits only the contract fields and shows the action in progress', async ({ page }) => {
      await fixture(page); await openGrowth(page);
      const inbox = page.getByRole('region', { name: 'Action inbox', exact: true });
      await inbox.getByRole('button', { name: 'Accept: Lab A', exact: true }).click();
      await expect(inbox.getByLabel('Action', { exact: true })).toBeFocused();
      await expect(inbox.getByLabel('Owner', { exact: true })).toHaveValue('manager@example.test');
      await expect(inbox.getByLabel('Owner', { exact: true }).locator('option:checked')).toHaveText('You');
      const dueOn = await page.evaluate(() => {
        const date = new Date(); date.setDate(date.getDate() + 7);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      });
      const submitted = page.waitForRequest(request => new URL(request.url()).pathname === '/api/growth/inbox' && request.method() === 'POST');
      await inbox.getByRole('button', { name: 'Create action: Lab A', exact: true }).click();
      const body = (await submitted).postDataJSON();
      expect(body).toEqual({ requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i), cardKey: 'card-a', decision: 'accept', actionType: 'visit', ownerEmail: 'manager@example.test', dueOn, detail: 'Bought in 7 of the previous 11 months, nothing in Oct · last bought Sep' });
      await expect(inbox.getByText('Already in progress', { exact: true })).toBeVisible();
      await expect(inbox.getByRole('button', { name: 'Accept: Lab A', exact: true })).toHaveCount(0);
    });
    test('reject requires a category before submitting', async ({ page }) => {
      await fixture(page); await openGrowth(page);
      const inbox = page.getByRole('region', { name: 'Action inbox', exact: true });
      let posts = 0;
      page.on('request', request => { if (new URL(request.url()).pathname === '/api/growth/inbox' && request.method() === 'POST') posts++; });
      await inbox.getByRole('button', { name: 'Reject: Lab A', exact: true }).click();
      const reason = inbox.getByLabel('Reason', { exact: true });
      await expect(reason).toHaveAttribute('required', '');
      await inbox.getByRole('button', { name: 'Reject: Lab A', exact: true }).last().click();
      expect(await reason.evaluate(element => element instanceof HTMLSelectElement && element.validity.valueMissing)).toBe(true);
      expect(posts).toBe(0);
      await reason.selectOption('price');
      await inbox.getByLabel('Note', { exact: true }).fill('  Price concern \n');
      const submitted = page.waitForRequest(request => new URL(request.url()).pathname === '/api/growth/inbox' && request.method() === 'POST');
      await inbox.getByRole('button', { name: 'Reject: Lab A', exact: true }).last().click();
      expect((await submitted).postDataJSON()).toMatchObject({ cardKey: 'card-a', decision: 'reject', category: 'price', note: 'Price concern' });
      await expect(inbox.getByText('Rejected · Price', { exact: true })).toBeVisible();
    });
    test('owner falls back to the first owner when the viewer is not eligible', async ({ page }) => {
      await fixture(page, { inboxViewerEmail: 'another-manager@example.test' }); await openGrowth(page);
      const inbox = page.getByRole('region', { name: 'Action inbox', exact: true });
      await inbox.getByRole('button', { name: 'Accept: Lab A', exact: true }).click();
      await expect(inbox.getByLabel('Owner', { exact: true })).toHaveValue('sales@example.test');
    });
    test('snooze shows the server date and omits a whitespace-only note', async ({ page }) => {
      await fixture(page); await openGrowth(page);
      const inbox = page.getByRole('region', { name: 'Action inbox', exact: true });
      await inbox.getByRole('button', { name: 'Snooze: Lab A', exact: true }).click();
      await inbox.getByLabel('Note', { exact: true }).fill(' \n\t ');
      const submitted = page.waitForRequest(request => new URL(request.url()).pathname === '/api/growth/inbox' && request.method() === 'POST');
      await inbox.getByRole('button', { name: 'Snooze: Lab A', exact: true }).last().click();
      expect((await submitted).postDataJSON()).toEqual({ requestId: expect.any(String), cardKey: 'card-a', decision: 'snooze', until: '2w' });
      await expect(inbox.getByText('Snoozed until 3 Feb', { exact: true })).toBeVisible();
      await expect(inbox.getByRole('button', { name: 'Undo: Lab A', exact: true })).toBeVisible();
    });
    test('unlinked cards offer Link and Done shows the observed outcome', async ({ page }) => {
      await fixture(page); await openGrowth(page);
      const inbox = page.getByRole('region', { name: 'Action inbox', exact: true });
      await expect(inbox.getByText('Tally ledger not linked', { exact: true })).toBeVisible();
      await expect(inbox.getByRole('button', { name: 'Link: Tally ledger not linked', exact: true })).toBeVisible();
      await expect(inbox.getByRole('button', { name: 'Accept: Tally ledger not linked', exact: true })).toHaveCount(0);
      await inbox.getByRole('button', { name: 'Done & outcomes', exact: true }).click();
      await expect(inbox.getByText('Bought again 6 Nov (₹8,200)', { exact: true })).toBeVisible();
      await expect(inbox.getByText('Outcomes are what happened afterwards, not proof the visit caused it.', { exact: true })).toBeVisible();
    });
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
      await page.getByRole('tab', { name: 'H1 → H2', exact: true }).click();
      const bridge = page.getByRole('region', { name: 'Where growth came from' });
      await expect(bridge.locator('svg rect[data-growth-bar]')).toHaveCount(6);
      await expect(bridge.getByLabel('Bridge identity')).toHaveText('71.5 + 17.9 − 17.4 + 48.3 − 10.0 = 110.3.');
      await expect(bridge.getByText('Most labs that stopped were occasional buyers; 4 regular labs stopped (₹2.1 L). Growth came from 41 existing labs.', { exact: true })).toBeVisible();
      await expect(bridge.getByText('Regular = bought in 3 or more of the 6 months before. 30 of the labs that stopped had bought only once or twice.', { exact: true })).toBeVisible();
      const healthDetails = page.locator('#data-health details');
      const inboxDetails = page.getByRole('region', { name: 'Action inbox', exact: true }).locator('details');
      await expect(healthDetails).not.toHaveAttribute('open', '');
      await expect(inboxDetails).not.toHaveAttribute('open', '');
      await expect(page.locator('#data-health summary')).toContainText(/Data health · \d+ limited · 1 blocked/);
      await page.locator('#data-health summary').click();
      await expect(page.locator('#data-health li')).toHaveCount(6);
      await inboxDetails.locator('summary', { hasText: 'How the inbox works' }).click();
      await expect(inboxDetails).toContainText('₹ at stake:');
      const scorecard = page.getByRole('region', { name: 'Scorecard', exact: true });
      await expect(scorecard.getByText('29.4%', { exact: true })).toBeVisible();
      await expect(scorecard.getByText('+8.0 pts (25% → 33%)', { exact: true })).toBeVisible();
      await expect(scorecard.getByText('₹0.3 L on sales with known cost · cost known for 85% of sales', { exact: true })).toBeVisible();
      const grossProfit = page.locator('#data-health li').filter({ has: page.getByText('Gross profit', { exact: true }) });
      await expect(grossProfit.getByText('· Limited', { exact: true })).toBeVisible();
      await expect(grossProfit.getByText('Cost known for 85% of sales (average purchase cost)', { exact: true })).toBeVisible();
      await expect(grossProfit.getByText('1 line left out: sale and cost units look different', { exact: true })).toBeVisible();
      for (const [tabName, section] of [['Revenue', tree], ['H1 → H2', bridge]] as const) {
        await page.getByRole('tab', { name: tabName, exact: true }).click();
        await section.getByRole('button', { name: 'View as table' }).click();
        await expect(section.locator('table').first()).toBeVisible();
        await section.getByRole('button', { name: 'View as chart' }).click();
      }
      if (width === 375) expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
    test('scorecard and skipped segment open compact lab actions and restore keyboard focus', async ({ page }) => {
      await fixture(page); await openGrowth(page); await page.getByRole('tab', { name: 'Monthly', exact: true }).click();
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
      await fixture(page, { labsTotal: 21 }); await openGrowth(page); await page.getByRole('tab', { name: 'Monthly', exact: true }).click();
      await page.getByRole('region', { name: 'Labs buying each month', exact: true }).getByRole('button', { name: /Oct.*skipped|skipped.*Oct/i }).click();
      const panel = page.getByRole('dialog');
      const request = page.waitForRequest(r => { const p = new URL(r.url()).searchParams; return r.url().includes('/api/growth/labs?') && p.get('list') === 'month_skipped' && p.get('page') === '2'; });
      await panel.getByRole('button', { name: 'Load more', exact: true }).click(); await request;
      await expect(panel.getByText('Lab B', { exact: true })).toBeVisible();
      await expect(panel.getByText('Lab A', { exact: true })).toBeVisible();
      await expect(panel.getByText('Showing 21 of 21', { exact: true })).toBeVisible();
    });
    test('Stopped starts with regular only and refetches when toggled off', async ({ page }) => {
      await fixture(page); await openGrowth(page); await page.getByRole('tab', { name: 'H1 → H2', exact: true }).click();
      const request = page.waitForRequest(r => { const p = new URL(r.url()).searchParams; return r.url().includes('/api/growth/labs?') && p.get('list') === 'bridge_stopped' && p.get('regularOnly') === 'true'; });
      await page.getByRole('region', { name: 'Where growth came from', exact: true }).getByRole('button', { name: /stopped/i }).click(); await request;
      const regular = page.getByRole('dialog').getByRole('checkbox', { name: 'Regular only', exact: true });
      await expect(regular).toBeChecked();
      const unfiltered = page.waitForRequest(r => { const p = new URL(r.url()).searchParams; return r.url().includes('/api/growth/labs?') && p.get('list') === 'bridge_stopped' && p.get('regularOnly') === 'false'; });
      await regular.uncheck(); await unfiltered;
    });
    test('large-purchase segments show suppliers and the Economics action', async ({ page }) => {
      await fixture(page); await openGrowth(page); await page.getByRole('tab', { name: 'Monthly', exact: true }).click();
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
    test('scorecard tiles open their details and Gross profit opens the Profit tab', async ({ page }) => {
      await fixture(page); await openGrowth(page);
      const request = page.waitForRequest(r => { const p = new URL(r.url()).searchParams; return r.url().includes('/api/growth/labs?') && p.get('list') === 'window_labs' && p.get('sort') === 'months' && !p.has('half'); });
      await page.getByRole('button', { name: /^Labs buying: \d+, open labs by buying months$/ }).click();
      await request;
      await expect(page.getByRole('dialog').getByText('Lab A', { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByRole('button', { name: /^Gross profit: .*, open Profit$/ }).click();
      await expect(page.getByRole('tab', { name: 'Profit', exact: true })).toHaveAttribute('aria-selected', 'true');
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
      await fixture(page); await openGrowth(page); await page.getByRole('tab', { name: 'Monthly', exact: true }).click();
      const purchases = page.getByRole('region', { name: 'Purchases against sales', exact: true });
      await expect(purchases.getByRole('button', { name: /sales|regular purchases/i })).toHaveCount(0);
      await expect(purchases.locator('svg rect[role="button"]')).toHaveCount(12);
      await purchases.getByRole('button', { name: 'View as table', exact: true }).click();
      for (const row of await purchases.locator('tbody tr').all()) {
        await expect(row.getByRole('cell').nth(0).getByRole('button')).toHaveCount(0);
        await expect(row.getByRole('cell').nth(1).getByRole('button')).toHaveCount(0);
      }
    });
    test('hovering a monthly bar shows its value straight away and hides on leave', async ({ page }) => {
      await fixture(page); await openGrowth(page); await page.getByRole('tab', { name: 'Monthly', exact: true }).click();
      const tip = page.locator('[data-chart-tip]');
      await expect(tip).toHaveCount(0);
      await page.locator('#buying-chart rect').first().hover();
      await expect(tip).toBeVisible();
      await expect(tip).toContainText(/^[A-Z][a-z]{2} · \d+ labs buying$/);
      await page.mouse.move(0, 0);
      await expect(tip).toBeHidden();
    });
    test('Brand setup health action reaches Accounts Prospects', async ({ page }) => {
      await fixture(page); await openGrowth(page);
      await page.route('**/api/customer-map?**', route => route.fulfill({ status: 503, json: { error: 'Unavailable in fixture' } }));
      await page.locator('#data-health summary').click();
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
    test('Growth shows one analysis tab at a time, loads margins only on demand and remembers the tab', async ({ page }) => {
      const marginRequests: string[] = [];
      page.on('request', request => { if (request.url().includes('/api/growth/margin')) marginRequests.push(request.url()); });
      await fixture(page); await openGrowth(page);
      await expect(page.getByRole('tab', { name: 'Revenue', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('region', { name: 'Where revenue comes from' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Where growth came from' })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Where margin can grow' })).toHaveCount(0);
      expect(marginRequests).toHaveLength(0);
      await page.getByRole('tab', { name: 'Profit', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Margin by lab and item', exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Where revenue comes from' })).toHaveCount(0);
      expect(marginRequests.length).toBeGreaterThan(0);
      await page.reload(); await openGrowth(page);
      await expect(page.getByRole('tab', { name: 'Profit', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('region', { name: 'Margin by lab and item', exact: true })).toBeVisible();
    });
    test('the Why? link opens the collapsed Data health items', async ({ page }) => {
      await fixture(page); await openGrowth(page);
      await expect(page.locator('#data-health li').first()).toBeHidden();
      await page.getByRole('region', { name: 'Scorecard', exact: true }).getByRole('link', { name: 'Why?' }).click();
      await expect(page.locator('#data-health li')).toHaveCount(6);
      await expect(page.locator('#data-health li').first()).toBeVisible();
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

