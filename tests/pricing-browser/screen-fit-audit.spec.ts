import { expect, test, type Page, type Locator } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { orderBootstrap, orderLine, orderSummary, pricingLine, pricingWorkspace, toOrderItem, toOrderResponse } from '../fixtures/api-builders';

const now = new Date().toISOString();
const email = 'administrator@example.test';
const lab = (i: number) => `Laboratory with a very long display name ${String(i).padStart(2, '0')}`;
const product = (i: number) => `Laboratory reagent with a very long product name ${String(i).padStart(2, '0')}`;
const rows = <T,>(make: (i: number) => T, count = 12) => Array.from({ length: count }, (_, i) => make(i + 1));
const jsonRoute = async (page: Page, pattern: string, json: unknown) => {
  await page.route(pattern, route => route.fulfill({ json }));
};

// Frame: frame-scroll-boundaries.spec.ts, orders-fit-screen.spec.ts and today.spec.ts.
async function setupFrame(page: Page) {
  await jsonRoute(page, '**/api/staff-auth', { ok: true, renewAfterSeconds: 3000 });
  await jsonRoute(page, '**/api/me', { roles: ['administrator'] });
  await jsonRoute(page, '**/api/push-subscription**', { enabled: false, publicKey: '' });
  await jsonRoute(page, '**/api/wallet?**', { coverage: { certified: true } });
  await jsonRoute(page, '**/api/my-actions?**', { page: 1, pageSize: 50, total: 0, overdueCount: 0, rows: [] });
}

// today.spec.ts: decision cards in both lanes. parseToday caps each lane at five.
async function setupToday(page: Page) {
  await jsonRoute(page, '**/api/today**', {
    policyVersion: 'today-v1', generatedAt: now, coverageCertified: true,
    unblock: { total: 12, rows: rows(i => ({ type: 'approve_price', title: lab(i), subtitle: product(i), valuePaise: 4800000,
      approximate: true, since: now, rankReason: 'value_known', target: { kind: 'order', orderId: `order-${i}` } }), 5) },
    grow: { total: 12, rows: rows(i => ({ type: 'diagnose', title: lab(i), subtitle: 'Focus account needs a diagnosis',
      valuePaisePerMonth: 6000000, valueKind: 'gap', due: null, rankReason: 'value_known', target: { kind: 'lab', customerId: `customer-${i}` } }), 5) },
  });
}

// tests/e2e/stock-freshness.spec.ts: dashboard stock row and freshness envelope.
async function setupStock(page: Page) {
  const stockRows = rows(i => ({ group: `Reagents ${i}`, item: product(i), closing: 2, reorderLevel: 5,
    minimumOrder: 1, shortfall: 3, orderToBePlaced: 3, lastSuppliedParty: lab(i), lastSuppliedQty: 2, lastSuppliedDate: '2026-10-01' }), 15);
  await jsonRoute(page, '**/api/stock**', { company: 'Test company', fetchedAtIso: now, fetchedAt: now,
    fetchedAtShort: 'Today', rows: stockRows, groups: stockRows.map(row => row.group) });
  await page.route('**/stockflow.html', route => route.fulfill({ contentType: 'text/html', body: readFileSync('public/stockflow.html', 'utf8') }));
}

// orders-fit-screen.spec.ts: populated pending queue, administrator bootstrap.
async function setupOrders(page: Page) {
  const orders = rows(i => orderSummary({ id: `order-${i}`, orderNumber: `SF-AUDIT-${i}`, customerName: lab(i),
    createdAt: now, updatedAt: now, status: 'packed', pricingState: 'approval_required',
    lines: [orderLine({ itemName: product(i), tallyKey: `item-${i}`, quantity: 2, fulfilledQuantity: 2 })] }));
  await page.route('**/api/orders**', route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    if (params.has('eventsFor')) return route.fulfill({ json: { events: [] } });
    return route.fulfill({ json: orderBootstrap({ actor: { email, role: 'administrator', roles: ['administrator'] },
      orders, operations: {}, pagination: { page: 1, pageCount: 1, pageSize: 20, total: orders.length } }) });
  });
}

