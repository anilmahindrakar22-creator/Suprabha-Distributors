import { expect, test, type Page } from '@playwright/test';
import type { WalletAccount, WalletWorkspace } from '../../lib/wallet-types';
import type { ContractWindow } from '../../lib/contract-windows';
import type { ActionDueRow } from '../../lib/wallet-action-types';
import type { MyActions } from '../../lib/my-actions-types';

// Same isolated AccountsWorkspace harness and API shapes as wallet,
// contract-windows and my-actions specs. No production navigation changes.
const customerId = '77111111-1111-4111-8111-111111111111';
const opportunityId = '88111111-1111-4111-8111-111111111111';
const actionId = '99111111-1111-4111-8111-111111111111';
const policy = { walletShareTargetBps: 8000, focusBandBps: 8000, staleAfterMonths: 6, version: 1, note: 'Policy', enteredBy: 'manager@example.test', enteredAt: '2026-10-01T00:00:00Z' };
const coverage = { certified: true, windowFrom: '2026-07-01', windowTo: '2026-09-30', windowLabel: 'Jul–Sep 2026', reason: null };
const row = { customerId, name: 'Example Diagnostic Laboratory', city: 'Bidar', walletPaise: 10000000, salesPaise: 2000000, sharePermille: 200, captureGapPaise: 6000000, untappedPaise: 8000000, confidence: 'high' as const, asOf: '2026-10-30', verified: true, stale: false, belowSales: false, inFocusBand: true };
const contract: ContractWindow = { customerId, customerName: row.name, town: row.city, opportunityId, kind: 'capture', divisionName: null, category: 'competitor_lock_in', party: 'Other Diagnostics', endsOn: '2027-01-12', daysLeft: 74, confidence: 'high', source: 'document' };
const deadlines: ContractWindow[] = [contract,
  { ...contract, opportunityId: '88222222-2222-4222-8222-222222222222', customerName: 'Ended Tender Lab', category: 'contract_tender', party: 'Tender Holder', endsOn: '2026-10-20', daysLeft: -10 },
  { ...contract, opportunityId: '88333333-3333-4333-8333-333333333333', customerName: 'Question Lab', category: 'unknown', party: 'Who approves the purchase?', endsOn: '2026-11-05', daysLeft: 6 },
];
const due: ActionDueRow = { actionId, customerId, customerName: 'Action Due Lab', city: 'Bidar', opportunityKind: 'capture', constraintCategory: 'price', actionType: 'visit', detail: 'Discuss the quote', ownerEmail: 'manager@example.test', dueOn: '2026-10-29', overdue: true, expectedMonthlyGainPaise: null };

