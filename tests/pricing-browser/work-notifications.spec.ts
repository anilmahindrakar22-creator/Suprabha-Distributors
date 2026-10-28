import { expect, test, type Locator, type Page } from '@playwright/test';
import { orderBootstrap, orderLine, orderSummary } from '../fixtures/api-builders';
import type { OrderSummary } from '../../lib/order-types';

async function advanceToNextCheck(page: Page, bell: Locator, expectedName: string) {
  // After each fake-clock step, give in-flight requests a short real-time window to land before the clock moves
  // again; otherwise, on a busy machine, the app's 15 s request timeout (on the fake clock) aborts the check.
  for (let step = 0; step < 20; step += 1) {
    await page.clock.runFor(1_000);
    try {
      await expect(bell).toHaveAttribute('aria-label', expectedName, { timeout: 750 });
      return;
    } catch { /* not yet: advance another step */ }
  }
  throw new Error(`Work check did not reach "${expectedName}" after 20 one-second clock steps; last bell name: "${await bell.getAttribute('aria-label')}"`);
}

const now = () => new Date().toISOString();
const order = (id: string, number: string, customer: string, status: string) => orderSummary({
  id, orderNumber: number, customerName: customer, customerPhone: null, status, source: 'phone', notes: null, version: 1,
  createdAt: now(), updatedAt: now(), lineCount: 1, totalQuantity: 2, reservedQuantity: 0, tallyInvoiceNumber: null, pricingState: 'approved',
  lines: [orderLine({ tallyKey: 'G', itemName: 'Glucose', itemGroup: 'Diasys', quantity: 2, baseUnit: 'Nos', fulfilledQuantity: 2 })], events: [], exceptions: [], installations: [],
});
const waiting = order('11111111-1111-4111-8111-111111111111', 'SF-26-1001', 'Apollo Clinic Lab', 'awaiting_tally_billing');
const packedNow = order('22222222-2222-4222-8222-222222222222', 'SF-26-1043', 'Care Hospital', 'awaiting_tally_billing');

async function mockAccounts(page: Page, billing: () => OrderSummary[], role: 'accounts' | 'billing' = 'accounts') {
  await page.route('**/api/orders**', (route) => {
    const url = new URL(route.request().url());
    const list = (orders: OrderSummary[]) => orderBootstrap({ actor: { email: 'staff@example.test', role, roles: [role] }, snapshot: { company: 'T', fetchedAt: now(), catalog: [] }, customers: [], operations: {}, orders, pagination: { total: orders.length, page: 1, pageCount: 1, pageSize: 20 } });
    if (url.searchParams.get('summary') === '1') return route.fulfill({ json: { operations: { awaitingTallyBilling: billing().length } } });
    if (url.searchParams.get('status') === 'billing') return route.fulfill({ json: list(billing()) });
    if (url.searchParams.get('status') === 'packed') return route.fulfill({ json: list([]) });
    const query = url.searchParams.get('query') || '';
    if (query.startsWith('assignee:')) return route.fulfill({ json: list([]) });
    if (query) return route.fulfill({ json: list(billing().filter((item) => JSON.stringify(item).includes(query))) });
    return route.fulfill({ json: list(billing()) });
  });
}

test('billing-only staff see ready-to-bill arrivals and desktop pop-ups in the bell', async ({ page, isMobile }) => {
  let billing = [waiting];
  await page.clock.install();
  await mockAccounts(page, () => billing, 'billing');
  await page.goto('/?view=frame&role=billing');
  const bell = page.getByRole('button', { name: /^Notifications/ });
  await expect(bell).toBeVisible();
  await page.clock.runFor(5_000);
  await expect(bell).toHaveAccessibleName('Notifications, 1 waiting for you');

  billing = [waiting, packedNow];
  await advanceToNextCheck(page, bell, 'Notifications, 2 waiting for you, 1 new');
  await bell.click();
  const panel = page.getByRole('dialog', { name: 'Notifications' });
  const arrival = panel.getByRole('button', { name: /^New: Care Hospital, SF-26-1043/ });
  await expect(arrival).toBeVisible();
  await expect(arrival).toContainText('Packed and priced · ready to bill');
  await expect(panel.getByRole('button', { name: /^Ready to bill/ })).toContainText('2');
  if (!isMobile) await expect(panel.getByText('Desktop pop-ups', { exact: true })).toBeVisible();
});

