import { expect, test, type Page } from '@playwright/test';
import type { EconomicsWorkspaceData } from '../../lib/instrument-economics-types';

type Line = NonNullable<EconomicsWorkspaceData['sourceLines']>[number];
const target = {
  id: 'cost-target', name: 'Review analyzer', customerName: 'Review laboratory', companyId: 'company', customerId: 'customer', customerSourceId: 'customer-guid', siteId: 'site', modelId: 'model', kind: 'placement' as const, installationId: null,
  effectiveFrom: '2026-01-01', effectiveTo: null, approval: 'approved' as const, version: 1, capitalPaise: '1000000', revenuePaise: '50000', knownGpPaise: '0', missingCostLines: 2, attributedLines: 2, recoveryPaise: '0', outstandingPaise: '1000000', health: 'data_incomplete' as const, forecastMonths: null, expectation: null,
};
const sale: Line = { id: 'missing-sale', companyId: 'company', voucherId: 'missing-voucher-id', voucherNumber: 'SALE/0042', revision: '1', lineKey: '2', date: '2026-09-10', kind: 'sale', customerSourceId: 'customer-guid', productId: 'missing-product', productName: 'Reagent without purchase', quantity: '2', unit: 'kit', netSalesPaise: '20000', batchId: null };
const batchSale: Line = { ...sale, id: 'batch-sale', productId: 'batch-product', productName: 'Batch reviewed reagent', voucherId: 'batch-voucher-id', voucherNumber: 'SALE/0043', quantity: '10', batchId: 'BATCH-A' };
const matchingPurchase: Line = { ...batchSale, id: 'matching-purchase', kind: 'purchase', customerSourceId: null, voucherId: 'purchase-id', voucherNumber: 'PUR/0010', date: '2026-09-01', netSalesPaise: '10000' };
const otherBatchPurchase: Line = { ...matchingPurchase, id: 'other-batch-purchase', voucherNumber: 'PUR/OTHER', batchId: 'BATCH-B' };
const attribution = (line: Line, targetId: string | null = target.id) => ({ id: `result-${line.id}`, sourceLineId: line.id, targetId, status: targetId ? 'cost_unavailable' : 'unattributed', reason: targetId ? 'Historical purchase linkage unavailable' : 'no_verified_compatible_placement', shareBasisPoints: 10000, quantity: line.quantity, revenuePaise: line.netSalesPaise, costPaise: null, gpPaise: null, date: line.date, voucherId: line.voucherId, revision: line.revision, productId: line.productId, productName: line.productName ?? line.productId, unit: line.unit, costEvidence: null });
const workspace: EconomicsWorkspaceData = {
  actorEmail: 'accounts@test.local', businessDate: '2026-10-13', todoCount: 2, targets: [target], mappings: [{ id: 'seed-mapping', companyId: target.companyId, modelId: target.modelId, productId: 'seed', targetId: target.id, effect: 'include', effectiveFrom: target.effectiveFrom, effectiveTo: null, reason: 'Existing related reagent' }], exceptions: [], leakage: [], cases: [],
  // None of these consumers may depend on workspace source lines.
  sourceLines: [], attributionLines: [attribution(sale), attribution(batchSale), attribution({ ...sale, id: 'related-customer-line', productId: 'related', productName: 'Related customer reagent' }, null), attribution({ ...sale, id: 'foreign-customer-line', productId: 'foreign', productName: 'Other customer reagent' }, null)],
  itemGroupCatalogs: [{ id: 'catalog', companyId: 'company', sourceVersion: '1', observedAt: '2026-10-13T00:00:00Z', current: true, groups: [{ id: 'family', name: 'Related family', parentId: null, itemCount: 3 }], products: [{ id: 'seed', name: 'Existing reagent', groupId: 'family', unit: 'kit' }, { id: 'related', name: 'Related customer reagent', groupId: 'family', unit: 'kit' }, { id: 'foreign', name: 'Other customer reagent', groupId: 'family', unit: 'kit' }] }],
  installations: [], customers: [], canManage: true, canApprove: true, canAct: true, generation: 'cost-review-browser', lastRebuiltAt: null, sourceImportedAt: null, sourceLineCount: 1000, unattributedPaise: '0', reportingFrom: '2026-09-01', reportingTo: '2026-10-01', policy: { attractiveMonths: 24, reviewMonths: 36, exceptionMonths: 48, forecastWindowMonths: 3, watchRevenuePercent: 80, criticalRevenuePercent: 50 },
};

