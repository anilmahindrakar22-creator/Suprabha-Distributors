import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { WalletAccount, WalletCommand, WalletWorkspace } from '../../lib/wallet-types';

const customerId = '66111111-1111-4111-8111-111111111111';
const snapshotId = '88222222-2222-4222-8222-222222222222';
const policy = { version: 1, walletShareTargetBps: 8000, focusBandBps: 8000, staleAfterMonths: 6, note: 'Initial policy', enteredBy: 'manager@example.test', enteredAt: '2026-10-30T00:00:00Z' };
const coverage = { certified: true, windowFrom: '2026-07-01', windowTo: '2026-09-30', windowLabel: 'Jul–Sep 2026', reason: null };
const row = { customerId, name: 'Example Diagnostic Laboratory', city: 'Bidar', walletPaise: 10000000, salesPaise: 2000000, sharePermille: 200, untappedPaise: 8000000, captureGapPaise: 6000000, confidence: 'high' as const, asOf: '2026-10-01', verified: false, stale: false, belowSales: false, inFocusBand: true };
const current = { id: snapshotId, monthlyWalletPaise: row.walletPaise, method: 'customer_stated' as const, source: 'Customer discussion', confidence: 'high' as const, asOf: row.asOf, note: 'Initial estimate', loweredReason: null, enteredBy: 'manager@example.test', enteredAt: '2026-10-01T00:00:00Z', verifiedBy: null, divisions: [{ code: 'BIOCHEM', name: 'Biochemistry', monthlyWalletPaise: 4000000 }], unallocatedPaise: 6000000 };
type Options = { certified?: boolean; canAssign?: boolean; failure?: 'conflict' | 'network' | 'forbidden'; };

async function fixture(page: Page, options: Options = {}) {
  const posts: WalletCommand[] = [];
  const reads: URL[] = [];
  const certified = options.certified !== false;
  let saved = false;
  let version = 1;
  await page.route('**/api/accounts**', route => route.fulfill({ json: { accounts: [], page: { page: 1, pageSize: 50, total: 0 }, owners: [], territories: [], canAssign: options.canAssign !== false, canEraseContacts: false, canSeePowerMap: false, actorEmail: 'manager@example.test', today: '2026-10-30', classPolicy: { aMinPaise: '20000000', bMinPaise: '7500000' } } }));
  await page.route('**/api/wallet**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/wallet/actions') return route.fulfill({ json: route.request().method() === 'GET' ? (url.searchParams.get('action') === 'get_actions_due' ? { page: 1, pageSize: 50, total: 0, overdueCount: 0, rows: [] } : []) : { ok: true } });
    if (url.pathname === '/api/wallet/diagnosis' && route.request().method() === 'GET') {
      return route.fulfill({ json: url.searchParams.get('action') === 'get_account_opportunities' ? [] : { rows: [], undiagnosedFocusCount: null, focusCount: null, focusWithoutDecisionMaker: 1 } });
    }
    if (options.failure === 'forbidden') return route.fulfill({ status: 403, json: { error: 'Wallet access required' } });
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as WalletCommand; posts.push(body);
      if (posts.length === 1 && options.failure === 'network') return route.abort('failed');
      if (options.failure === 'conflict' && posts.length === 1) {
        if (body.action === 'set_wallet_policy') version++;
        return route.fulfill({ status: 409, json: { error: 'PT409' } });
      }
      if (body.action === 'record_wallet_snapshot') saved = true;
      if (body.action === 'set_wallet_policy') version++;
      return route.fulfill({ json: { ok: true, snapshotId, version } });
    }
    reads.push(url);
    const latest = posts.findLast(p => p.action === 'record_wallet_snapshot');
    const updated = saved && latest?.action === 'record_wallet_snapshot' ? { ...row, walletPaise: latest.payload.monthlyWalletPaise } : row;
    const visibleRow = certified ? updated : { ...updated, salesPaise: null, sharePermille: null, captureGapPaise: null, untappedPaise: null, inFocusBand: null };
    if (url.searchParams.get('action') === 'get_wallet_account') {
      const account: WalletAccount = { policy, coverage: { ...coverage, certified }, row: visibleRow, current: { ...current, monthlyWalletPaise: updated.walletPaise }, history: [current], divisions: [{ code: 'BIOCHEM', name: 'Biochemistry' }, { code: 'HAEM', name: 'Haematology' }] };
      return route.fulfill({ json: account });
    }
    const workspace: WalletWorkspace = { policy: { ...policy, version }, coverage: { ...coverage, certified }, view: url.searchParams.get('view') as WalletWorkspace['view'], page: Number(url.searchParams.get('page')), pageSize: 50, total: 51, rows: [visibleRow, { ...visibleRow, customerId: '77111111-1111-4111-8111-111111111111', name: 'No estimate lab', walletPaise: null, sharePermille: null, confidence: null, asOf: null }], summary: { focusCount: certified ? 8 : null, focusGapPaise: certified ? 42000000 : null, estimatedAccounts: 9, accountsWithSales: certified ? 112 : null, unlinkedSalesPaise: certified ? 1234500 : null, unlinkedLedgers: certified ? 3 : null } };
    return route.fulfill({ json: workspace });
  });
  await page.goto('/?view=accounts');
  if (options.canAssign !== false) await page.getByRole('button', { name: 'Wallet', exact: true }).click();
  return { posts, reads };
}