// to-order.spec.ts, requirements.spec.ts and stock-po-draft.spec.ts.
async function setupPurchase(page: Page) {
  await jsonRoute(page, '**/api/product-requests*', { requests: [] });
  await jsonRoute(page, '**/api/purchase-orders*', { page: 1, items: [], total: 0 });
  await page.route('**/api/requirements?*', route => {
    const p = new URL(route.request().url()).searchParams;
    const view = p.get('view');
    return route.fulfill({ json: p.has('alerts') ? { windowDays: 7, alerts: [], pagination: { page: 1, pageCount: 1, total: 0 } }
      : view === 'cover' ? { view, leadTimeDays: 7, salesThrough: '2026-10-01', runsOutCount: 0, items: [] }
      : view === 'to_order' ? toOrderResponse({ total: 12, waitingCount: 12, items: rows(i => toOrderItem({ itemKey: `item-${i}`, itemName: product(i), group: `Reagents ${i}` })) })
      : { view, leadTimeDays: 7, total: 0, items: [] } });
  });
}

// accounts-workspace.spec.ts: all-accounts response and account card shape.
async function setupAccounts(page: Page) {
  // Same weekly values as go-live-card.spec.ts, with two active people for the audit.
  await page.route('**/api/go-live', route => route.request().method() !== 'GET' ? route.fallback() : route.fulfill({ json: {
    weeks: ['2026-11-23','2026-11-16','2026-11-09','2026-11-02','2026-10-26'].map(weekStart => ({
      weekStart, ordersEntered: 2, ordersLinkedToTally: 1, tallySaleInvoices: 0, visitsLogged: 3, activePeople: 2,
    })),
    people: [
      { email: 'staff@example.test', roles: ['management'], actionsThisWeek: 4, ordersThisWeek: 2, visitsThisWeek: 3, lastActionAt: null },
      { email: 'admin@example.test', roles: ['administrator'], actionsThisWeek: 1, ordersThisWeek: 0, visitsThisWeek: 0, lastActionAt: '2026-11-26T00:00:00Z' },
    ],
    membersByRole: { sales: 0, operations: 0, warehouse: 0, accounts: 0, billing: 0, management: 1, administrator: 1, viewer: 0 },
    generatedAt: '2026-11-26T00:00:00Z',
  } }));
  // Optional lazy Accounts cards fetch on mount, even while collapsed.
  // Success envelopes from data-checks.spec.ts and data-speed-report.spec.ts.
  // Fall through to the network guard for mutations; this audit is read-only.
  await page.route('**/api/data-checks', route => route.request().method() !== 'GET' ? route.fallback() : route.fulfill({ json: {
    view: 'data_checks', asOf: '2026-11-18',
    unlinkedLedgers: { count: 7, ofBuying: 100, top: rows(i => ({ name: `Test ledger ${i}`, lastSaleOn: '2026-11-17' }), 7) },
    noPinCode: { count: 20, ofBuying: 93, top: rows(i => ({ customerId: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`, name: lab(i), town: 'Test town' }), 20) },
    itemsNotInStockFlow: { count: 0, ofSold: 42 },
    freshness: { salesThrough: '2026-11-17', itemListReadAt: '2026-11-18T04:30:00Z' },
  } }));
  await page.route('**/api/data-speed', route => route.request().method() !== 'GET' ? route.fallback() : route.fulfill({ json: {
    statsAvailable: true, statsResetAt: '2026-11-01T00:00:00Z', windowFrom: '2026-11-11T00:00:00Z',
    reads: [{ gateway: 'economics', calls: 7, meanMs: 1977, previousMeanMs: 714, maxMs: 4200 }, { gateway: 'today', calls: 5, meanMs: 714, previousMeanMs: null, maxMs: 900 }],
    budget: { meanMs: 1000, maxMs: 3000 }, lastImportAt: new Date(Date.now() - 8 * 3600_000).toISOString(), lastRebuildAt: '2026-11-18T04:30:00Z',
    exceptions: [{ reason: 'Canonical customer GUID unavailable in the master export.', total: 4, under7Days: 1, from7To30Days: 2, over30Days: 1, acknowledgeable: 0 }], snapshotCount: 0,
  } }));
  await jsonRoute(page, '**/api/power-map**', { contacts: [], links: [], route: null });
  await jsonRoute(page, '**/api/accounts**', { accounts: rows(i => ({ id: `customer-${i}`, name: lab(i), city: 'Pune', appContacts: [],
    owner: { email, territoryId: 'territory-1', territoryName: 'West', since: '2026-10-01', version: 1 }, location: null,
    lastVisit: null, nextVisitOn: '2026-10-03', lastOrderOn: null,
    class: { state: 'not_available', monthlyPaise: null, window: { from: '2026-07-01', to: '2026-09-30' } } })),
    page: { page: 1, pageSize: 50, total: 12 }, owners: [{ email, name: 'Administrator' }], territories: [{ id: 'territory-1', name: 'West' }],
    canAssign: true, canEraseContacts: true, canSeePowerMap: true, actorEmail: email, today: '2026-10-30',
    classPolicy: { aMinPaise: '20000000', bMinPaise: '7500000' } });
}

// pricing-order-inbox.spec.ts: pending price exceptions and policy/contracts reads.
async function setupPricing(page: Page) {
  await page.route('**/api/pricing**', route => {
    const p = new URL(route.request().url()).searchParams;
    const id = p.get('orderId');
    const i = Number(id?.split('-').pop()) || 1;
    return route.fulfill({ json: id ? pricingWorkspace({ orderId: id, orderNumber: `SF-AUDIT-${i}`, customerName: lab(i),
      pricingState: 'approval_required', lines: [pricingLine({ lineId: `line-${i}`, itemName: product(i) })],
      exceptions: [{ id: `exception-${i}`, lineId: `line-${i}`, referenceRate: 4450, enteredRate: 4450, differenceAmount: 0,
        differencePercent: 0, reason: 'Keep the last rate', state: 'pending', requestedBy: email, requestedAt: now, version: 1 }] })
      : p.has('policies') ? { policies: [] } : { contracts: [] } });
  });
}

// economics-summary-read.spec.ts: lightweight summary plus detail view envelope.
async function setupEconomics(page: Page) {
  // Same SalesCoverage contract fixture as sales-coverage.spec.ts.
  await jsonRoute(page, '**/api/instrument-economics?action=get_sales_coverage',
    JSON.parse(readFileSync('tests/fixtures/sales-coverage-example.json', 'utf8')));
  await jsonRoute(page, '**/api/instrument-economics/cost-review**', { sales: [], salesTotal: 0, purchases: [], purchasesTotal: 0 });
  await jsonRoute(page, '**/api/instrument-economics/line-refs**', { rows: [], total: 0, limit: 5000 });
  await page.route('**/api/instrument-economics', route => route.fulfill({ json: {
    actorEmail: email, readView: route.request().headers()['x-stockflow-economics-view'] ?? 'summary', todoCount: 0,
    targets: rows(i => ({ id: `target-${i}`, name: product(i), customerName: lab(i), companyId: 'company', customerId: `customer-${i}`,
      customerSourceId: `customer-guid-${i}`, siteId: `site-${i}`, modelId: 'model', kind: 'placement', installationId: null,
      effectiveFrom: '2026-07-23', salesFrom: '2026-07-23', effectiveTo: null, approval: 'approved', version: 1,
      capitalPaise: '62500000', instrumentBillingPaise: '40000000', netInvestmentPaise: '22500000', revenuePaise: '10000',
      knownGpPaise: '6000', missingCostLines: 1, attributedLines: 2, recoveryPaise: '40006000', outstandingPaise: '22494000',
      health: 'data_incomplete', forecastMonths: null, expectation: null,
      reagentLifetime: { salesPaise: '20000', knownGpPaise: '12000', lines: 3, missingCostLines: 1 } })),
    mappings: [], exceptions: [], leakage: [], cases: [], sourceLines: [], attributionLines: [], installations: [], customers: [],
    canManage: true, canApprove: true, canAct: true, generation: 'audit-1', lastRebuiltAt: null, sourceImportedAt: null,
    sourceLineCount: 840, unattributedPaise: '0', businessDate: '2026-10-30', reportingFrom: '2026-09-01', reportingTo: '2026-10-01',
    policy: { attractiveMonths: 24, reviewMonths: 36, exceptionMonths: 48, forecastWindowMonths: 3, watchRevenuePercent: 80, criticalRevenuePercent: 50 },
  } }));
}

// growth-charts.spec.ts / growth-brands.spec.ts: certified twelve-month overview.
async function setupGrowth(page: Page) {
  const half = { revenuePaise: 715000000, repeatPaise: 579000000, bulkPaise: 136000000, bulkInvoices: 4, labsBuying: 121, buyingMonths: 374, perBuyingMonthPaise: 1548400 };
  const gp = { salesPaise: 10000000, knownSalesPaise: 8500000, costPaise: 6000000, gpPaise: 2500000, gpPct: 29.4, coveragePct: 85 };
  const months = rows(i => new Date(Date.UTC(2025, 10 + i - 1, 1)).toISOString().slice(0, 7));
  await jsonRoute(page, '**/api/growth{,?*}', { companyCount: 1, window: { from: '2025-11-01', to: '2026-11-01', h1From: '2025-11-01', h2From: '2026-05-01' },
    confirmed: true, confirmedReason: null, scorecard: { regularLabs: 20, regularPct: 40, top10Pct: 35 },
    months: months.map(month => ({ month, labsBuying: 68, firstTime: 3, skippedRegulars: 12, salesPaise: 150000000, purchasesRegularPaise: 100000000, purchasesLargePaise: 20000000, largePurchaseInvoices: 1 })),
    tree: half, halves: [{ half: 'H1', ...half }, { half: 'H2', ...half }],
    bridge: { h1Paise: half.revenuePaise, h2Paise: half.revenuePaise, ...Object.fromEntries(['new', 'stopped', 'stoppedRegular', 'grew', 'fell', 'same', 'other'].map(key => [key, { labs: 4, paise: 1000000 }])) },
    health: { gp: { costedPct: 85, computedAt: now }, history: { firstSaleOn: '2025-10-01', monthsImported: 13 }, itemGroups: { unmappedPct: 21 }, reasons: { visitReasons180: 0, constraints: 0, openActions: 0, visits180: 4 }, catalog: { observedAt: now, groups: 30 } },
    gp: { method: 'average_purchase_cost_to_date', window: { ...gp, unreliableLines: 1 }, halves: [{ half: 'H1', ...gp }, { half: 'H2', ...gp }], repeat: gp, bulk: gp, consumables: gp, instruments: gp,
      months: months.map(month => ({ month, ...gp, consumablesKnownSalesPaise: 1000000, consumablesGpPaise: 280000, instrumentsKnownSalesPaise: 500000, instrumentsGpPaise: -100000 })) } });
  await page.route('**/api/growth/margin?**', route => {
    const p = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: p.has('billedBelow')
      ? { lines: 0, gapPaise: 0, unitMismatchLines: 0, approvedPricesInUse: 0, page: 1, pageSize: 20, total: 0, rows: [] }
      : { view: p.get('view'), sort: p.get('sort') ?? 'sales', filter: p.get('filter') ?? 'all', q: p.get('q'), page: 1, pageSize: 20, total: 12,
        thresholdPct: 14, consumablesMarginPct: 28.1,
        levers: { priceSpread: { items: 12, pairs: 24, paise: 19000000 }, lowMargin: { items: 12, paiseToThreshold: 7000000, examples: [] }, freeGoods: { lines: 9, costPaise: 3500000 }, instrumentsGpPaise: -30000000 },
        rows: rows(i => ({ itemKey: `item-${i}`, labKey: `ledger-${i}`, customerId: `customer-${i}`, name: p.get('view') === 'items' ? product(i) : lab(i), town: 'Pune',
          salesPaise: 55000000, knownSalesPaise: 55000000, gpPaise: 7000000, marginPct: 13.2, labs: 13, priceLowPaise: 140000,
          typicalPricePaise: 250000, priceHighPaise: 322000, spreadPaise: 2904900, low: true, belowCost: false, coveragePct: 100, totalSalesPaise: 80000000, instrumentSalesPaise: 25000000 })) } });
  });
  await jsonRoute(page, '**/api/growth/brands{,?*}', { window: { from: '2025-11-01', to: '2026-11-01', h2From: '2026-05-01' },
    totals: { salesPaise: 19000000, instrumentSalesPaise: 0, consumablesSalesPaise: 19000000, knownSalesPaise: 19000000, gpPaise: 4000000, marginPct: 22.5 },
    rows: rows(i => ({ key: `brand:${i}`, kind: 'brand', brandCode: `P${i}`, name: product(i), salesPaise: 1000000, h1Paise: 400000, h2Paise: 600000,
      instrumentSalesPaise: 0, consumablesSalesPaise: 1000000, knownSalesPaise: 1000000, gpPaise: 250000, marginPct: 25, items: 4, lines: [] })) });
  // These endpoints deliberately return the same unavailable state as growth-charts.spec.ts.
  for (const path of ['inbox', 'labs', 'lab-months']) await page.route(`**/api/growth/${path}**`, route => route.fulfill({ status: 503, json: { error: 'Unavailable in fixture' } }));
}

const surfaces = ['today', 'stock', 'orders', 'requests', 'accounts', 'pricing', 'economics', 'growth'] as const;
const viewports = [{ width: 375, height: 740 }, { width: 768, height: 1024 }, { width: 1280, height: 594 }, { width: 1440, height: 900 }];

// Runs in either the top document or the stock iframe, using that window's width.
function measureOverflow() {
  return Array.from(document.querySelectorAll('*')).filter(element => {
    const r = element.getBoundingClientRect(), style = getComputedStyle(element);
    if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.top >= innerHeight || style.visibility === 'hidden' || style.display === 'none' || r.right <= innerWidth + 1) return false;
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (['auto', 'scroll', 'hidden'].includes(getComputedStyle(ancestor).overflowX)) return false;
    }
    return true;
  }).slice(0, 10).map(element => ({ tag: element.tagName.toLowerCase(), text: (element.textContent ?? '').trim().slice(0, 40), right: element.getBoundingClientRect().right }));
}

async function measureScroll(root: Locator, rowSelector: string) {
  return root.evaluate(async (element, selector) => {
    const visible = (el: Element) => el.getBoundingClientRect().width >= 4 && el.getBoundingClientRect().height >= 4;
    const candidates = Array.from(element.querySelectorAll(selector)).filter(visible);
    const last = candidates.at(-1);
    if (!last) {
      const panes = [element, ...Array.from(element.querySelectorAll('*'))].filter(el => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY));
      return { canScroll: panes.some(el => el.scrollHeight > el.clientHeight), lastVisible: null, reason: 'No rendered row or card' };
    }
    // Use this document's own scrolling element (including inside Stock's iframe).
    // Only the nearest overflowing pane owns this list; scrolling every ancestor
    // can move an inner list out of view while measuring it.
    let container: HTMLElement | undefined;
    for (let el = last.parentElement; el; el = el.parentElement) {
      if (['auto', 'scroll'].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) {
        container = el;
        break;
      }
    }
    container ??= document.scrollingElement as HTMLElement;
    const containers = [container];
    const original = containers.map(el => el.scrollTop);
    const originalBehavior = container.style.scrollBehavior;
    container.style.scrollBehavior = 'auto';
    const canScroll = containers.some(el => el.scrollHeight > el.clientHeight);
    containers.forEach(el => { el.scrollTop = el.scrollHeight; });
    await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    const r = last.getBoundingClientRect();
    // A tall card can be visible without fitting wholly in the viewport. Record
    // full visibility separately so that distinction remains reviewable.
    const box = container === document.scrollingElement
      ? { top: 0, bottom: innerHeight } : container.getBoundingClientRect();
    const top = Math.max(0, box.top), bottom = Math.min(innerHeight, box.bottom);
    const lastVisible = r.bottom > top && r.top < bottom;
    const lastFullyVisible = r.top >= top - 1 && r.bottom <= bottom + 1;
    const result = { canScroll, lastVisible, lastFullyVisible, lastText: (last.textContent ?? '').trim().slice(0, 80),
      containers: containers.map(el => ({ tag: el.tagName, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop })) };
    containers.forEach((el, i) => { el.scrollTop = original[i]; });
    container.style.scrollBehavior = originalBehavior;
    return result;
  }, rowSelector);
}

test.describe('Screen fit audit @audit', () => {
  test('all main screens in the real frame', async ({ browser }, info) => {
    test.skip(info.project.name !== 'pricing-desktop', 'Audit sets its own viewports');
    test.setTimeout(600000);
    const report: Record<string, unknown>[] = [];
    mkdirSync(resolve('work'), { recursive: true });
    mkdirSync(resolve('test-results/screen-fit'), { recursive: true });
    for (const viewport of viewports) for (const surface of surfaces) {
      const context = await browser.newContext({ viewport, baseURL: String(info.project.use.baseURL), serviceWorkers: 'block' });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const screenshot = `test-results/screen-fit/${surface}-${viewport.width}x${viewport.height}.png`;
      const entry: Record<string, unknown> = { surface, viewport, screenshot };
      const unmocked: string[] = [];
      try {
        const origin = new URL(String(info.project.use.baseURL)).origin;
        await context.route('**/*', route => {
          const url = new URL(route.request().url());
          if (url.origin !== origin || url.pathname.startsWith('/api/')) {
            unmocked.push(url.pathname + url.search);
            return route.abort();
          }
          return route.continue();
        });
        await setupFrame(page);
        for (const setup of [setupToday, setupStock, setupOrders, setupPurchase, setupAccounts, setupPricing, setupEconomics, setupGrowth]) await setup(page);
        await page.goto('/?view=staff-frame&role=administrator&roles=administrator&growthPeriod=rolling12');
        const nav = page.getByRole('navigation', { name: 'Application sections', exact: true }).filter({ visible: true });
        const label = surface === 'requests' ? 'purchase' : surface;
        let button = nav.getByRole('button', { name: new RegExp(`^${label}$`, 'i') });
        // Administrators land on Today; use that landing screen without remounting it.
        if (surface !== 'today' && !await button.isVisible()) {
          await nav.getByRole('button', { name: 'More', exact: true }).click();
          button = nav.getByRole('button', { name: new RegExp(`^${surface}$`, 'i') });
        }
        if (surface !== 'today') await button.click();
        const content = page.locator('main > section');
        const ready: Record<typeof surfaces[number], Locator> = {
          today: content.getByRole('article').first(), stock: page.frameLocator('iframe').locator('#groupCards summary').first(),
          orders: content.getByRole('button', { name: /^SF-AUDIT-/ }).first(), requests: content.locator('details[data-request-group] summary').first(),
          accounts: content.getByRole('list', { name: 'Accounts', exact: true }).getByRole('listitem').first(),
          pricing: content.getByRole('region', { name: 'Order prices waiting for approval' }).getByRole('article').first(),
          economics: content.getByRole('region', { name: 'Economic targets' }).getByRole('article').first(),
          growth: content.getByRole('navigation', { name: 'Growth sections', exact: true }).or(content.getByRole('tablist', { name: 'Growth analysis', exact: true })),
        };
        await expect(ready[surface]).toBeVisible({ timeout: 15000 });
        if (surface === 'today') {
          await expect(content.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
          await expect(content.getByRole('region', { name: 'Unblock today', exact: true }).getByRole('article')).toHaveCount(5);
          await expect(content.getByRole('region', { name: 'Grow', exact: true }).getByRole('article')).toHaveCount(5);
        }
        if (surface === 'accounts') {
          // Include the lazy optional cards before taking measurements/screenshots.
          await expect(content.locator('summary').filter({ hasText: /^Data checks/ }).first()).toBeVisible();
          await expect(content.getByRole('region', { name: 'Data and speed', exact: true })).toBeVisible();
        }
        const dimensions = await page.evaluate(() => ({ width: document.scrollingElement!.scrollWidth, height: document.scrollingElement!.scrollHeight, innerWidth, innerHeight }));
        const header = await page.locator('main > header').boundingBox();
        const hardChecks = { documentHorizontal: dimensions.width <= dimensions.innerWidth + 1,
          documentVertical: dimensions.height <= dimensions.innerHeight + 1,
          headerInsideViewport: !!header && header.x >= 0 && header.y >= 0 && header.x + header.width <= viewport.width + 1 && header.y + header.height <= viewport.height + 1,
          navigationVisible: await nav.isVisible() };
        entry.hardChecks = hardChecks;
        entry.document = dimensions;
        for (const [check, passed] of Object.entries(hardChecks)) expect.soft(passed, `${surface} ${viewport.width}x${viewport.height}: ${check}`).toBe(true);
        entry.overflow = await page.evaluate(measureOverflow);
        if (surface === 'stock') {
          const frame = page.frames().find(frame => frame.url().endsWith('/stockflow.html'))!;
          entry.iframeOverflow = await frame.evaluate(measureOverflow);
          entry.scroll = await measureScroll(page.frameLocator('iframe').locator('body'), '#groupCards details > summary');
        } else {
          entry.scroll = await measureScroll(content, surface === 'orders' ? 'button[aria-label^="SF-AUDIT-"]'
            : surface === 'pricing' ? '[aria-label="Order prices waiting for approval"] > div > article'
            : surface === 'growth' ? '[aria-label="Growth sections"] button, [data-growth-scroller] section[aria-labelledby]'
            : 'article, [role="listitem"], tbody tr, details[data-request-group]');
        }
        if (unmocked.length) throw new Error(`Unmocked requests: ${unmocked.join(', ')}`);
      } catch (error) {
        entry.loadError = error instanceof Error ? error.message : String(error);
        expect.soft(entry.loadError, `${surface} ${viewport.width}x${viewport.height} failed to load`).toBeUndefined();
      } finally {
        try { await page.screenshot({ path: screenshot, fullPage: false }); }
        catch (error) { entry.screenshotError = String(error); expect.soft(false, `Screenshot ${screenshot}: ${error}`).toBe(true); }
        entry.unmockedRequests = unmocked;
        report.push(entry);
        writeFileSync(resolve('work/screen-fit-report.json'), JSON.stringify(report, null, 2));
        await context.close();
      }
    }
  });
});