async function fixture(page: Page, { certified = true, deepLink = false, sharePermille = 200 }: { certified?: boolean; deepLink?: boolean; sharePermille?: number | null } = {}) {
  const visibleRow = { ...row, sharePermille, ...(certified ? {} : { salesPaise: null, sharePermille: null, captureGapPaise: null, untappedPaise: null, inFocusBand: null }) };
  await page.route('**/api/accounts**', route => route.fulfill({ json: { accounts: [], page: { page: 1, pageSize: 50, total: 0 }, owners: [], territories: [], canAssign: true, canSeeMyActions: true, canEraseContacts: false, canSeePowerMap: false, actorEmail: 'manager@example.test', today: '2026-10-30', classPolicy: { aMinPaise: '20000000', bMinPaise: '7500000' } } }));
  await page.route('**/api/wallet/actions?**', route => {
    const action = new URL(route.request().url()).searchParams.get('action');
    if (action === 'get_contract_windows') return route.fulfill({ json: { rows: deadlines, total: deadlines.length, plannedCount: 0, page: 1, pageSize: 20 } });
    if (action === 'get_actions_due') return route.fulfill({ json: { rows: [due], total: 1, overdueCount: 1, page: 1, pageSize: 50 } });
    return route.fulfill({ json: [] });
  });
  await page.route('**/api/wallet/diagnosis**', route => route.fulfill({ json: new URL(route.request().url()).searchParams.get('action') === 'get_wallet_diagnoses'
    ? { rows: [{ customerId, kind: 'capture', category: 'price', confidence: 'low', priceUnproven: true }], undiagnosedFocusCount: 0, focusCount: 1 }
    : [] }));
  await page.route('**/api/wallet?**', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('action') === 'get_wallet_account') return route.fulfill({ json: { policy, coverage: { ...coverage, certified }, row: visibleRow, current: null, history: [], divisions: [] } satisfies WalletAccount });
    return route.fulfill({ json: { policy, coverage: { ...coverage, certified }, view: (url.searchParams.get('view') ?? 'all') as WalletWorkspace['view'], page: 1, pageSize: 50, total: 1, rows: [visibleRow], summary: { focusCount: certified ? 1 : null, focusGapPaise: certified ? 6000000 : null, estimatedAccounts: 1, accountsWithSales: certified ? 1 : null, unlinkedSalesPaise: 0, unlinkedLedgers: 0 } } satisfies WalletWorkspace });
  });
  const mine: MyActions = { page: 1, pageSize: 50, total: 1, overdueCount: 1, rows: [{ actionId, customerId, customerName: row.name, city: row.city, actionType: 'visit', detail: due.detail, dueOn: due.dueOn, overdue: true, constraintCategory: 'price', routeToDecider: ['Asha', 'Ravi', 'Meena'] }] };
  await page.route('**/api/my-actions?**', route => route.fulfill({ json: mine }));
  if (deepLink) {
    // Supply the new props to the existing Vite fixture at the browser boundary.
    // Keep the shared harness file unchanged for every other spec.
    await page.route('**/main.tsx', async route => {
      const response = await route.fetch();
      const source = await response.text();
      const withProps = source.replace(/((?:_?jsxDEV|_?jsx)\(AccountsWorkspace,\s*\{)/, `$1 initialView: 'wallet', initialCustomerId: '${customerId}',`);
      expect(withProps).not.toBe(source);
      await route.fulfill({ response, body: withProps });
    });
  }
  await page.goto('/?view=accounts');
  if (!deepLink) await page.getByRole('button', { name: 'Wallet', exact: true }).click();
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const wallet = page.getByRole('region', { name: 'Wallet', exact: true });
  if (await wallet.count()) expect(await wallet.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
}

for (const width of [375, 1280]) test.describe(`Glance Wallet at ${width}px`, () => {
  test.use({ viewport: { width, height: 812 } });

  test('wallet meters expose share, target and constraint in every lab view without overflow', async ({ page }) => {
    await fixture(page);
    for (const view of ['Focus', 'All', 'No estimate', 'Stale', 'Below sales']) {
      await page.getByRole('button', { name: view, exact: true }).click();
      const lab = page.getByRole('list', { name: 'Wallet accounts', exact: true });
      const meter = lab.getByRole('meter', { name: 'Wallet share 20%', exact: true });
      await expect(meter).toHaveAttribute('aria-valuenow', '20');
      await expect(meter.locator('[aria-hidden="true"]').first()).toHaveClass(/bg-sf-danger/);
      await expect(meter.locator('[aria-hidden="true"]').last()).toHaveAttribute('style', /left: 80%/);
      await expect(lab.getByText('Why: Price (not proven)', { exact: true })).toHaveClass(/break-words/);
      await expect(lab.locator('svg.lucide-indian-rupee')).toBeVisible();
      await expect(lab.getByText('Gap ₹60,000/mo to target', { exact: true })).toHaveClass(/text-sf-danger/);
      await noOverflow(page);
    }
  });

  for (const [sharePermille, tone] of [[400, 'warning'], [800, 'success']] as const) test(`share ${sharePermille / 10}% uses ${tone} tone`, async ({ page }) => {
    await fixture(page, { sharePermille });
    const meter = page.getByRole('meter', { name: `Wallet share ${sharePermille / 10}%`, exact: true });
    await expect(meter).toHaveAttribute('aria-valuenow', String(sharePermille / 10));
    await expect(meter.locator('[aria-hidden="true"]').first()).toHaveClass(new RegExp(`bg-sf-${tone}`));
    await noOverflow(page);
  });

  for (const certified of [false, true]) test(`${certified ? 'unknown share' : 'uncertified sales'} shows a dashed Awaiting Tally track`, async ({ page }) => {
    await fixture(page, { certified, sharePermille: null });
    const lab = page.getByRole('list', { name: 'Wallet accounts', exact: true });
    const meter = lab.getByRole('meter', { name: 'Wallet share: awaiting data', exact: true });
    await expect(meter).toHaveClass(/border-dashed/);
    await expect(meter).not.toHaveAttribute('aria-valuenow');
    await expect(lab.getByText('Awaiting Tally', { exact: true })).toBeVisible();
    await noOverflow(page);
  });

  test('deadline countdowns expose contract and question horizons beside their icons', async ({ page }) => {
    await fixture(page);
    await page.getByRole('button', { name: 'Actions due', exact: true }).click();
    const section = page.getByRole('region', { name: 'Deadlines without a plan', exact: true });
    await expect(section.getByRole('img', { name: 'Ends 12 Jan 2027 · 74 days left: 74 days left of 120', exact: true })).toBeVisible();
    await expect(section.getByRole('img', { name: 'Ended 10 days ago: ended 10 days ago', exact: true })).toBeVisible();
    await expect(section.getByRole('img', { name: 'Ask by 5 Nov 2026 · 6 days left: 6 days left of 14', exact: true })).toBeVisible();
    // lucide 1.x renders CircleHelp with its canonical class, circle-question-mark.
    for (const icon of ['lock', 'file-badge', 'circle-help, svg.lucide-circle-question-mark']) await expect(section.locator(`svg.lucide-${icon}`).first()).toBeVisible();
    await expect(page.getByRole('list', { name: 'Actions due', exact: true }).locator('svg.lucide-footprints').locator('..')).toHaveClass(/text-sf-danger/);
    await noOverflow(page);
  });

  test('My actions keeps the meeting route in order with a decider crown and overdue chip', async ({ page }) => {
    await fixture(page);
    await page.getByRole('button', { name: 'Back to Accounts', exact: true }).click();
    await page.getByRole('button', { name: 'My actions', exact: true }).click();
    const action = page.getByRole('list', { name: 'Open actions', exact: true });
    await expect(action.getByText('Meet: Asha → Ravi → Meena', { exact: true })).toBeVisible();
    const decider = action.locator('svg.lucide-crown').locator('..');
    await expect(decider).toHaveText('Meena');
    await expect(decider.locator('strong')).toHaveText('Meena');
    await expect(action.locator('svg.lucide-footprints')).toBeVisible();
    await expect(action.getByText('Overdue', { exact: true }).locator('..')).toHaveClass(/text-sf-danger/);
    await noOverflow(page);
  });

  test('initialCustomerId opens the loaded lab sheet once through AccountsWorkspace', async ({ page }) => {
    await fixture(page, { deepLink: true });
    const sheet = page.getByRole('dialog', { name: row.name, exact: true });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Update estimate', exact: true })).toBeVisible();
    await noOverflow(page);
    expect(await sheet.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await sheet.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Wallet accounts', exact: true })).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
