import { expect, test, type Page } from '@playwright/test';
import type { WalletAccount, WalletWorkspace } from '../../lib/wallet-types';
import type { WalletOpportunity } from '../../lib/wallet-diagnosis-types';

const a = '66111111-1111-4111-8111-111111111111';
const b = '77111111-1111-4111-8111-111111111111';
const c = '88111111-1111-4111-8111-111111111111';
const opportunityId = '99111111-1111-4111-8111-111111111111';
const constraintId = '99222222-2222-4222-8222-222222222222';
const snapshotId = '88222222-2222-4222-8222-222222222222';
const policy = { version: 1, walletShareTargetBps: 8000, focusBandBps: 8000, staleAfterMonths: 6, note: 'Policy', enteredBy: 'manager@example.test', enteredAt: '2026-10-30T00:00:00Z' };
const coverage = { certified: true, windowFrom: '2026-07-01', windowTo: '2026-09-30', windowLabel: 'Jul–Sep 2026', reason: null };
const row = { customerId: a, name: 'Example Diagnostic Laboratory', city: 'Bidar', walletPaise: 10000000, salesPaise: 2000000, sharePermille: 200, untappedPaise: 8000000, captureGapPaise: 6000000, confidence: 'high' as const, asOf: '2026-10-01', verified: false, stale: false, belowSales: false, inFocusBand: true };
const second = { ...row, customerId: b, name: 'Not diagnosed lab' };
const none = { ...row, customerId: c, name: 'No estimate lab', walletPaise: null, sharePermille: null, confidence: null, asOf: null };
const current = { id: snapshotId, monthlyWalletPaise: 10000000, method: 'customer_stated' as const, source: 'Discussion', confidence: 'high' as const, asOf: row.asOf, note: 'Estimate', loweredReason: null, enteredBy: 'manager@example.test', enteredAt: '2026-10-01T00:00:00Z', verifiedBy: null, divisions: [{ code: 'BIOCHEM', name: 'Biochemistry', monthlyWalletPaise: 4000000 }], unallocatedPaise: 6000000 };
const diagnosed: WalletOpportunity = { id: opportunityId, customerId: a, kind: 'capture', openedReason: 'Tender price pressure', openedBy: 'manager@example.test', openedAt: '2026-10-01T00:00:00Z', closure: null, constraint: { id: constraintId, category: 'price', evidence: 'Competitor quote', confidence: 'high', recordedBy: 'manager@example.test', recordedAt: '2026-10-02T00:00:00Z' }, history: [] };
type Options = { diagnosisFailure?: '500' | 'shape'; conflict?: boolean };
async function fixture(page: Page, options: Options = {}) {
  const posts: Array<{ action: string; payload: Record<string, unknown> }> = [];
  let opportunities: WalletOpportunity[] = [diagnosed];
  let attemptedConflict = false;
  await page.route('**/api/accounts**', route => route.fulfill({ json: { accounts: [], page: { page: 1, pageSize: 50, total: 0 }, owners: [], territories: [], canAssign: true, canEraseContacts: false, canSeePowerMap: false, actorEmail: 'manager@example.test', today: '2026-10-30', classPolicy: { aMinPaise: '20000000', bMinPaise: '7500000' } } }));
  await page.route('**/api/wallet/diagnosis**', async route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { action: string; payload: Record<string, unknown> }; posts.push(body);
      if (options.conflict && !attemptedConflict) { attemptedConflict = true; return route.fulfill({ status: 409, json: { error: 'PT409' } }); }
      if (body.action === 'open_opportunity') opportunities = [...opportunities, { ...diagnosed, id: opportunityId, customerId: String(body.payload.customerId), kind: String(body.payload.kind) as WalletOpportunity['kind'], openedReason: String(body.payload.reason), constraint: null, history: [] }];
      if (body.action === 'record_constraint') opportunities = opportunities.map(item => item.id === body.payload.opportunityId ? { ...item, constraint: { id: constraintId, category: String(body.payload.category) as WalletOpportunity['constraint'] extends infer _ ? 'price' : never, evidence: String(body.payload.evidence), confidence: String(body.payload.confidence) as 'high', recordedBy: 'manager@example.test', recordedAt: '2026-10-02T00:00:00Z' }, history: [] } : item);
      if (body.action === 'close_opportunity') opportunities = opportunities.map(item => item.id === body.payload.opportunityId ? { ...item, closure: { outcome: String(body.payload.outcome) as 'lost', reason: String(body.payload.reason), closedBy: 'manager@example.test', closedAt: '2026-10-03T00:00:00Z' } } : item);
      return route.fulfill({ json: { ok: true } });
    }
    if (url.searchParams.get('action') === 'get_wallet_diagnoses') {
      if (options.diagnosisFailure === '500') return route.fulfill({ status: 500, json: { error: 'offline' } });
      if (options.diagnosisFailure === 'shape') return route.fulfill({ json: { rows: 'wrong', undiagnosedFocusCount: 2, focusCount: 3 } });
      return route.fulfill({ json: { rows: [{ customerId: a, kind: 'capture', category: 'price', confidence: 'high' }], undiagnosedFocusCount: 2, focusCount: 3 } });
    }
    return route.fulfill({ json: opportunities.filter(item => item.customerId === url.searchParams.get('customerId')) });
  });
  await page.route('**/api/wallet?**', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('action') === 'get_wallet_account') return route.fulfill({ json: { policy, coverage, row, current, history: [current], divisions: [{ code: 'BIOCHEM', name: 'Biochemistry' }] } satisfies WalletAccount });
    const workspace: WalletWorkspace = { policy, coverage, view: (url.searchParams.get('view') ?? 'all') as WalletWorkspace['view'], page: 1, pageSize: 50, total: 3, rows: [row, second, none], summary: { focusCount: 3, focusGapPaise: 1000000, estimatedAccounts: 3, accountsWithSales: 3, unlinkedSalesPaise: 0, unlinkedLedgers: 0 } };
    return route.fulfill({ json: workspace });
  });
  await page.goto('/?view=accounts');
  await page.getByRole('button', { name: 'Wallet', exact: true }).click();
  return { posts };
}
async function openAccount(page: Page) { await page.getByRole('button', { name: /Example Diagnostic Laboratory/ }).click(); return page.getByRole('dialog'); }

