import { test, expect } from '@playwright/test';

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
    if (mode === 'customer') await page.getByText('Choose a price', { exact: true }).click();
    if (mode === 'base') {
      await page.getByLabel('Base selling price ₹').fill('445');
      await page.getByLabel('Effective from').fill('2026-09-14');
    }
    const reason = page.getByLabel(mode === 'customer' ? 'Decision reason' : mode === 'base' ? 'Reason' : 'Management reason', { exact: true });
    await reason.fill('Approved economics');
    const save = page.getByRole('button', { name: mode === 'customer' ? 'Recommended ₹445.00' : mode === 'base' ? 'Approve base price' : 'Apply recommended prices', exact: true });
    await save.click();
    await expect(page.getByRole('alert').or(page.getByText('Failed to fetch', { exact: true }))).toBeVisible();
    await save.click();
    await expect.poll(() => commands.length).toBe(2);
    expect(commands[1]).toEqual(commands[0]);
    if (mode === 'customer') await page.getByText('Choose a price', { exact: true }).click();
    await reason.fill('A different approved decision');
    await save.click();
    await expect.poll(() => commands.length).toBe(3);
    expect(commands[2].payload.idempotencyKey).not.toBe(commands[0].payload.idempotencyKey);
  });
}

const customerId = '11111111-1111-4111-8111-111111111111';
const row = { customerId, customerName: 'Test Laboratory', tallyKey: 'GLUCOSE', itemName: 'Glucose reagent', evidenceHash: 'a'.repeat(64), currentDecisionId: null, fixed: false, lastRate: 420, lastInvoiceDate: '2026-08-18', lastInvoiceReference: 'SD/26-27/0420', historicCost: 300, currentCost: 310, costChange: 10, continuity: 430, target: 445, recommended: 445, continuityGP: 120, continuityMargin: 27.91, recommendedGP: 135, recommendedMargin: 30.34, differenceToCustomer: 25, additionalGP: 15, status: 'RECOMMENDED', warnings: [] };

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
  await expect(page.getByText('₹420.00', { exact: true })).toBeVisible();
  await page.getByText('Choose a price', { exact: true }).click();
  await page.getByLabel('Decision reason').fill('Approve recommended economics');
  await page.getByRole('button', { name: 'Recommended ₹445.00' }).click();
  await expect.poll(() => saved).toMatchObject({ action: 'apply_price_book', payload: { customerId, tallyKey: 'GLUCOSE', choice: 'recommended', evidenceHash: row.evidenceHash, expectedDecisionId: null } });
  await page.getByRole('button', { name: 'All products', exact: true }).click();
  await expect.poll(() => reads.at(-1)).toContain('tab=all');
  await page.getByRole('button', { name: 'Exceptions / special prices', exact: true }).click();
  await expect.poll(() => reads.at(-1)).toContain('tab=exceptions');
});

test('Accounts can inspect economics but cannot approve a customer book price', async ({ page }) => {
  await page.route('**/api/orders?customers=1', (route) => route.fulfill({ json: { customers: [{ id: customerId, name: 'Test Laboratory' }] } }));
  await page.route('**/api/pricing**', (route) => route.fulfill({ json: { rows: [row], offset: 0, hasMore: false } }));
  await page.goto('/?role=accounts');
  await page.getByLabel('Select customer').fill('Test');
  await page.getByRole('button', { name: 'Test Laboratory', exact: true }).click();
  await page.getByText('Choose a price', { exact: true }).click();
  await page.getByLabel('Decision reason').fill('Review only');
  await expect(page.getByRole('button', { name: 'Recommended ₹445.00' })).toBeDisabled();
});
