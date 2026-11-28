import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/instrument-economics/cost-review**', route => route.fulfill({ json: { sales: [], salesTotal: 0, purchases: [], purchasesTotal: 0 } }));
  await page.route('**/api/instrument-economics/line-refs**', route => route.fulfill({ json: { rows: [], total: 0, limit: 5000 } }));
});

const target = { id: 'summary-target', name: 'SYS 240', customerName: 'Summary laboratory', companyId: 'company', customerId: 'customer', customerSourceId: 'customer-guid', siteId: 'site', modelId: 'model', kind: 'placement', installationId: null,
  effectiveFrom: '2026-07-23', salesFrom: '2026-07-23', effectiveTo: null, approval: 'approved', version: 1, capitalPaise: '62500000', instrumentBillingPaise: '40000000', netInvestmentPaise: '22500000', revenuePaise: '10000', knownGpPaise: '6000', missingCostLines: 1, attributedLines: 2, recoveryPaise: '40006000', outstandingPaise: '22494000', health: 'data_incomplete', forecastMonths: null, expectation: null,
  reagentLifetime: { salesPaise: '20000', knownGpPaise: '12000', lines: 3, missingCostLines: 1 } };
const summary = { actorEmail: 'manager@test.local', readView: 'summary', todoCount: 2, targets: [target], mappings: [], exceptions: [], leakage: [], cases: [], sourceLines: [], attributionLines: [], installations: [], customers: [], canManage: true, canApprove: true, canAct: true, generation: 'run-1', lastRebuiltAt: null, sourceImportedAt: null, sourceLineCount: 840, unattributedPaise: '0', businessDate: '2026-10-13', reportingFrom: '2026-09-01', reportingTo: '2026-10-01', policy: { attractiveMonths: 24, reviewMonths: 36, exceptionMonths: 48, forecastWindowMonths: 3, watchRevenuePercent: 80, criticalRevenuePercent: 50 } };

