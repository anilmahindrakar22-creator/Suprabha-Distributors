import { expect, test, type Page, type Route } from '@playwright/test';

test('instrument sale date drives lifetime labels and simple group and item mapping defaults', async ({ page }) => {
  const posts: { action: string; payload: Record<string, unknown> }[] = [];
  const sold = { ...target, effectiveFrom: '2026-07-30', salesFrom: '2026-07-23' };
  const data = economicsData({ targets: [sold], attributionLines: [], itemGroupCatalogs: [{ id: 'sale-date-catalog', companyId: 'company-guid', sourceVersion: 'v1', observedAt: '2026-10-09T10:00:00Z', current: true, groups: [{ id: 'sale-date-group', name: 'Sale date group', itemCount: 30, parentId: null }], products: [] }] });
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: data });
    posts.push(route.request().postDataJSON());
    return route.fulfill({ status: 409, json: { error: 'Test keeps the form available for date review' } });
  });
  await page.goto('/?view=instrument-economics');
  await expect(page.getByText('Reagent sales since 23 Jul 2026', { exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Economics sections' }).getByRole('button', { name: 'Set up', exact: true }).click();
  await page.getByText('Add a Tally item group', { exact: true }).click();
  const groupForm = page.locator('form').filter({ has: page.getByRole('region', { name: 'Item group mapping identity' }) });
  await groupForm.getByLabel('Instrument placement', { exact: true }).selectOption(sold.id);
  await groupForm.getByLabel('Tally item group', { exact: true }).selectOption('sale-date-group');
  await expect(groupForm).toContainText('Include in instrument sales and GP · from 2026-07-23');
  await groupForm.getByRole('button', { name: 'Add item group', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ action: 'set_item_group_mapping', payload: { effectiveFrom: '2026-07-23', groupId: 'sale-date-group' } });
  await page.getByText('Add a single item', { exact: true }).click();
  const itemForm = page.locator('form').filter({ has: page.getByRole('region', { name: 'Product mapping identity' }) });
  await itemForm.getByLabel('Instrument placement', { exact: true }).selectOption(sold.id);
  await itemForm.getByLabel('Individual reagent item', { exact: true }).selectOption('product-guid-one');
  await expect(itemForm).toContainText('Include in instrument sales and GP · from 2026-07-23');
  await itemForm.getByRole('button', { name: 'Add item', exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1]).toMatchObject({ action: 'set_mapping', payload: { effectiveFrom: '2026-07-23', productId: 'product-guid-one' } });
  await itemForm.getByRole('button', { name: 'Change dates, exclusion or note' }).click();
  await itemForm.getByLabel('Effective from', { exact: true }).fill('2026-08-01');
  await itemForm.getByRole('button', { name: 'Add item', exact: true }).click();
  await expect.poll(() => posts.length).toBe(3);
  expect(posts[2]).toMatchObject({ payload: { effectiveFrom: '2026-08-01' } });
});

test('existing instrument registration searches invoices safely and keeps installation dates separate', async ({ page }, testInfo) => {
  const posts: { action: string; payload: Record<string, unknown> }[] = [];
  const data = economicsData({ targets: [], sourceLines: [{ id: 'historical-sale', companyId: 'company-1', voucherId: 'billing-1', voucherNumber: 'SD/26-27/0388', revision: '7', lineKey: '1', date: '2026-07-23', kind: 'sale', customerSourceId: 'customer-guid-1', productId: 'analyzer-1', productName: 'Historical analyzer', quantity: '1', unit: 'qty', netSalesPaise: '40000000', batchId: 'HIST-SERIAL' }, { id: 'bulk-sale', companyId: 'company-1', voucherId: 'bulk-billing', revision: '1', lineKey: '2', date: '2026-07-23', kind: 'sale', customerSourceId: 'customer-guid-1', productId: 'analyzer-1', productName: 'Bulk analyzer', quantity: '2', unit: 'qty', netSalesPaise: '80000000', batchId: 'HIST-SERIAL' }] });
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: data });
    posts.push(route.request().postDataJSON());
    return route.fulfill({ status: 409, json: { error: 'Instrument invoice changed; refresh before registration' } });
  });
  await page.goto('/?view=instrument-economics');
  await openAdvanced(page);
  await page.getByLabel('Action', { exact: true }).selectOption('register_historical_instrument');
  await page.getByRole('combobox', { name: 'Instrument selling line', exact: true }).fill('HIST-SERIAL');
  await expect(page.getByRole('option', { name: /Bulk analyzer/ })).toHaveCount(0);
  await page.getByRole('option', { name: /Historical analyzer.*HIST-SERIAL/ }).click();
  await expect(page.getByLabel('Confirmed serial number')).toHaveValue('HIST-SERIAL');
  await page.getByRole('combobox', { name: 'Instrument selling line', exact: true }).fill('unmatched invoice');
  await expect(page.getByLabel('Confirmed serial number')).toHaveValue('');
  await expect(page.locator('input[name="expectedSourceRevision"]')).toHaveValue('');
  await expect(page.getByText('No matching instrument invoices.', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Instrument selling line', exact: true }).fill('0388');
  await expect(page.getByRole('option', { name: /Historical analyzer.*0388/ })).toBeVisible();
  await page.screenshot({ path: `docs/UI-PREVIEWS/instrument-searchable-invoice-${testInfo.project.name}.png`, fullPage: false });
  await page.getByRole('combobox', { name: 'Instrument selling line', exact: true }).press('ArrowDown');
  await page.getByRole('combobox', { name: 'Instrument selling line', exact: true }).press('Enter');
  await expect(page.getByLabel('Confirmed serial number')).toHaveValue('HIST-SERIAL');
  await expect(page.locator('input[name="expectedSourceRevision"]')).toHaveValue('7');
  expect(posts).toHaveLength(0);
  await page.getByLabel('Customer', { exact: true }).selectOption('customer-1');
  await page.getByLabel('Confirmed installation date').fill('2026-07-30');
  await page.getByLabel('Installation verification evidence').fill('Management confirmed historical installation and serial');
  await expect(page.getByText('Invoice date: 2026-07-23.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Register existing instrument', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Instrument invoice changed');
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ action: 'register_historical_instrument', payload: { sourceLineId: 'historical-sale', expectedSourceRevision: '7', customerId: 'customer-1', installedOn: '2026-07-30', serialNumber: 'HIST-SERIAL' } });
  expect(posts[0].payload).not.toHaveProperty('capitalPaise');
  await expect(page.getByLabel('Confirmed installation date')).toHaveValue('2026-07-30');
  await expect(page.getByLabel('Confirmed serial number')).toHaveValue('HIST-SERIAL');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

const target = {
  id: 'target-placement-1', kind: 'placement', name: 'Alpha chemistry analyzer', companyId: 'company-guid', customerId: 'customer-1', customerName: 'Alpha Laboratory',
  customerSourceId: 'canonical-customer-guid', siteId: 'site-1', modelId: 'model-1', installationId: 'installation-1', effectiveFrom: '2025-01-01', effectiveTo: null,
  approval: 'approved', version: 2, capitalPaise: '120000000', revenuePaise: '8500000', knownGpPaise: '2300000', missingCostLines: 0, attributedLines: 12,
  recoveryPaise: '23000000', outstandingPaise: '97000000', health: 'healthy', forecastMonths: 42.2,
  expectation: { id: 'expectation-1', monthlyRevenuePaise: '10000000', monthlyGpPaise: '4000000', effectiveFrom: '2026-01-01', reason: 'Approved current baseline' },
};
const economicsData = (overrides: Record<string, unknown> = {}) => ({
  actorEmail: 'manager@example.com', businessDate: '2026-10-09', businessTimezone: 'Asia/Kolkata',
  targets: [target, { ...target, id: 'target-critical', name: 'Critical analyzer', health: 'critical', revenuePaise: '4500000', knownGpPaise: '-100000', forecastMonths: null }, { ...target, id: 'target-inactive', name: 'Inactive analyzer', health: 'inactive', effectiveTo: '2025-12-31', forecastMonths: null }],
  mappings: [], exceptions: [], leakage: [], cases: [], sourceLines: [
    { id: 'sale-line-1', companyId: 'company-guid', voucherId: 'INV-100', revision: '1', lineKey: '1', date: '2026-09-10', kind: 'sale', customerSourceId: 'canonical-customer-guid', productId: 'product-guid-one', quantity: '10', unit: 'test', netSalesPaise: '500000', batchId: null },
    { id: 'sale-line-2', companyId: 'company-guid', voucherId: 'INV-101', revision: '1', lineKey: '1', date: '2026-09-12', kind: 'sale', customerSourceId: 'canonical-customer-guid', productId: 'product-guid-two', quantity: '4', unit: 'kit', netSalesPaise: '360000', batchId: null },
    { id: 'purchase-line-1', companyId: 'company-guid', voucherId: 'PUR-01', revision: '1', lineKey: '1', date: '2026-09-01', kind: 'purchase', customerSourceId: null, productId: 'product-guid-one', quantity: '20', unit: 'test', netSalesPaise: '200000', batchId: null },
  ], installations: [{ id: 'installation-1', name: 'Alpha analyzer', serialNumber: 'SN-01', customerName: 'Alpha Laboratory' }],
  customers: [{ id: 'customer-1', name: 'Alpha Laboratory' }], canManage: true, canApprove: false, canAct: false, generation: 'run-1', lastRebuiltAt: '2026-10-07T10:00:00.000Z', sourceImportedAt: '2026-10-07T09:00:00.000Z', sourceLineCount: 12, unattributedPaise: '0', reportingFrom: '2026-09-01', reportingTo: '2026-10-01',
  policy: { attractiveMonths: 24, reviewMonths: 36, exceptionMonths: 48, forecastWindowMonths: 3, watchRevenuePercent: 80, criticalRevenuePercent: 50 }, ...overrides,
});

async function openAdvanced(page: Page, section: 'All actions' | 'Exceptions' | 'Reagent leakage' | 'Reports' = 'All actions') {
  await page.getByRole('navigation', { name: 'Economics sections' }).getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.getByRole('navigation', { name: 'Advanced sections' }).getByRole('button', { name: section, exact: true }).click();
}

async function mockWorkspace(page: Page, body = economicsData()) {
  await page.route('**/api/instrument-economics', (route: Route) => route.request().method() === 'GET'
    ? route.fulfill({ json: body })
    : route.fulfill({ json: { ok: true } }));
  await page.goto('/?view=instrument-economics');
  await expect(page.getByRole('heading', { name: 'Instrument economics' })).toBeVisible();
  await expect(page.getByText('Business date 9 Oct 2026', { exact: false })).toBeVisible();
}

test('only administrators see the policy action', async ({ page }) => {
  await mockWorkspace(page, economicsData({ canAdministrator: false }));
  await openAdvanced(page);
  await expect(page.getByLabel('Action', { exact: true }).locator('option[value="set_policy"]')).toHaveCount(0);
  await page.unroute('**/api/instrument-economics');
  await mockWorkspace(page, economicsData({ canAdministrator: true }));
  await openAdvanced(page);
  await expect(page.getByLabel('Action', { exact: true }).locator('option[value="set_policy"]')).toHaveCount(1);
  await page.getByLabel('Action', { exact: true }).selectOption('set_policy');
  await expect(page.getByLabel('Management can approve up to (months)', { exact: true })).toBeVisible();
});

test('proposed reagent totals say pending approval instead of zero sales or no billed items', async ({ page }, testInfo) => {
  await mockWorkspace(page, economicsData({ targets: [{ ...target, approval: 'proposed', health: 'proposed', expectation: null, revenuePaise: '0', knownGpPaise: '0', forecastMonths: null, itemBreakdown: [] }] }));
  await expect(page.getByText('Waiting for approval in Set up.', { exact: false })).toBeVisible();
  await openAdvanced(page, 'Reports');
  const breakdown = page.getByRole('region', { name: 'Item sales and GP breakdown', exact: true });
  await expect(breakdown).toContainText('Reagent sales and GP are pending approval.');
  await expect(breakdown).not.toContainText('₹0.00');
  await expect(page.getByText('No attributed reagent items were billed in this reporting month.', { exact: true })).toHaveCount(0);
  await breakdown.scrollIntoViewIfNeeded();
  await expect(breakdown).toBeInViewport();
  await page.screenshot({ path: `docs/UI-PREVIEWS/instrument-proposed-pending-${testInfo.project.name}.png` });
});

test('proposal review shows net investment and the placement-start baseline before approving', async ({ page }, testInfo) => {
  const posts: Record<string, unknown>[] = [];
  const data = economicsData({ canApprove: true, targets: [{ ...target, approval: 'proposed', health: 'proposed', forecastMonths: null,
    approvalPreview: { status: 'within_limit', capitalPaise: '55000000', instrumentBillingPaise: '20000000', netInvestmentPaise: '35000000',
      expectedMonthlyGpPaise: '1000000', expectedPaybackMonths: 35, expectationId: 'start-baseline', expectationEffectiveFrom: '2025-01-01',
      policyId: 'policy-1', reviewMonths: 36, exceptionMonths: 48 } }] });
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: data });
    posts.push(route.request().postDataJSON());
    return route.fulfill({ status: 409, json: { error: 'Financial preview changed; refresh before approval' } });
  });
  await page.goto('/?view=instrument-economics');
  // Approval is step 2 of the simple Set up flow.
  await page.getByRole('navigation', { name: 'Economics sections' }).getByRole('button', { name: 'Set up', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Step 2: Investment and approval' })).toBeVisible();
  const proposal = page.getByRole('region', { name: 'Placement approval preview' });
  await expect(proposal.getByText('₹5,50,000.00', { exact: true })).toBeVisible();
  await expect(proposal.getByText('₹2,00,000.00', { exact: true })).toBeVisible();
  await expect(proposal.getByText('₹3,50,000.00', { exact: true })).toBeVisible();
  await expect(proposal.getByText('₹10,000.00', { exact: true })).toBeVisible();
  await expect(proposal.getByText('35 months', { exact: true })).toBeVisible();
  await expect(proposal.getByText('Approval baseline from 1 Jan 2025.', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Decision', exact: true }).selectOption('approved');
  await page.getByLabel('Decision reason', { exact: true }).fill('Verified net investment and start baseline');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `docs/UI-PREVIEWS/instrument-approval-preview-${testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop'}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Submit review', exact: true }).click();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ action: 'approve_target', payload: { expectedGeneration: 'run-1', expectedVersion: '2', decision: 'approved' } });
  await expect(page.getByText('Financial preview changed; refresh before approval', { exact: true })).toBeVisible();
});

test('verified placement can start actual tracking without an expected target', async ({ page }) => {
  const posts: Record<string, unknown>[] = [];
  const data = economicsData({ canApprove: true, targets: [{ ...target, approval: 'proposed', health: 'proposed', expectation: null, forecastMonths: null,
    approvalPreview: { status: 'actuals_only', capitalPaise: '62500000', instrumentBillingPaise: '40000000', netInvestmentPaise: '22500000',
      expectedMonthlyGpPaise: null, expectedPaybackMonths: null, expectationId: null, expectationEffectiveFrom: null,
      policyId: 'policy-1', reviewMonths: 36, exceptionMonths: 48 } }] });
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: data });
    posts.push(route.request().postDataJSON());
    return route.fulfill({ status: 409, json: { error: 'Actual tracking approval retained for test' } });
  });
  await page.goto('/?view=instrument-economics');
  await openAdvanced(page);
  const proposal = page.getByRole('region', { name: 'Placement approval preview' });
  await expect(proposal.getByText('Ready for actual tracking', { exact: true })).toBeVisible();
  await expect(proposal.getByText('Expected sales and GP are optional.', { exact: false })).toBeVisible();
  await expect(proposal.getByText('Not set', { exact: true })).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Decision', exact: true }).selectOption('approved');
  await page.getByLabel('Decision reason', { exact: true }).fill('Start verified actual tracking; planning target is not set');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Submit review', exact: true }).click();
  await expect(page.getByText('Actual tracking approval retained for test', { exact: true })).toBeVisible();
  expect(posts[0]).toMatchObject({ action: 'approve_target', payload: { expectedGeneration: 'run-1', expectedVersion: '2', decision: 'approved' } });
});

test('proposal above the review band requires explicit administrator approval', async ({ page }) => {
  const posts: Record<string, unknown>[] = [];
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: economicsData({ canAdministrator: true, canApprove: true, targets: [{ ...target, approval: 'proposed', health: 'proposed',
      approvalPreview: { status: 'director_exception_required', capitalPaise: '40000000', instrumentBillingPaise: '0', netInvestmentPaise: '40000000', expectedMonthlyGpPaise: '1000000', expectedPaybackMonths: 40, expectationId: 'start-baseline', expectationEffectiveFrom: '2025-01-01', policyId: 'policy-1', reviewMonths: 36, exceptionMonths: 48 } }] }) });
    posts.push(route.request().postDataJSON());
    return route.fulfill({ status: 400, json: { error: 'Review retained for test' } });
  });
  await page.goto('/?view=instrument-economics');
  await openAdvanced(page);
  await expect(page.getByText('Administrator approval required', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Decision', exact: true }).selectOption('approved');
  await page.getByLabel('Decision reason', { exact: true }).fill('Administrator reviewed the extended investment payback');
  await page.getByRole('button', { name: 'Submit review', exact: true }).click();
  expect(posts).toHaveLength(0);
  await page.getByRole('checkbox', { name: 'Administrator approval: I confirm this payback beyond the review band' }).check();
  await page.getByRole('button', { name: 'Submit review', exact: true }).click();
  await expect(page.getByText('Review retained for test', { exact: true })).toBeVisible();
  expect(posts[0]).toMatchObject({ action: 'approve_target', payload: { directorException: true, expectedGeneration: 'run-1' } });
});

test('management above the review band needs an administrator and can still reject', async ({ page }) => {
  const posts: Record<string, unknown>[] = [];
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: economicsData({ canAdministrator: false, canApprove: true, targets: [{ ...target, approval: 'proposed', health: 'proposed', approvalPreview: { status: 'director_exception_required', capitalPaise: '40000000', instrumentBillingPaise: '0', netInvestmentPaise: '40000000', expectedMonthlyGpPaise: '1000000', expectedPaybackMonths: 40, expectationId: 'start-baseline', expectationEffectiveFrom: '2025-01-01', policyId: 'policy-1', reviewMonths: 36, exceptionMonths: 48 } }] }) });
    posts.push(route.request().postDataJSON()); return route.fulfill({ status: 400, json: { error: 'Rejection retained for test' } });
  });
  await page.goto('/?view=instrument-economics'); await openAdvanced(page);
  await expect(page.getByText('Needs an Administrator to approve (payback over 36 months).', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Administrator approval: I confirm this payback beyond the review band' })).toHaveCount(0);
  await expect(page.locator('select[name="decision"] option[value="approved"]')).toHaveAttribute('disabled', '');
  await page.getByRole('combobox', { name: 'Decision', exact: true }).selectOption('rejected');
  await page.getByLabel('Decision reason', { exact: true }).fill('Management rejected capital exposure');
  await page.getByRole('button', { name: 'Submit review', exact: true }).click();
  await expect(page.getByText('Rejection retained for test', { exact: true })).toBeVisible();
  expect(posts[0]).toMatchObject({ action: 'approve_target', payload: { decision: 'rejected' } });
});

test('blocked proposal can be rejected explicitly while approval remains unavailable', async ({ page }) => {
  const posts: Record<string, unknown>[] = [];
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: economicsData({ canApprove: true, targets: [{ ...target, approval: 'proposed', health: 'proposed',
      approvalPreview: { status: 'limit_exceeded', capitalPaise: '55000000', instrumentBillingPaise: '0', netInvestmentPaise: '55000000', expectedMonthlyGpPaise: '1000000', expectedPaybackMonths: 55, expectationId: 'start-baseline', expectationEffectiveFrom: '2025-01-01', policyId: 'policy-1', reviewMonths: 36, exceptionMonths: 48 } }] }) });
    posts.push(route.request().postDataJSON());
    return route.fulfill({ status: 400, json: { error: 'Rejection retained for test' } });
  });
  await page.goto('/?view=instrument-economics');
  await openAdvanced(page);
  await expect(page.getByText('Approval payback limit exceeded', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Decision', exact: true }).locator('option[value="approved"]')).toHaveAttribute('disabled', '');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Decision', exact: true }).selectOption('rejected');
  await page.getByLabel('Decision reason', { exact: true }).fill('Investment exceeds the approved maximum payback');
  await page.getByRole('button', { name: 'Submit review', exact: true }).click();
  await expect(page.getByText('Rejection retained for test', { exact: true })).toBeVisible();
  expect(posts[0]).toMatchObject({ action: 'approve_target', payload: { decision: 'rejected' } });
});

test('Administrators can inspect retained non-economic documents in Reports without treating them as sales or supply', async ({ page }) => {
  const sourceId = 'PROFORMA-'.repeat(24);
  await mockWorkspace(page, economicsData({ canManage: true, sourceDocumentExclusionCount: 102, sourceDocumentExclusions: [
    { sourceId, revision: '3', date: '2026-09-12', voucherType: 'Proforma Invoice', reason: 'Accounts-approved proposal document; linked actual sales are separate.', cancelled: false },
  ] }));
  await openAdvanced(page, 'Reports');
  const summary = page.locator('summary').filter({ hasText: 'Excluded documents (102)' });
  await expect(page.getByText(sourceId, { exact: true })).not.toBeVisible();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(sourceId, { exact: true })).toBeVisible();
  await expect(page.getByText('Classified non-economic documents are retained for audit and excluded from revenue, GP and supply.')).toBeVisible();
  await expect(page.getByText('101 older excluded documents are retained for audit.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('reconciliation exposes missing FOC costs even when their sales value is zero', async ({ page }) => {
  await mockWorkspace(page, economicsData({ canManage: true, reportingSummary: {
    netSalesPaise: '0', attributedSalesPaise: '0', unattributedSalesPaise: '0', excludedSalesPaise: '0',
    instrumentBillingSalesPaise: '0', verifiedCostPaise: '125050', knownGpPaise: '-125050', missingCostSalesPaise: '0', missingCostLines: 1,
  } }));
  await openAdvanced(page, 'Reports');
  const disclosure = page.locator('details').filter({ hasText: 'Monthly sales reconciliation' });
  await disclosure.locator('summary').click();
  await expect(disclosure.locator('div').filter({ has: page.locator('dt', { hasText: 'Lines missing cost' }) }).locator('dd')).toHaveText('1');
  await expect(disclosure.getByText('−₹1,250.50', { exact: true })).toBeVisible();
  await expect(disclosure.getByText('Verified-cost lines only; may be partial', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test('instrument acquisition previews Tally net cost and submits a source link instead of manual value', async ({ page }) => {
  const data = economicsData();
  data.sourceLines.push({ ...data.sourceLines[2], id: 'instrument-purchase', voucherId: 'PUR-INSTRUMENT-9', productId: 'instrument-guid', quantity: '1', unit: 'nos', netSalesPaise: '55000001' });
  const posts: Record<string, unknown>[] = [];
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: data });
    posts.push(route.request().postDataJSON());
    return route.fulfill({ status: 400, json: { error: 'Keep evidence for review' } });
  });
  await page.goto('/?view=instrument-economics');
  await openAdvanced(page);
  await page.getByLabel('Capital source', { exact: true }).selectOption('tally');
  await page.getByLabel('Tally acquisition purchase', { exact: true }).selectOption('instrument-purchase');
  await expect(page.getByText('Tally net acquisition cost: ₹5,50,000.01', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Capital (₹)', { exact: true })).toHaveCount(0);

  await page.getByLabel('Target kind', { exact: true }).selectOption('placement');
  await page.getByLabel('Target name', { exact: true }).fill('Instrument from purchase');
  await page.getByLabel('Tally company GUID', { exact: true }).fill('company-guid');
  await page.getByLabel('Customer', { exact: true }).selectOption('customer-1');
  await page.getByLabel('Canonical customer GUID', { exact: true }).fill('canonical-customer-guid');
  await page.getByLabel('Site ID', { exact: true }).fill('site-1');
  await page.getByLabel('Model ID', { exact: true }).fill('model-1');
  await page.getByLabel('Installation', { exact: true }).selectOption('installation-1');
  await page.getByLabel('Effective from', { exact: true }).fill('2026-09-15');
  await page.getByLabel('Capital purchase or approval evidence', { exact: true }).fill('SN-01 matched to invoice');
  await page.getByRole('button', { name: 'Create target', exact: true }).click();
  await expect(page.getByText('Keep evidence for review', { exact: true })).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ action: 'create_target', payload: { capitalPaise: '0', acquisitionPurchaseLineId: 'instrument-purchase', capitalEvidence: 'SN-01 matched to invoice' } });
});

test('changed Tally acquisition remains visible with an explicit review warning', async ({ page }) => {
  await mockWorkspace(page, economicsData({ targets: [{ ...target, capitalSource: 'tally_purchase', capitalEvidenceCurrent: false, health: 'data_incomplete', forecastMonths: null }], acquisitionReviews: [{ id: 'review-1', target_id: target.id, revision: 1, previous_amount_paise: '55000000', amount_paise: '57000000', actor: 'manager@example.com', reason: 'Serial verified against revised invoice', recorded_at: '2026-10-08T10:00:00Z' }] }));
  await openAdvanced(page, 'Reports');
  await expect(page.getByText('Capital source: Verified Tally purchase.', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Tally acquisition evidence has changed' })).toBeVisible();
  await page.getByRole('region', { name: 'Selected target details' }).locator('summary').filter({ hasText: 'Full financial breakdown' }).click();
  await expect(page.getByRole('region', { name: 'Selected target details' }).getByText('₹12,00,000.00', { exact: true })).toBeVisible();
  await page.getByText('Acquisition reviews (1)', { exact: true }).click();
  await expect(page.getByText('₹5,50,000.00 → ₹5,70,000.00', { exact: true })).toBeVisible();
  await expect(page.getByText(/manager@example.com.*Serial verified against revised invoice/)).toBeVisible();
});

for (const cancelled of [false, true]) {
  test(`acquisition review previews a ${cancelled ? 'cancellation' : 'price revision'} and submits only verified source/version references`, async ({ page }) => {
    const item = { targetId: target.id, targetName: target.name, expectedVersion: 2, voucherId: 'PUR-ACQUISITION', expectedSourceRevision: '3', changed: true, cancelled, previousAmountPaise: '55000000', proposedAmountPaise: cancelled ? '0' : '57000000', capitalDeltaPaise: cancelled ? '-55000000' : '2000000', productId: 'instrument-guid', lineKey: '1' };
    const data = economicsData({ acquisitionReviewItems: [item] });
    const posts: Record<string, unknown>[] = [];
    await page.route('**/api/instrument-economics', route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: data });
      posts.push(route.request().postDataJSON());
      return route.fulfill({ status: 409, json: { error: 'Source changed again; refresh' } });
    });
    await page.goto('/?view=instrument-economics');
    await openAdvanced(page);
    await page.getByRole('combobox', { name: 'Action', exact: true }).selectOption('review_acquisition');
    await page.getByLabel('Acquisition to review', { exact: true }).selectOption(target.id);
    await expect(page.getByText('Previously verified acquisition: ₹5,50,000.00', { exact: true })).toBeVisible();
    await expect(page.getByText(cancelled ? 'Proposed acquisition: ₹0.00 · capital adjustment: −₹5,50,000.00' : 'Proposed acquisition: ₹5,70,000.00 · capital adjustment: ₹20,000.00', { exact: true })).toBeVisible();
    await page.getByLabel('Acquisition review evidence', { exact: true }).fill('Verified instrument serial and revised purchase');
    if (cancelled) {
      await page.getByRole('button', { name: 'Review acquisition revision', exact: true }).click();
      expect(posts).toHaveLength(0);
      await page.getByRole('checkbox', { name: 'I verified this cancellation and approve reducing this acquisition cost to zero.', exact: true }).check();
    }
    await page.getByRole('button', { name: 'Review acquisition revision', exact: true }).click();
    await expect(page.getByText('Source changed again; refresh', { exact: true })).toBeVisible();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ action: 'review_acquisition', payload: { targetId: target.id, expectedVersion: '2', expectedSourceRevision: '3', reason: 'Verified instrument serial and revised purchase', expectedActorEmail: 'manager@example.com', ...(cancelled ? { confirmCancellation: true } : {}) } });
    expect((posts[0].payload as Record<string, unknown>).amountPaise).toBeUndefined();
    expect((posts[0].payload as Record<string, unknown>).capitalPaise).toBeUndefined();
    await expect(page.getByLabel('Acquisition review evidence', { exact: true })).toHaveValue('Verified instrument serial and revised purchase');
  });
}

test('incompatible acquisition evidence cannot be acknowledged through the review form', async ({ page }) => {
  const posts: unknown[] = [];
  const data = economicsData({ acquisitionReviewItems: [{ targetId: target.id, targetName: target.name, expectedVersion: 2, voucherId: 'PUR-ACQUISITION', expectedSourceRevision: '4', changed: true, cancelled: false, previousAmountPaise: '55000000', proposedAmountPaise: null, capitalDeltaPaise: null, productId: 'instrument-guid', lineKey: '1' }] });
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: data });
    posts.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/?view=instrument-economics');
  await openAdvanced(page);
  await page.getByRole('combobox', { name: 'Action', exact: true }).selectOption('review_acquisition');
  await page.getByLabel('Acquisition to review', { exact: true }).selectOption(target.id);
  await expect(page.getByRole('alert').filter({ hasText: 'missing or incompatible instrument evidence' })).toBeVisible();
  await page.getByLabel('Acquisition review evidence', { exact: true }).fill('Investigated missing line');
  await page.getByRole('button', { name: 'Review acquisition revision', exact: true }).click();
  await expect(page.getByText('The acquisition source is missing or incompatible. Investigate its Tally evidence before reviewing capital.', { exact: true })).toBeVisible();
  expect(posts).toHaveLength(0);
});

test('below-cost instrument billing previews the investment and displays the authoritative linked figures', async ({ page }) => {
  const instrumentTarget = { ...target, capitalPaise: '55000000', acquisitionProductId: 'instrument-guid', acquisitionUnit: 'nos', capitalEvidenceCurrent: true, instrumentBillingCurrent: true, instrumentBillingPaise: '0', netInvestmentPaise: '55000000', recoveryPaise: '0', outstandingPaise: '55000000' };
  const sale = { id: 'instrument-sale', companyId: target.companyId, voucherId: 'INSTRUMENT-INV-1', revision: '1', lineKey: '1', date: '2026-09-15', kind: 'sale', customerSourceId: target.customerSourceId, productId: 'instrument-guid', quantity: '1', unit: 'nos', netSalesPaise: '20000000', batchId: null };
  let linked = false; const posts: Record<string, unknown>[] = [];
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'POST') { posts.push(route.request().postDataJSON()); linked = true; return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: economicsData({ targets: [{ ...instrumentTarget, ...(linked ? { version: 3, instrumentBillingPaise: '20000000', netInvestmentPaise: '35000000', recoveryPaise: '20000000', outstandingPaise: '35000000' } : {}) }], sourceLines: [sale, { ...sale, id: 'other-customer-sale', customerSourceId: 'another-customer' }, { ...sale, id: 'reagent-sale', productId: 'reagent-guid' }], instrumentBillings: linked ? [{ target_id: target.id, source_line_id: sale.id, source_id: sale.voucherId, line_key: '1', actor: 'manager@example.com', reason: 'Confirmed serial and below-cost customer invoice', current: true, billedRecoveryPaise: '20000000' }] : [] }) });
  });
  await page.goto('/?view=instrument-economics');
  await openAdvanced(page);
  await page.getByRole('combobox', { name: 'Action', exact: true }).selectOption('link_instrument_billing');
  await page.getByLabel('Instrument placement', { exact: true }).selectOption(target.id);
  await expect(page.getByLabel('Instrument selling invoice', { exact: true }).locator('option')).toHaveCount(2);
  await page.getByLabel('Instrument selling invoice', { exact: true }).selectOption(sale.id);
  await expect(page.getByText('Purchase/capital cost: ₹5,50,000.00', { exact: true })).toBeVisible();
  await expect(page.getByText('Net instrument billing: ₹2,00,000.00', { exact: true })).toBeVisible();
  await expect(page.getByText('Placement investment: ₹3,50,000.00', { exact: true })).toBeVisible();
  await page.getByLabel('Instrument billing verification evidence', { exact: true }).fill('Confirmed serial and below-cost customer invoice');
  await page.getByRole('button', { name: 'Link instrument selling invoice', exact: true }).click();
  await expect(page.getByText('Saved. Workspace refreshed with the latest records.', { exact: true })).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ action: 'link_instrument_billing', payload: { targetId: target.id, expectedVersion: '2', sourceLineId: sale.id, reason: 'Confirmed serial and below-cost customer invoice' } });
  expect((posts[0].payload as Record<string, unknown>).amountPaise).toBeUndefined();
  await openAdvanced(page, 'Reports');
  const details = page.getByRole('region', { name: 'Selected target details', exact: true });
  await details.locator('summary').filter({ hasText: 'Full financial breakdown' }).click();
  await expect(details.getByText('Net investment', { exact: true }).locator('..').getByText('₹3,50,000.00', { exact: true })).toBeVisible();
  await expect(details.getByText('Instrument billing', { exact: true }).locator('..').getByText('₹2,00,000.00', { exact: true })).toBeVisible();
  await expect(details.getByText('Net invoiced recovery; not cash receipts', { exact: true })).toBeVisible();
});

test('portfolio shows API health colors, reporting dates and fits the browser viewport', async ({ page }, testInfo) => {
  const data = economicsData();
  await mockWorkspace(page, economicsData({ targets: [...data.targets,
    { ...target, id: 'target-watch', name: 'Watch analyzer', health: 'watch', revenuePaise: '6500000', knownGpPaise: '1800000', forecastMonths: 53.9 },
    { ...target, id: 'target-incomplete', name: 'Evidence review analyzer', health: 'data_incomplete', missingCostLines: 2, forecastMonths: null },
    { ...target, id: 'target-proposed', name: 'Proposed analyzer', health: 'proposed', approval: 'proposed', effectiveFrom: '2026-11-01', revenuePaise: '0', knownGpPaise: '0', recoveryPaise: '0', outstandingPaise: '120000000', attributedLines: 0, forecastMonths: null, expectation: null },
  ] }));
  const cards = page.getByRole('region', { name: 'Economic targets', exact: true });
  await expect(cards.getByText('Healthy', { exact: true }).first()).toHaveClass(/text-sf-success/);
  await expect(cards.getByText('Critical', { exact: true }).first()).toHaveClass(/text-sf-danger/);
  await expect(cards.getByText('Inactive', { exact: true }).first()).toHaveClass(/text-sf-muted/);
  await expect(cards.getByText('Watch', { exact: true }).first()).toHaveClass(/text-sf-warning/);
  await expect(cards.getByText('Data incomplete', { exact: true }).first()).toHaveClass(/text-sf-body/);
  await expect(cards.getByText('Proposed', { exact: true }).first()).toHaveClass(/text-sf-info/);
  await expect(page.getByText('Tally data from', { exact: false })).toBeVisible();
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  for (const name of ['Instruments', 'To do', 'Set up', 'Advanced']) {
    const button = await page.getByRole('navigation', { name: 'Economics sections' }).getByRole('button', { name, exact: true }).boundingBox();
    expect(button).not.toBeNull();
    expect(button!.x).toBeGreaterThanOrEqual(0);
    expect(button!.x + button!.width).toBeLessThanOrEqual(widths.viewport);
  }
  await page.screenshot({ path: `test-results/instrument-economics-${testInfo.project.name}.png`, fullPage: true });
});

test('portfolio filters intersect status, type and search and keep details aligned with visible results', async ({ page }) => {
  const data = economicsData();
  await mockWorkspace(page, economicsData({ targets: [...data.targets, { ...target, id: 'group-1', kind: 'group', name: 'Shared analyzer group', health: 'critical' }] }));
  await page.getByLabel('Status', { exact: true }).selectOption('critical');
  await expect(page.getByText('2 of 4 instruments')).toBeVisible();
  await page.getByLabel('Type', { exact: true }).selectOption('group');
  await expect(page.getByText('1 of 4 instruments')).toBeVisible();
  await page.getByRole('button', { name: 'Sales & items', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Shared analyzer group · sales' })).toBeVisible();
  await page.getByLabel('Search instruments', { exact: true }).fill('missing site');
  await expect(page.getByRole('heading', { name: 'No matching instruments' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Instrument sales' })).toHaveCount(0);
  await page.getByLabel('Search instruments', { exact: true }).fill('ALPHA LABORATORY');
  await expect(page.getByText('1 of 4 instruments')).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Search instruments', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('all');
  await expect(page.getByLabel('Type', { exact: true })).toHaveValue('all');
  await expect(page.getByText('4 of 4 instruments')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset filters', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('read-only roles can inspect economics but see no setup or case mutation controls', async ({ page }) => {
  await mockWorkspace(page, economicsData({ canManage: false, canApprove: false, canAct: false }));
  const nav = page.getByRole('navigation', { name: 'Economics sections' });
  await expect(nav.getByRole('button', { name: 'Instruments', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to instrument tasks', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Sales without purchase cost' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tally import problems' })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: 'Set up', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: 'Advanced', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Action')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Set expectation|Create target|Set policy/ })).toHaveCount(0);
});

for (const status of [401, 403]) {
  test(`authorization loss ${status} on refresh clears previously loaded economics`, async ({ page }) => {
    let authorized = true;
    await page.route('**/api/instrument-economics', route => route.fulfill(authorized ? { json: economicsData() } : { status, json: { error: 'Financial access is no longer available' } }));
    await page.goto('/?view=instrument-economics');
    await expect(page.getByRole('heading', { name: 'Alpha chemistry analyzer', exact: true })).toBeVisible();
    authorized = false;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Financial access is no longer available');
    await expect(page.getByRole('region', { name: 'Economic targets', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Selected target details', exact: true })).toHaveCount(0);
    await expect(page.getByText('₹12,00,000.00', { exact: true })).toHaveCount(0);
  });

  test(`authorization loss ${status} on save clears economics and mutation controls`, async ({ page }) => {
    await page.route('**/api/instrument-economics', route => route.fulfill(route.request().method() === 'GET' ? { json: economicsData() } : { status, json: { error: 'Financial access is no longer available' } }));
    await page.goto('/?view=instrument-economics');
    await openAdvanced(page);
    await page.getByLabel('Action').selectOption('record_capital');
    await page.getByRole('combobox', { name: /^Target/ }).selectOption('target-placement-1');
    await page.getByLabel('Signed amount (₹)').fill('100');
    await page.getByLabel('Entry kind').selectOption('capital');
    await page.getByLabel('Effective date').fill('2026-09-10');
    await page.getByLabel('Reason').fill('Reviewed instrument acquisition');
    await page.getByRole('button', { name: 'Record capital or contribution', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Financial access is no longer available');
    await expect(page.getByLabel('Action')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Retry saved command', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Instruments', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Economic targets', exact: true })).toHaveCount(0);
  });
}

test('an uncertain save survives access loss and only the original account can retry its unchanged command', async ({ page }) => {
  const posts: Array<{ action: string; payload: Record<string, unknown> }> = [];
  let account = 'manager@example.com';
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: economicsData({ actorEmail: account }) });
    posts.push(route.request().postDataJSON());
    return route.fulfill(posts.length === 1 ? { status: 503, json: { error: 'Temporary save response' } } : posts.length === 2 ? { status: 401, json: { error: 'Sign in again' } } : { json: { ok: true } });
  });
  await page.goto('/?view=instrument-economics');
  await openAdvanced(page);
  await page.getByLabel('Action').selectOption('record_capital');
  await page.getByRole('combobox', { name: /^Target/ }).selectOption('target-placement-1');
  await page.getByLabel('Signed amount (₹)').fill('100');
  await page.getByLabel('Entry kind').selectOption('capital');
  await page.getByLabel('Effective date').fill('2026-09-10');
  await page.getByLabel('Reason').fill('Reviewed instrument acquisition');
  await page.getByRole('button', { name: 'Record capital or contribution', exact: true }).click();
  await page.getByRole('button', { name: 'Retry saved command', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Sign in again');
  await expect(page.getByRole('button', { name: 'Retry saved command', exact: true })).toHaveCount(0);
  account = 'another-manager@example.com';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('saved command belongs to another account');
  await expect(page.getByLabel('Action')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Retry saved command', exact: true })).toHaveCount(0);
  expect(posts).toHaveLength(2);
  account = 'manager@example.com';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('button', { name: 'Retry saved command', exact: true }).click();
  await expect(page.getByText('Saved. Workspace refreshed with the latest records.')).toBeVisible();
  expect(posts).toHaveLength(3); expect(posts[1]).toEqual(posts[0]); expect(posts[2]).toEqual(posts[0]);
  expect(posts[0].payload.expectedActorEmail).toBe('manager@example.com');
});

test('non-JSON access rejection still clears financial figures', async ({ page }) => {
  let authorized = true;
  await page.route('**/api/instrument-economics', route => route.fulfill(authorized ? { json: economicsData() } : { status: 403, contentType: 'text/html', body: 'Access expired' }));
  await page.goto('/?view=instrument-economics');
  await expect(page.getByRole('heading', { name: 'Alpha chemistry analyzer', exact: true })).toBeVisible();
  authorized = false;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Financial access is no longer available');
  await expect(page.getByRole('region', { name: 'Economic targets', exact: true })).toHaveCount(0);
});

test('keeps explicit server errors visible and preserves entered product row values', async ({ page }) => {
  const posts: unknown[] = [];
  await page.route('**/api/instrument-economics', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: economicsData() });
    posts.push(route.request().postDataJSON()); return route.fulfill({ status: 400, json: { error: 'Expectation evidence is invalid' } });
  });
  await page.goto('/?view=instrument-economics'); await openAdvanced(page);
  await page.getByLabel('Action').selectOption('set_expectation');
  await page.getByLabel('Economic target').selectOption('target-placement-1');
  await page.getByLabel('Effective from').fill('2026-10-01');
  await page.getByLabel('Monthly revenue (₹)').fill('5000.00');
  await page.getByLabel('Monthly GP (₹)').fill('1500.00');
  await page.getByLabel('Reason').fill('Approved monthly commercial baseline');
  await page.getByLabel('Canonical product GUID').selectOption('product-guid-one');
  await page.getByLabel('Base unit').fill('test');
  await page.getByLabel('Expected units per month').fill('0.5');
  await page.getByLabel('Expected unit price (₹)').fill('500.00');
  await page.getByLabel('Expected unit cost (₹)').fill('350.00');
  await page.getByRole('button', { name: 'Add another product' }).click();
  await page.getByLabel('Canonical product GUID').nth(1).selectOption('product-guid-two');
  await page.getByLabel('Base unit').nth(1).fill('kit');
  await page.getByLabel('Expected units per month').nth(1).fill('4');
  await page.getByLabel('Expected unit price (₹)').nth(1).fill('900.00');
  await page.getByLabel('Expected unit cost (₹)').nth(1).fill('600.00');
  await page.getByRole('button', { name: 'Set expectation' }).click();
  await expect(page.getByRole('alert')).toContainText('Expectation evidence is invalid');
  await expect(page.getByLabel('Canonical product GUID').nth(1)).toHaveValue('product-guid-two');
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ action: 'set_expectation', payload: { monthlyRevenuePaise: '500000', monthlyGpPaise: '150000', items: [
    { productId: 'product-guid-one', baseUnit: 'test', expectedMonthlyUnits: '0.5', expectedUnitPricePaise: '50000', expectedUnitCostPaise: '35000' },
    { productId: 'product-guid-two', baseUnit: 'kit', expectedMonthlyUnits: '4', expectedUnitPricePaise: '90000', expectedUnitCostPaise: '60000' },
  ] } });
});

test('retries an unknown response with the exact saved command and idempotency key', async ({ page }) => {
  const posts: Array<{ action: string; payload: Record<string, unknown> }> = [];
  await page.route('**/api/instrument-economics', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: economicsData() });
    posts.push(route.request().postDataJSON());
    return route.fulfill(posts.length === 1 ? { status: 503, json: { error: 'Temporary gateway response' } } : { json: { ok: true } });
  });
  await page.goto('/?view=instrument-economics'); await openAdvanced(page);
  await page.getByLabel('Action').selectOption('set_expectation');
  await page.getByLabel('Economic target').selectOption('target-placement-1');
  await page.getByLabel('Effective from').fill('2026-10-01');
  await page.getByLabel('Monthly revenue (₹)').fill('5000.00'); await page.getByLabel('Monthly GP (₹)').fill('1500.00');
  await page.getByLabel('Reason').fill('Approved monthly commercial baseline');
  await page.getByLabel('Canonical product GUID').selectOption('product-guid-one'); await page.getByLabel('Base unit').fill('test');
  await page.getByLabel('Expected units per month').fill('10'); await page.getByLabel('Expected unit price (₹)').fill('500.00'); await page.getByLabel('Expected unit cost (₹)').fill('350.00');
  await page.getByRole('button', { name: 'Set expectation' }).click();
  await expect(page.getByRole('alert')).toContainText('Temporary gateway response');
  await expect(page.getByRole('button', { name: 'Retry saved command' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry saved command' }).click();
  await expect(page.getByText('Saved. Workspace refreshed with the latest records.')).toBeVisible();
  expect(posts).toHaveLength(2); expect(posts[1]).toEqual(posts[0]);
  expect(posts[0].payload.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
});

test('preserves the exact sign and paise of a capital adjustment with surrounding spaces', async ({ page }) => {
  const posts: Array<{ action: string; payload: Record<string, unknown> }> = [];
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: economicsData() });
    posts.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/?view=instrument-economics');
  await openAdvanced(page);
  await page.getByLabel('Action').selectOption('record_capital');
  await page.getByRole('combobox', { name: /^Target/ }).selectOption('target-placement-1');
  await page.getByLabel('Signed amount (₹)').fill(' -1.50 ');
  await page.getByLabel('Entry kind').selectOption('capital');
  await page.getByLabel('Effective date').fill('2026-09-10');
  await page.getByLabel('Reason').fill('Reviewed capital adjustment');
  await page.getByRole('button', { name: 'Record capital or contribution', exact: true }).click();
  await expect(page.getByText('Saved. Workspace refreshed with the latest records.')).toBeVisible();
  expect(posts).toHaveLength(1); expect(posts[0].payload.amountPaise).toBe('-150');
});

test('capital review sends explicit administrator approval without changing the investment amount', async ({ page }) => {
  const posts: Array<{ action: string; payload: Record<string, unknown> }> = [];
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: economicsData({ canAdministrator: true }) });
    posts.push(route.request().postDataJSON()); return route.fulfill({ status: 400, json: { error: 'Review configured approval limit' } });
  });
  await page.goto('/?view=instrument-economics');
  await openAdvanced(page);
  await page.getByLabel('Action').selectOption('record_capital');
  await page.getByRole('combobox', { name: /^Target/ }).selectOption(target.id);
  await page.getByLabel('Signed amount (₹)').fill('100000.01');
  await page.getByLabel('Entry kind').selectOption('capital');
  await page.getByLabel('Effective date').fill('2026-09-10');
  await page.getByLabel('Reason').fill('Approved additional capital review');
  await page.getByLabel('Administrator approval: I confirm this payback beyond the review band', { exact: true }).check();
  await page.getByRole('button', { name: 'Record capital or contribution', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Review configured approval limit');
  expect(posts).toHaveLength(1);
  expect(posts[0].payload).toMatchObject({ amountPaise: '10000001', directorException: true, kind: 'capital' });
});
test('FOC review submits its classification without requiring an original-sale link', async ({ page }) => {
  const data = economicsData();
  data.sourceLines.push({ ...data.sourceLines[0], id: 'foc-source', voucherId: 'FOC-1', netSalesPaise: '0' });
  const posts: Array<{ action: string; payload: Record<string, unknown> }> = [];
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: data });
    posts.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/?view=instrument-economics');
  await openAdvanced(page);
  await page.getByLabel('Action').selectOption('resolve_line');
  await page.getByLabel('Current unresolved source line', { exact: true }).selectOption('foc-source');
  await page.getByLabel('FOC reason when reviewing a zero-value sale', { exact: true }).selectOption('commercial_support');
  await page.getByLabel('Review evidence', { exact: true }).fill('Reviewed customer support material');
  await page.getByRole('button', { name: 'Review source line', exact: true }).click();
  await expect(page.getByText('Saved. Workspace refreshed with the latest records.')).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ action: 'resolve_line', payload: { sourceLineId: 'foc-source', focReason: 'commercial_support' } });
  expect(posts[0].payload.originalSaleLineId || null).toBeNull();
});
test('verifies a sale against multiple compatible historical purchases without guessing costs', async ({ page }) => {
  const posts: Array<{ action: string; payload: Record<string, unknown> }> = [];
  const data = economicsData({ attributionLines: [
    { id: 'result-missing-cost', sourceLineId: 'sale-line-1', targetId: 'target-placement-1', status: 'cost_unavailable', reason: 'Historical purchase linkage unavailable', shareBasisPoints: 10000, quantity: '10', revenuePaise: '500000', costPaise: null, gpPaise: null, date: '2026-09-10', voucherId: 'INV-100', revision: '1', productId: 'product-guid-one', productName: 'Reagent one', unit: 'test', costEvidence: null },
    { id: 'result-known-cost', sourceLineId: 'sale-line-2', targetId: 'target-placement-1', status: 'verified', reason: 'Verified purchase linkage', shareBasisPoints: 10000, quantity: '4', revenuePaise: '360000', costPaise: '200000', gpPaise: '160000', date: '2026-09-12', voucherId: 'INV-101', revision: '1', productId: 'product-guid-two', productName: 'Reagent two', unit: 'kit', costEvidence: 'PUR-03' },
  ] });
  data.sourceLines.push({ ...data.sourceLines[2], id: 'purchase-line-2', voucherId: 'PUR-02', date: '2026-09-02' });
  data.sourceLines.push({ ...data.sourceLines[2], id: 'purchase-too-late', voucherId: 'PUR-LATE', date: '2026-09-11' });
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: data });
    posts.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/?view=instrument-economics');
  await openAdvanced(page);
  await page.getByLabel('Action').selectOption('verify_cost');
  await expect(page.getByText('1 sale line needs cost evidence.', { exact: true })).toBeVisible();
  await expect(page.getByText('1 with several possible purchases', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Sale needing cost', { exact: true }).locator('option[value="sale-line-2"]')).toHaveCount(0);
  await expect(page.getByLabel('Sale needing cost', { exact: true }).locator('option[value="sale-line-1"]')).toContainText('2 possible purchases');
  await page.getByLabel('Sale needing cost', { exact: true }).selectOption('sale-line-1');
  await expect(page.getByText('Cover the complete sale quantity: 10 test.')).toBeVisible();
  await page.getByLabel('Purchase source 1', { exact: true }).selectOption('purchase-line-1');
  await expect(page.getByLabel('Purchase source 1', { exact: true }).locator('option[value="purchase-too-late"]')).toHaveCount(0);
  await page.getByLabel('Purchase quantity 1', { exact: true }).fill('4.25');
  await page.getByRole('button', { name: 'Add purchase source', exact: true }).click();
  await page.getByLabel('Purchase source 2', { exact: true }).selectOption('purchase-line-2');
  await page.getByLabel('Purchase quantity 2', { exact: true }).fill('5.75');
  await page.getByLabel('Evidence reference', { exact: true }).fill('Reviewed historical purchase lots');
  await page.getByRole('button', { name: 'Verify sale cost', exact: true }).click();
  await expect(page.getByText('Saved. Workspace refreshed with the latest records.')).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ action: 'verify_cost', payload: { sourceLineId: 'sale-line-1', purchaseAllocations: [
    { purchaseLineId: 'purchase-line-1', quantity: '4.25' }, { purchaseLineId: 'purchase-line-2', quantity: '5.75' },
  ] } });
  expect(posts[0].payload).not.toHaveProperty('costPaise');
});

test('shared reagent allocation supports three placements and rejects an incomplete percentage total', async ({ page }) => {
  const posts: Array<{ action: string; payload: Record<string, unknown> }> = [];
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: economicsData() });
    posts.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/?view=instrument-economics');
  await openAdvanced(page);
  await page.getByLabel('Action').selectOption('set_allocation');
  await page.getByLabel('Tally company GUID').fill('company-guid');
  await page.getByLabel('Canonical customer GUID').fill('canonical-customer-guid');
  await page.getByLabel('Site ID').fill('site-1');
  await page.getByLabel('Tally product GUID').fill('product-guid-one');
  await page.getByLabel('Effective from', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Reason', { exact: true }).fill('Verified shared usage split');
  await page.getByLabel('Allocation placement 1', { exact: true }).selectOption('target-placement-1');
  await page.getByLabel('Allocation share 1 (%)', { exact: true }).fill('33.33');
  await page.getByLabel('Allocation placement 2', { exact: true }).selectOption('target-critical');
  await page.getByLabel('Allocation share 2 (%)', { exact: true }).fill('33.33');
  await page.getByRole('button', { name: 'Add allocation placement', exact: true }).click();
  await page.getByLabel('Allocation placement 3', { exact: true }).selectOption('target-inactive');
  await page.getByLabel('Allocation share 3 (%)', { exact: true }).fill('33.33');
  await page.getByRole('button', { name: 'Set product allocation', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Allocation shares must total exactly 100%.');
  expect(posts).toHaveLength(0);
  await page.getByLabel('Allocation share 3 (%)', { exact: true }).fill('33.34');
  await page.getByRole('button', { name: 'Set product allocation', exact: true }).click();
  await expect(page.getByText('Saved. Workspace refreshed with the latest records.')).toBeVisible();
  expect(posts[0]).toMatchObject({ action: 'set_allocation', payload: { shares: [
    { targetId: 'target-placement-1', basisPoints: 3333 }, { targetId: 'target-critical', basisPoints: 3333 }, { targetId: 'target-inactive', basisPoints: 3334 },
  ] } });
});

for (const resolution of ['accepted', 'not_saved'] as const) {
  test(`reload recovers an uncertain capital save as ${resolution} without storing its financial payload`, async ({ page }) => {
    const posts: Array<{ action: string; payload: Record<string, unknown> }> = [];
    let account = 'manager@example.com';
    await page.route('**/api/instrument-economics', route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: economicsData({ actorEmail: account }) });
      const post = route.request().postDataJSON(); posts.push(post);
      if (post.action !== 'recover_economic_command') return route.fulfill({ status: 503, json: { error: 'Unknown save response' } });
      return route.fulfill({ json: { status: resolution === 'accepted' ? 'accepted' : post.payload.closeUnresolved ? 'not_saved' : 'unresolved' } });
    });
    await page.goto('/?view=instrument-economics');
    await openAdvanced(page);
    await page.getByLabel('Action').selectOption('record_capital');
    await page.getByRole('combobox', { name: /^Target/ }).selectOption('target-placement-1');
    await page.getByLabel('Signed amount (₹)').fill('1234.56');
    await page.getByLabel('Entry kind').selectOption('capital');
    await page.getByLabel('Effective date').fill('2026-09-10');
    await page.getByLabel('Reason').fill('Private instrument investment reference');
    await page.getByRole('button', { name: 'Record capital or contribution', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Unknown save response');
    const stored = await page.evaluate(() => sessionStorage.getItem('suprabha-economic-command-reference-v1'));
    expect(JSON.parse(stored!)).toEqual({ action: 'record_capital', key: posts[0].payload.idempotencyKey, actorEmail: account });
    expect(stored).not.toMatch(/123456|target-placement|Private instrument/);
    account = 'another-manager@example.com'; await page.reload();
    await expect(page.getByRole('alert')).toContainText('saved command belongs to another account');
    await expect(page.getByRole('button', { name: 'Check saved command', exact: true })).toHaveCount(0);
    account = 'manager@example.com'; await page.reload();
    await openAdvanced(page);
    await expect(page.getByLabel('Action')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Retry saved command', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Check saved command', exact: true }).click();
    if (resolution === 'not_saved') {
      await expect(page.getByRole('alert')).toContainText('result is still unknown');
      await expect(page.getByLabel('Action')).toBeDisabled();
      await page.getByRole('button', { name: 'Close unresolved request', exact: true }).click();
      await expect(page.getByText('The request was closed before saving. Late delivery is blocked; you can enter a new command.')).toBeVisible();
    } else await expect(page.getByText('The original command was saved. Workspace refreshed.')).toBeVisible();
    await expect(page.getByLabel('Action')).toBeEnabled();
    expect(posts.filter(post => post.action === 'record_capital')).toHaveLength(1);
    expect(posts.slice(1).every(post => post.payload.commandKey === posts[0].payload.idempotencyKey)).toBe(true);
    expect(await page.evaluate(() => sessionStorage.getItem('suprabha-economic-command-reference-v1'))).toBeNull();
  });
}

test('leakage classification requires evidence and submits multiple reasons without asserting a causal split', async ({ page }) => {
  const posts: Array<{ action: string; payload: Record<string, unknown> }> = [];
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: economicsData({ canAct: true, leakage: [{ targetId: target.id, productId: 'product-guid-one', windowFrom: '2026-09-01', windowTo: '2026-10-01', expectedUnits: '100', actualUnits: '60', shortfallUnits: '40', potentialRevenuePaise: '200000', potentialGpPaise: '60000', evidenceTier: 'supply_proxy', status: 'review_required' }] }) });
    posts.push(route.request().postDataJSON()); return route.fulfill({ status: 400, json: { error: 'Keep evidence for review' } });
  });
  await page.goto('/?view=instrument-economics');
  await openAdvanced(page, 'Reagent leakage');
  await page.getByLabel('Case title', { exact: true }).fill('Review laboratory supply gap');
  await page.getByLabel('Reason', { exact: true }).fill('Customer sourcing investigation');
  await page.getByLabel('Owner', { exact: true }).fill('manager@example.com');
  await page.getByLabel('Follow-up action', { exact: true }).fill('Review visit evidence and pricing');
  await page.getByRole('combobox', { name: 'Primary reason', exact: true }).selectOption('competitor_sourcing');
  await page.getByRole('combobox', { name: 'Reason confidence', exact: true }).selectOption('confirmed');
  await page.getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Confirmed reasons require a supporting evidence reference');
  expect(posts).toHaveLength(0);
  await page.getByLabel('Classification evidence reference', { exact: true }).fill('Visit VN-12 / customer supplier invoice');
  await page.getByText('Additional contributing reasons', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Pricing / discount pressure', exact: true }).check();
  await page.getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Keep evidence for review');
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ action: 'create_case', payload: { primaryReason: 'competitor_sourcing', reasonCodes: ['competitor_sourcing', 'pricing_pressure'], confidence: 'confirmed', evidenceReference: 'Visit VN-12 / customer supplier invoice' } });
  await expect(page.getByLabel('Classification evidence reference', { exact: true })).toHaveValue('Visit VN-12 / customer supplier invoice');
});

for (const status of ['dismissed', 'no_recovery'] as const) {
  test(`${status} cases require reopening before recording new recovery`, async ({ page }) => {
    await mockWorkspace(page, economicsData({ canAct: true, cases: [{ id: 'closed-case', targetId: target.id, title: 'Closed supply review', reason: 'Review concluded', status, owner: 'manager@example.com', dueDate: null, action: 'Review supply', outcome: 'Review completed without recovery', version: 2, potentialRevenuePaise: '200000', potentialGpPaise: '60000', recoveredRevenuePaise: '0', recoveredGpPaise: '0' }] }));
    await openAdvanced(page, 'Reagent leakage');
    await expect(page.getByText('Reopen this case before recording new recovery evidence.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Claim recovery', exact: true })).toBeDisabled();
    await expect(page.getByRole('combobox', { name: /^Follow-up sale source line/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Update case', exact: true })).toBeEnabled();
  });
}
test('read-only case review shows frozen estimate evidence and only its own audit history', async ({ page }) => {
  await mockWorkspace(page, economicsData({ canManage: true, canAct: false, cases: [{ id: 'case-review-1', targetId: target.id, title: 'Laboratory supply review', reason: 'Customer sourcing investigation', status: 'qualified', owner: 'manager@example.com', dueDate: null, action: 'Review visit', outcome: '', version: 2, primaryReason: 'competitor_sourcing', reasonCodes: ['competitor_sourcing'], confidence: 'confirmed', evidenceReference: 'Visit VN-12', potentialRevenuePaise: '200000', potentialGpPaise: '60000', recoveredRevenuePaise: '0', recoveredGpPaise: '0', evaluation: { expectationId: 'baseline-immutable-1', generationId: 'source-generation-1', evaluatedAt: '2026-10-08T10:00:00Z', evidenceTier: 'inventory_reconciled', expectedUnits: '100', actualUnits: '60', shortfallUnits: '40' } }], caseHistory: [{ id: 'event-1', caseId: 'case-review-1', action: 'update_case', actor: 'reviewer@example.com', recordedAt: '2026-10-08T11:00:00Z', payload: { status: 'qualified', classification: { primaryReason: 'competitor_sourcing', confidence: 'confirmed', evidenceReference: 'Visit VN-12' } } }, { id: 'event-2', caseId: 'another-case', action: 'update_case', actor: 'private-other-case@example.com', recordedAt: '2026-10-08T11:00:00Z', payload: { outcome: 'Unrelated case outcome' } }] }));
  await openAdvanced(page, 'Reagent leakage');
  await page.getByText('Original estimate evidence', { exact: true }).click();
  await expect(page.getByText('Expected units at creation', { exact: true })).toBeVisible();
  await expect(page.getByText(/Baseline reference: baseline-immutable-1/)).toBeVisible();
  await page.getByText('Case history', { exact: true }).click();
  await expect(page.getByText('Case updated', { exact: true })).toBeVisible();
  await expect(page.getByText('reviewer@example.com', { exact: true })).toBeVisible();
  await expect(page.getByText('private-other-case@example.com', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Update case', exact: true })).toHaveCount(0);
});

test('leakage separates signed financial variance from supply-gap estimates and blocks ambiguous valuations', async ({ page }) => {
  await mockWorkspace(page, economicsData({ leakage: [{ targetId: target.id, productId: 'product-guid-one', windowFrom: '2026-09-01', windowTo: '2026-10-01', expectedUnits: '100', actualUnits: '70', shortfallUnits: '30', potentialRevenuePaise: '300000', potentialGpPaise: '120000', evidenceTier: 'supply_proxy', status: 'potential_shortfall', attributionComplete: true, expectedRevenuePaise: '1000000', actualRevenuePaise: '0', revenueVariancePaise: '-1000000', expectedGpPaise: '400000', actualGpPaise: '-3200000', gpVariancePaise: '-3600000', financialVarianceStatus: 'verified' }, { targetId: target.id, productId: 'product-guid-two', windowFrom: '2026-09-01', windowTo: '2026-10-01', expectedUnits: '10', actualUnits: '0', shortfallUnits: '10', potentialRevenuePaise: null, potentialGpPaise: null, evidenceTier: 'supply_proxy', status: 'data_review_required', attributionComplete: false, expectedRevenuePaise: null, actualRevenuePaise: null, revenueVariancePaise: null, expectedGpPaise: null, actualGpPaise: null, gpVariancePaise: null, financialVarianceStatus: 'data_review_required' }] }));
  await openAdvanced(page, 'Reagent leakage');
  const panels = page.getByText('Actual economics vs baseline', { exact: true });
  await panels.first().click();
  await expect(page.getByText('−₹10,000.00', { exact: true })).toBeVisible();
  await expect(page.getByText('−₹36,000.00', { exact: true })).toBeVisible();
  await expect(page.getByText(/They overlap with supply-gap estimates and must not be added together/).first()).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Resolve mappings before valuing the supply gap');
  await panels.nth(1).click();
  await expect(page.getByText('Financial evidence needs review before these values can be relied on.', { exact: true })).toBeVisible();
});

for (const [status, months, label, color] of [
  ['review_required', 40, 'Investment review required', 'border-sf-warning-line'],
  ['limit_exceeded', 55, 'Investment payback limit exceeded', 'border-sf-danger-line'],
] as const) {
  test(`instrument billing restatement exposes ${status} separately from the actual forecast`, async ({ page }, testInfo) => {
    await mockWorkspace(page, economicsData({ targets: [{ ...target, capitalPaise: '55000000', instrumentBillingPaise: String(55000000 - months * 1000000), netInvestmentPaise: String(months * 1000000), recoveryPaise: String(78000000 - months * 1000000), outstandingPaise: String(months * 1000000 - 23000000), health: status === 'limit_exceeded' ? 'critical' : 'watch', forecastMonths: 18, investmentReview: { status, expectedPaybackMonths: months, expectationId: 'approved-start-baseline', policyId: 'policy-1', expectedMonthlyGpPaise: '1000000', netInvestmentPaise: String(months * 1000000), reviewMonths: 36, exceptionMonths: 48, approvedPaybackMonths: 35, approvedNetInvestmentPaise: '35000000', approvedDirectorException: false } }] }));
    await openAdvanced(page, 'Reports');
    const review = page.getByRole('region', { name: 'Investment payback review' });
    await expect(review.getByText(label, { exact: true })).toBeVisible();
    await expect(review).toHaveClass(new RegExp(color));
    await expect(review).toContainText(`Expected investment payback: ${months} months`);
    await expect(review).toContainText('Original approval: 35 months');
    await expect(page.locator('section').filter({ has: page.getByRole('heading', { name: 'Planning and payback', exact: true }) }).getByText('18 months', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('investment-review.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test.describe('Indian evidence timestamp display', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('source freshness stays on the Indian business clock in another browser timezone', async ({ page }) => {
    await mockWorkspace(page, economicsData({ sourceImportedAt: '2026-09-30T18:30:00Z', lastRebuiltAt: '2026-09-30T18:31:00Z' }));
    await openAdvanced(page, 'Reports');
    const coverage = page.getByRole('region', { name: 'Economics data coverage' });
    await expect(coverage).toContainText('1 Oct 2026');
    await expect(coverage).toContainText('12:00 am');
    await expect(coverage).toContainText('Figures recalculated 1 Oct 2026, 12:01 am');
  });
});

for (const [status, months, actualGp, health, label] of [
  ['review_required', 43, 1250000, 'watch', 'Actual recovery forecast needs review'],
  ['limit_exceeded', 109, 500000, 'critical', 'Actual recovery forecast exceeds limit'],
  ['non_positive_gp', null, 0, 'critical', 'Actual GP does not support recovery'],
] as const) {
  test(`low actual reagent GP exposes ${status} despite an acceptable approval baseline`, async ({ page }, testInfo) => {
    await mockWorkspace(page, economicsData({ targets: [{ ...target, health, capitalPaise: '55000000', instrumentBillingPaise: '0', netInvestmentPaise: '55000000', recoveryPaise: String(actualGp), outstandingPaise: String(55000000 - actualGp), knownGpPaise: String(actualGp), revenuePaise: '5000000', forecastMonths: months,
      expectation: { ...target.expectation, monthlyRevenuePaise: '6000000', monthlyGpPaise: '1800000' },
      forecastReview: { status, policyId: 'policy-1', reviewMonths: 36, exceptionMonths: 48 },
      investmentReview: { status: 'within_limit', expectedPaybackMonths: 30.56, expectationId: 'approval-baseline', policyId: 'policy-1', expectedMonthlyGpPaise: '1800000', netInvestmentPaise: '55000000', reviewMonths: 36, exceptionMonths: 48, approvedPaybackMonths: 30.5555555555555556 },
    }] }));
    await openAdvanced(page, 'Reports');
    const review = page.getByRole('region', { name: 'Actual GP forecast review' });
    await expect(review.getByText(label, { exact: true })).toBeVisible();
    await expect(review).toContainText(`Actual recovery forecast: ${months == null ? 'Unavailable' : `${months} months`}`);
    await expect(page.getByRole('region', { name: 'Investment payback review' })).toContainText('Investment within review limit');
    await expect(page.getByRole('region', { name: 'Investment payback review' })).toContainText('Original approval: 30.56 months');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('actual-payback-review.png'), fullPage: true });
  });
}


test('mapping suggestions stay company-scoped and submit exact IDs for a placement override', async ({ page }, testInfo) => {
  const posts: Record<string, unknown>[] = [];
  const base = economicsData();
  const data = economicsData({ targets: [target, { ...target, id: 'other-placement', companyId: 'other-company', name: 'Other company analyzer' }, { ...target, id: 'other-model', modelId: 'model-2', name: 'Other model analyzer' }], sourceLines: [
    ...base.sourceLines,
    { ...base.sourceLines[0], id: 'named-sale', productName: 'Chemistry reagent', date: '2026-09-20' },
    { ...base.sourceLines[0], id: 'same-name', productId: 'same-name-distinct-guid', productName: 'Chemistry reagent', date: '2026-09-21' },
    { ...base.sourceLines[0], id: 'foreign-product', companyId: 'other-company', productId: 'foreign-guid', productName: 'Foreign reagent' },
  ] });
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: data });
    posts.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/?view=instrument-economics');
  await openAdvanced(page);
  await page.getByRole('combobox', { name: 'Action', exact: true }).selectOption('set_mapping');
  await page.getByRole('button', { name: 'Advanced: model-wide mapping or verified IDs', exact: true }).click();
  const identity = page.getByRole('region', { name: 'Product mapping identity' });
  await identity.getByLabel('Tally company GUID').fill('company-guid');
  await identity.getByLabel('Model ID').fill('model-1');
  const suggestions = identity.locator('datalist').nth(2);
  await expect(suggestions.locator('option[value="product-guid-one"]')).toHaveAttribute('label', 'Chemistry reagent');
  await expect(suggestions.locator('option[value="same-name-distinct-guid"]')).toHaveCount(1);
  await expect(suggestions.locator('option[value="product-guid-one"]')).toHaveCount(1);
  await expect(suggestions.locator('option[value="foreign-guid"]')).toHaveCount(0);
  await expect(identity.getByLabel('Mapping applies to').locator('option')).toHaveCount(2);
  await identity.getByLabel('Tally product GUID').fill('same-name-distinct-guid');
  await expect(identity.getByText('Selected product: Chemistry reagent', { exact: true })).toBeVisible();
  await identity.getByLabel('Mapping applies to').selectOption(target.id);
  await page.getByRole('button', { name: 'Change dates, exclusion or note', exact: true }).click();
  await page.getByLabel('Effect', { exact: true }).selectOption('include');
  await page.getByLabel('Effective from', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Reason', { exact: true }).fill('Reviewed instrument compatibility');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/UI-PREVIEWS/instrument-mapping-' + (testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop') + '.png', fullPage: true });
  await page.getByRole('button', { name: 'Set product mapping', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ action: 'set_mapping', payload: { companyId: 'company-guid', modelId: 'model-1', productId: 'same-name-distinct-guid', targetId: target.id } });
  expect(JSON.stringify(posts[0])).not.toContain('Chemistry reagent');
});

test('changing mapping company or model clears incompatible selection', async ({ page }) => {
  const base = economicsData();
  await mockWorkspace(page, economicsData({ targets: [target, { ...target, id: 'other-placement', companyId: 'other-company' }], sourceLines: [...base.sourceLines, { ...base.sourceLines[0], id: 'other-sale', companyId: 'other-company', productId: 'other-product' }] }));
  await openAdvanced(page);
  await page.getByRole('combobox', { name: 'Action', exact: true }).selectOption('set_mapping');
  await page.getByRole('button', { name: 'Advanced: model-wide mapping or verified IDs', exact: true }).click();
  const identity = page.getByRole('region', { name: 'Product mapping identity' });
  await identity.getByLabel('Tally company GUID').fill('company-guid');
  await identity.getByLabel('Model ID').fill('model-1');
  await identity.getByLabel('Tally product GUID').fill('product-guid-one');
  await identity.getByLabel('Mapping applies to').selectOption(target.id);
  await identity.getByLabel('Model ID').fill('model-2');
  await expect(identity.getByLabel('Mapping applies to')).toHaveValue('');
  await identity.getByLabel('Tally company GUID').fill('other-company');
  await expect(identity.getByLabel('Model ID')).toHaveValue('');
  await expect(identity.getByLabel('Tally product GUID')).toHaveValue('');
  await expect(identity.locator('datalist').nth(2).locator('option[value="product-guid-one"]')).toHaveCount(0);
  await expect(identity.locator('datalist').nth(2).locator('option[value="other-product"]')).toHaveCount(1);
});

test('verified IDs outside imported history still permit a model mapping', async ({ page }) => {
  const posts: Record<string, unknown>[] = [];
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: economicsData() });
    posts.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/?view=instrument-economics');
  await openAdvanced(page);
  await page.getByRole('combobox', { name: 'Action', exact: true }).selectOption('set_mapping');
  await page.getByRole('button', { name: 'Advanced: model-wide mapping or verified IDs', exact: true }).click();
  await page.getByLabel('Tally company GUID', { exact: true }).fill('verified-unimported-company');
  await page.getByLabel('Model ID', { exact: true }).pressSequentially('SYS 240');
  await page.getByLabel('Tally product GUID', { exact: true }).fill('verified-unimported-product');
  await page.getByRole('button', { name: 'Change dates, exclusion or note', exact: true }).click();
  await page.getByLabel('Effect', { exact: true }).selectOption('include');
  await page.getByLabel('Effective from', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Reason', { exact: true }).fill('Verified master record and manufacturer compatibility');
  await page.getByRole('button', { name: 'Set product mapping', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ payload: { companyId: 'verified-unimported-company', modelId: 'SYS 240', productId: 'verified-unimported-product', targetId: '' } });
});

test('item group mapping follows the selected placement company and submits exact IDs', async ({ page }) => {
  const posts: Record<string, unknown>[] = [];
  const base = economicsData();
  const data = economicsData({
    targets: [target, { ...target, id: 'foreign-placement', companyId: 'other-company', modelId: 'model-foreign', name: 'Foreign analyzer' }],
    itemGroupCatalogs: [
      { id: 'catalog-company', companyId: 'company-guid', sourceVersion: 'v42', observedAt: '2026-10-09T10:00:00.000Z', current: true, groups: [{ id: 'group-reagents', name: 'Reagents', parentId: null, itemCount: 7 }], products: [] },
      { id: 'catalog-foreign', companyId: 'other-company', sourceVersion: 'v9', observedAt: '2026-10-09T10:00:00.000Z', current: true, groups: [{ id: 'foreign-group', name: 'Foreign supplies', parentId: null, itemCount: 3 }], products: [] },
      { id: 'catalog-stale', companyId: 'company-guid', sourceVersion: 'v41', observedAt: '2026-10-08T10:00:00.000Z', current: false, groups: [{ id: 'stale-group', name: 'Old group', parentId: null, itemCount: 9 }], products: [] },
    ],
    sourceLines: base.sourceLines,
  });
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: data });
    posts.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/?view=instrument-economics');
  await openAdvanced(page);
  await page.getByRole('combobox', { name: 'Action', exact: true }).selectOption('set_item_group_mapping');
  const identity = page.getByRole('region', { name: 'Item group mapping identity' });
  await expect(identity.getByText('All items in the selected group, including subgroups, contribute reagent sales and GP.', { exact: false })).toBeVisible();
  const placement = identity.getByLabel('Instrument placement');
  const group = identity.getByLabel('Tally item group');
  await placement.selectOption('target-placement-1');
  await expect(group.locator('option[value="group-reagents"]')).toContainText('Reagents · 7 items');
  await expect(group.locator('option[value="foreign-group"]')).toHaveCount(0);
  await expect(group.locator('option[value="stale-group"]')).toHaveCount(0);
  await group.selectOption('group-reagents');
  await placement.selectOption('foreign-placement');
  await expect(group).toHaveValue('');
  await expect(group.locator('option[value="group-reagents"]')).toHaveCount(0);
  await expect(group.locator('option[value="foreign-group"]')).toHaveCount(1);
  await placement.selectOption('target-placement-1');
  await group.selectOption('group-reagents');
  await page.getByRole('button', { name: 'Change dates, exclusion or note', exact: true }).click();
  await page.getByLabel('Effect', { exact: true }).selectOption('include');
  await page.getByLabel('Effective from', { exact: true }).fill('2026-10-01');
  await page.getByLabel('Effective to', { exact: true }).fill('');
  await page.getByLabel('Reason', { exact: true }).fill('Verified reagent group for this analyzer');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Map item group to instrument', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ action: 'set_item_group_mapping', payload: {
    companyId: 'company-guid', modelId: 'model-1', targetId: 'target-placement-1', groupId: 'group-reagents',
    expectedCatalogId: 'catalog-company', effect: 'include', effectiveFrom: '2026-10-01', effectiveTo: '', reason: 'Verified reagent group for this analyzer',
  } });
  expect(JSON.stringify(posts[0])).not.toContain('Reagents');
});

test('item group mapping shows empty and stale catalog states and blocks submission without a current group', async ({ page }) => {
  const posts: Record<string, unknown>[] = [];
  const data = economicsData({ targets: [...economicsData().targets, { ...target, id: 'foreign-placement', companyId: 'other-company', modelId: 'model-foreign', name: 'Foreign analyzer' }], itemGroupCatalogs: [
    { id: 'catalog-empty', companyId: 'company-guid', sourceVersion: 'v42', observedAt: '2026-10-09T10:00:00.000Z', current: true, groups: [], products: [] },
    { id: 'catalog-stale', companyId: 'other-company', sourceVersion: 'v41', observedAt: '2026-10-08T10:00:00.000Z', current: false, groups: [{ id: 'stale-group', name: 'Old group', parentId: null, itemCount: 9 }], products: [] },
  ] });
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: data });
    posts.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/?view=instrument-economics');
  await openAdvanced(page);
  await page.getByRole('combobox', { name: 'Action', exact: true }).selectOption('set_item_group_mapping');
  const identity = page.getByRole('region', { name: 'Item group mapping identity' });
  const placement = identity.getByLabel('Instrument placement');
  await placement.selectOption('target-placement-1');
  await expect(identity.getByText('The current Tally catalog has no item groups to map.', { exact: true })).toBeVisible();
  await placement.selectOption('foreign-placement');
  await expect(identity.getByText('No current item group catalog is available for this company.', { exact: false })).toBeVisible();
  await expect(identity.getByLabel('Tally item group').locator('option[value="stale-group"]')).toHaveCount(0);
  await placement.selectOption('target-placement-1');
  await page.getByRole('button', { name: 'Change dates, exclusion or note', exact: true }).click();
  await page.getByLabel('Effect', { exact: true }).selectOption('include');
  await page.getByLabel('Effective from', { exact: true }).fill('2026-10-01');
  await page.getByLabel('Reason', { exact: true }).fill('No group catalog entries exist');
  await page.getByRole('button', { name: 'Map item group to instrument', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Select an instrument and a group from its current Tally item catalog');
  expect(posts).toHaveLength(0);
});

test('selected placement details retain item group mapping versions and current Tally membership', async ({ page }) => {
  const data = economicsData({
    itemGroupCatalogs: [{ id: 'catalog-company', companyId: 'company-guid', sourceVersion: 'v42', observedAt: '2026-10-09T10:00:00.000Z', current: true, groups: [
      { id: 'group-reagents', name: 'Reagents', parentId: null, itemCount: 7 },
      { id: 'group-old', name: 'Legacy reagents', parentId: null, itemCount: 2 },
    ], products: [] }],
    itemGroupMappings: [
      { id: 'mapping-current', companyId: 'company-guid', modelId: 'model-1', groupId: 'group-reagents', targetId: target.id, effect: 'include', effectiveFrom: '2026-10-01', effectiveTo: null, catalogId: 'catalog-company', reason: 'Current reagent group for this analyzer' },
      { id: 'mapping-old', companyId: 'company-guid', modelId: 'model-1', groupId: 'group-old', targetId: target.id, effect: 'exclude', effectiveFrom: '2025-01-01', effectiveTo: '2026-01-01', catalogId: 'catalog-old', reason: 'Prior group review retained for audit' },
    ],
  });
  await mockWorkspace(page, data);
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: target.name, exact: true }) });
  await card.getByRole('button', { name: 'Sales & items', exact: true }).click();
  const details = page.getByRole('region', { name: 'Instrument sales' });
  const mappingDetails = details.locator('details').filter({ hasText: 'Item group mappings (2)' });
  await expect(mappingDetails).toBeVisible();
  await mappingDetails.locator('summary').click();
  await expect(mappingDetails.getByText('Reagents', { exact: true })).toBeVisible();
  await expect(mappingDetails.getByText('Legacy reagents', { exact: true })).toBeVisible();
  await expect(mappingDetails).toContainText('Reagents · include');
  await expect(mappingDetails).toContainText('Legacy reagents · exclude');
  await expect(mappingDetails.getByText('2026-10-01 · open-ended · Current Tally membership: 7 items.', { exact: true })).toBeVisible();
  await expect(mappingDetails.getByText('2025-01-01 until 2026-01-01 (exclusive) · Current Tally membership: 2 items.', { exact: true })).toBeVisible();
  await expect(mappingDetails.getByText('Prior group review retained for audit', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


test('monthly item GP breakdown shows unique billed items and partial costs without duplicate names merging', async ({ page }, testInfo) => {
  await mockWorkspace(page, economicsData({ targets: [{ ...target, revenuePaise: '6000000', knownGpPaise: '1940000', missingCostLines: 1, attributedLines: 5, itemBreakdown: [
    { productId: 'reagent-a', productName: 'Shared reagent name', unit: 'pack', quantity: '0.800000', revenuePaise: '4000000', knownCostPaise: '2560000', knownGpPaise: '1440000', sourceLines: 2, missingCostLines: 0 },
    { productId: 'reagent-b', productName: 'Shared reagent name', unit: 'kit', quantity: '1.250001', revenuePaise: '2000000', knownCostPaise: '500000', knownGpPaise: '1000000', sourceLines: 2, missingCostLines: 1 },
    { productId: 'foc-control', productName: 'FOC control', unit: 'pack', quantity: '1', revenuePaise: '0', knownCostPaise: '500000', knownGpPaise: '-500000', sourceLines: 1, missingCostLines: 0 },
  ] }] }));
  await openAdvanced(page, 'Reports');
  const region = page.getByRole('region', { name: 'Item sales and GP breakdown' });
  await expect(region).toBeVisible();
  await expect(region.getByText('Unique billed items', { exact: true })).toBeVisible();
  await expect(region.locator('dd').first()).toHaveText('3');
  await expect(region.getByText('September 2026', { exact: false })).toBeVisible();
  await expect(region.getByRole('table').getByRole('row')).toHaveCount(4);
  const a = region.getByRole('row').filter({ hasText: 'reagent-a' });
  await expect(a.getByText('0.8 pack', { exact: true })).toBeVisible();
  await expect(a.getByText('₹14,400.00', { exact: true })).toBeVisible();
  const b = region.getByRole('row').filter({ hasText: 'reagent-b' });
  await expect(b.getByText('1.250001 kit', { exact: true })).toBeVisible();
  await expect(b.getByText('Partial · 1 line missing cost', { exact: true })).toBeVisible();
  const foc = region.getByRole('row').filter({ hasText: 'foc-control' });
  await expect(foc.getByText('−₹5,000.00', { exact: true })).toBeVisible();
  const scroll = region.getByRole('region', { name: 'Scrollable item breakdown' });
  await scroll.focus();
  await expect(scroll).toBeFocused();
  if (testInfo.project.name.includes('mobile')) {
    await expect(region.getByText('Swipe the item table to see purchase cost, GP and cost status.', { exact: true })).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    await scroll.evaluate(element => { element.scrollLeft = 0; });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await region.screenshot({ path: 'docs/UI-PREVIEWS/instrument-item-gp-' + (testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop') + '.png' });
});

test('simple investment view works without planning expectations and keeps details optional', async ({ page }, testInfo) => {
  await mockWorkspace(page, economicsData({ targets: [{ ...target, expectation: null, capitalPaise: '62500000', instrumentBillingPaise: '40000000', netInvestmentPaise: '22500000', recoveryPaise: '45000000', outstandingPaise: '17500000' }] }));
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: target.name, exact: true }) });
  await expect(card.getByRole('region', { name: 'Investment and recovery' })).toContainText('₹2,25,000.00');
  await expect(card.getByRole('region', { name: 'Investment and recovery' })).toContainText('₹50,000.00');
  await expect(card.getByRole('region', { name: 'Investment and recovery' })).toContainText('₹1,75,000.00');
  // Planning and payback detail is not on the simple card; Administrators find it under Advanced.
  await expect(card.getByText('Invoice and planning details', { exact: true })).toHaveCount(0);
  await expect(card.getByText('Expected sales / GP: not set.', { exact: false })).toHaveCount(0);
  await card.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `docs/UI-PREVIEWS/instrument-simple-investment-${testInfo.project.name}.png`, fullPage: false });
});

test('simple view sends missing Tally purchases to To do and shows the three set-up steps', async ({ page }, testInfo) => {
  const sale = { id: 'sale-calcium', companyId: 'company-guid', voucherId: 'tally-guid-0404', voucherNumber: 'SD/26-27/0404', revision: '1', lineKey: '5', date: '2026-07-25', kind: 'sale', customerSourceId: 'canonical-customer-guid', productId: 'calcium', productName: 'SYS 480 Calcium AS FS', quantity: '2.000000', unit: 'qty', netSalesPaise: '586000', batchId: '0652605' };
  const purchase = { ...sale, id: 'purchase-calcium', voucherId: 'tally-guid-1164', voucherNumber: '1164MF/CDI/2627', kind: 'purchase', customerSourceId: null, quantity: '1.000000', netSalesPaise: '0', batchId: '0652505' };
  await mockWorkspace(page, economicsData({ targets: [{ ...target, health: 'data_incomplete', missingCostLines: 1 }], sourceLines: [sale, purchase],
    attributionLines: [{ id: 'result-calcium', sourceLineId: sale.id, targetId: target.id, status: 'cost_unavailable', reason: 'Historical purchase linkage unavailable', shareBasisPoints: 10000, quantity: '2', revenuePaise: '586000', costPaise: null, gpPaise: null, date: sale.date, voucherId: sale.voucherId, revision: '1', productId: sale.productId, productName: sale.productName, unit: 'qty', costEvidence: null }],
    exceptions: [{ sourceId: 'import', productId: '', date: '2026-08-05', netSalesPaise: '0', status: 'import_rejected', reason: 'Incomplete voucher identity, lines or net economic values', voucherNumber: '6466', voucherType: 'Sales', voucherDate: '2026-10-10', detail: 'Canonical customer GUID unavailable in the master export.' }, { sourceId: 'other-customer:1', productId: 'x', date: '2026-08-05', netSalesPaise: '1000', status: 'unattributed', reason: 'no_verified_compatible_placement' }] }));
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: target.name, exact: true }) });
  await expect(card.getByText('Reagent sales since 1 Jan 2025', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: '1 sale needs purchase-cost review · See To do', exact: true }).click();
  const todo = page.getByRole('region', { name: 'Sales without purchase cost' });
  await expect(todo).toContainText('SYS 480 Calcium AS FS · 2 qty · ₹5,860.00');
  await expect(todo).toContainText('Tally SD/26-27/0404 line 5 · batch 0652605');
  await expect(todo).toContainText('Tally purchases of this item are less than the quantity sold.');
  await expect(page.getByRole('region', { name: 'Tally import problems' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Accounts review (1)', exact: true }).click();
  const problems = page.getByRole('region', { name: 'Tally import problems' });
  await expect(problems.getByRole('heading', { name: 'Tally documents needing review (1)' })).toBeVisible();
  await expect(problems).toContainText('This covers imported Tally data across instruments.');
  await expect(problems.getByText("The party ledger on this invoice wasn't found in Tally's customer list.", { exact: true })).not.toBeVisible();
  await problems.getByText('Show document details (1)', { exact: true }).click();
  await expect(problems.getByText('Sales invoice 6466 · 10 Oct 2026', { exact: true })).toBeVisible();
  await expect(problems.getByText("The party ledger on this invoice wasn't found in Tally's customer list.", { exact: true })).toBeVisible();
  await expect(problems).not.toContainText('no_verified_compatible_placement');
  await page.getByRole('navigation', { name: 'Economics sections' }).getByRole('button', { name: 'Set up', exact: true }).click();
  for (const step of ['Step 1: Choose the instrument', 'Step 2: Investment and approval', 'Step 3: Choose reagent items']) await expect(page.getByRole('region', { name: step })).toBeVisible();
  await expect(page.getByLabel('Action', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `docs/UI-PREVIEWS/instrument-simple-setup-${testInfo.project.name}.png`, fullPage: false });
});

test('instrument items panel suggests related items but searches all groups with explicit add/remove dates', async ({ page }) => {
  const posts: Array<{ action: string; payload: Record<string, unknown> }> = [];
  const sale = { id: 'amylase-sale', companyId: 'company-guid', voucherId: 'tally-0494', voucherNumber: 'SD/26-27/0494', revision: '1', lineKey: '3', date: '2026-09-20', kind: 'sale', customerSourceId: 'canonical-customer-guid', productId: 'amylase', productName: 'Alpha-Amylase Cc Fs', quantity: '2', unit: 'qty', netSalesPaise: '3395979', batchId: null };
  const data = economicsData({ targets: [target],
    mappings: [{ id: 'map-urea', companyId: 'company-guid', modelId: 'model-1', productId: 'urea', targetId: target.id, effect: 'include', effectiveFrom: '2025-01-01', effectiveTo: null, reason: 'Urea counts' }],
    itemGroupMappings: [{ id: 'group-map', companyId: 'company-guid', modelId: 'model-1', groupId: 'sys480', targetId: target.id, effect: 'include', effectiveFrom: '2025-01-01', effectiveTo: null, catalogId: 'catalog-1', reason: 'Owner chose SYS 480' }],
    itemGroupCatalogs: [{ id: 'catalog-1', companyId: 'company-guid', sourceVersion: 'v1', observedAt: '2026-10-09T10:00:00Z', current: true, groups: [{ id: 'diasys', name: 'Diasys Diagnostic India Pvt Ltd', parentId: null, itemCount: 50 }, { id: 'sys480', name: 'SYS 480', parentId: 'diasys', itemCount: 30 }, { id: 'sysmex', name: 'Sysmex', parentId: null, itemCount: 20 }], products: [{ id: 'urea', name: 'SYS 480 Urea FS', groupId: 'sys480', unit: 'qty' }, { id: 'amylase', name: 'Alpha-Amylase Cc Fs', groupId: 'diasys', unit: 'qty' }, { id: 'scs', name: 'SYS SCS 400', groupId: 'diasys', unit: 'qty' }, { id: 'wdf', name: 'Sysmex Lysercell WDF', groupId: 'sysmex', unit: 'qty' }] }],
    sourceLines: [sale, { ...sale, id: 'unrelated-sale', productId: 'wdf', productName: 'Sysmex Lysercell WDF' }, { ...sale, id: 'other-customer-sale', customerSourceId: 'someone-else', productId: 'scs', productName: 'SYS SCS 400' }],
    attributionLines: [
      { id: 'r-amylase', sourceLineId: 'amylase-sale', targetId: null, status: 'unattributed', reason: 'no_verified_compatible_placement', shareBasisPoints: 10000, quantity: '2', revenuePaise: '3395979', costPaise: null, gpPaise: null, date: '2026-09-20', voucherId: 'tally-0494', revision: '1', productId: 'amylase', productName: 'Alpha-Amylase Cc Fs', unit: 'qty', costEvidence: null },
      { id: 'r-other', sourceLineId: 'other-customer-sale', targetId: null, status: 'unattributed', reason: 'no_verified_compatible_placement', shareBasisPoints: 10000, quantity: '1', revenuePaise: '100000', costPaise: null, gpPaise: null, date: '2026-09-20', voucherId: 'tally-x', revision: '1', productId: 'scs', productName: 'SYS SCS 400', unit: 'qty', costEvidence: null },
      { id: 'r-unrelated', sourceLineId: 'unrelated-sale', targetId: null, status: 'unattributed', reason: 'no_verified_compatible_placement', shareBasisPoints: 10000, quantity: '2', revenuePaise: '3395979', costPaise: null, gpPaise: null, date: '2026-09-20', voucherId: 'tally-y', revision: '1', productId: 'wdf', productName: 'Sysmex Lysercell WDF', unit: 'qty', costEvidence: null },
    ] });
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: data });
    posts.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/?view=instrument-economics');
  const items = page.getByRole('region', { name: 'Instrument items' });
  await expect(items).toContainText('SYS 480 · Tally item group · 30 items');
  await expect(items).toContainText('SYS 480 Urea FS · single item');
  await expect(items).toContainText('Alpha-Amylase Cc Fs');
  await expect(items).not.toContainText('Sysmex Lysercell WDF');
  await expect(items.getByLabel('Search all Tally items')).toBeVisible();
  await expect(items.getByText('SYS SCS 400 ·', { exact: false })).toHaveCount(0);
  await items.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ action: 'set_mapping', payload: { targetId: target.id, productId: 'urea', effect: 'exclude', effectiveFrom: '2026-10-09', companyId: 'company-guid', modelId: 'model-1' } });
  await items.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1]).toMatchObject({ action: 'set_mapping', payload: { targetId: target.id, productId: 'amylase', effect: 'include', effectiveFrom: target.effectiveFrom } });
  await items.getByLabel('Search all Tally items', { exact: true }).fill('SCS');
  await items.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => posts.length).toBe(3);
  expect(posts[2]).toMatchObject({ action: 'set_mapping', payload: { productId: 'scs', effect: 'include', effectiveFrom: target.effectiveFrom } });
  await items.getByRole('button', { name: 'Remove group', exact: true }).click();
  await expect.poll(() => posts.length).toBe(4);
  expect(posts[3]).toMatchObject({ action: 'set_item_group_mapping', payload: { groupId: 'sys480', expectedCatalogId: 'catalog-1', effect: 'exclude', effectiveFrom: '2026-10-09' } });
  await items.getByLabel('Search all Tally items').fill('urea');
  await expect(items.getByRole('list', { name: 'Items to add' })).toContainText('Already counted');
  await items.getByLabel('Search all Tally items').fill('unknown reagent');
  await expect(items).toContainText('No matching items. Try another name.');
  expect(posts).toHaveLength(4);
  await items.getByLabel('Search all Tally items').fill('SYSMEX WDF');
  await expect(items.getByRole('list', { name: 'Items to add' })).toContainText('Sysmex Lysercell WDF');
  expect(posts).toHaveLength(4);
  await items.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => posts.length).toBe(5);
  expect(posts[4]).toMatchObject({ action: 'set_mapping', payload: { targetId: target.id, productId: 'wdf', effectiveFrom: target.effectiveFrom } });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('read-only roles see counted items without add or remove controls', async ({ page }) => {
  await mockWorkspace(page, economicsData({ canManage: false, targets: [target], mappings: [{ id: 'map-urea', companyId: 'company-guid', modelId: 'model-1', productId: 'product-guid-one', targetId: target.id, effect: 'include', effectiveFrom: '2025-01-01', effectiveTo: null, reason: 'Counts' }] }));
  const items = page.getByRole('region', { name: 'Instrument items' });
  await expect(items).toContainText('single item');
  await expect(items.getByRole('button')).toHaveCount(0);
});

test('simple group mapping saves with two selections and keeps dates editable', async ({ page }) => {
  const posts: Record<string, unknown>[] = [];
  const data = economicsData({ targets: [target], itemGroupCatalogs: [{ id: 'current-catalog', companyId: 'company-guid', sourceVersion: 'v1', observedAt: '2026-10-09T10:00:00Z', current: true, groups: [{ id: 'group-one', name: 'Chemistry group', itemCount: 30, parentId: null }], products: [] }] });
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: data });
    posts.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/?view=instrument-economics');
  await openAdvanced(page);
  await page.getByLabel('Action', { exact: true }).selectOption('set_item_group_mapping');
  await page.getByLabel('Instrument placement', { exact: true }).selectOption(target.id);
  await page.getByLabel('Tally item group', { exact: true }).selectOption('group-one');
  await expect(page.getByLabel('Effective from', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Include in instrument sales and GP · from 2026-10-09', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Map item group to instrument', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ payload: { targetId: target.id, companyId: 'company-guid', modelId: 'model-1', groupId: 'group-one', effect: 'include', effectiveFrom: '2026-10-09' } });
});

test('simple individual mapping submits canonical IDs and clears item on placement change', async ({ page }) => {
  const posts: Record<string, unknown>[] = [];
  const data = economicsData({ targets: [target, { ...target, id: 'foreign-placement', companyId: 'foreign-company', name: 'Other instrument' }] });
  await page.route('**/api/instrument-economics', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: data });
    posts.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/?view=instrument-economics');
  await openAdvanced(page);
  await page.getByLabel('Action', { exact: true }).selectOption('set_mapping');
  await page.getByLabel('Instrument placement', { exact: true }).selectOption(target.id);
  await page.getByLabel('Individual reagent item', { exact: true }).selectOption('product-guid-one');
  await page.getByLabel('Instrument placement', { exact: true }).selectOption('foreign-placement');
  await expect(page.getByLabel('Individual reagent item', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Individual reagent item').locator('option[value="product-guid-one"]')).toHaveCount(0);
  await page.getByLabel('Instrument placement', { exact: true }).selectOption(target.id);
  await page.getByLabel('Individual reagent item', { exact: true }).selectOption('product-guid-one');
  await expect(page.getByLabel('Tally company GUID')).toHaveCount(0);
  await expect(page.getByLabel('Model ID')).toHaveCount(0);
  await page.getByRole('button', { name: 'Set product mapping', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ payload: { targetId: target.id, companyId: 'company-guid', modelId: 'model-1', productId: 'product-guid-one', effect: 'include', effectiveFrom: '2026-10-09' } });
});


test('review documents remain readable and scrollable on a narrow phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 532 });
  const exceptions = Array.from({ length: 11 }, (_, i) => ({ sourceId: `review-source-${i}`, productId: '', date: '2026-10-10', netSalesPaise: '0', status: 'import_rejected', reason: 'Review required', voucherNumber: i ? `DN/${i}` : 'SD/26-27/VERY-LONG-UNBROKEN-INVOICE-REFERENCE-0123456789012345678901234567890', voucherType: i ? 'Debit Note' : 'GST SALE', voucherDate: i === 10 ? '' : '2026-10-10', detail: i ? 'Unclassified inventory voucher type; configure its verified voucher role.' : 'Accounting-only credit or voucher needs verified product/original-sale linkage.' }));
  await mockWorkspace(page, economicsData({ exceptions }));
  await page.getByRole('navigation', { name: 'Economics sections' }).getByRole('button', { name: 'To do (11)', exact: true }).click();
  await page.getByRole('button', { name: 'Accounts review (11)', exact: true }).click();
  const region = page.getByRole('region', { name: 'Tally import problems' });
  await region.getByText('Show document details (11)', { exact: true }).click();
  await expect(region.getByRole('listitem')).toHaveCount(11);
  await region.scrollIntoViewIfNeeded();
  expect(await region.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(region).toContainText('Sales invoice SD/26-27/VERY-LONG');
  await expect(region).toContainText("This document isn't linked");
  await page.screenshot({ path: testInfo.outputPath('invoice-review-phone.png') });
  const list = region.getByRole('list');
  await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(region.getByText('Debit Note DN/10 · Date unavailable', { exact: true })).toBeInViewport();
});


test('financial breakdown uses cumulative reagent totals and distinguishes billing from recovered investment on a phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 532 });
  const lifetime = { salesPaise: '45266952', knownGpPaise: '29853706', lines: 35, missingCostLines: 0 };
  await mockWorkspace(page, economicsData({ targets: [{ ...target, salesFrom: '2026-07-23', expectation: null, capitalPaise: '62500000', instrumentBillingPaise: '40000000', netInvestmentPaise: '22500000', recoveryPaise: '69853706', outstandingPaise: '0', revenuePaise: '0', knownGpPaise: '0', attributedLines: 0, reagentLifetime: lifetime }] }));
  await openAdvanced(page, 'Reports');
  const details = page.getByRole('region', { name: 'Selected target details', exact: true });
  await details.getByText('Full financial breakdown', { exact: true }).click();
  const breakdown = details.getByRole('region', { name: 'Cumulative financial breakdown' });
  await expect(details).toContainText('₹4,52,669.52');
  await expect(breakdown.getByText('Reagent sales since sale', { exact: true }).locator('..')).toContainText('₹4,52,669.52');
  await expect(breakdown.getByText('Reagent GP since sale', { exact: true }).locator('..')).toContainText('₹2,98,537.06');
  await expect(breakdown.getByText('Recovered investment', { exact: true }).locator('..')).toContainText('₹2,98,537.06');
  await expect(breakdown.getByText('Total including instrument billing', { exact: true }).locator('..')).toContainText('₹6,98,537.06');
  await expect(breakdown.getByText('Recorded surplus', { exact: true }).locator('..')).toContainText('₹73,537.06');
  await expect(breakdown).toContainText('23 Jul 2026');
  await expect(breakdown).not.toContainText('Attributed revenue');
  expect(await breakdown.locator('dd').evaluateAll(nodes => nodes.filter(node => node.textContent?.includes('₹')).every(node => {const range=document.createRange();range.selectNodeContents(node);return range.getClientRects().length===1;}))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await breakdown.screenshot({ path: testInfo.outputPath('financial-breakdown-phone.png') });
});


test('Accounts can read document review without setup or financial edit actions', async ({ page }) => {
  await mockWorkspace(page, economicsData({ canManage: false, canApprove: false, canAct: false, exceptions: [{ sourceId: 'debit-1', productId: '', date: '2026-10-10', netSalesPaise: '0', status: 'import_rejected', reason: 'Unclassified inventory voucher type; configure its verified voucher role.', voucherNumber: '1', voucherType: 'Debit Note', voucherDate: '' }] }));
  const nav=page.getByRole('navigation', { name: 'Economics sections' });
  await nav.getByRole('button', { name: /^To do/ }).click();
  await expect(page.getByRole('region', { name: 'Tally import problems' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Accounts review (1)', exact: true }).click();
  await page.getByText('Show document details (1)', { exact: true }).click();
  await expect(page.getByText('Debit Note 1 · Date unavailable', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to instrument tasks', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Sales without purchase cost' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tally import problems' })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: 'Set up', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: 'Advanced', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Approve|Rebuild|Save/ })).toHaveCount(0);
});
