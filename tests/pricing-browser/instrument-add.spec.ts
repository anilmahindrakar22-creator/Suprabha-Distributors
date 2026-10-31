import { expect, test, type Page, type Route } from '@playwright/test';

const purchaseLine = {
  id: 'purchase-uuid-1', companyId: 'company-uuid-1', voucherId: 'purchase-voucher-1', voucherNumber: 'PUR/26/077', revision: '3', lineKey: '1',
  date: '2026-07-23', kind: 'purchase', customerSourceId: null, partyName: 'Analyzer Supplies', productId: 'product-1', productName: 'Sys 240 Biochemistry Analyzer',
  quantity: '1', unit: 'qty', netSalesPaise: '42000000', batchId: 'SYS240-009', usedByInstrument: false,
};
const saleLine = {
  id: 'sale-uuid-1', companyId: 'company-uuid-1', voucherId: 'sale-voucher-1', voucherNumber: 'SD/26-27/0388', revision: '1', lineKey: '1',
  date: '2026-07-23', kind: 'sale', customerSourceId: 'tally-ledger-1', partyName: 'Alpha Laboratory', productId: 'product-1', productName: 'Sys 240 Biochemistry Analyzer',
  quantity: '1', unit: 'qty', netSalesPaise: '30000000', batchId: 'SYS240-009', usedByInstrument: false,
};
const workspace = (overrides: Record<string, unknown> = {}) => ({
  actorEmail: 'admin@example.com', businessDate: '2026-10-09', businessTimezone: 'Asia/Kolkata', targets: [] as (typeof proposedTarget)[], mappings: [], exceptions: [], leakage: [], cases: [],
  sourceLines: [purchaseLine, saleLine,
    { ...purchaseLine, id: 'cheap-line', voucherId: 'cheap-voucher', voucherNumber: 'PUR/26/001', productName: 'Reagent kit', netSalesPaise: '100000', batchId: null },
    { ...purchaseLine, id: 'used-line', voucherId: 'used-voucher', voucherNumber: 'PUR/26/002', usedByInstrument: true }],
  installations: [], customers: [
    { id: 'lab-alpha', name: 'Alpha Laboratory', city: 'Bengaluru', tallyIdentities: [{ companyId: 'company-uuid-1', customerSourceId: 'tally-ledger-1' }] },
    { id: 'lab-beta', name: 'Beta Diagnostics', city: 'Mysuru', tallyIdentities: [{ companyId: 'company-uuid-1', customerSourceId: 'tally-ledger-2' }] },
  ],
  canManage: true, canApprove: false, canAct: false, generation: 'run-1', lastRebuiltAt: null, sourceImportedAt: null, sourceLineCount: 4, unattributedPaise: '0',
  reportingFrom: '2026-09-01', reportingTo: '2026-10-01', policy: { attractiveMonths: 24, reviewMonths: 36, exceptionMonths: 48, forecastWindowMonths: 3, watchRevenuePercent: 80, criticalRevenuePercent: 50 },
  ...overrides,
});

