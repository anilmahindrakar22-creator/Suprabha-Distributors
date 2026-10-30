import { expect, test, type Page } from '@playwright/test';

const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'];
const snapshotIds = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'];
const policy = { version: 1, walletShareTargetBps: 8000, focusBandBps: 8000, staleAfterMonths: 6, note: 'Default', enteredBy: 'Manager', enteredAt: '2026-10-30T00:00:00Z' };
const coverage = { certified: false, windowFrom: '2026-07-01', windowTo: '2026-09-30', windowLabel: 'Jul–Sep 2026', reason: null };
const lab = (i: number) => ({ customerId: ids[i], name: `Lab ${i + 1}`, city: `City ${i + 1}`, walletPaise: i === 0 ? 1000000 : null, salesPaise: null, sharePermille: null, untappedPaise: null, captureGapPaise: null, confidence: 'medium', asOf: '2026-10-01', verified: false, stale: false, belowSales: false, inFocusBand: null });
const workspace = (view: string) => ({ policy, coverage, view, page: 1, pageSize: 50, total: 3, rows: [lab(0), lab(1), lab(2)], summary: { focusCount: null, focusGapPaise: null, estimatedAccounts: 1, accountsWithSales: null, unlinkedSalesPaise: null, unlinkedLedgers: null } });
async function setup(page: Page, opts: { sales?: boolean; failure?: 'conflict' | 'network' } = {}) {
  const reads: string[] = []; const posts: Array<{ action: string; payload: Record<string, unknown> }> = []; let failRow = opts.failure ? (opts.failure === 'conflict' ? 2 : 1) : -1; let failOnce = true;
  await page.route('**/api/accounts**', route => route.fulfill({ json: { accounts: [], page: { page: 1, pageSize: 50, total: 0 }, owners: [], territories: [], canAssign: true, canEraseContacts: false, canSeePowerMap: false, actorEmail: 'manager@example.test', today: '2026-10-30', classPolicy: { aMinPaise: '20000000', bMinPaise: '7500000' } } }));
  await page.route('**/api/wallet**', async route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET') {
      reads.push(url.href);
      if (url.pathname === '/api/wallet/actions') return route.fulfill({ json: { page: 1, pageSize: 50, total: 0, overdueCount: 0, rows: [] } });
      if (url.pathname === '/api/wallet/diagnosis') return route.fulfill({ json: { rows: [], undiagnosedFocusCount: null, focusCount: null, focusWithoutDecisionMaker: null } });
      if (url.searchParams.get('action') === 'get_wallet_workspace') return route.fulfill({ json: workspace(url.searchParams.get('view') ?? 'no_estimate') });
      const id = url.searchParams.get('customerId')!; const i = ids.indexOf(id);
      return route.fulfill({ json: { policy, coverage, row: lab(i), current: i === 0 ? { id: snapshotIds[i], monthlyWalletPaise: 1000000, method: 'manager_estimate', source: 'Previous', confidence: 'medium', asOf: '2026-10-01', note: 'Initial', loweredReason: null, enteredBy: 'Manager', enteredAt: '2026-10-01T00:00:00Z', verifiedBy: null, divisions: [], unallocatedPaise: 1000000 } : null, history: [], divisions: [] } });
    }
    const body = route.request().postDataJSON() as { action: string; payload: Record<string, unknown> }; posts.push(body);
    const idx = ids.indexOf(String(body.payload.customerId)) + 1;
    if (failOnce && idx === failRow) {
      failOnce = false;
      if (opts.failure === 'network') return route.abort();
      return route.fulfill({ status: 409, json: { error: 'Changed by someone else, reload this row' } });
    }
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/?view=accounts');
  await page.getByRole('button', { name: 'Wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Quick entry', exact: true }).click();
  return { reads, posts };
}