async function openForm(page: Page) {
  await page.getByRole('button', { name: /Example Diagnostic Laboratory/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Unallocated', { exact: true })).toBeVisible();
  await expect(sheet.getByText('History (1)', { exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'Update estimate', exact: true }).click();
  const form = sheet.getByRole('form', { name: 'Update estimate' });
  await form.getByLabel('Source', { exact: true }).fill('Customer call');
  await form.getByLabel('Note', { exact: true }).fill('Updated after review');
  return form;
}

for (const width of [375, 1280]) test.describe(`Wallet at ${width}px`, () => {
  test.use({ viewport: { width, height: 812 } });
  test('certified header, account figures, and no horizontal overflow', async ({ page }, testInfo) => {
    await fixture(page);
    await expect(page.getByText('Focus band: 8 accounts hold 80% of the capture gap · ₹4.2 L/month', { exact: true })).toBeVisible();
    await expect(page.getByText('Ranked by gap to the 80% Wallet-share target · based on 9 of 112 accounts with an estimate · From Tally, Jul–Sep 2026', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Focus', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Wallet ₹1,00,000/mo · Sales ₹20,000/mo · 20% share', { exact: true })).toBeVisible();
    await expect(page.getByText('Gap ₹60,000/mo to target', { exact: true })).toBeVisible();
    const tick = page.getByRole('meter', { name: 'Wallet share 20%', exact: true }).locator('[aria-hidden="true"]').last();
    await expect(tick).toBeVisible();
    expect(await tick.evaluate(el => (el as HTMLElement).style.left)).toBe('80%');
    const noEstimate = page.getByRole('button', { name: /No estimate lab/ });
    await expect(noEstimate).toContainText('No estimate');
    await expect(noEstimate.getByRole('meter')).not.toHaveAttribute('aria-valuenow');
    await expect(noEstimate).not.toContainText('Not verified');
    await expect(page.getByRole('button', { name: /Example Diagnostic Laboratory/ })).toContainText('Not verified');
    const unlinked = page.getByText('Not linked to a customer:', { exact: false });
    await expect(unlinked).toHaveCount(1);
    await expect(unlinked).toContainText('₹12,345/month across 3 Tally ledgers');
    expect(await unlinked.evaluate(el => ({ afterHeader: !!el.previousElementSibling?.textContent?.includes('Focus band:'), beforeChips: el.nextElementSibling?.getAttribute('aria-label') === 'Wallet views' }))).toEqual({ afterHeader: true, beforeChips: true });
    await expect(page.getByLabel('Search accounts')).toHaveAttribute('placeholder', 'Name or town');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    mkdirSync('work/tmp', { recursive: true });
    await page.screenshot({ path: `work/tmp/wallet-${width === 375 ? 'phone' : 'desktop'}-${testInfo.project.name}.png`, fullPage: true });
    const sizes = await page.getByRole('region', { name: 'Wallet', exact: true }).getByRole('button').evaluateAll(buttons => buttons.map(el => el.getBoundingClientRect().height));
    expect(sizes.every(height => height >= 44)).toBe(true);
  });
  test('uncertified coverage hides sales and disables sales-dependent chips', async ({ page }) => {
    await fixture(page, { certified: false });
    await expect(page.getByText('Sales figures appear once Tally coverage is certified (Jul–Sep 2026)', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'See Sales coverage' })).toHaveAttribute('href', '/?view=instrument-economics');
    for (const name of ['Focus', 'Below sales']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const account = page.getByRole('button', { name: /Example Diagnostic Laboratory/ });
    await expect(account).toContainText('Wallet ₹1,00,000/mo');
    await expect(account).not.toContainText('Sales');
    await expect(account).not.toContainText('Gap');
  });
  test('chips, debounced search, and 50-row pagination send query parameters', async ({ page }) => {
    const { reads } = await fixture(page);
    for (const [name, view] of [['All', 'all'], ['No estimate', 'no_estimate'], ['Stale', 'stale'], ['Below sales', 'below_sales'], ['Focus', 'focus']]) {
      await page.getByRole('button', { name, exact: true }).click();
      await expect.poll(() => reads.at(-1)?.searchParams.get('view')).toBe(view);
    }
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect.poll(() => reads.at(-1)?.searchParams.get('page')).toBe('2');
    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    await expect.poll(() => reads.at(-1)?.searchParams.get('page')).toBe('1');
    await page.getByLabel('Search accounts').fill('Bidar');
    await expect.poll(() => reads.at(-1)?.searchParams.get('search')).toBe('Bidar');
  });
  test('recording an estimate sends exact paise and refreshes the row', async ({ page }) => {
    const { posts } = await fixture(page);
    const form = await openForm(page);
    await form.getByLabel('Total (₹/month)', { exact: true }).fill('120000.29');
    await form.getByLabel('Add division split').check();
    await form.getByLabel('Biochemistry (₹/month)').fill('40000.01');
    await expect(form.getByText('Unallocated: ₹80,000.28/month')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await form.getByRole('button', { name: 'Save estimate' }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ action: 'record_wallet_snapshot', payload: { customerId, monthlyWalletPaise: 12000029, method: 'customer_stated', source: 'Customer call', confidence: 'high', note: 'Updated after review', loweredReason: null, divisions: [{ code: 'BIOCHEM', monthlyWalletPaise: 4000001 }], expectedCurrentSnapshotId: snapshotId } });
    expect((posts[0].payload as { requestId: string }).requestId).toMatch(/^[0-9a-f-]{36}$/);
    const asOf = (posts[0].payload as { asOf: string }).asOf;
    expect(asOf).toBe(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('button', { name: /Example Diagnostic Laboratory/ })).toContainText('Wallet ₹1,20,000.29/mo');
  });
  test('lowering reason appears only below the current total', async ({ page }) => {
    const { posts } = await fixture(page); const form = await openForm(page);
    const total = form.getByLabel('Total (₹/month)', { exact: true });
    await expect(form.getByLabel('Why is the estimate lower?')).toHaveCount(0);
    await total.fill('99999.99');
    await expect(form.getByLabel('Why is the estimate lower?')).toBeVisible();
    await total.fill('100000');
    await expect(form.getByLabel('Why is the estimate lower?')).toHaveCount(0);
    await total.fill('100001');
    await expect(form.getByLabel('Why is the estimate lower?')).toHaveCount(0);
    await total.fill('99999.99');
    await form.getByLabel('Why is the estimate lower?').fill('Customer revised volume');
    await form.getByRole('button', { name: 'Save estimate' }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ action: 'record_wallet_snapshot', payload: { monthlyWalletPaise: 9999999, loweredReason: 'Customer revised volume' } });
  });
  test('PT409 reloads the account and shows the message', async ({ page }) => {
    const { reads } = await fixture(page, { failure: 'conflict' }); const form = await openForm(page);
    await form.getByRole('button', { name: 'Save estimate' }).click();
    await expect(page.getByRole('dialog').getByText('Someone else updated this estimate. Reloaded.', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Update estimate', exact: true })).toBeVisible();
    expect(reads.filter(url => url.searchParams.get('action') === 'get_wallet_account')).toHaveLength(2);
  });
  test('network retry retains the original command', async ({ page }) => {
    const { posts } = await fixture(page, { failure: 'network' }); const form = await openForm(page);
    await form.getByRole('button', { name: 'Save estimate' }).click();
    await expect(form.getByRole('alert')).toContainText('Save could not be confirmed');
    await expect(form.getByLabel('Total (₹/month)', { exact: true })).toBeDisabled();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
    await form.getByRole('button', { name: 'Retry same save' }).click();
    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1]).toEqual(posts[0]);
  });
  test('targets use the current policy version', async ({ page }) => {
    const { posts } = await fixture(page);
    await page.getByRole('button', { name: 'Targets', exact: true }).click();
    const form = page.getByRole('form', { name: 'Wallet targets' });
    await form.getByLabel('Wallet-share target (%)', { exact: true }).fill('75.25');
    await form.getByLabel('Focus band (%)', { exact: true }).fill('85');
    await form.getByLabel('Stale after (months)', { exact: true }).fill('4');
    await form.getByLabel('Note', { exact: true }).fill('Reviewed targets');
    await form.getByRole('button', { name: 'Save targets' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(posts[0]).toMatchObject({ action: 'set_wallet_policy', payload: { walletShareTargetBps: 7525, focusBandBps: 8500, staleAfterMonths: 4, note: 'Reviewed targets', expectedVersion: 1 } });
  });
  test('role without canAssign has no Wallet entry', async ({ page }) => {
    const { reads } = await fixture(page, { canAssign: false });
    await expect(page.getByRole('button', { name: 'Add customer', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Wallet', exact: true })).toHaveCount(0);
    expect(reads).toHaveLength(0);
  });
  test('PT409 reloads policy targets', async ({ page }) => {
    const { reads, posts } = await fixture(page, { failure: 'conflict' });
    await page.getByRole('button', { name: 'Targets', exact: true }).click();
    const form = page.getByRole('form', { name: 'Wallet targets' });
    await form.getByLabel('Note', { exact: true }).fill('Reviewed targets');
    const before = reads.length;
    await form.getByRole('button', { name: 'Save targets' }).click();
    await expect(page.getByRole('dialog').getByText('Someone else updated the targets. Reloaded.', { exact: true })).toBeVisible();
    await expect.poll(() => reads.length).toBeGreaterThan(before);
    await expect(form.getByLabel('Note', { exact: true })).toHaveValue('');
    await form.getByLabel('Note', { exact: true }).fill('Reviewed updated policy');
    await form.getByRole('button', { name: 'Save targets' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(posts[1]).toMatchObject({ action: 'set_wallet_policy', payload: { expectedVersion: 2 } });
  });
  test('PT403 shows management message with no retry', async ({ page }) => {
    await fixture(page, { failure: 'forbidden' });
    await expect(page.getByText('Wallet is for management', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  });
});
