import { expect, test, type Page } from '@playwright/test';

const product = { companyId: 'company', productId: 'reagent-guid', productName: 'Reagent with a long descriptive product name that wraps on a phone', lastDate: '2026-07-23' };
const target = {
  id: 'target-1', kind: 'placement', name: 'Analyzer', companyId: 'company', customerId: 'customer-1', customerName: 'Laboratory',
  customerSourceId: 'customer-guid', siteId: 'site-1', modelId: 'model-1', installationId: 'installation-1', effectiveFrom: '2025-01-01', effectiveTo: null,
  approval: 'approved', version: 2, capitalPaise: '120000000', revenuePaise: '8500000', knownGpPaise: '2300000', missingCostLines: 0, attributedLines: 12,
  recoveryPaise: '23000000', outstandingPaise: '97000000', health: 'healthy', forecastMonths: 42.2, expectation: null,
};
const workspace = {
  actorEmail: 'manager@example.com', businessDate: '2026-10-09', targets: [target], mappings: [], exceptions: [], leakage: [], cases: [],
  installations: [], customers: [], canManage: true, canApprove: false, canAct: true, generation: 'run-1', lastRebuiltAt: null,
  sourceImportedAt: null, sourceLineCount: 0, unattributedPaise: '0', reportingFrom: '2026-09-01', reportingTo: '2026-10-01',
  policy: { attractiveMonths: 24, reviewMonths: 36, exceptionMonths: 48, forecastWindowMonths: 3, watchRevenuePercent: 80, criticalRevenuePercent: 50 },
};

async function openAction(page: Page, action: string, posts: Record<string, unknown>[]) {
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: workspace });
    posts.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/?view=instrument-economics');
  await page.getByRole('navigation', { name: 'Economics sections' }).getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.getByRole('navigation', { name: 'Advanced sections' }).getByRole('button', { name: 'All actions', exact: true }).click();
  await page.getByLabel('Action', { exact: true }).selectOption(action);
}

for (const width of [375, 1280]) {
  test(`product picker searches and submits the canonical ID at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    const requests: URLSearchParams[] = [];
    const posts: Record<string, unknown>[] = [];
    await page.route('**/api/instrument-economics/products**', route => {
      const params = new URL(route.request().url()).searchParams;
      requests.push(params);
      return route.fulfill({ json: { rows: [product, { ...product, companyId: 'other-company' }], total: 2, limit: 50, offset: 0, companies: ['company', 'other-company'] } });
    });
    await openAction(page, 'record_observation', posts);
    expect(requests).toHaveLength(0);
    const picker = page.getByRole('combobox', { name: 'Canonical reagent product', exact: true });
    await picker.fill('reagent words');
    await expect.poll(() => requests.some(params => params.get('q') === 'reagent words')).toBe(true);
    expect(requests.find(params => params.get('q') === 'reagent words')?.has('companyId')).toBe(false);
    await expect(page.getByRole('option')).toHaveCount(1);
    await page.getByRole('option', { name: /Reagent with a long/ }).click();
    await expect(page.locator('input[name="productId"]')).toHaveValue(product.productId);
    const form = picker.locator('xpath=ancestor::form');
    await page.getByLabel('Economic target', { exact: true }).selectOption(target.id);
    await page.getByLabel('Base unit', { exact: true }).fill('pack');
    await page.getByLabel('Observation period starts').fill('2026-09-01');
    await page.getByLabel('Observation period ends (exclusive)').fill('2026-10-01');
    await page.getByLabel('Tests completed').fill('100');
    await page.getByLabel('Tests per reagent unit').fill('10');
    await page.getByLabel('Evidence reference', { exact: true }).fill('Verified usage');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await form.getByRole('button', { name: 'Record consumption observation', exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ action: 'record_observation', payload: { productId: product.productId } });
  });

  test(`allocation datalist waits for two characters at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    const queries: string[] = [];
    await page.route('**/api/instrument-economics/products**', route => {
      queries.push(new URL(route.request().url()).searchParams.get('q') ?? '');
      return route.fulfill({ json: { rows: [product], total: 1, limit: 50, offset: 0, companies: ['company'] } });
    });
    await openAction(page, 'set_allocation', []);
    const input = page.getByLabel('Tally product GUID', { exact: true });
    await input.fill('r');
    await page.waitForTimeout(350);
    expect(queries).toHaveLength(0);
    await input.fill('re');
    await expect.poll(() => queries.includes('re')).toBe(true);
    await expect(page.locator('#economic-product-options option')).toHaveAttribute('value', product.productId);
    await input.fill('verified-unlisted-id');
    await expect(input).toHaveValue('verified-unlisted-id');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`product picker retries below the field at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    let calls = 0;
    await page.route('**/api/instrument-economics/products**', route => {
      if (++calls === 1) return route.fulfill({ status: 502, json: { error: 'Unavailable' } });
      return route.fulfill({ json: { rows: [product], total: 1, limit: 50, offset: 0, companies: ['company'] } });
    });
    await openAction(page, 'record_observation', []);
    await page.getByRole('combobox', { name: 'Canonical reagent product', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Could not load products.');
    await expect(page.getByRole('listbox').getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('option', { name: /Reagent with a long/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
