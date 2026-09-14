import { test, expect } from '@playwright/test';

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