async function mockReads(page: Page, failFirst = false) {
  const posts: { action: string; payload: Record<string, unknown> }[] = [];
  let costRequests = 0;
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: workspace });
    posts.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/instrument-economics/cost-review**', route => {
    costRequests++;
    if (failFirst && costRequests === 1) return route.fulfill({ status: 502, json: { error: 'Review unavailable' } });
    return route.fulfill({ json: { sales: [sale, batchSale], salesTotal: 2, purchases: [matchingPurchase, otherBatchPurchase], purchasesTotal: 2 } });
  });
  await page.route('**/api/instrument-economics/line-refs**', route => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('companyId')).toBe(target.companyId);
    expect(params.get('customerSourceId')).toBe(target.customerSourceId);
    return route.fulfill({ json: { rows: [{ id: sale.id, kind: 'sale', voucherNumber: 'REFS/0042' }, { id: batchSale.id, kind: 'sale', voucherNumber: null }, { id: 'related-customer-line', kind: 'sale', voucherNumber: null }], total: 3, limit: 5000 } });
  });
  await page.route('**/api/instrument-economics/products**', route => route.fulfill({ json: { rows: [], total: 0, limit: 200, offset: 0, companies: [] } }));
  await page.goto('/?view=instrument-economics');
  await expect(page.getByRole('heading', { name: 'Instrument economics', exact: true })).toBeVisible();
  return { posts, costRequests: () => costRequests };
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [375, 1280]) {
  test(`focused cost and line reads supply economics consumers at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { posts } = await mockReads(page);
    const expand = page.getByRole('button', { name: 'Sales & items', exact: true });
    if (await expand.count()) await expand.click();
    const salesTable = page.getByRole('region', { name: 'Instrument sales', exact: true });
    await expect(salesTable).toContainText('REFS/0042');
    await expect(salesTable).toContainText(batchSale.voucherId);
    const suggestions = page.getByRole('region', { name: 'Instrument items', exact: true }).getByRole('list', { name: 'Items to add', exact: true });
    await expect(suggestions).toContainText('Related customer reagent');
    await expect(suggestions).not.toContainText('Other customer reagent');
    await noHorizontalScroll(page);

    const sections = page.getByRole('navigation', { name: 'Economics sections' });
    await sections.getByRole('button', { name: /^To do/ }).click();
    const todo = page.getByRole('region', { name: 'Sales without purchase cost' });
    await expect(todo).toContainText(sale.productName!);
    await expect(todo).toContainText('Tally SALE/0042 line 2');
    await expect(todo).toContainText('No Tally purchase of this item on or before the sale date. Import the purchase or check the item.');
    await noHorizontalScroll(page);

    await sections.getByRole('button', { name: 'Advanced', exact: true }).click();
    await page.getByRole('navigation', { name: 'Advanced sections' }).getByRole('button', { name: 'All actions', exact: true }).click();
    await page.getByLabel('Action', { exact: true }).selectOption('verify_cost');
    const saleSelect = page.getByLabel('Sale needing cost', { exact: true });
    await expect(saleSelect.locator(`option[value="${sale.id}"]`)).toContainText(sale.productName!);
    await expect(saleSelect.locator(`option[value="${batchSale.id}"]`)).toContainText(batchSale.productName!);
    await saleSelect.selectOption(batchSale.id);
    const purchaseSelect = page.getByLabel('Purchase source 1', { exact: true });
    await expect(purchaseSelect.locator('option[value="matching-purchase"]')).toContainText('PUR/0010');
    await expect(purchaseSelect.locator('option[value="other-batch-purchase"]')).toHaveCount(0);
    await purchaseSelect.selectOption(matchingPurchase.id);
    await page.getByLabel('Purchase quantity 1', { exact: true }).fill('10');
    await page.getByLabel('Evidence reference', { exact: true }).fill('Accounts checked matching batch purchase');
    await noHorizontalScroll(page);
    await page.getByRole('button', { name: 'Verify sale cost', exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ action: 'verify_cost', payload: { sourceLineId: batchSale.id, purchaseAllocations: [{ purchaseLineId: matchingPurchase.id, quantity: '10' }] } });
    expect(posts[0].payload).not.toHaveProperty('costPaise');
  });

  test(`cost-review retry recovers at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const reads = await mockReads(page, true);
    await page.getByRole('navigation', { name: 'Economics sections' }).getByRole('button', { name: /^To do/ }).click();
    const todo = page.getByRole('region', { name: 'Sales without purchase cost' });
    await expect(todo.getByText('Could not load sales.', { exact: true })).toBeVisible();
    await todo.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(todo).toContainText(sale.productName!);
    await expect(todo.getByText('Could not load sales.', { exact: true })).toHaveCount(0);
    expect(reads.costRequests()).toBe(2);
    await noHorizontalScroll(page);
  });
}
