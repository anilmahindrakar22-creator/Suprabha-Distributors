import { test, expect } from '@playwright/test';

test('close unsaved recovery retains busy receipts and releases only confirmed outcomes', async ({ page }) => {
  const key = '11111111-1111-4111-8111-111111111111';
  let status = 'unresolved';
  const commands: unknown[] = [];
  await page.goto('/');
  await page.evaluate(key => sessionStorage.setItem('stockflow:pricing-recovery:fixture@example.test', JSON.stringify([{ action: 'create_pricing_policy', idempotencyKey: key }])), key);
  await page.route('**/api/pricing**', async route => {
    commands.push(route.request().postDataJSON());
    await route.fulfill({ json: { status } });
  });
  await page.reload();
  const close = page.getByRole('button', { name: /Close only if unsaved/ });
  await close.click();
  await expect(page.getByText(/This save is still unresolved/)).toBeVisible();
  await expect(close).toBeVisible();
  status = 'not_saved';
  await close.click();
  await expect(page.getByText(/blocked late delivery/)).toBeVisible();
  await expect(close).toHaveCount(0);
  expect(commands).toEqual(Array(2).fill({ action: 'close_unresolved_pricing', payload: { idempotencyKey: key, pricingAction: 'create_pricing_policy' } }));
});

for (const action of ['approve_price_contract', 'reject_price_contract', 'create_pricing_policy', 'create_price_contract']) {
  test(`${action} retains unchanged requests across uncertain responses`, async ({ page }) => {
    let recoveryStatus = 'unresolved';
    const commands: { action: string; payload: { idempotencyKey: string } }[] = [];
    await page.route('**/api/orders?customers=1', route => route.fulfill({ json: { customers: [{ id: customerId, name: 'Test Laboratory' }] } }));
    await page.route('**/api/orders?catalog=1', route => route.fulfill({ json: { catalog: [{ tallyKey: 'GLUCOSE', item: 'Glucose reagent', group: 'Reagents', active: true }] } }));
    await page.route('**/api/pricing**', async route => {
      if (route.request().method() === 'POST') { commands.push(route.request().postDataJSON()); await route.abort('failed'); }
      else if (route.request().url().includes('recoveryKey=')) await route.fulfill({ json: { status: recoveryStatus } });
      else await route.fulfill({ json: route.request().url().includes('policies=1') ? { policies: [] } : { contracts: [{ id: customerId, customerId, customerName: 'Test Laboratory', tallyKey: 'GLUCOSE', price: 445, validFrom: '2026-01-01', status: 'pending_approval', source: 'customer_contract', reason: 'Test', version: 1 }] } });
    });
    await page.goto('/?view=workspace');
    let buttonName: string;
    let reason;
    if (action === 'create_pricing_policy') {
      await page.getByText('Pricing administration', { exact: true }).click();
      await page.getByRole('button', { name: 'New policy', exact: true }).click();
      await page.getByLabel('Policy version', { exact: true }).fill('test-v1');
      await page.getByLabel('Minimum gross margin %', { exact: true }).fill('20');
      await page.getByLabel('Override approval threshold %').fill('5');
      reason = page.getByLabel('Management reason', { exact: true });
      buttonName = 'Activate policy';
    } else if (action === 'create_price_contract') {
      await page.getByText('Pricing administration', { exact: true }).click();
      await page.getByRole('button', { name: '+ Propose price', exact: true }).click();
      await page.getByLabel('Customer', { exact: true }).fill('Test');
      await page.getByRole('button', { name: 'Test Laboratory', exact: true }).click();
      await page.getByLabel('Product', { exact: true }).fill('Glucose');
      await page.getByRole('button', { name: 'Glucose reagent Reagents', exact: true }).click();
      await page.getByLabel('Selling price (₹)').fill('445');
      reason = page.getByLabel('Business reason');
      buttonName = 'Send for approval';
    } else {
      reason = page.getByPlaceholder('Optional approval note · required to reject');
      buttonName = action === 'approve_price_contract' ? 'Approve' : 'Reject';
    }
    await reason.fill('Reviewed economics');
    const save = page.getByRole('button', { name: buttonName, exact: true });
    await save.click();
    await expect(page.getByText('Failed to fetch', { exact: true })).toBeVisible();
    await save.click();
    await expect.poll(() => commands.length).toBe(2);
    expect(commands[1]).toEqual(commands[0]);
    expect(commands[0].action).toBe(action);
    await expect(save).toBeEnabled();
    await reason.fill('Changed decision reason');
    await save.click();
    await expect.poll(() => commands.length).toBe(3);
    expect(commands[2].payload.idempotencyKey).not.toBe(commands[0].payload.idempotencyKey);
    await expect(page.getByText('Failed to fetch', { exact: true })).toBeVisible();
    const receipts = await page.evaluate(() => JSON.parse(sessionStorage.getItem('stockflow:pricing-recovery:fixture@example.test') || '[]'));
    expect(receipts).toHaveLength(2);
    expect(Object.keys(receipts[0]).sort()).toEqual(['action', 'idempotencyKey']);
    await page.reload();
    const check = page.getByRole('button', { name: /Check earlier save/ });
    await expect(check).toHaveCount(2);
    await page.getByText('Pricing administration', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'New policy', exact: true })).toBeDisabled();
    await check.first().click();
    await expect(page.getByText(/This save is still unresolved/)).toBeVisible();
    recoveryStatus = 'accepted';
    await check.first().click();
    await expect(check).toHaveCount(1);
    await check.first().click();
    await expect(check).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New policy', exact: true })).toBeEnabled();
    expect(commands).toHaveLength(3);
  });
}

