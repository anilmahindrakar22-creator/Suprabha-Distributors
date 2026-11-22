import { expect, test, type Page } from '@playwright/test';
import { openGrowthArea } from './growth-helpers';

const measures = { revenuePaise: 100000, repeatPaise: 100000, bulkPaise: 0, bulkInvoices: 0, labsBuying: 1, buyingMonths: 12, perBuyingMonthPaise: 8333 };
const summary = {
  companyCount: 1, confirmed: true, confirmedReason: null,
  window: { from: '2025-11-01', to: '2026-11-01', h1From: '2025-11-01', h2From: '2026-05-01' },
  scorecard: { regularLabs: 1, regularPct: 100, top10Pct: 100 },
  months: Array.from({ length: 12 }, (_, i) => ({ month: new Date(Date.UTC(2025, 10 + i, 1)).toISOString().slice(0, 7), labsBuying: 1, firstTime: 0, skippedRegulars: 0, salesPaise: 100000, purchasesRegularPaise: 100000, purchasesLargePaise: 0, largePurchaseInvoices: 0 })),
  tree: measures, halves: [{ ...measures, half: 'H1' }, { ...measures, half: 'H2' }],
  bridge: { h1Paise: 100000, h2Paise: 100000, ...Object.fromEntries(['new', 'stopped', 'stoppedRegular', 'grew', 'fell', 'same', 'other'].map(key => [key, { labs: 0, paise: 0 }])) },
  health: { gp: { costedPct: 100, computedAt: null }, history: { firstSaleOn: '2025-11-01', monthsImported: 12 }, itemGroups: { unmappedPct: 0 }, reasons: { visitReasons180: 0, constraints: 0, openActions: 0, visits180: 0 }, catalog: { observedAt: null, groups: 1 } },
};
const levers = { priceSpread: { items: 1, pairs: 1, paise: 10000 }, lowMargin: { items: 0, paiseToThreshold: 0, examples: [] }, freeGoods: { lines: 0, costPaise: 0 }, instrumentsGpPaise: 0 };
const tallyKey = '\u0004 Reagent';
const priceRow = {
  customerId: 'lab-1', customerName: 'Lab One', tallyKey, itemName: 'Reagent', currentDecisionId: null, evidenceHash: 'price-book-evidence',
  currentPrice: 80, currentPriceSource: 'LAST_TALLY_INVOICE', riskStatus: 'GREEN', pricingDate: '2026-11-09', fixed: false,
  lastRate: 80, lastInvoiceDate: null, lastInvoiceReference: null, historicCost: null, currentCost: null, costChange: null,
  continuity: 80, target: null, recommended: 80, continuityGP: null, continuityMargin: null, recommendedGP: null, recommendedMargin: null,
  differenceToCustomer: 0, additionalGP: null, status: 'REVIEW', warnings: [],
};

async function mockPriceBook(page: Page, posts: unknown[], row: Omit<typeof priceRow, 'target'> & { target: number | null } = priceRow, additionalRows: typeof row[] = []) {
  await page.route('**/api/me', route => route.fulfill({ json: { roles: ['management'] } }));
  await page.route('**/api/push-subscription**', route => route.fulfill({ json: { enabled: false, publicKey: '' } }));
  await page.route('**/api/today**', route => route.fulfill({ json: { policyVersion: 'today-v1', generatedAt: '2026-11-09T06:00:00Z', coverageCertified: true, unblock: { total: 0, rows: [] }, grow: { total: 0, rows: [] } } }));
  await page.route('**/api/orders?customers=1', route => route.fulfill({ json: { customerVersion: 'review-test', customers: [{ id: row.customerId, name: row.customerName }] } }));
  await page.route('**/api/pricing**', route => {
    if (route.request().method() === 'POST') { posts.push(route.request().postDataJSON()); return route.fulfill({ json: { applied: 1 } }); }
    const params = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: params.has('book') ? { rows: [row, ...additionalRows], offset: 0, hasMore: false, bulkEligibleKeys: [] } : params.has('contracts') ? { contracts: [] } : params.has('policies') ? { policies: [] } : { rows: [], total: 0 } });
  });
}

