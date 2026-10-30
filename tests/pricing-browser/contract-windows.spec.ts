import { expect, test, type Page } from '@playwright/test';
import type { WalletAccount, WalletPolicy, WalletRow, WalletWorkspace } from '../../lib/wallet-types';
import type { ActionDueRow } from '../../lib/wallet-action-types';
import type { ContractWindow } from '../../lib/contract-windows';

const customerId = '77111111-1111-4111-8111-111111111111';
const opportunityId = '88111111-1111-4111-8111-111111111111';
const policy: WalletPolicy = { walletShareTargetBps: 8000, focusBandBps: 8000, staleAfterMonths: 6, version: 1, note: 'Policy', enteredBy: 'manager@example.test', enteredAt: '2026-10-01T00:00:00Z' };
const row: WalletRow = { customerId, name: 'Example Diagnostic Laboratory', city: 'Bidar', walletPaise: 10000000, salesPaise: 2000000, sharePermille: 200, captureGapPaise: 6000000, untappedPaise: 4000000, confidence: 'high', asOf: '2026-10-30', verified: true, stale: false, belowSales: false, inFocusBand: true };
const coverage = { certified: true, windowFrom: '2026-07-01', windowTo: '2026-09-30', windowLabel: 'Jul–Sep 2026', reason: null };
const window: ContractWindow = { customerId, customerName: row.name, town: row.city, opportunityId, kind: 'capture', divisionName: null, category: 'competitor_lock_in', party: 'Other Diagnostics', endsOn: '2027-01-12', daysLeft: 74, confidence: 'high', source: 'document' };
const ended: ContractWindow = { ...window, opportunityId: '88222222-2222-4222-8222-222222222222', customerName: 'Ended Tender Lab', category: 'contract_tender', party: 'Tender Holder', endsOn: '2026-10-20', daysLeft: -10 };
type Options = { empty?: boolean; plannedCount?: number; failure?: 'read' | 'malformed'; more?: boolean };

async function fixture(page: Page, options: Options = {}) {
  const reads: number[] = [];
  const dueRow: ActionDueRow = { actionId: '99111111-1111-4111-8111-111111111111', customerId, customerName: 'Action Due Lab', city: 'Bidar', opportunityKind: 'capture', constraintCategory: 'price', actionType: 'visit', detail: 'Visit about the quote', ownerEmail: 'manager@example.test', dueOn: '2026-10-29', overdue: true, expectedMonthlyGainPaise: null };
  await page.route('**/api/accounts**', route => route.fulfill({ json: { accounts: [], page: { page: 1, pageSize: 50, total: 0 }, owners: [], territories: [], canAssign: true, canEraseContacts: false, canSeePowerMap: false, actorEmail: 'manager@example.test', today: '2026-10-30', classPolicy: { aMinPaise: '20000000', bMinPaise: '7500000' } } }));
  // Query strings require the trailing ?** (the same harness as wallet-actions.spec.ts).
  await page.route('**/api/wallet/actions?**', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('action') === 'get_contract_windows') {
      const pageNumber = Number(url.searchParams.get('page')); reads.push(pageNumber);
      if (options.failure === 'read') return route.fulfill({ status: 502, json: { error: 'Unavailable' } });
      const rows = options.empty ? [] : pageNumber === 1 ? [window, ended] : [{ ...window, opportunityId: '88333333-3333-4333-8333-333333333333', customerName: 'Next Page Lab' }];
      return route.fulfill({ json: { rows: options.failure === 'malformed' ? [window, { ...ended, daysLeft: 1.5 }] : rows, total: options.empty ? 0 : options.more ? 3 : 2, plannedCount: options.plannedCount ?? 0, page: pageNumber, pageSize: 20 } });
    }
    if (url.searchParams.get('action') === 'get_actions_due') return route.fulfill({ json: { page: 1, pageSize: 50, total: 1, overdueCount: 1, rows: [dueRow] } });
    return route.fulfill({ json: [] });
  });
  await page.route('**/api/wallet/diagnosis**', route => route.fulfill({ json: new URL(route.request().url()).searchParams.get('action') === 'get_account_opportunities' ? [] : { rows: [], undiagnosedFocusCount: null, focusCount: null } }));
  await page.route('**/api/wallet?**', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('action') === 'get_wallet_account') return route.fulfill({ json: { policy, coverage, row, current: null, history: [], divisions: [] } satisfies WalletAccount });
    return route.fulfill({ json: { policy, coverage, view: (url.searchParams.get('view') ?? 'all') as WalletWorkspace['view'], page: 1, pageSize: 50, total: 1, rows: [row], summary: { focusCount: 1, focusGapPaise: 6000000, estimatedAccounts: 1, accountsWithSales: 1, unlinkedSalesPaise: 0, unlinkedLedgers: 0 } } satisfies WalletWorkspace });
  });
  await page.goto('/?view=accounts');
  await page.getByRole('button', { name: 'Wallet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Actions due', exact: true })).toBeVisible();
  expect(reads).toEqual([]);
  await page.getByRole('button', { name: 'Actions due', exact: true }).click();
  return reads;
}

