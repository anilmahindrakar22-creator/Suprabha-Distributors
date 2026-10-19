import { expect, test } from '@playwright/test';

for (const failFirst of [false, true]) {
  test(`order pricing reload recovers ${failFirst ? 'a failed initial read' : 'a live order version change'}`, async ({ page, isMobile }) => {
    let version = 1;
    let reads = 0;
    let recovered = !failFirst;
    const commands: Array<{ payload: { expectedVersion: number } }> = [];
    const order = () => ({
      id: '61000000-0000-4000-8000-000000000002', orderNumber: 'SF-PRICE-001', customerName: 'Pricing Recovery Lab', status: 'packed',
      version, customerPhone: null, source: 'phone', notes: null, pricingState: 'review_required', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      lineCount: 1, totalQuantity: 1, reservedQuantity: 0, tallyInvoiceNumber: null,
      lines: [{ tallyKey: 'G', itemName: 'Glucose', itemGroup: 'Diasys', quantity: 1, baseUnit: 'Nos', fulfilledQuantity: 1 }], events: [], exceptions: [], installations: [],
    });
    await page.setViewportSize({ width: isMobile ? 375 : 1280, height: 800 });
    await page.clock.install();
    await page.route('**/api/orders**', route => {
      const url = new URL(route.request().url());
      if (url.searchParams.has('summary')) return route.fulfill({ json: { operations: {}, orderRevision: version.toString(16).padStart(32, '0') } });
      if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
      return route.fulfill({ json: { actor: { email: 'accounts@example.test', role: 'accounts', roles: ['accounts'] }, snapshot: { company: 'TEST', fetchedAt: new Date().toISOString(), catalog: [] }, customers: [], operations: {}, orders: [order()], pagination: { total: 1, page: 1, pageCount: 1, pageSize: 20 } } });
    });
    await page.route('**/api/pricing**', route => {
      if (route.request().method() === 'POST') { commands.push(route.request().postDataJSON()); return route.fulfill({ json: { pricingState: 'approved' } }); }
      reads++;
      // Development mode may run the opening load twice; keep failing until the user reloads.
      if (!recovered) return route.fulfill({ status: 502, json: { error: 'Pricing unavailable' } });
      return route.fulfill({ json: { orderId: order().id, orderNumber: order().orderNumber, orderVersion: version, pricingState: 'review_required', exceptions: [], history: [], lines: [{
        lineId: 'line-1', tallyKey: 'G', itemName: 'Glucose', quantity: 1, resolution: 'NO_PRICE_HISTORY', guardrail: 'PRICE_REVIEW_REQUIRED', proposedRate: null,
        fixed: false, lastRate: null, historicCost: null, currentCost: 310, costChange: null, continuityPrice: null, recommendedPrice: null, targetMarginPrice: null,
        recommendationReason: 'No eligible customer history', continuityGP: null, continuityMargin: null, recommendedGP: null, recommendedMargin: null,
        differenceToCustomer: null, additionalGP: null, evidenceHash: 'a'.repeat(64), warnings: [], source: { type: 'NONE', reference: null, date: null, version: null },
      }] } });
    });
    await page.goto('/?view=orders-workspace&actor=accounts@example.test');
    await expect(page.getByText('Pricing Recovery Lab', { exact: true }).first()).toBeVisible();
    const compact = page.getByRole('button', { name: /SF-PRICE-001, Pricing Recovery Lab/ });
    if (isMobile && await compact.count()) await compact.click();
    await page.clock.runFor(2_000);
    // The next-step bar needs the price state, so pricing loads as soon as the order opens.
    await page.getByText('View order details', { exact: true }).last().click();
    await page.clock.runFor(100);
    const panel = page.getByRole('region', { name: 'Price review', exact: true });
    if (failFirst) {
      await expect(page.getByText('Pricing unavailable', { exact: true }).first()).toBeVisible();
      recovered = true;
    } else {
      await panel.getByLabel('Custom selling rate').fill('440');
      await panel.getByLabel('Decision reason').fill('Agreed price, keep this draft');
      if (isMobile) await page.screenshot({ path: 'test-results/pricing-review-mobile.png', fullPage: true });
      await expect(panel.getByLabel('Custom selling rate')).toHaveValue('440');
      version = 2;
      await page.clock.runFor(16_000);
      await expect(panel.getByRole('alert')).toContainText('This order changed. Reload pricing');
      await expect(panel.getByLabel('Custom selling rate')).toHaveValue('440');
      await expect(panel.getByLabel('Decision reason')).toHaveValue('Agreed price, keep this draft');
      await expect(panel.getByRole('button', { name: 'Submit price exception', exact: true })).toBeDisabled();
    }
    expect(commands).toEqual([]);
    await panel.getByRole('button', { name: 'Reload pricing', exact: true }).click();
    await expect(panel.getByLabel('Custom selling rate')).toHaveValue('');
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await panel.getByLabel('Custom selling rate').fill('450');
    await panel.getByLabel('Decision reason').fill('Reviewed latest order');
    await panel.getByRole('button', { name: 'Submit price exception', exact: true }).click();
    await expect.poll(() => commands.length).toBe(1);
    expect(commands[0].payload.expectedVersion).toBe(version);
  });
}