test('Add an instrument registers a sold machine from readable invoices and opens its review', async ({ page }) => {
  const posts: Record<string, any>[] = [];
  let data = workspace();
  await mockWorkspace(page, route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: data });
    const body = route.request().postDataJSON(); posts.push(body);
    if (body.action === 'register_historical_instrument') return route.fulfill({ json: { ok: true, entityId: 'installation-uuid-1' } });
    if (body.action === 'create_target') {
      data = { ...data, targets: [proposedTarget] };
      return route.fulfill({ json: { ok: true, entityId: 'target-uuid-1' } });
    }
    return route.fulfill({ json: { ok: true } });
  });
  await goToSetup(page);
  const add = page.getByRole('region', { name: 'Add an instrument' });
  await expect(add.getByLabel('Search machines')).toBeVisible();
  await expect(add.getByRole('button', { name: /Sys 240 Biochemistry Analyzer.*bought 23 Jul 2026.*₹4,20,000.*Analyzer Supplies/ })).toBeVisible();
  await expect(add.getByRole('button', { name: 'Show cheaper items', exact: true })).toBeVisible();
  await add.getByRole('button', { name: 'Show cheaper items', exact: true }).click();
  await expect(add.getByRole('button', { name: /Reagent kit/ })).toBeVisible();
  await add.getByRole('button', { name: 'Show equipment only', exact: true }).click();
  await add.getByLabel('Search machines').fill('Sys 240');
  await expect(add.getByRole('button', { name: /Sys 240 Biochemistry Analyzer.*bought/ })).toHaveCount(1);
  await expect(add.getByRole('button', { name: /Reagent kit/ })).toHaveCount(0);
  await expect(add.getByText(/purchase-uuid|company-uuid|sale-uuid|tally-ledger/)).toHaveCount(0);
  await expect(add.getByRole('button', { name: /Reagent kit/ })).toHaveCount(0);
  await expect(add.getByRole('button', { name: /used-voucher/ })).toHaveCount(0);
  const machine = add.getByRole('button', { name: /Sys 240 Biochemistry Analyzer.*bought/ });
  await machine.click();
  await expect(machine).toHaveAttribute('aria-pressed', 'true');
  await add.getByRole('button', { name: 'Sold', exact: true }).click();
  const sold = add.getByRole('button', { name: 'Sold', exact: true });
  const rental = add.getByRole('button', { name: 'Rental', exact: true });
  await expect(sold).toHaveAttribute('aria-pressed', 'true');
  const [selectedBorder, unselectedBorder] = await Promise.all([
    sold.evaluate(element => getComputedStyle(element).borderColor),
    rental.evaluate(element => getComputedStyle(element).borderColor),
  ]);
  expect(selectedBorder).not.toBe(unselectedBorder);
  const sale = add.getByRole('button', { name: /Sys 240.*sold 23 Jul 2026.*₹3,00,000.*Alpha Laboratory/ });
  await expect(sale).toBeVisible();
  await expect(sale).toHaveAttribute('aria-pressed', 'true');
  await add.getByLabel('Serial number').fill('SYS240-009');
  await expect(add.getByLabel('Installation date')).toHaveValue('2026-07-23');
  await expect(add).toContainText('Investment ₹1,20,000 = bought ₹4,20,000 − billed ₹3,00,000');
  await add.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => posts.length).toBe(3);
  expect(posts.map(post => post.action)).toEqual(['register_historical_instrument', 'create_target', 'link_instrument_billing']);
  expect(posts[0]).toMatchObject({ payload: { sourceLineId: 'sale-uuid-1', basis: 'sold', serialNumber: 'SYS240-009', installedOn: '2026-07-23' } });
  expect(posts[1]).toMatchObject({ payload: { acquisitionPurchaseLineId: 'purchase-uuid-1', installationId: 'installation-uuid-1' } });
  expect(posts[2]).toMatchObject({ payload: { targetId: 'target-uuid-1', sourceLineId: 'sale-uuid-1' } });
  for (const post of posts) expect(post.payload.idempotencyKey).toBeTruthy();
  await expect(add).toContainText('Added. Waiting for approval');
  const firstRegisterKey = posts[0].payload.idempotencyKey;
  await add.getByRole('button', { name: 'Approve now', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Placement approval preview' })).toBeVisible();
  await add.getByRole('button', { name: 'Add another instrument', exact: true }).click();
  await expect(add.getByLabel('Search machines')).toHaveValue('');
  await expect(add.getByLabel('Serial number')).toHaveCount(0);
  await expect(add.getByRole('button', { name: /Sys 240 Biochemistry Analyzer.*bought/ })).toHaveAttribute('aria-pressed', 'false');
  await add.getByRole('button', { name: /Sys 240 Biochemistry Analyzer.*bought/ }).click();
  await add.getByRole('button', { name: 'Sold', exact: true }).click();
  await add.getByRole('button', { name: /Sys 240.*sold 23 Jul 2026/ }).click();
  await add.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => posts.length).toBe(6);
  expect(posts[3].action).toBe('register_historical_instrument');
  expect(posts[3].payload.idempotencyKey).not.toBe(firstRegisterKey);
});