for (const width of [375, 1280]) test.describe(`Contracts ending soon at ${width}px`, () => {
  test.use({ viewport: { width, height: 812 } });
  test('section and rows appear above actions due without horizontal overflow', async ({ page }) => {
    await fixture(page);
    const section = page.getByRole('region', { name: 'Contracts ending soon', exact: true });
    await expect(section.getByRole('heading')).toHaveText('Contracts ending soon (2)');
    const button = section.getByRole('button', { name: /Example Diagnostic Laboratory/ });
    for (const text of ['Example Diagnostic Laboratory · Bidar', 'Competitor lock-in: Other Diagnostics', 'Ends 12 Jan 2027 · 74 days left', 'No action planned before it ends']) await expect(button).toContainText(text);
    await expect(page.getByRole('list', { name: 'Actions due', exact: true })).toContainText('Visit about the quote');
    expect(await section.evaluate(el => !!(el.compareDocumentPosition(document.querySelector('ul[aria-label="Actions due"]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  test('tapping a contract row opens the lab sheet', async ({ page }) => {
    await fixture(page);
    await page.getByRole('region', { name: 'Contracts ending soon', exact: true }).getByRole('button', { name: /Example Diagnostic Laboratory/ }).click();
    await expect(page.getByRole('dialog', { name: row.name, exact: true })).toBeVisible();
  });
  test('ended tender shows ended wording in the danger colour', async ({ page }) => {
    await fixture(page);
    const button = page.getByRole('button', { name: /Ended Tender Lab/ });
    await expect(button).toContainText('Tender: Tender Holder');
    await expect(button.getByText('Ended 10 days ago', { exact: true })).toHaveClass(/text-sf-danger/);
  });
  test('zero total hides the section', async ({ page }) => {
    const reads = await fixture(page, { empty: true });
    await expect.poll(() => reads.length).toBe(1);
    await expect(page.getByRole('region', { name: 'Contracts ending soon', exact: true })).toHaveCount(0);
    await expect(page.getByText('more already', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Action Due Lab/ })).toBeVisible();
  });
  for (const plannedCount of [1, 3]) test(`planned count ${plannedCount} appears even with no unplanned windows`, async ({ page }) => {
    await fixture(page, { empty: true, plannedCount });
    await expect(page.getByText(`${plannedCount} more already ${plannedCount === 1 ? 'has' : 'have'} an action planned`, { exact: true })).toHaveClass(/text-sf-muted/);
    await expect(page.getByRole('region', { name: 'Contracts ending soon', exact: true })).toHaveCount(0);
  });
  for (const failure of ['read', 'malformed'] as const) test(`${failure} failure shows muted message while actions due render`, async ({ page }) => {
    await fixture(page, { failure });
    await expect(page.getByText('Contract dates could not load', { exact: true })).toHaveClass(/text-sf-muted/);
    await expect(page.getByRole('region', { name: 'Contracts ending soon', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Action Due Lab/ })).toContainText('Visit about the quote');
  });
  test('load more appends the next page', async ({ page }) => {
    const reads = await fixture(page, { more: true });
    const section = page.getByRole('region', { name: 'Contracts ending soon', exact: true });
    await section.getByRole('button', { name: 'Load more', exact: true }).click();
    await expect(section.getByRole('button', { name: /Next Page Lab/ })).toBeVisible();
    await expect(section.getByRole('listitem')).toHaveCount(3);
    await expect(section.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0);
    expect(reads).toEqual([1, 2]);
  });
});
