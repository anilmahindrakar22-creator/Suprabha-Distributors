import { expect, test } from '@playwright/test';

const target = { id: 'summary-target', name: 'SYS 240', customerName: 'Summary laboratory', companyId: 'company', customerId: 'customer', customerSourceId: 'customer-guid', siteId: 'site', modelId: 'model', kind: 'placement', installationId: null,
  effectiveFrom: '2026-07-23', salesFrom: '2026-07-23', effectiveTo: null, approval: 'approved', version: 1, capitalPaise: '62500000', instrumentBillingPaise: '40000000', netInvestmentPaise: '22500000', revenuePaise: '10000', knownGpPaise: '6000', missingCostLines: 1, attributedLines: 2, recoveryPaise: '40006000', outstandingPaise: '22494000', health: 'data_incomplete', forecastMonths: null, expectation: null,
  reagentLifetime: { salesPaise: '20000', knownGpPaise: '12000', lines: 3, missingCostLines: 1 } };
const summary = { actorEmail: 'manager@test.local', readView: 'summary', todoCount: 2, targets: [target], mappings: [], exceptions: [], leakage: [], cases: [], sourceLines: [], attributionLines: [], installations: [], customers: [], canManage: true, canApprove: true, canAct: true, generation: 'run-1', lastRebuiltAt: null, sourceImportedAt: null, sourceLineCount: 840, unattributedPaise: '0', businessDate: '2026-10-13', reportingFrom: '2026-09-01', reportingTo: '2026-10-01', policy: { attractiveMonths: 24, reviewMonths: 36, exceptionMonths: 48, forecastWindowMonths: 3, watchRevenuePercent: 80, criticalRevenuePercent: 50 } };
const full = { ...summary, readView: 'full', generation: 'run-2', targets: [{ ...target, reagentLifetime: { salesPaise: '25000', knownGpPaise: '15000', lines: 4, missingCostLines: 1 } }] };

test('one instrument starts as a summary; evidence loads only on demand and can close', async ({ page }) => {
  const views: string[] = [];
  await page.route('**/api/instrument-economics', route => {
    const view = route.request().headers()['x-stockflow-economics-view']; views.push(view);
    return route.fulfill({ json: view === 'summary' ? summary : full });
  });
  await page.goto('/?view=instrument-economics');
  await expect(page.getByRole('button', { name: 'Sales & items', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('Reagent sales since 23 Jul 2026', { exact: true })).toBeVisible();
  await expect(page.getByText('Partial · 1 without purchase cost', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'To do (2)', exact: true })).toBeVisible();
  expect(views).toEqual(['summary']);
  await page.getByRole('button', { name: 'Sales & items', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Instrument items' })).toBeVisible();
  await expect(page.getByText('4 invoice lines', { exact: true })).toBeVisible();
  expect(views).toEqual(['summary', 'full']);
  await page.getByRole('button', { name: 'Hide sales & items', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Instrument items' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sales & items', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Instrument items' })).toBeVisible();
  expect(views).toEqual(['summary', 'full']);
});

test('failed evidence read retains summary and never opens empty setup; revocation clears finance', async ({ page }) => {
  let status = 502;
  await page.route('**/api/instrument-economics', route => route.request().headers()['x-stockflow-economics-view'] === 'summary'
    ? route.fulfill({ json: summary }) : route.fulfill({ status, json: { error: status === 403 ? 'Financial access revoked' : 'Evidence unavailable' } }));
  await page.goto('/?view=instrument-economics');
  await expect(page.getByRole('button', { name: 'Set up', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Set up', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Evidence unavailable');
  await expect(page.getByRole('region', { name: 'Economic targets' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set up', exact: true })).not.toHaveAttribute('aria-current', 'page');
  status = 403;
  await page.getByRole('button', { name: 'Sales & items', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Financial access revoked');
  await expect(page.getByRole('region', { name: 'Economic targets' })).toHaveCount(0);
});
