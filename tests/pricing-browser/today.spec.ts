import { expect, test, type Page } from '@playwright/test';
import { orderBootstrap, orderLine, orderSummary, pricingWorkspace } from '../fixtures/api-builders';
import type { Today } from '../../lib/today';

const orderId = '11111111-1111-4111-8111-111111111111';
const customerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const now = '2026-10-30T09:00:00Z';
const fixture = (): Today => ({
  policyVersion: 'today-v1', generatedAt: now, coverageCertified: true,
  unblock: { total: 7, rows: [
    { type: 'approve_price', title: 'Apollo Clinic Lab', subtitle: '2 lines awaiting price approval', valuePaise: 4_800_000, approximate: true, since: now, rankReason: 'value_known', target: { kind: 'order', orderId } },
    { type: 'stock_covers', title: 'Glucose stock arrived', subtitle: '3 waiting orders covered', valuePaise: null, approximate: false, since: now, rankReason: 'value_unknown', target: { kind: 'stock', itemKey: 'GLU' } },
    { type: 'stuck_order', title: 'Care Hospital', subtitle: 'Packed for over 24 hours', valuePaise: 95_000, approximate: false, since: now, rankReason: 'value_known', target: { kind: 'order', orderId } },
  ] },
  grow: { total: 3, rows: [
    { type: 'diagnose', title: 'Diagnose Focus lab', subtitle: 'Focus account needs a diagnosis', valuePaisePerMonth: 6_000_000, valueKind: 'gap', due: null, rankReason: 'value_known', target: { kind: 'lab', customerId } },
    { type: 'deadline', title: 'Plan contract renewal', subtitle: 'Competitor lock-in ends soon', valuePaisePerMonth: null, valueKind: null, due: '2026-11-01', rankReason: 'value_unknown', target: { kind: 'lab', customerId } },
    { type: 'overdue_action', title: 'Follow up visit', subtitle: 'visit · Discuss repeat order', valuePaisePerMonth: 2_500_000, valueKind: 'expected', due: '2026-10-01', rankReason: 'value_known', target: { kind: 'lab', customerId } },
  ] },
});

// Same frame order/summary and My actions mocks as work-notifications.spec.ts.
async function mockFrame(page: Page, today: () => Today = fixture, fail: () => boolean = () => false) {
  const order = orderSummary({ id: orderId, orderNumber: 'SF-26-1001', customerName: 'Apollo Clinic Lab', status: 'awaiting_tally_billing', source: 'phone', createdAt: now, updatedAt: now, pricingState: 'approved', lines: [orderLine({ tallyKey: 'GLU', itemName: 'Glucose', quantity: 2, fulfilledQuantity: 2 })] });
  await page.route('**/api/me', route => route.fulfill({ json: { roles: ['administrator'] } }));
  await page.route('**/api/push-subscription**', route => route.fulfill({ json: { enabled: false, publicKey: '' } }));
  await page.route('**/api/wallet?**', route => route.fulfill({ json: { coverage: { certified: today().coverageCertified ?? true } } }));
  await page.route('**/api/my-actions?**', route => route.fulfill({ json: { page: 1, pageSize: 50, total: 0, overdueCount: 0, rows: [] } }));
  await page.route('**/api/orders**', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('summary') === '1') return route.fulfill({ json: { operations: {} } });
    if (url.searchParams.has('eventsFor')) return route.fulfill({ json: { events: [] } });
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    const query = url.searchParams.get('query') || '';
    const orders = query.startsWith('assignee:') ? [] : [order];
    return route.fulfill({ json: orderBootstrap({ actor: { email: 'staff@example.test', role: 'administrator', roles: ['administrator'] }, snapshot: { company: 'T', fetchedAt: now, catalog: [] }, customers: [], operations: {}, orders, pagination: { total: orders.length, page: 1, pageCount: 1, pageSize: 20 } }) });
  });
  await page.route('**/api/pricing?**', route => route.fulfill({ json: pricingWorkspace({ orderId, orderNumber: 'SF-26-1001' }) }));
  await page.route('**/api/today**', route => fail() ? route.fulfill({ status: 503, json: { error: 'Unavailable' } }) : route.fulfill({ json: today() }));
}

async function mockWallet(page: Page) {
  const coverage = { certified: true, windowFrom: '2026-07-01', windowTo: '2026-09-30', windowLabel: 'Jul–Sep 2026', reason: null };
  const policy = { version: 1, walletShareTargetBps: 8000, focusBandBps: 8000, staleAfterMonths: 6, note: 'Policy', enteredBy: 'staff@example.test', enteredAt: now };
  const row = { customerId, name: 'Target lab outside the first page', city: 'Pune', walletPaise: null, salesPaise: null, sharePermille: null, untappedPaise: null, captureGapPaise: null, confidence: null, asOf: null, verified: false, stale: false, belowSales: false, inFocusBand: null };
  await page.route('**/api/accounts**', route => route.fulfill({ json: { accounts: [], page: { page: 1, pageSize: 50, total: 0 }, owners: [], territories: [], canAssign: true, canEraseContacts: false, canSeePowerMap: false, actorEmail: 'staff@example.test', today: '2026-10-30', classPolicy: { aMinPaise: '20000000', bMinPaise: '7500000' } } }));
  await page.route('**/api/wallet?**', route => route.fulfill({ json: new URL(route.request().url()).searchParams.get('action') === 'get_wallet_account'
    ? { policy, coverage, row, current: null, history: [], divisions: [] }
    : { policy, coverage, view: 'all', page: 1, pageSize: 50, total: 0, rows: [], summary: { focusCount: 0, focusGapPaise: 0, estimatedAccounts: 0, accountsWithSales: 0, unlinkedSalesPaise: 0, unlinkedLedgers: 0 } } }));
  await page.route('**/api/wallet/diagnosis?**', route => route.fulfill({ json: [] }));
  await page.route('**/api/wallet/actions?**', route => route.fulfill({ json: new URL(route.request().url()).searchParams.get('action') === 'get_contract_windows'
    ? { rows: [], total: 0, plannedCount: 0, page: 1, pageSize: 20 }
    : { rows: [], total: 0, overdueCount: 0, page: 1, pageSize: 50 } }));
}