test('Accounts hears at once when a packed order reaches Tally billing, and can open that exact order', async ({ page, isMobile }) => {
  let billing = [waiting];
  await page.clock.install();
  await mockAccounts(page, () => billing);
  await page.goto('/?view=frame&role=accounts');
  await page.clock.runFor(5_000);
  const bell = page.getByRole('button', { name: /^Notifications/ });
  await expect(bell).toHaveAccessibleName('Notifications, 1 waiting for you');

  billing = [waiting, packedNow];
  await advanceToNextCheck(page, bell, 'Notifications, 2 waiting for you, 1 new');
  const banner = page.locator('output').filter({ hasText: 'Packed · ready for Tally billing' });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Care Hospital · SF-26-1043');
  await expect(bell).toHaveAccessibleName('Notifications, 2 waiting for you, 1 new');
  await expect(page).toHaveTitle(/^\(1\) /);
  await expect(page.getByRole('button', { name: /^orders/i })).toContainText('2');

  await banner.getByRole('button', { name: 'Open' }).click();
  if (isMobile) await expect(page.getByRole('dialog', { name: 'Order SF-26-1043' })).toBeVisible();
  else await expect(page.getByLabel('Selected order workspace')).toContainText('SF-26-1043');
  await expect(page).not.toHaveTitle(/^\(\d/);
});

test('the bell lists your queue and new work; opening it clears the new count', async ({ page }) => {
  let billing = [waiting];
  await page.clock.install();
  await mockAccounts(page, () => billing);
  await page.goto('/?view=frame&role=accounts');
  await page.clock.runFor(5_000);
  // Let the first check finish before moving the clock on (its 15 s timeout runs on the same clock).
  await expect(page.getByRole('button', { name: /^Notifications/ })).toHaveAccessibleName('Notifications, 1 waiting for you');
  billing = [waiting, packedNow];
  const bell = page.getByRole('button', { name: /^Notifications/ });
  await advanceToNextCheck(page, bell, 'Notifications, 2 waiting for you, 1 new');
  await bell.click();
  const panel = page.getByRole('dialog', { name: 'Notifications' });
  await expect(panel.getByRole('button', { name: /^New: Care Hospital, SF-26-1043/ })).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Tally billing/ })).toContainText('2');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(bell).toBeFocused();
  await expect(bell).toHaveAccessibleName('Notifications, 2 waiting for you');
});

test('an order the person cannot see fails closed', async ({ page }) => {
  let billing = [waiting];
  await page.clock.install();
  await mockAccounts(page, () => billing);
  await page.goto('/?view=frame&role=accounts');
  await page.clock.runFor(5_000);
  // Let the first check finish before moving the clock on (its 15 s timeout runs on the same clock).
  await expect(page.getByRole('button', { name: /^Notifications/ })).toHaveAccessibleName('Notifications, 1 waiting for you');
  billing = [waiting, packedNow];
  await advanceToNextCheck(page, page.getByRole('button', { name: /^Notifications/ }), 'Notifications, 2 waiting for you, 1 new');
  await page.getByRole('button', { name: /^Notifications/ }).click();
  // Simulate the order disappearing (access removed) between the check and the tap.
  await page.unroute('**/api/orders**');
  await mockAccounts(page, () => []);
  await page.getByRole('dialog', { name: 'Notifications' }).getByRole('button', { name: /^New: Care Hospital/ }).click();
  await expect(page.getByRole('alert')).toContainText('Order SF-26-1043 is not available to you');
});