test('Growth Review prices opens a focused proposal and waits for the person to submit', async ({ page }) => {
  const posts: unknown[] = [];
  await mockPriceBook(page, posts);
  await page.route('**/api/growth', route => route.fulfill({ json: summary }));
  await page.route('**/api/growth/inbox**', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await page.route('**/api/growth/margin?**', route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.has('itemKey')) return route.fulfill({ json: {
      kind: 'item', itemKey: 'item-1', name: 'Reagent', typicalPricePaise: 10000, labs: 3, marginPct: 20, tallyItemKey: tallyKey, page: 1, pageSize: 20, total: 1,
      rows: [{ labKey: 'ledger-1', customerId: 'lab-1', name: 'Lab One', town: null, unitPricePaise: 8000, quantity: 10, salesPaise: 80000, belowTypical: true, packDifference: false, approvedPricePaise: null }],
    } });
    const view = params.get('view') ?? 'labs';
    return route.fulfill({ json: { view, sort: params.get('sort') ?? 'sales', filter: params.get('filter') ?? 'all', q: null, page: 1, pageSize: 20, total: view === 'items' ? 1 : 0, thresholdPct: 14, consumablesMarginPct: 20, levers,
      rows: view === 'items' ? [{ itemKey: 'item-1', name: 'Reagent', salesPaise: 100000, knownSalesPaise: 100000, gpPaise: 20000, marginPct: 20, low: false, labs: 3, priceLowPaise: 8000, typicalPricePaise: 10000, priceHighPaise: 11000, spreadPaise: 10000, belowCost: false }] : [],
    } });
  });
  await page.goto('/?view=frame&role=management&roles=management');
  const growth = page.getByRole('button', { name: /^growth$/i });
  if (!await growth.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await growth.click();
  await openGrowthArea(page, 'profit');
  await page.getByRole('tab', { name: 'Items', exact: true }).click();
  await page.getByRole('button', { name: 'Reagent: open labs and prices', exact: true }).click();
  await page.getByRole('button', { name: 'Review prices', exact: true }).click();
  const row = page.getByRole('article', { name: 'Price review for Reagent', exact: true });
  await expect(row).toBeFocused();
  await expect(row.getByLabel('Custom rate', { exact: true })).toHaveValue('100');
  const reason = row.getByLabel('Decision note', { exact: false });
  await expect(reason).toHaveValue(/Growth review:/);
  await expect(row).toContainText('From Growth:');
  await expect(row).toContainText('Proposing a price needs approval as usual; approved prices apply to new orders for this lab.');
  expect(posts).toHaveLength(0);
  await row.getByLabel('Custom rate', { exact: true }).fill('101');
  await reason.fill('Reviewed selling price');
  // The existing submit button is labelled Approve custom in this price book.
  await row.getByRole('button', { name: 'Approve custom', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ action: 'apply_price_book', payload: { customerId: 'lab-1', expectedDecisionId: null, tallyKey, evidenceHash: 'price-book-evidence', choice: 'custom', price: 101, reason: 'Reviewed selling price', idempotencyKey: expect.any(String) } });
});