test('reload recovery stores only a receipt and checks the server without resubmitting', async ({ page }) => {
  let posts = 0;
  let status = 'unresolved';
  await page.route('**/api/orders?customers=1', route => route.fulfill({ json: { customers: [{ id: customerId, name: 'Test Laboratory' }] } }));
  await page.route('**/api/pricing**', async route => {
    if (route.request().method() === 'POST') { posts++; await route.abort('failed'); }
    else if (route.request().url().includes('recoveryKey=')) await route.fulfill({ json: { status } });
    else await route.fulfill({ json: { rows: [row], offset: 0, hasMore: false } });
  });
  await page.goto('/');
  await page.getByLabel('Select customer').fill('Test');
  await page.getByRole('button', { name: 'Test Laboratory', exact: true }).click();
  await page.getByRole('button', { name: 'Review item' }).click();
  await page.getByLabel(/^Decision note/).fill('Sensitive commercial reason');
  await page.getByRole('button', { name: 'Recommended ₹445.00' }).click();
  await expect(page.getByText('Failed to fetch', { exact: true })).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('stockflow:pricing-recovery:fixture@example.test') || '[]'));
  expect(Object.keys(stored[0]).sort()).toEqual(['action', 'idempotencyKey']);
  await page.reload();
  await page.getByRole('button', { name: /Check earlier save/ }).click();
  await expect(page.getByText(/This save is still unresolved/)).toBeVisible();
  status = 'accepted';
  await page.getByRole('button', { name: /Check earlier save/ }).click();
  await expect(page.getByText(/server confirmed the earlier pricing save/)).toBeVisible();
  expect(posts).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem('stockflow:pricing-recovery:fixture@example.test'))).toBe('[]');
});

test('recovery ignores another account receipts and keeps references on network failure', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.setItem('stockflow:pricing-recovery:other@example.test', JSON.stringify([{ action: 'apply_price_book', idempotencyKey: '11111111-1111-4111-8111-111111111111' }])));
  await page.reload();
  await expect(page.getByRole('button', { name: /Check earlier save/ })).toHaveCount(0);
  await page.evaluate(() => sessionStorage.setItem('stockflow:pricing-recovery:fixture@example.test', sessionStorage.getItem('stockflow:pricing-recovery:other@example.test')!));
  await page.route('**/api/pricing**', route => route.abort('failed'));
  await page.reload();
  await page.getByRole('button', { name: /Check earlier save/ }).click();
  await expect(page.getByText(/recovery reference has been kept/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Check earlier save/ })).toBeVisible();
});

