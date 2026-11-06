import { expect, test, type Page } from '@playwright/test';
import { orderBootstrap, orderLine, orderSummary, pricingWorkspace } from '../fixtures/api-builders';

const now = '2026-11-06T09:30:00Z'; // Friday 15:00 IST
const stale = '2026-11-06T06:30:00Z'; // Friday 12:00 IST
const paused = { state: 'paused', pendingSince: null };
const pausedMessage = 'Economics update is paused. Figures may be out of date.';
const orderId = '11111111-1111-4111-8111-111111111111';
type SummaryRead = { status?: number; body: unknown };

// Frame mocks from today.spec.ts, with the optional summary timestamp supplied here.
async function mockFrame(page: Page, role: 'administrator' | 'sales', summary: () => SummaryRead) {
  const order = orderSummary({ id: orderId, orderNumber: 'SF-26-1001', customerName: 'Apollo Clinic Lab', status: 'awaiting_tally_billing', source: 'phone', createdAt: now, updatedAt: now, pricingState: 'approved', lines: [orderLine({ tallyKey: 'GLU', itemName: 'Glucose', quantity: 2, fulfilledQuantity: 2 })] });
  await page.route('**/api/me', route => route.fulfill({ json: { roles: [role] } }));
  await page.route('**/api/push-subscription**', route => route.fulfill({ json: { enabled: false, publicKey: '' } }));
  await page.route('**/api/wallet?**', route => route.fulfill({ json: { coverage: { certified: true } } }));
  await page.route('**/api/my-actions?**', route => route.fulfill({ json: { page: 1, pageSize: 50, total: 0, overdueCount: 0, rows: [] } }));
  await page.route('**/api/orders**', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('summary') === '1') {
      const read = summary();
      return route.fulfill({ status: read.status ?? 200, json: read.body });
    }
    if (url.searchParams.has('eventsFor')) return route.fulfill({ json: { events: [] } });
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    const orders = (url.searchParams.get('query') || '').startsWith('assignee:') ? [] : [order];
    return route.fulfill({ json: orderBootstrap({ actor: { email: 'staff@example.test', role, roles: [role] }, snapshot: { company: 'T', fetchedAt: now, catalog: [] }, customers: [], operations: {}, orders, pagination: { total: orders.length, page: 1, pageCount: 1, pageSize: 20 } }) });
  });
  await page.route('**/api/pricing?**', route => route.fulfill({ json: pricingWorkspace({ orderId, orderNumber: 'SF-26-1001' }) }));
  await page.route('**/api/today**', route => route.fulfill({ json: {
    policyVersion: 'today-v1', generatedAt: now, coverageCertified: true,
    unblock: { total: 0, rows: [] }, grow: { total: 0, rows: [] },
  } }));
}

async function openFrame(page: Page, role: 'administrator' | 'sales' = 'administrator') {
  const read = page.waitForResponse(response => new URL(response.url()).searchParams.get('summary') === '1');
  await page.goto(`/?view=frame&role=${role}&roles=${role}`);
  await (await read).finished();
  await expect(page.getByRole('button', { name: 'stock', exact: true }).filter({ visible: true }).first()).toBeVisible();
  if (role === 'administrator') await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
}

const notice = (page: Page) => page.getByRole('status').filter({ hasText: /Tally data last reached StockFlow|Stock figures are from|Economics update is/ });

