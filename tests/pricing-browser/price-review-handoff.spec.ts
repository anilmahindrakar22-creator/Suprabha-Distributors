import { expect, test } from '@playwright/test';

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

test('Growth Review prices opens a focused proposal and waits for the person to submit', async ({ page }) => {
  const posts: unknown[] = [];
  await page.route('**/api/me', route => route.fulfill({ json: { roles: ['management'] } }));
  await page.route('**/api/push-subscription**', route => route.fulfill({ json: { enabled: false, publicKey: '' } }));
  await page.route('**/api/today**', route => route.fulfill({ json: { policyVersion: 'today-v1', generatedAt: '2026-11-09T06:00:00Z', coverageCertified: true, unblock: { total: 0, rows: [] }, grow: { total: 0, rows: [] } } }));
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
  await page.route('**/api/orders?customers=1', route => route.fulfill({ json: { customerVersion: 'review-test', customers: [{ id: 'lab-1', name: 'Lab One' }] } }));
  await page.route('**/api/pricing**', route => {
    if (route.request().method() === 'POST') { posts.push(route.request().postDataJSON()); return route.fulfill({ json: { applied: 1 } }); }
    const params = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: params.has('book') ? { rows: [priceRow], offset: 0, hasMore: false, bulkEligibleKeys: [] } : params.has('contracts') ? { contracts: [] } : params.has('policies') ? { policies: [] } : { rows: [], total: 0 } });
  });
  await page.goto('/?view=frame&role=management&roles=management');
  const growth = page.getByRole('button', { name: /^growth$/i });
  if (!await growth.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await growth.click();
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
