import { expect, test } from '@playwright/test';

const targets = [
  { id: 'lab-a-coag', name: 'Coag analyser · Test Lab A', customerName: 'Test Lab A', companyId: 'company', customerId: 'customer-a', customerSourceId: 'customer-a-guid', siteId: 'site', modelId: 'model', kind: 'placement', installationId: null,
    effectiveFrom: '2026-07-23', salesFrom: '2026-07-23', effectiveTo: null, approval: 'approved', version: 1, capitalPaise: '12500000', instrumentBillingPaise: '0', netInvestmentPaise: '12500000', revenuePaise: '10000', knownGpPaise: '6000', missingCostLines: 1, attributedLines: 2, recoveryPaise: '2500000', outstandingPaise: '10000000', health: 'data_incomplete', forecastMonths: null, expectation: null,
    reagentLifetime: { salesPaise: '0', knownGpPaise: '0', lines: 0, missingCostLines: 0 } },
  { id: 'lab-a-haem', name: 'Haematology analyser · Test Lab A', customerName: 'Test Lab A', companyId: 'company', customerId: 'customer-a', customerSourceId: 'customer-a-guid', siteId: 'site', modelId: 'model', kind: 'placement', installationId: null,
    effectiveFrom: '2026-07-24', salesFrom: '2026-07-24', effectiveTo: null, approval: 'approved', version: 1, capitalPaise: '23456789', instrumentBillingPaise: '0', netInvestmentPaise: '23456789', revenuePaise: '10000', knownGpPaise: '6000', missingCostLines: 1, attributedLines: 2, recoveryPaise: '4000000', outstandingPaise: '19456789', health: 'data_incomplete', forecastMonths: null, expectation: null,
    reagentLifetime: { salesPaise: '20000', knownGpPaise: '12000', lines: 3, missingCostLines: 1 } },
  { id: 'lab-a-bio', name: 'Biochemistry analyser · Test Lab A', customerName: 'Test Lab A', companyId: 'company', customerId: 'customer-a', customerSourceId: 'customer-a-guid', siteId: 'site', modelId: 'model', kind: 'placement', installationId: null,
    effectiveFrom: '2026-07-25', salesFrom: '2026-07-25', effectiveTo: null, approval: 'approved', version: 1, capitalPaise: '34567890', instrumentBillingPaise: '0', netInvestmentPaise: '34567890', revenuePaise: '10000', knownGpPaise: '6000', missingCostLines: 1, attributedLines: 2, recoveryPaise: '6000000', outstandingPaise: '28567890', health: 'data_incomplete', forecastMonths: null, expectation: null,
    reagentLifetime: { salesPaise: '20000', knownGpPaise: '12000', lines: 3, missingCostLines: 1 } },
  { id: 'lab-b-single', name: 'Single analyser · Test Lab B', customerName: 'Test Lab B', companyId: 'company', customerId: 'customer-b', customerSourceId: 'customer-b-guid', siteId: 'site', modelId: 'model', kind: 'placement', installationId: null,
    effectiveFrom: '2026-07-26', salesFrom: '2026-07-26', effectiveTo: null, approval: 'approved', version: 1, capitalPaise: '9000000', instrumentBillingPaise: '0', netInvestmentPaise: '9000000', revenuePaise: '10000', knownGpPaise: '6000', missingCostLines: 1, attributedLines: 2, recoveryPaise: '1000000', outstandingPaise: '8000000', health: 'data_incomplete', forecastMonths: null, expectation: null,
    reagentLifetime: { salesPaise: '10000', knownGpPaise: '6000', lines: 1, missingCostLines: 0 } },
];
const summary = { actorEmail: 'manager@test.local', readView: 'summary', todoCount: 2, targets, mappings: [], exceptions: [], leakage: [], cases: [], sourceLines: [], attributionLines: [], installations: [], customers: [], canManage: true, canApprove: true, canAct: true, generation: 'run-1', lastRebuiltAt: null, sourceImportedAt: null, sourceLineCount: 840, unattributedPaise: '0', businessDate: '2026-10-13', reportingFrom: '2026-09-01', reportingTo: '2026-10-01', policy: { attractiveMonths: 24, reviewMonths: 36, exceptionMonths: 48, forecastWindowMonths: 3, watchRevenuePercent: 80, criticalRevenuePercent: 50 } };

test('shows one lab total for a customer with multiple approved instruments', async ({ page }) => {
  await page.route('**/api/instrument-economics', route => route.fulfill({ json: summary }));
  await page.goto('/?view=instrument-economics');

  const total = page.getByRole('article', { name: 'Lab total' });
  await expect(total).toHaveCount(1);
  await expect(total).toContainText('Test Lab A · lab total');
  await expect(total).toContainText('3 instruments');
  const invested = `₹7,05,246.79`;
  await expect(total).toContainText(invested);
  await expect(total).toContainText('No reagent sales linked yet');
  for (const name of ['Coag analyser', 'Haematology analyser', 'Biochemistry analyser']) await expect(total).toContainText(name);
  await expect(total).not.toContainText(' · Test Lab A');
  await expect(total).not.toContainText('Test Lab B');
});

test('portfolio search hides the lab total when its members do not match', async ({ page }) => {
  await page.route('**/api/instrument-economics', route => route.fulfill({ json: summary }));
  await page.goto('/?view=instrument-economics');
  await expect(page.getByRole('article', { name: 'Lab total' })).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search instruments' }).fill('Test Lab B');
  await expect(page.getByRole('article', { name: 'Lab total' })).toHaveCount(0);
});

test('lab total has no horizontal overflow', async ({ page }) => {
  await page.route('**/api/instrument-economics', route => route.fulfill({ json: summary }));
  await page.goto('/?view=instrument-economics');
  const total = page.getByRole('article', { name: 'Lab total' });
  await expect(total).toHaveCount(1);
  const { scrollWidth, clientWidth } = await total.evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
});