const lines = Array.from({ length: 51 }, (_, index) => ({
  id: `source-${index}`, companyId: 'company', voucherId: `voucher-${index}`, revision: '1', lineKey: '1', date: '2026-10-10',
  kind: 'sale', customerSourceId: 'customer-guid', productId: `product-${index}`, productName: `Evidence item ${index + 1}`,
  quantity: '1', unit: 'kit', netSalesPaise: '10000', batchId: null,
}));
const problem = { sourceId: 'import-42', productId: '', date: '2026-10-10', netSalesPaise: '0', status: 'import_rejected', reason: 'Missing customer', voucherNumber: 'IMPORT-42', voucherType: 'Sales', voucherDate: '2026-10-10' };
for (const [device, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 1000 }]] as const) {
  test.describe(device, () => {
    test.use({ viewport });
    test('rapid Add reagents taps share the delayed detail read and show loading', async ({ page }) => {
      let detailRequests = 0;
      await page.route('**/api/instrument-economics', async route => {
        const view = route.request().headers()['x-stockflow-economics-view'];
        expect(view).not.toBe('full');
        if (view === 'summary') return route.fulfill({ json: summary });
        detailRequests++;
        await new Promise(resolve => setTimeout(resolve, 2000));
        await route.fulfill({ json: { ...summary, readView: 'detail' } });
      });
      await page.goto('/?view=instrument-economics');
      const add = page.getByRole('button', { name: /^Add reagents/ });
      await add.evaluate(button => { for (let i = 0; i < 3; i++) (button as HTMLButtonElement).click(); });
      await expect(add).toBeDisabled();
      await expect(add).toHaveAttribute('aria-busy', 'true');
      await expect(add).toContainText('Loading…');
      await expect.poll(() => detailRequests).toBe(1);
      await expect(page.getByRole('form', { name: 'Add group with items' })).toBeVisible();
      await expect(add).toBeEnabled();
      await expect(add).toHaveAttribute('aria-busy', 'false');
      expect(detailRequests).toBe(1);
    });
    test('Add reagents shows its open state and closes only on Hide reagents', async ({ page }) => {
      let detailRequests = 0;
      await page.route('**/api/instrument-economics', async route => {
        const view = route.request().headers()['x-stockflow-economics-view'];
        expect(view).not.toBe('full');
        if (view === 'summary') return route.fulfill({ json: summary });
        detailRequests++;
        await route.fulfill({ json: { ...summary, readView: 'detail' } });
      });
      await page.goto('/?view=instrument-economics');
      const add = page.getByRole('button', { name: /^Add reagents/ });
      await add.click();
      await expect(page.getByRole('form', { name: 'Add group with items' })).toBeVisible();
      const hide = page.getByRole('button', { name: /^Hide reagents/ });
      await expect(hide).toHaveAttribute('aria-expanded', 'true');
      await hide.click();
      await expect(page.getByRole('form', { name: 'Add group with items' })).toBeHidden();
      const closed = page.getByRole('button', { name: /^Add reagents/ });
      await expect(closed).toHaveAttribute('aria-expanded', 'false');
      expect(detailRequests).toBe(1);
    });
    test('failed Add reagents read has an inline alert and Retry opens the form', async ({ page }) => {
      let detailRequests = 0;
      await page.route('**/api/instrument-economics', async route => {
        const view = route.request().headers()['x-stockflow-economics-view'];
        expect(view).not.toBe('full');
        if (view === 'summary') return route.fulfill({ json: summary });
        detailRequests++;
        if (detailRequests === 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          return route.fulfill({ status: 502, json: { error: 'Detail unavailable' } });
        }
        return route.fulfill({ json: { ...summary, readView: 'detail' } });
      });
      await page.goto('/?view=instrument-economics');
      const card = page.getByRole('article').filter({ has: page.getByRole('button', { name: /^Add reagents/ }) });
      await card.getByRole('button', { name: /^Add reagents/ }).click();
      await expect(card.getByRole('alert')).toContainText("Couldn't load the instrument details.");
      const retry = card.getByRole('button', { name: 'Retry loading instrument details', exact: true });
      await expect(retry).toHaveText('Retry');
      await retry.click();
      await expect(card.getByRole('form', { name: 'Add group with items' })).toBeVisible();
      await expect(card.getByRole('alert')).toHaveCount(0);
      expect(detailRequests).toBe(2);
    });
    test('all actions, import review and paged evidence never request full', async ({ page }) => {
      const views: string[] = [];
      const offsets: number[] = [];
      const exceptionLimits: number[] = [];
      page.on('request', request => {
        const view = request.headers()['x-stockflow-economics-view'];
        if (view) views.push(view);
      });
      await page.route('**/api/instrument-economics', route => {
        const view = route.request().headers()['x-stockflow-economics-view'];
        return route.fulfill({ json: view === 'summary' ? summary : { ...summary, readView: 'detail', generation: 'detail-run' } });
      });
      await page.route('**/api/instrument-economics/exceptions**', route => {
        const params = new URL(route.request().url()).searchParams;
        const limit = Number(params.get('limit')); exceptionLimits.push(limit);
        expect(params.get('status')).toBe('import_rejected');
        return route.fulfill({ json: { rows: [problem], groups: [], total: 1, limit, offset: 0 } });
      });
      await page.route('**/api/instrument-economics/lines**', route => {
        const params = new URL(route.request().url()).searchParams;
        const limit = Number(params.get('limit')); const offset = Number(params.get('offset'));
        offsets.push(offset);
        expect(limit).toBe(50);
        return route.fulfill({ json: { rows: lines.slice(offset, offset + limit), total: lines.length, limit, offset } });
      });
      await page.goto('/?view=instrument-economics');
      await expect(page.getByRole('region', { name: 'Economic targets' })).toBeVisible();
      await page.getByRole('button', { name: /^To do/ }).click();
      await page.getByRole('button', { name: 'Accounts review (1)', exact: true }).click();
      await page.getByText('Show document details (1)', { exact: true }).click();
      await expect(page.getByText('Sales invoice IMPORT-42', { exact: false })).toBeVisible();
      expect(exceptionLimits).toEqual([1, 200]);
      await page.getByRole('button', { name: 'Advanced', exact: true }).click();
      await page.getByRole('button', { name: 'Exceptions', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Attribution and cost exceptions' })).toBeVisible();
      await page.getByRole('button', { name: 'All actions', exact: true }).click();
      await expect(page.getByLabel('Action', { exact: true })).toBeVisible();
      // Re-enter Advanced while All actions is selected, covering both tab open paths.
      await page.getByRole('button', { name: 'Instruments', exact: true }).click();
      await page.getByRole('button', { name: 'Advanced', exact: true }).click();
      await expect(page.getByLabel('Action', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Reports', exact: true }).click();
      expect(offsets).toEqual([]);
      const evidence = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Current source line evidence' }) });
      await evidence.locator('summary').click();
      await expect(evidence.locator('summary')).toHaveText('Current source line evidence (51)');
      await expect(evidence.locator('li')).toHaveCount(50);
      await evidence.getByRole('button', { name: 'Show more', exact: true }).click();
      await expect(evidence.locator('li')).toHaveCount(51);
      await expect(evidence.getByText('Evidence item 51 (product-50)', { exact: false })).toBeVisible();
      await expect(evidence.getByRole('button', { name: 'Show more', exact: true })).toHaveCount(0);
      expect(offsets).toEqual([0, 50]);
      expect(views).toEqual(['summary', 'detail']);
      expect(views).not.toContain('full');
    });
  });
}