async function openPriceBook(page: Page) {
  await page.goto('/?view=frame&role=management&roles=management');
  const pricing = page.getByRole('button', { name: /^pricing$/i });
  if (!await pricing.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await pricing.click();
  await page.getByRole('button', { name: 'Customer prices', exact: true }).click();
  await page.getByLabel('Select customer', { exact: true }).fill('Lab One');
  await page.getByRole('button', { name: 'Lab One', exact: true }).click();
}

async function openPriceReview(page: Page) {
  await openPriceBook(page);
  await page.getByRole('button', { name: 'Review item', exact: true }).click();
  return page.getByRole('article', { name: 'Price review for Reagent', exact: true });
}

test('price review compares the lab with Target and a live Proposed rate', async ({ page }) => {
  await mockPriceBook(page, [], { ...priceRow, customerId: 'customer-a', target: 2400, recommended: 2300 });
  const comparisonRequests: string[] = [];
  await page.route('**/api/growth/margin?tallyItemKey=**', route => {
    comparisonRequests.push(route.request().url());
    return route.fulfill({ json: {
      kind: 'item', itemKey: 'item-1', name: 'Reagent', typicalPricePaise: 250000, labs: 4, marginPct: null, tallyItemKey: tallyKey, pricePolicy: null, page: 1, pageSize: 20, total: 4,
      rows: [230000, 240000, 250000, 260000].map((unitPricePaise, index) => ({
        labKey: `ledger-${index}`, customerId: index === 0 ? 'customer-a' : `customer-${index}`, name: index === 0 ? 'Lab One' : `Lab ${index}`, town: null,
        unitPricePaise, quantity: 10, salesPaise: unitPricePaise * 10, belowTypical: false, packDifference: false, approvedPricePaise: null,
        liftToPricePaise: null, minimumPricePaise: null, belowMinimum: null, belowTarget: null,
      })),
    } });
  });
  const article = await openPriceReview(page);
  await article.getByRole('button', { name: 'Compare with other labs', exact: true }).click();
  await expect(article.getByRole('heading', { name: "Where this lab's price sits", exact: true })).toBeVisible();
  const strip = article.locator('[data-price-strip]');
  await expect(strip).toContainText('Target ₹2,400');
  await expect(strip).toContainText('Proposed ₹2,300');
  await expect(strip).toContainText('Lower ₹2,250');
  await expect(strip).toContainText('Upper ₹2,750');
  const viewport = page.viewportSize();
  if (viewport && viewport.width < 640) {
    const bounds = await article.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
    const dots = strip.locator('[data-price-dot]');
    await expect(dots).toHaveCount(4);
    for (const dot of await dots.all()) {
      await expect(dot).toBeVisible();
      await expect(dot).toBeInViewport();
    }
  }
  const highlighted = strip.locator('[data-price-dot][aria-label*="(this lab)"]');
  await expect(highlighted).toHaveAttribute('aria-label', /Lab One:.*\(this lab\)/);
  await expect(highlighted.locator('circle[r="7"]')).toHaveAttribute('stroke', 'var(--color-sf-strong)');
  await expect(highlighted.locator('circle[r="7"]')).toHaveAttribute('stroke-width', '2');
  await article.getByLabel('Custom rate', { exact: true }).fill('2600');
  await expect(strip).toContainText('Proposed ₹2,600');
  expect(comparisonRequests).toHaveLength(1);
  const params = new URL(comparisonRequests[0]).searchParams;
  expect(params.get('tallyItemKey')).toBe(tallyKey);
  expect(params.get('page')).toBe('1');
});

test('price review quietly handles missing Growth prices', async ({ page }) => {
  await mockPriceBook(page, [], { ...priceRow, customerId: 'customer-a', target: 2400, recommended: 2300 });
  await page.route('**/api/growth/margin?tallyItemKey=**', route => route.fulfill({ status: 404, json: { error: 'No Growth prices for this item yet.' } }));
  const article = await openPriceReview(page);
  await article.getByRole('button', { name: 'Compare with other labs', exact: true }).click();
  await expect(article.getByText('No lab price comparison for this item yet.', { exact: true })).toBeVisible();
  await expect(article.locator('[data-price-strip]')).toHaveCount(0);
  await expect(article.getByRole('alert')).toHaveCount(0);
});

test('a multi-row price book loads comparisons only when requested', async ({ page }) => {
  const comparisonRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/growth/margin') comparisonRequests.push(request.url());
  });
  await mockPriceBook(page, [], priceRow, [{ ...priceRow, tallyKey: 'other-item', itemName: 'Other reagent' }]);
  await page.route('**/api/growth/margin?**', route => route.fulfill({ status: 404, json: { error: 'No Growth prices for this item yet.' } }));
  await openPriceBook(page);
  await page.getByRole('button', { name: 'Browse all products', exact: true }).click();
  const articles = page.getByRole('article', { name: /^Price review for / });
  await expect(articles).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Compare with other labs', exact: true })).toHaveCount(2);
  expect(comparisonRequests).toHaveLength(0);
  const article = page.getByRole('article', { name: 'Price review for Reagent', exact: true });
  await article.getByRole('button', { name: 'Compare with other labs', exact: true }).click();
  await expect(article.getByText('No lab price comparison for this item yet.', { exact: true })).toBeVisible();
  expect(comparisonRequests).toHaveLength(1);
  await article.getByLabel('Custom rate', { exact: true }).fill('2600');
  await expect(article.getByRole('button', { name: 'Compare with other labs', exact: true })).toHaveCount(0);
  expect(comparisonRequests).toHaveLength(1);
  await expect(page.getByRole('article', { name: 'Price review for Other reagent', exact: true }).getByRole('button', { name: 'Compare with other labs', exact: true })).toBeVisible();
});