test('rental uses the purchase, bounded linked-lab search, and retries step two with its original key', async ({ page }) => {
  const posts: Record<string, any>[] = [];
  let failCreate = true;
  let data = workspace({ customers: [
    ...Array.from({ length: 24 }, (_, index) => ({ id: `lab-${index}`, name: `Alpha Lab ${index}`, city: `City ${index}`, tallyIdentities: [{ companyId: 'company-uuid-1', customerSourceId: `ledger-${index}` }] })),
    { id: 'unlinked-lab', name: 'Alpha Unlinked', city: 'Bengaluru' },
  ] });
  await mockWorkspace(page, route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: data });
    const body = route.request().postDataJSON(); posts.push(body);
    if (body.action === 'create_target' && failCreate) {
      failCreate = false;
      return route.fulfill({ status: 409, json: { error: 'Instrument invoice changed; refresh before registration' } });
    }
    if (body.action === 'register_historical_instrument') return route.fulfill({ json: { ok: true, entityId: 'installation-rental' } });
    data = { ...data, targets: [{ ...proposedTarget, id: 'target-rental', installationId: 'installation-rental', customerId: 'lab-0', customerName: 'Alpha Lab 0', customerSourceId: 'ledger-0' }] };
    return route.fulfill({ json: { ok: true, entityId: 'target-rental' } });
  });
  await goToSetup(page);
  const add = page.getByRole('region', { name: 'Add an instrument' });
  await add.getByRole('button', { name: /Sys 240 Biochemistry Analyzer.*bought/ }).click();
  await add.getByRole('button', { name: 'Rental', exact: true }).click();
  const labs = add.getByLabel('Search labs');
  await labs.fill('A');
  await expect(add.getByRole('button', { name: /Alpha Lab/ })).toHaveCount(0);
  await labs.fill('Al');
  await expect(add.getByRole('button', { name: /Alpha Lab 0.*City 0/ })).toBeVisible();
  await expect(add.getByRole('button', { name: /Alpha Lab/ })).toHaveCount(20);
  await expect(add.getByText(/unlinked-lab|Alpha Unlinked/)).toHaveCount(0);
  await expect(add.getByRole('link', { name: 'Link to Tally first', exact: true })).toBeVisible();
  await add.getByRole('button', { name: /Alpha Lab 0.*City 0/ }).click();
  await expect(add.getByLabel('Serial number')).toHaveValue('SYS240-009');
  await expect(add.getByLabel('Installation date')).toHaveValue('2026-07-23');
  await expect(add).toContainText('Investment ₹4,20,000 = bought ₹4,20,000 − billed ₹0');
  await add.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(add.getByRole('alert')).toContainText("Step 2 didn't save");
  const firstStep2Key = posts[1].payload.idempotencyKey;
  await add.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(() => posts.length).toBe(3);
  expect(posts.map(post => post.action)).toEqual(['register_historical_instrument', 'create_target', 'create_target']);
  expect(posts[1].payload.idempotencyKey).toBe(firstStep2Key);
  expect(posts[0]).toMatchObject({ payload: { sourceLineId: 'purchase-uuid-1', basis: 'rental', customerId: 'lab-0' } });
  expect(posts[0].payload).not.toHaveProperty('customerSourceId');
  expect(posts[1]).toMatchObject({ payload: { acquisitionPurchaseLineId: 'purchase-uuid-1', installationId: 'installation-rental' } });
  await expect(add).toContainText('Added. Waiting for approval');
  await add.getByRole('button', { name: 'Approve now', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Placement approval preview' })).toBeVisible();
});

test('old registration and correction forms stay inside Advanced', async ({ page }) => {
  await mockWorkspace(page, route => route.fulfill({ json: workspace() }));
  await goToSetup(page);
  await expect(page.getByRole('heading', { name: 'Add an instrument' })).toBeVisible();
  await expect(page.getByLabel('Action', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Advanced (corrections)', { exact: true })).toBeVisible();
  await page.getByText('Advanced (corrections)', { exact: true }).click();
  await page.getByText('Register an existing instrument', { exact: true }).click();
  await expect(page.getByLabel('Instrument selling line')).toBeVisible();
  await expect(page.getByLabel('Action', { exact: true })).toHaveCount(0);
});

test('Add an instrument has no horizontal overflow on a 375 pixel phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await mockWorkspace(page, route => route.fulfill({ json: workspace() }));
  await goToSetup(page);
  const add = page.getByRole('region', { name: 'Add an instrument' });
  await expect(add.getByLabel('Search machines')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

async function goToSetup(page: Page) {
  await page.getByRole('navigation', { name: 'Economics sections' }).getByRole('button', { name: 'Set up', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add an instrument' })).toBeVisible();
}

async function mockWorkspace(page: Page, handler: (route: Route) => Promise<void>) {
  await page.route('**/api/instrument-economics', handler);
  await page.goto('/?view=frame&role=administrator&roles=administrator');
  const more = page.getByRole('button', { name: 'More' });
  if (await more.isVisible()) await more.click();
  await page.getByRole('button', { name: /^economics$/i }).click();
  await expect(page.getByRole('heading', { name: 'Instrument economics' })).toBeVisible();
}

const proposedTarget = {
  id: 'target-uuid-1', kind: 'placement', name: 'Sys 240 · Alpha Laboratory', companyId: 'company-uuid-1', customerId: 'lab-alpha', customerName: 'Alpha Laboratory',
  customerSourceId: 'tally-ledger-1', siteId: 'Bengaluru', modelId: 'Sys 240 Biochemistry Analyzer', installationId: 'installation-uuid-1', effectiveFrom: '2026-07-23', effectiveTo: null,
  approval: 'proposed', version: 1, capitalPaise: '42000000', instrumentBillingPaise: '30000000', netInvestmentPaise: '12000000', revenuePaise: '0', knownGpPaise: '0',
  missingCostLines: 0, attributedLines: 0, recoveryPaise: '0', outstandingPaise: '12000000', health: 'proposed', forecastMonths: null, expectation: null,
  approvalPreview: { status: 'actuals_only', capitalPaise: '42000000', instrumentBillingPaise: '30000000', netInvestmentPaise: '12000000', expectedMonthlyGpPaise: null, expectedPaybackMonths: null,
    expectationId: null, expectationEffectiveFrom: null, policyId: 'policy-1', reviewMonths: 36, exceptionMonths: 48 },
};
