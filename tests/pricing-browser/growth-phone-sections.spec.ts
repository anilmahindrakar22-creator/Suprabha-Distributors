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
  rows: p.get('view') === 'items' ? [{ itemKey: 'item-a', name: 'Cliniquant CRP', salesPaise: 55000000, knownSalesPaise: 55000000, gpPaise: 7000000, marginPct: 13.2, labs: 13, priceLowPaise: 140000, typicalPricePaise: 250000, priceHighPaise: 322000, spreadPaise: 2904900, low: true, belowCost: false }] : [{ labKey: 'ledger-a', customerId: 'customer-a', name: 'Lab A', town: 'Town A', salesPaise: 55000000, knownSalesPaise: 55000000, gpPaise: 7000000, marginPct: 13.2, coveragePct: 100, low: true, totalSalesPaise: 80000000, instrumentSalesPaise: 25000000 }],
});
const itemDetail = () => ({
  kind: 'item', itemKey: 'item-a', name: 'Cliniquant CRP', typicalPricePaise: 250000, labs: 13, marginPct: 28.1, tallyItemKey: 'tally-a', page: 1, pageSize: 20, total: 4,
  pricePolicy: { minimumMarginPct: 25, targetMarginPct: 30 },
  rows: [
    { labKey: 'ledger-a', customerId: 'customer-a', name: 'Lab A', town: 'Town A', unitPricePaise: 160800, quantity: 6, salesPaise: 964800, belowTypical: true, packDifference: false, approvedPricePaise: 170000, belowMinimum: true, minimumPricePaise: 180000, belowTarget: true, liftToPricePaise: 300000 },
    { labKey: 'ledger-pack', customerId: 'customer-pack', name: 'Pack Lab', town: null, unitPricePaise: 50000, quantity: 2, salesPaise: 100000, belowTypical: false, packDifference: true, approvedPricePaise: null, belowMinimum: null, minimumPricePaise: null, belowTarget: null, liftToPricePaise: null },
    { labKey: 'ledger-unlinked', customerId: null, name: null, town: null, unitPricePaise: 140000, quantity: 4, salesPaise: 560000, belowTypical: true, packDifference: false, approvedPricePaise: null, belowMinimum: null, minimumPricePaise: null, belowTarget: null, liftToPricePaise: null },
    { labKey: 'ledger-steady', customerId: 'customer-steady', name: 'Steady Lab', town: 'Town B', unitPricePaise: 250000, quantity: 5, salesPaise: 1250000, belowTypical: false, packDifference: false, approvedPricePaise: null, belowMinimum: null, minimumPricePaise: null, belowTarget: null, liftToPricePaise: null },
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
async function fixture(page: Page, options: { role?: string; status?: number; confirmed?: boolean; malformed?: boolean; labsTotal?: number; inboxViewerEmail?: string; billedBelow?: 'lines' | 'error'; inboxOpen?: boolean; reason?: string } = {}) {
  const role = options.role ?? 'management';
  await page.route('**/api/me', route => route.fulfill({ json: { roles: [role] } }));
  await page.route('**/api/push-subscription**', route => route.fulfill({ json: { enabled: false, publicKey: '' } }));
  await page.route('**/api/wallet?**', route => route.fulfill({ json: { coverage: { certified: true } } }));
  await page.route('**/api/today**', route => route.fulfill({ json: { policyVersion: 'today-v1', generatedAt: '2026-11-01T06:00:00Z', coverageCertified: true, unblock: { total: 0, rows: [] }, grow: { total: 0, rows: [] } } }));
  await page.route('**/api/accounts?**', route => route.fulfill({ json: { accounts: [], page: { page: 1, pageSize: 20, total: 0 }, owners: [], territories: [], classPolicy: { aMinPaise: '10000000', bMinPaise: '3000000' }, canAssign: true, canSeeProspects: true, canSeeMyActions: true, canEraseContacts: false, canSeePowerMap: true, actorEmail: 'manager@example.test', today: '2026-11-09' } }));
  await page.route('**/api/growth', route => route.fulfill({ status: options.status ?? 200, json: options.malformed ? {} : { ...sample(), confirmed: options.confirmed ?? true, confirmedReason: options.confirmed === false ? options.reason ?? 'Sales import is pending' : null } }));
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
  if (options.inboxOpen !== false) await page.addInitScript(() => { try { localStorage.setItem('sf-growth-inbox-open', '1'); } catch { /* storage unavailable */ } });
  await page.goto('/?view=frame&role=' + role + '&roles=' + role + '&growthPeriod=rolling12');
}
async function openGrowth(page: Page) {
  const entry = page.getByRole('button', { name: /^growth$/i });
  if (!await entry.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(entry).toBeVisible();
  await entry.click();
}


const titles = ['Act now', 'Revenue', 'Labs', 'Profit', 'Brands & items', 'Data health'];
const menu = (page: Page) => page.getByRole('navigation', { name: 'Growth sections', exact: true });
const sectionHeading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true, level: 2 }).first();
async function openSection(page: Page, title: string) {
  await menu(page).getByRole('button', { name: new RegExp('^' + title) }).click();
  await expect(sectionHeading(page, title)).toBeFocused();
  const backBox = await page.getByRole('button', { name: '‹ Back to Growth', exact: true }).boundingBox();
  const headingBox = await sectionHeading(page, title).boundingBox();
  expect(backBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(Math.abs((backBox!.y + backBox!.height / 2) - (headingBox!.y + headingBox!.height / 2))).toBeLessThanOrEqual(8);
}
async function backToMenu(page: Page) {
  await page.getByRole('button', { name: '‹ Back to Growth', exact: true }).click();
  await expect(menu(page)).toBeVisible();
}
async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function phoneFixture(page: Page) {
  // Keep the Growth page's fixtures and routes above; add the lab-months endpoint.
  await page.route('**/api/growth/lab-months*', route => {
    const filter = new URL(route.request().url()).searchParams.get('filter') ?? 'top';
    const months = sample().months.map(m => m.month);
    const monthsPaise = months.map((_, i) => i < 9 ? 400000 : 100000);
    return route.fulfill({ json: {
      window: { from: '2025-11-01', to: '2026-11-01' }, months, filter, totalLabs: 1,
      rows: [{ labKey: 'ledger-a', customerId: 'customer-a', name: 'Lab A', town: 'Town A',
        totalPaise: 3900000, monthsPaise, buyingMonths: 12, lastPurchaseOn: '2026-10-15',
        usualMonthlyPaise: 400000, monthsMissed: 0, phone: null,
        lastNinetyPaise: 300000, previousNinetyPaise: 1200000,
      }],
    } });
  });
  await page.route('**/api/growth/stopped-items?**', route => route.fulfill({ status: 503, json: {} }));
  await fixture(page);
}
test.describe('Growth phone sections', () => {
  test.use({ viewport: { width: 375, height: 800 } });
  test('1. lands on six section cards with Act now first', async ({ page }) => {
    await phoneFixture(page); await openGrowth(page);
    const buttons = menu(page).getByRole('button');
    await expect(buttons).toHaveCount(6);
    for (const [index, title] of titles.entries()) await expect(buttons.nth(index)).toContainText(title);
    await expect(page.getByRole('heading', { name: 'Action inbox', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Scorecard', exact: true })).toHaveCount(0);
    await expect(buttons.nth(1)).toContainText('₹1.8 Cr');
    await expect(buttons.nth(2)).toContainText('164 labs buying');
    await expect(buttons.nth(3)).toContainText('29.4%');
  });
  test('2. Act now opens the inbox and call shortcuts, then returns', async ({ page }) => {
    await phoneFixture(page); await openGrowth(page); await openSection(page, 'Act now');
    await expect(page.getByRole('heading', { name: 'Action inbox', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Labs to call', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lapsing core labs ›', exact: true })).toBeVisible();
    await expect(menu(page)).toHaveCount(0);
    await backToMenu(page);
    await expect(page.getByRole('heading', { name: 'Action inbox', exact: true })).toHaveCount(0);
  });
  test('3. Buying less opens Labs with the declining filter selected', async ({ page }) => {
    await phoneFixture(page); await openGrowth(page); await openSection(page, 'Act now');
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/growth/lab-months' && new URL(r.url()).searchParams.get('filter') === 'declining');
    await page.getByRole('button', { name: 'Buying less ›', exact: true }).click();
    await response;
    await expect(sectionHeading(page, 'Labs')).toBeFocused();
    await expect(page.getByRole('button', { name: 'Buying less (1)', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('list', { name: 'Call list', exact: true })).toContainText('Last 90 days');
    const chipBox = await page.getByRole('button', { name: 'Buying less (1)', exact: true }).boundingBox();
    const buyingBox = await page.getByRole('heading', { name: 'Labs buying each month', exact: true }).boundingBox();
    expect(chipBox).not.toBeNull();
    expect(buyingBox).not.toBeNull();
    expect(chipBox!.y).toBeLessThan(buyingBox!.y);
    await page.goBack();
    await expect(sectionHeading(page, 'Act now')).toBeFocused();
    await page.goForward();
    await expect(page.getByRole('button', { name: 'Buying less (1)', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
  test('4. Revenue has its scorecard and switch; brands are separate from Profit', async ({ page }) => {
    await phoneFixture(page); await openGrowth(page); await openSection(page, 'Revenue');
    await expect(page.getByRole('region', { name: 'Scorecard', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Revenue', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'H1 → H2', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Where growth came from', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Purchases against sales', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Labs buying each month', exact: true })).toHaveCount(0);
    await backToMenu(page); await openSection(page, 'Profit');
    await expect(page.getByRole('region', { name: 'Where margin can grow', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Sales by principal', exact: true })).toHaveCount(0);
    await backToMenu(page); await openSection(page, 'Brands & items');
    await expect(page.getByRole('region', { name: 'Sales by principal', exact: true })).toBeVisible();
  });
  test('5. browser Back returns to the menu and stays on Growth', async ({ page }) => {
    await phoneFixture(page); await openGrowth(page); await openSection(page, 'Labs');
    await page.goBack();
    await expect(menu(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Growth', exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: '‹ Back to Growth', exact: true })).toHaveCount(0);
  });
  test('6. an initial labs hash opens Labs', async ({ page }) => {
    await phoneFixture(page);
    await page.goto('/?view=frame&role=management&roles=management&growthPeriod=rolling12#growth-labs');
    await openGrowth(page);
    await expect(sectionHeading(page, 'Labs')).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Labs buying each month', exact: true })).toBeVisible();
    await expect(menu(page)).toHaveCount(0);
    await backToMenu(page);
  });
  test('7. menu and every section fit the phone and reset the Growth scroll', async ({ page }) => {
    await phoneFixture(page); await openGrowth(page);
    await expect(menu(page)).toBeVisible(); await noHorizontalScroll(page);
    for (const title of titles) {
      await openSection(page, title);
      await noHorizontalScroll(page);
      await page.locator('[data-growth-scroller]').evaluate(el => { el.scrollTop = 300; });
      await backToMenu(page);
      await expect.poll(() => page.locator('[data-growth-scroller]').evaluate(el => el.scrollTop)).toBe(0);
      await noHorizontalScroll(page);
    }
  });
});
test.describe('Growth desktop retains its layout', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test('8. existing tabs and Health remain, with principals inside Profit', async ({ page }) => {
    await fixture(page); await openGrowth(page);
    for (const name of ['Revenue', 'H1 → H2', 'Monthly', 'Profit']) await expect(page.getByRole('tab', { name, exact: true })).toBeVisible();
    await expect(menu(page)).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Scorecard', exact: true })).toBeVisible();
    await expect(page.locator('#data-health')).toBeVisible();
    await page.getByRole('tab', { name: 'Profit', exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: 'Profit', exact: true }).getByRole('region', { name: 'Sales by principal', exact: true })).toBeVisible();
  });
});