for (const mode of ['customer', 'base', 'impact'] as const) {
  test(`${mode} save retries preserve the command after a lost response`, async ({ page }) => {
    const commands: { payload: { idempotencyKey: string; reason: string } }[] = [];
    await page.route('**/api/orders?customers=1', route => route.fulfill({ json: { customers: [{ id: customerId, name: 'Test Laboratory' }] } }));
    await page.route('**/api/orders?catalog=1', route => route.fulfill({ json: { catalog: [{ tallyKey: 'GLUCOSE', item: 'Glucose reagent', active: true }] } }));
    await page.route('**/api/pricing**', async route => {
      if (route.request().method() === 'POST') {
        commands.push(route.request().postDataJSON());
        if (commands.length !== 2) await route.abort('failed');
        else await route.fulfill({ json: { applied: 1, skipped: 0 } });
      } else await route.fulfill({ json: { rows: [row], previewHash: 'preview', offset: 0, hasMore: false } });
    });
    await page.goto('/');
    if (mode !== 'customer') await page.getByRole('button', { name: mode === 'base' ? 'Base / default prices' : 'Purchase-cost review', exact: true }).click();
    await page.getByLabel(mode === 'customer' ? 'Select customer' : 'Select product').fill(mode === 'customer' ? 'Test' : 'Glucose');
    await page.getByRole('button', { name: mode === 'customer' ? 'Test Laboratory' : 'Glucose reagent', exact: true }).click();
    if (mode === 'customer') await page.getByRole('button', { name: 'Review item' }).click();
    if (mode === 'base') {
      await page.getByLabel('Base selling price ₹').fill('445');
      await page.getByLabel('Effective from').fill('2026-09-14');
    }
    const reason = mode === 'impact' ? null : mode === 'customer' ? page.getByLabel(/^Decision note/) : page.getByLabel('Reason', { exact: true });
    if (reason) await reason.fill('Approved economics');
    const save = page.getByRole('button', { name: mode === 'customer' ? 'Recommended ₹445.00' : mode === 'base' ? 'Approve base price' : 'Apply recommended prices', exact: true });
    await save.click();
    await expect(page.getByRole('alert').or(page.getByText('Failed to fetch', { exact: true }))).toBeVisible();
    await save.click();
    await expect.poll(() => commands.length).toBe(2);
    expect(commands[1]).toEqual(commands[0]);
    if (mode === 'customer') await page.getByRole('button', { name: 'Review item' }).click();
    if (reason) await reason.fill('A different approved decision');
    await (mode === 'impact' ? page.getByRole('button', { name: 'Pass through cost increase' }) : save).click();
    await expect.poll(() => commands.length).toBe(3);
    expect(commands[2].payload.idempotencyKey).not.toBe(commands[0].payload.idempotencyKey);
  });
}

const customerId = '11111111-1111-4111-8111-111111111111';
const row = { customerId, customerName: 'Test Laboratory', tallyKey: 'GLUCOSE', itemName: 'Glucose reagent', evidenceHash: 'a'.repeat(64), currentDecisionId: null, fixed: false, lastRate: 420, lastInvoiceDate: '2026-08-18', lastInvoiceReference: 'SD/26-27/0420', historicCost: 300, currentCost: 310, costChange: 10, continuity: 430, target: 445, recommended: 445, continuityGP: 120, continuityMargin: 27.91, recommendedGP: 135, recommendedMargin: 30.34, differenceToCustomer: 25, additionalGP: 15, status: 'RECOMMENDED', warnings: [], source: { type: 'LAST_TALLY_INVOICE', reference: 'SD/26-27/0420', date: '2026-08-18', version: 'v1' }, cost: { amount: 310, kind: 'purchase_price', effectiveAt: '2026-09-01', sourceReference: 'PUR/310', changeAmount: 10, changePercent: 3.33 } };

test('order choices show economics and allow explicit custom input', async ({ page }) => {
  await page.goto('/?view=order');
  await expect(page.getByText('Target-margin price exceeds continuity')).toBeVisible();
  await page.getByRole('button', { name: 'Maintain ₹430.00' }).click();
  await expect(page.getByText('Selected rate: ₹430.00')).toBeVisible();
  await page.getByRole('button', { name: 'Recommended ₹445.00' }).click();
  await expect(page.getByText('Selected rate: ₹445.00')).toBeVisible();
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await expect(page.getByLabel('Decision reason')).toHaveValue('');
  await page.getByLabel('Custom selling rate').fill('440');
  await expect(page.getByText('Selected rate: ₹440.00')).toBeVisible();
  await page.goto('/?view=order&fixed=1');
  await expect(page.getByRole('button', { name: 'Maintain ₹430.00' })).toBeDisabled();
});