for (const width of [375, 1280]) test.describe(`Wallet diagnosis at ${width}px`, () => {
  test.use({ viewport: { width, height: 812 } });
  test('renders diagnosis chips and the certified header count without horizontal scroll', async ({ page }) => {
    await fixture(page);
    await expect(page.getByText('Why: Price', { exact: true })).toBeVisible();
    await expect(page.getByText('Not diagnosed', { exact: true })).toBeVisible();
    const noEstimate = page.getByRole('button', { name: /No estimate lab/ });
    await expect(noEstimate).toContainText('No estimate');
    await expect(noEstimate).not.toContainText('Not diagnosed');
    await expect(page.getByText(/2 of 3 Focus accounts not diagnosed/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
  test('starts diagnosis, records a constraint, and closes it with category evidence hints', async ({ page }) => {
    const { posts } = await fixture(page);
    const sheet = await openAccount(page);
    await sheet.getByRole('button', { name: 'Close', exact: true }).first().click();
    await page.getByRole('button', { name: /Not diagnosed lab/ }).click();
    const diagnosis = page.getByRole('region', { name: "Why we're not winning" });
    await diagnosis.getByRole('button', { name: 'Start diagnosis' }).click();
    await diagnosis.getByLabel('Reason').fill('Customer has a new tender');
    await diagnosis.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ action: 'open_opportunity', payload: { customerId: b, kind: 'capture', reason: 'Customer has a new tender' } });
    await diagnosis.getByRole('button', { name: 'Record constraint' }).click();
    await expect(diagnosis.getByText('Capture opportunity · Customer has a new tender', { exact: true })).toBeVisible();
    await diagnosis.getByLabel('Category').selectOption('price');
    await expect(diagnosis.getByText('Competitor, product and their price')).toBeVisible();
    await diagnosis.getByLabel('Evidence').fill('Competitor quote for product X');
    await diagnosis.getByLabel('Confidence').selectOption('high');
    await diagnosis.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1]).toMatchObject({ action: 'record_constraint', payload: { opportunityId, category: 'price', evidence: 'Competitor quote for product X', confidence: 'high', expectedCurrentConstraintId: null } });
    await diagnosis.getByRole('button', { name: 'Record constraint' }).click();
    await diagnosis.getByLabel('Category').selectOption('unknown');
    await expect(diagnosis.getByText('What we need to find out')).toBeVisible();
    await diagnosis.getByRole('button', { name: 'Cancel' }).click();
    await diagnosis.getByRole('button', { name: 'Close opportunity', exact: true }).click();
    await diagnosis.getByLabel('Outcome').selectOption('lost');
    await diagnosis.getByLabel('Reason').fill('Lost the tender');
    await diagnosis.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => posts.length).toBe(3);
    expect(posts[2]).toMatchObject({ action: 'close_opportunity', payload: { opportunityId, outcome: 'lost', reason: 'Lost the tender' } });
  });
  test('keeps the 409 reload message visible', async ({ page }) => {
    await fixture(page, { conflict: true });
    const sheet = await openAccount(page);
    const diagnosis = page.getByRole('region', { name: "Why we're not winning" });
    await diagnosis.getByRole('button', { name: 'Record constraint' }).click();
    await diagnosis.getByLabel('Category').selectOption('price');
    await diagnosis.getByLabel('Evidence').fill('Competitor quote');
    await diagnosis.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(diagnosis.getByText('Someone else just updated this. Reloaded.', { exact: true })).toBeVisible();
    await expect(sheet).toBeVisible();
  });
  test('failed and malformed diagnosis reads leave list chips out', async ({ page }) => {
    await fixture(page, { diagnosisFailure: '500' });
    await expect(page.getByRole('button', { name: /Example Diagnostic Laboratory/ })).not.toContainText('Why: Price');
    await expect(page.getByRole('button', { name: /Example Diagnostic Laboratory/ })).not.toContainText('Not diagnosed');
  });
});