// Both configured browser projects run each explicit phone/desktop viewport.
for (const width of [375, 1280]) {
  test.describe(`Data freshness at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      await page.clock.setFixedTime(new Date(now));
    });

    test('administrator sees the connector action and the strip wraps without overflow', async ({ page }) => {
      await mockFrame(page, 'administrator', () => ({ body: { operations: {}, sourceUpdatedAt: stale } }));
      await openFrame(page);
      await expect(notice(page)).toHaveText('Tally data last reached StockFlow 3 hours ago. Check the office connector.');
      await expect(notice(page)).toHaveClass(/bg-sf-warning-soft/);
      await expect(notice(page).locator('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect(await notice(page).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    });

    test('sales sees stock age without a connector action', async ({ page }) => {
      await mockFrame(page, 'sales', () => ({ body: { operations: {}, sourceUpdatedAt: stale } }));
      await openFrame(page, 'sales');
      await expect(notice(page)).toHaveText('Stock figures are from 3 hours ago.');
      await expect(notice(page)).not.toContainText('connector');
    });

    test('administrator sees only the economics line when data is fresh and economics is paused', async ({ page }) => {
      await mockFrame(page, 'administrator', () => ({ body: { operations: {}, sourceUpdatedAt: now, economicsStatus: paused } }));
      await openFrame(page);
      await expect(notice(page)).toHaveText(pausedMessage);
      await expect(notice(page)).toHaveClass(/bg-sf-warning-soft/);
      await expect(notice(page).locator('svg')).toHaveCount(1);
    });

    test('sales sees no strip when data is fresh and economics is paused', async ({ page }) => {
      await mockFrame(page, 'sales', () => ({ body: { operations: {}, sourceUpdatedAt: now, economicsStatus: paused } }));
      await openFrame(page, 'sales');
      await expect(notice(page)).toHaveCount(0);
    });

    test('stale data and paused economics share one strip with separate lines and no overflow', async ({ page }) => {
      await mockFrame(page, 'administrator', () => ({ body: { operations: {}, sourceUpdatedAt: stale, economicsStatus: paused } }));
      await openFrame(page);
      await expect(notice(page)).toHaveCount(1);
      await expect(notice(page).locator('svg')).toHaveCount(1);
      const lines = notice(page).locator('span.block');
      await expect(lines).toHaveText(['Tally data last reached StockFlow 3 hours ago. Check the office connector.', pausedMessage]);
      const first = await lines.nth(0).boundingBox();
      const second = await lines.nth(1).boundingBox();
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect(await notice(page).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    });

    test('malformed economics status still accepts a stale timestamp', async ({ page }) => {
      await mockFrame(page, 'administrator', () => ({ body: { operations: {}, sourceUpdatedAt: stale, economicsStatus: { state: 'paused', pendingSince: 'junk' } } }));
      await openFrame(page);
      await expect(notice(page)).toHaveText('Tally data last reached StockFlow 3 hours ago. Check the office connector.');
    });

    test('failed, missing and malformed economics reads preserve the last good status', async ({ page }) => {
      let read: SummaryRead = { body: { operations: {}, sourceUpdatedAt: now, economicsStatus: paused } };
      await mockFrame(page, 'administrator', () => read);
      await openFrame(page);
      await expect(notice(page)).toHaveText(pausedMessage);
      let wakeMinute = 32;
      for (const next of [
        { status: 503, body: {} },
        { body: { operations: {}, sourceUpdatedAt: now } },
        { body: { operations: {}, sourceUpdatedAt: now, economicsStatus: { state: 'paused', pendingSince: 'junk' } } },
        { body: { operations: {}, sourceUpdatedAt: now, economicsStatus: null } },
      ]) {
        read = next;
        await page.clock.setFixedTime(new Date(`2026-11-06T09:${wakeMinute}:00Z`));
        const response = page.waitForResponse(result => new URL(result.url()).searchParams.get('summary') === '1');
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await (await response).finished();
        if ('economicsStatus' in next.body && next.body.economicsStatus === null) await expect(notice(page)).toHaveCount(0);
        else await expect(notice(page)).toHaveText(pausedMessage);
        wakeMinute += 2;
      }
    });

    for (const [name, read] of [
      ['fresh data', { body: { operations: {}, sourceUpdatedAt: '2026-11-06T09:20:00Z' } }],
      ['failed summary', { status: 503, body: { error: 'Unavailable' } }],
      ['missing field', { body: { operations: {} } }],
      ['malformed body', { body: { operations: {}, sourceUpdatedAt: 42 } }],
    ] as const) {
      test(`${name} leaves the frame visible without a strip`, async ({ page }) => {
        await mockFrame(page, 'administrator', () => read);
        await openFrame(page);
        await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
        await expect(notice(page)).toHaveCount(0);
      });
    }

    test('six days old uses the danger strip', async ({ page }) => {
      await mockFrame(page, 'administrator', () => ({ body: { operations: {}, sourceUpdatedAt: '2026-10-31T09:30:00Z' } }));
      await openFrame(page);
      await expect(notice(page)).toContainText('6 days ago');
      await expect(notice(page)).toHaveClass(/border-sf-danger-line/);
      await expect(notice(page)).toHaveClass(/bg-sf-danger-soft/);
      await expect(notice(page)).toHaveClass(/text-sf-danger/);
    });

    test('failed and malformed refreshes preserve the last good timestamp', async ({ page }) => {
      let read: SummaryRead = { body: { operations: {}, sourceUpdatedAt: stale } };
      await mockFrame(page, 'administrator', () => read);
      await openFrame(page);
      await expect(notice(page)).toContainText('3 hours ago');
      let wakeMinute = 30;
      for (const next of [{ status: 503, body: {} }, { body: { operations: {}, sourceUpdatedAt: 42 } }]) {
        read = next;
        await page.clock.setFixedTime(new Date(`2026-11-06T10:${wakeMinute}:00Z`));
        const response = page.waitForResponse(result => new URL(result.url()).searchParams.get('summary') === '1');
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await (await response).finished();
        await expect(notice(page)).toContainText('4 hours ago');
        wakeMinute += 2;
      }
    });
  });
}