test('customer-first worksheet defaults to Purchased and submits a bound decision', async ({ page }) => {
  const reads: string[] = [];
  let saved: Record<string, unknown> | undefined;
  await page.route('**/api/orders?customers=1', (route) => route.fulfill({ json: { customers: [{ id: customerId, name: 'Test Laboratory', phone: null, city: null, tallyKey: 'LAB' }] } }));
  await page.route('**/api/pricing**', async (route) => {
    if (route.request().method() === 'POST') { saved = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, applied: 1, skipped: 0 } }); return; }
    reads.push(route.request().url());
    await route.fulfill({ json: { rows: [row], offset: 0, hasMore: false } });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Customer prices', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Select customer').fill('Test');
  await page.getByRole('button', { name: 'Test Laboratory', exact: true }).click();
  await expect(page.getByText('Glucose reagent', { exact: true })).toBeVisible();
  expect(reads[0]).toContain('tab=purchased');
  await page.getByRole('button', { name: 'Review item' }).click();
  await expect(page.getByText('Price source:')).toBeVisible();
  await expect(page.getByText('Last Tally sales invoice')).toBeVisible();
  await expect(page.getByText('Current selling rate', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Recommended ₹445.00' }).click();
  await expect.poll(() => saved).toMatchObject({ action: 'apply_price_book', payload: { customerId, tallyKey: 'GLUCOSE', choice: 'recommended', evidenceHash: row.evidenceHash, expectedDecisionId: null, reason: 'Approved recommended price' } });
  await page.getByRole('button', { name: 'Browse all products', exact: true }).click();
  await expect.poll(() => reads.at(-1)).toContain('tab=all');
  await page.getByLabel('Review exceptions only').check();
  await expect.poll(() => reads.at(-1)).toContain('tab=exceptions');
});

test('Accounts can inspect economics but cannot approve a customer book price', async ({ page }) => {
  await page.route('**/api/orders?customers=1', (route) => route.fulfill({ json: { customers: [{ id: customerId, name: 'Test Laboratory' }] } }));
  await page.route('**/api/pricing**', (route) => route.fulfill({ json: { rows: [row], offset: 0, hasMore: false } }));
  await page.goto('/?role=accounts');
  await page.getByLabel('Select customer').fill('Test');
  await page.getByRole('button', { name: 'Test Laboratory', exact: true }).click();
  await page.getByRole('button', { name: 'Review item' }).click();
  await page.getByLabel(/^Decision note/).fill('Review only');
  await expect(page.getByRole('button', { name: 'Recommended ₹445.00' })).toBeDisabled();
});

test('customer book previews visible economics and approves eligible purchased items together', async ({ page }) => {
  const approvalPreviewHash = 'b'.repeat(64);
  const posts: Array<{ action: string; payload: Record<string, string> }> = [];
  await page.route('**/api/orders?customers=1', route => route.fulfill({ json: { customers: [{ id: customerId, name: 'Test Laboratory' }] } }));
  await page.route('**/api/pricing**', async route => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      await route.fulfill({ json: { ok: true, applied: 2, excluded: 1 } });
      return;
    }
    await route.fulfill({ json: {
      rows: [row, { ...row, tallyKey: 'CRP', itemName: 'CRP reagent', lastRate: 620, historicCost: 390, currentCost: 410, recommended: 640 },
        { ...row, tallyKey: 'FIXED', itemName: 'Fixed reagent', fixed: true, lastRate: 700, recommended: 700 }],
      offset: 0, hasMore: false, approvalPreviewHash, bulkTotalCount: 3,
      bulkEligibleCount: 2, bulkExcludedCount: 1, bulkEligibleKeys: ['GLUCOSE', 'CRP'],
    } });
  });
  await page.goto('/');
  await page.getByLabel('Select customer').fill('Test');
  await page.getByRole('button', { name: 'Test Laboratory', exact: true }).click();
  await expect(page.getByRole('table')).toContainText('Glucose reagent');
  await expect(page.getByRole('table')).toContainText('CRP reagent');
  await expect(page.getByRole('table')).toContainText('Fixed reagent');
  await expect(page.getByRole('table')).toContainText('₹420.00');
  await expect(page.getByText('3 purchased items · 2 ready · 1 protected or need review')).toBeVisible();
  await page.getByLabel('Accept recommended prices').uncheck();
  await expect(page.getByRole('button', { name: 'Approve price book' })).toBeDisabled();
  await page.getByLabel('Accept recommended prices').check();
  await page.getByRole('button', { name: 'Approve price book' }).click();
  await expect.poll(() => posts).toMatchObject([{ action: 'approve_customer_price_book', payload: { customerId, approvalPreviewHash } }]);
  expect(posts[0].payload.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByText('2 recommended prices approved together. 1 fixed, already-approved, or review-needed items were left unchanged.')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('stockflow:pricing-recovery:fixture@example.test'))).toBe('[]');
});
