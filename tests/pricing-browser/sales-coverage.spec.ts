import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { SalesCoverage } from '../../lib/sales-coverage';

// Contract example (work/codex-handoffs/sales-coverage-contract.md), committed as a fixture.
const example = JSON.parse(readFileSync('tests/fixtures/sales-coverage-example.json', 'utf8')) as SalesCoverage;
const workspace = {
  actorEmail: 'manager@example.com', targets: [], mappings: [], exceptions: [], leakage: [], cases: [], sourceLines: [], installations: [], customers: [],
  canManage: true, canApprove: false, canAct: false, generation: null, lastRebuiltAt: null, sourceImportedAt: null,
  sourceLineCount: 0, unattributedPaise: '0', reportingFrom: '2026-09-01', reportingTo: '2026-10-01',
  policy: { attractiveMonths: 24, reviewMonths: 36, exceptionMonths: 48, forecastWindowMonths: 3, watchRevenuePercent: 80, criticalRevenuePercent: 50 },
};
async function mockCoverage(page: Page, coverage = example) {
  await page.route('**/api/instrument-economics*', route => {
    expect(route.request().method()).toBe('GET');
    const action = new URL(route.request().url()).searchParams.get('action');
    return route.fulfill({ json: action === 'get_sales_coverage' ? coverage : workspace });
  });
  await page.goto('/?view=instrument-economics');
}

for (const width of [375, 1280]) {
  test.describe(`sales coverage at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });
    test('complete mixed months and no horizontal overflow', async ({ page }) => {
      await mockCoverage(page);
      const card = page.getByRole('region', { name: 'Sales coverage', exact: true });
      await expect(card).toContainText('Jul–Sep 2026 · complete · as of 30 Oct, 10:14 pm');
      for (const text of ['matches', 'no Tally control', 'differs by −₹100']) await expect(card.getByText(text, { exact: false })).toBeVisible();
      await expect(card).not.toContainText('₹0');
      await page.getByRole('button', { name: 'Refresh sales coverage' }).click();
      await expect(card).toContainText('complete · as of');
      expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
    test('incomplete with two blocking items', async ({ page }) => {
      await mockCoverage(page, { ...example, complete: false, blockingCount: 2, blockingItems: [
        { sourceId: 'source-1', reason: 'Missing ledger', recordedAt: example.importedAt! },
        { sourceId: 'source-2-very-long-unbroken-reference-01234567890123456789012345678901234567890', reason: 'Missing party', recordedAt: example.importedAt! },
      ] });
      const card = page.getByRole('region', { name: 'Sales coverage', exact: true });
      await expect(card).toContainText('incomplete · 2 blocking items');
      await card.getByText('Blocking items (2)', { exact: true }).click();
      await expect(card.getByRole('listitem')).toHaveCount(2);
      await expect(card.getByText('Missing ledger · 30 Oct, 10:14 pm · source-1', { exact: true })).toBeVisible();
      await expect(card.getByText(/Missing party · 30 Oct, 10:14 pm · source-2/)).toBeVisible();
      expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
    test('rebuild paused warning', async ({ page }) => {
      await mockCoverage(page, { ...example, rebuild: { state: 'paused', since: example.importedAt, reason: 'Sales review required' } });
      await expect(page.getByRole('region', { name: 'Sales coverage', exact: true }).getByRole('status')).toHaveText('Economics results paused since 30 Oct, 10:14 pm. Figures shown are from before the pause.');
    });
    for (const role of ['sales', 'operations']) {
      test(`${role} cannot see the card`, async ({ page }) => {
        let coverageReads = 0;
        await page.route('**/api/**', route => {
          const url = new URL(route.request().url());
          if (url.pathname === '/api/instrument-economics') {
            if (url.searchParams.get('action') === 'get_sales_coverage') coverageReads += 1;
            return route.fulfill({ status: 403, json: { error: 'Commercial economics access required' } });
          }
          return route.fallback();
        });
        await page.goto('/?view=instrument-economics');
        await expect(page.getByRole('alert').filter({ hasText: 'Commercial economics access required' })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Sales coverage', exact: true })).toHaveCount(0);
        expect(coverageReads).toBe(0);
        // Exercise the actual role helper in the shell as well as the gateway denial.
        await page.goto(`/?view=frame&role=${role}`);
        await expect(page.getByRole('button', { name: 'economics', exact: true })).toHaveCount(0);
        await expect(page.getByRole('region', { name: 'Sales coverage', exact: true })).toHaveCount(0);
      });
    }
  });
}