for (const width of [375, 1280]) {
  test.describe(`Today at ${width}px`, () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width, height: 800 }); });

    test('administrator lands on Today with two lanes, approximate and unknown values, and no overflow', async ({ page }) => {
      await mockFrame(page);
      await page.goto('/?view=frame&role=administrator&roles=administrator');
      await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
      const unblock = page.getByRole('region', { name: 'Unblock today' });
      const grow = page.getByRole('region', { name: 'Grow', exact: true });
      await expect(unblock.getByText('≈ ₹48k', { exact: true })).toBeVisible();
      await expect(unblock.getByText('₹ ?', { exact: true })).toBeVisible();
      await expect(grow.getByText('₹60k/mo gap', { exact: true })).toBeVisible();
      await expect(grow.getByText('₹25k/mo expected', { exact: true })).toBeVisible();
      await expect(grow.getByText('₹ ?', { exact: true })).toBeVisible();
      const a = await unblock.boundingBox(), b = await grow.boundingBox();
      expect(a).not.toBeNull(); expect(b).not.toBeNull();
      if (width < 1024) expect(b!.y).toBeGreaterThan(a!.y);
      else expect(b!.x).toBeGreaterThan(a!.x);
      for (const button of await unblock.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('article')].every(card => card.scrollWidth <= card.clientWidth))).toBe(true);
    });

    test('sales does not see Today', async ({ page }) => {
      await mockFrame(page);
      await page.goto('/?view=frame&role=sales&roles=sales');
      await expect(page.getByTitle('Suprabha stock dashboard')).toBeVisible();
      const more = page.getByRole('button', { name: 'More', exact: true });
      if (await more.isVisible()) await more.click();
      await expect(page.getByRole('button', { name: 'today', exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Today', exact: true })).toHaveCount(0);
    });

    test('an order button opens that exact order through the frame', async ({ page }) => {
      await mockFrame(page);
      await page.goto('/?view=frame&role=administrator&roles=administrator');
      await page.getByRole('region', { name: 'Unblock today' }).getByRole('button', { name: 'Approve', exact: true }).click();
      if (width < 1024) await expect(page.getByRole('dialog', { name: 'Order SF-26-1001' })).toBeVisible();
      else await expect(page.getByLabel('Selected order workspace')).toContainText('SF-26-1001');
      await expect(page.getByRole('button', { name: /^orders/i })).toHaveAttribute('aria-pressed', 'true');
    });

    test('empty lanes explain that there are no decisions', async ({ page }) => {
      await mockFrame(page, () => ({ ...fixture(), coverageCertified: undefined, unblock: { total: 0, rows: [] }, grow: { total: 0, rows: [] } }));
      await page.goto('/?view=frame&role=administrator&roles=administrator');
      await expect(page.getByText('Nothing to unblock', { exact: true })).toBeVisible();
      await expect(page.getByText('No growth decisions yet', { exact: true })).toBeVisible();
    });

    test('a lab button opens its Wallet sheet even outside the current page', async ({ page }) => {
      await mockFrame(page);
      await mockWallet(page);
      await page.goto('/?view=frame&role=administrator&roles=administrator');
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Wallet', exact: true })).toBeVisible();
      await expect(page.getByRole('dialog', { name: 'Target lab outside the first page' })).toBeVisible();
    });

    test('Grow Show all opens Wallet Actions due', async ({ page }) => {
      await mockFrame(page);
      await mockWallet(page);
      await page.goto('/?view=frame&role=administrator&roles=administrator');
      await page.getByRole('button', { name: 'Show all 3 growth decisions', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Actions due', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByText('No actions due.', { exact: true })).toBeVisible();
    });

    test('uncertified Grow explains the missing wallet and Tally coverage', async ({ page }) => {
      await mockFrame(page, () => ({ ...fixture(), coverageCertified: false, grow: { total: 0, rows: [] } }));
      await page.goto('/?view=frame&role=administrator&roles=administrator');
      await expect(page.getByText('Growth decisions need wallet estimates and certified Tally sales', { exact: true })).toBeVisible();
      await expect(page.getByText('No growth decisions yet', { exact: true })).toHaveCount(0);
    });

    test('a load failure shows one line and Retry recovers', async ({ page }) => {
      let failing = true;
      await mockFrame(page, fixture, () => failing);
      await page.goto('/?view=frame&role=administrator&roles=administrator');
      await expect(page.getByRole('alert')).toContainText('Today could not load');
      await expect(page.getByRole('region', { name: 'Unblock today' })).toHaveCount(0);
      failing = false;
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Unblock today' })).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
    });
  });
}