test('shared Source is required', async ({ page }) => {
  await setup(page);
  await page.getByLabel('₹ / month').nth(1).fill('25');
  await expect(page.getByRole('textbox', { name: 'Source' })).toHaveAttribute('required', '');
  await expect(page.getByRole('button', { name: 'More options', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Save entered rows/ })).toBeVisible();
});

test('typing in three rows sends sequential exact paise and current snapshot ids', async ({ page }) => {
  const { posts, reads } = await setup(page);
  await page.getByLabel('Source').fill('Owner estimate, Oct 2026');
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await page.getByLabel('₹ / month').nth(0).fill('12000'); await page.getByLabel('₹ / month').nth(1).fill('2.50'); await page.getByLabel('₹ / month').nth(2).fill('3');
  await page.getByRole('button', { name: 'Save entered rows (3)' }).click();
  await expect.poll(() => posts.length).toBe(3);
  expect(posts.map(x => x.payload.customerId)).toEqual(ids);
  expect(posts.map(x => x.payload.monthlyWalletPaise)).toEqual([1200000, 250, 300]);
  expect(posts.map(x => x.payload.expectedCurrentSnapshotId)).toEqual(snapshotIds.map((id, i) => i === 0 ? id : null));
  expect(posts[0].action).toBe('record_wallet_snapshot');
  expect(posts[0].payload).toMatchObject({ method: 'manager_estimate', source: 'Owner estimate, Oct 2026', confidence: 'medium', note: 'Quick entry', divisions: [] });
  expect(reads.filter(x => new URL(x).searchParams.get('action') === 'get_wallet_account')).toHaveLength(3);
});

test('lowered estimate reveals a required reason and sends it', async ({ page }) => {
  const { posts } = await setup(page);
  await page.getByLabel('Source').fill('Owner estimate, Oct 2026'); await page.getByLabel('₹ / month').nth(0).fill('9000');
  await expect(page.getByLabel('Reason for lowering')).toBeVisible(); await page.getByLabel('Reason for lowering').fill('Volume revised');
  await page.getByRole('button', { name: 'Save entered rows (1)' }).click(); await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].payload.loweredReason).toBe('Volume revised');
});

test('409 on row two reports its message and proceeds to row three', async ({ page }) => {
  const { posts } = await setup(page, { failure: 'conflict' });
  await page.getByLabel('Source').fill('Owner estimate, Oct 2026');
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  for (const [index, field] of (await page.getByLabel('₹ / month').all()).entries()) await field.fill(index === 0 ? '12000' : '22');
  await page.getByRole('button', { name: 'Save entered rows (3)' }).click(); await expect.poll(() => posts.length).toBe(3);
  await expect(page.getByText('⚠ Changed by someone else, reload this row')).toBeVisible();
  await expect(page.getByText('✓ Saved')).toHaveCount(2);
});

test('network failure retry keeps the same requestId', async ({ page }) => {
  const { posts } = await setup(page, { failure: 'network' });
  await page.getByLabel('Source').fill('Owner estimate, Oct 2026'); await page.getByLabel('₹ / month').nth(0).fill('12000');
  await page.getByRole('button', { name: 'Save entered rows (1)' }).click(); await expect(page.getByText('⚠ Save could not be confirmed. Retry the same row.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save entered rows (1)' }).click(); await expect.poll(() => posts.length).toBe(2);
  expect(posts[1]).toEqual(posts[0]);
});

test('not visible to sales', async ({ page }) => {
  await page.route('**/api/accounts**', route => route.fulfill({ json: { accounts: [], page: { page: 1, pageSize: 50, total: 0 }, owners: [], territories: [], canAssign: false, canEraseContacts: false, canSeePowerMap: false, actorEmail: 'sales@example.test', today: '2026-10-30', classPolicy: { aMinPaise: '20000000', bMinPaise: '7500000' } } }));
  await page.goto('/?view=accounts');
  await expect(page.getByRole('button', { name: 'Wallet', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Quick entry', exact: true })).toHaveCount(0);
});

test('375 px layout has no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 }); await setup(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
