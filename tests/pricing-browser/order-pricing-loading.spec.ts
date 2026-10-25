import { expect, test } from '@playwright/test';

test('stage changes show pricing loading until the current read settles without repeated reads', async ({ page, isMobile }) => {
  const orderId = '61000000-0000-4000-8000-000000000002';
  let version = 1;
  let pricingReads = 0;
  let writes = 0;
  let releasePricing!: () => void;
  const pricingGate = new Promise<void>(resolve => { releasePricing = resolve; });
  const order = () => ({
    id: orderId, orderNumber: 'SF-LOAD-001', customerName: 'Loading Contract Laboratory',
    status: version === 1 ? 'confirmed' : 'packed', pricingState: version === 1 ? 'approved' : 'review_required',
    version, customerPhone: null, source: 'phone', notes: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    lineCount: 1, totalQuantity: 1, reservedQuantity: 0, tallyInvoiceNumber: null,
    lines: [{ id: 'line-1', tallyKey: 'G', itemName: 'Glucose', itemGroup: 'Diasys', quantity: 1, baseUnit: 'Nos', fulfilledQuantity: 1 }],
    events: [], exceptions: [], installations: [],
  });
  await page.clock.install();
  await page.route('**/api/orders**', route => {
    if (route.request().method() === 'POST') { writes++; return route.fulfill({ status: 500, json: { error: 'Unexpected write' } }); }
    const url = new URL(route.request().url());
    if (url.searchParams.has('summary')) return route.fulfill({ json: { operations: {}, orderRevision: version.toString(16).padStart(32, '0') } });
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    return route.fulfill({ json: {
      actor: { email: 'administrator@example.test', role: 'administrator', roles: ['administrator'] },
      snapshot: { company: 'TEST', fetchedAt: new Date().toISOString(), catalog: [] },
      customers: [], operations: {}, orders: [order()], pagination: { total: 1, page: 1, pageCount: 1, pageSize: 20 },
    } });
  });
  await page.route('**/api/pricing**', async route => {
    if (route.request().method() !== 'GET') { writes++; return route.fulfill({ status: 500, json: { error: 'Unexpected write' } }); }
    pricingReads++;
    await pricingGate;
    return route.fulfill({ json: {
      orderId, orderNumber: 'SF-LOAD-001', orderVersion: version, pricingState: 'review_required', exceptions: [], history: [],
      lines: [{ lineId: 'line-1', tallyKey: 'G', itemName: 'Glucose', quantity: 1, resolution: 'NO_PRICE_HISTORY', guardrail: 'PRICE_REVIEW_REQUIRED', proposedRate: null, governed: false,
        currentCost: 310, lastRate: null, historicCost: null, continuityPrice: null, recommendedPrice: null, targetMarginPrice: null,
        evidenceHash: 'a'.repeat(64), warnings: [], source: { type: 'NONE', reference: null, date: null, version: null },
      }],
    } });
  });
  await page.goto('/?view=orders-workspace&actor=administrator@example.test');
  if (isMobile) await page.getByRole('button', { name: /^SF-LOAD-001,/ }).click();
  const bar = page.getByRole('region', { name: 'Order next step', exact: true });
  await expect(bar.getByRole('button', { name: 'Packed · all items', exact: true })).toBeVisible();
  expect(pricingReads).toBe(0);
  await page.clock.runFor(2_000);
  version = 2;
  // The next interval is scheduled after the preceding async refresh settles.
  await expect.poll(async () => {
    await page.clock.runFor(16_000);
    return pricingReads;
  }).toBe(1);
  await expect(bar).toContainText('Checking price');
  await expect(bar.getByRole('button', { name: 'Enter price', exact: true })).toHaveCount(0);
  await expect.poll(() => pricingReads).toBe(1);
  await page.clock.runFor(20_000);
  expect(pricingReads).toBe(1);
  releasePricing();
  await expect(bar.getByRole('button', { name: 'Enter price', exact: true })).toBeVisible();
  expect(writes).toBe(0);
});
