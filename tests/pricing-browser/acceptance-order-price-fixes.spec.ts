import { expect, test, type Page } from '@playwright/test';
import { orderBootstrap, orderLine, orderSummary, pricingLine, pricingWorkspace } from '../fixtures/api-builders';

const orderId = '62000000-0000-4000-8000-000000000001';
const lineId = '62000000-0000-4000-8000-000000000002';
const orderNumber = 'SF-ACCEPT-001';
const otherNumber = 'SF-ACCEPT-002';
type Command = { action: string; payload: Record<string, unknown> };

function detail(page: Page, isMobile: boolean, number = orderNumber) {
  return isMobile
    ? page.getByRole('dialog', { name: `Order ${number}`, exact: true })
    : page.locator('[aria-label="Selected order workspace"]');
}

async function expectExactDetail(page: Page, isMobile: boolean, number = orderNumber) {
  const panel = detail(page, isMobile, number);
  await expect(panel).toBeVisible();
  await expect(panel.getByText(number, { exact: true })).toBeVisible();
  await expect(panel.getByRole('region', { name: 'Order next step', exact: true })).toBeVisible();
}

async function mockReview(page: Page, scenario: 'loaded' | 'filtered' | 'inaccessible') {
  const commands: Command[] = [];
  const listReads: URL[] = [];
  let order = orderSummary({
    id: orderId, orderNumber, status: 'awaiting_confirmation', pricingState: 'approved',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const other = orderSummary({
    id: '62000000-0000-4000-8000-000000000003', orderNumber: otherNumber,
    customerName: 'Another laboratory', status: 'awaiting_confirmation', pricingState: 'approved',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  await page.route('**/api/orders**', route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST') {
      const command = route.request().postDataJSON() as Command;
      commands.push(command);
      if (command.action === 'transition_order') {
        order = { ...order, status: String(command.payload.toStatus), version: order.version + 1 };
      }
      return route.fulfill({ json: { orderId, status: order.status, version: order.version } });
    }
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    listReads.push(url);
    const status = url.searchParams.get('status') || 'open';
    const query = url.searchParams.get('query') || '';
    const accessible = scenario !== 'inaccessible' || commands.length === 0;
    const orders = [...(accessible ? [order] : []), ...(scenario === 'loaded' ? [other] : [])]
      .filter(candidate => status === 'open' || status === 'all' || candidate.status === status)
      .filter(candidate => !query || candidate.orderNumber.includes(query));
    return route.fulfill({ json: orderBootstrap({
      orders, pagination: { total: orders.length, page: 1, pageCount: 1, pageSize: 20 },
    }) });
  });
  await page.route('**/api/pricing**', route => route.fulfill({ json: pricingWorkspace({
    orderId, orderNumber, orderVersion: order.version, pricingState: 'approved', lines: [],
  }) }));
  return { commands, listReads };
}

async function completeOrderStep(page: Page, isMobile: boolean, scenario: 'loaded' | 'filtered' | 'inaccessible') {
  const mock = await mockReview(page, scenario);
  await page.goto('/?view=orders-workspace');
  await expect(page.getByRole('button', { name: new RegExp(`^${orderNumber},`) })).toBeVisible();
  if (scenario !== 'loaded') {
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await page.getByLabel('Show orders', { exact: true }).selectOption('awaiting_confirmation');
    await expect.poll(() => mock.listReads.some(url => url.searchParams.get('status') === 'awaiting_confirmation')).toBe(true);
    await expect(page.getByRole('button', { name: new RegExp(`^${orderNumber},`) })).toBeVisible();
  }
  await page.getByRole('button', { name: new RegExp(`^${orderNumber},`) }).click();
  await detail(page, isMobile).getByRole('region', { name: 'Order next step', exact: true })
    .getByRole('button', { name: 'Confirm order', exact: true }).click();
  await expect.poll(() => mock.commands.length).toBe(1);
  expect(mock.commands[0]).toMatchObject({ action: 'transition_order', payload: { orderId, toStatus: 'confirmed' } });
  if (isMobile) await page.getByRole('button', { name: 'Back to orders', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review order', exact: true })).toBeVisible();
  return mock;
}

test('Review order opens the exact acknowledged order already in the list', async ({ page, isMobile }) => {
  const { listReads } = await completeOrderStep(page, isMobile, 'loaded');
  if (!isMobile) {
    await page.getByRole('button', { name: new RegExp(`^${otherNumber},`) }).click();
    await expectExactDetail(page, isMobile, otherNumber);
  } else {
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Review order', exact: true }).click();
  await expectExactDetail(page, isMobile);
  expect(listReads.filter(url => url.searchParams.get('query') === orderNumber)).toHaveLength(0);
});

test('Review order finds and opens an order hidden by the current status filter', async ({ page, isMobile }) => {
  const { listReads } = await completeOrderStep(page, isMobile, 'filtered');
  await expect(page.getByRole('button', { name: new RegExp(`^${orderNumber},`) })).toHaveCount(0);
  await page.getByRole('button', { name: 'Review order', exact: true }).click();
  await expectExactDetail(page, isMobile);
  const read = listReads.find(url => url.searchParams.get('query') === orderNumber);
  expect(read).toBeDefined();
  expect(read!.searchParams.get('status')).toBe('all');
  expect(read!.searchParams.get('page')).toBe('1');
  expect(read!.searchParams.has('date')).toBe(false);
  expect(read!.searchParams.has('dateTo')).toBe(false);
  await expect(page.getByText(/is not available to you/)).toHaveCount(0);
});

test('Review order reports an inaccessible order without opening a detail', async ({ page, isMobile }) => {
  const { listReads } = await completeOrderStep(page, isMobile, 'inaccessible');
  await expect(page.getByRole('button', { name: new RegExp(`^${orderNumber},`) })).toHaveCount(0);
  await page.getByRole('button', { name: 'Review order', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(`Order ${orderNumber} is not available to you`);
  expect(listReads.some(url => url.searchParams.get('query') === orderNumber && url.searchParams.get('status') === 'all')).toBe(true);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[aria-label="Selected order workspace"]')).toHaveCount(0);
});

async function openEnterPrice(page: Page, isMobile: boolean, guidance = false) {
  const posts: Command[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/pricing') {
      posts.push(request.postDataJSON() as Command);
    }
  });
  const order = orderSummary({
    id: orderId, orderNumber, status: 'packed', pricingState: 'review_required',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    lines: [orderLine({ fulfilledQuantity: 1 })],
  });
  await page.route('**/api/orders**', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    const orders = url.searchParams.get('status') === 'history' ? [] : [order];
    return route.fulfill({ json: orderBootstrap({
      actor: { email: 'accounts@example.test', role: 'accounts', roles: ['accounts'] },
      orders, pagination: { total: orders.length, page: 1, pageCount: 1, pageSize: 20 },
    }) });
  });
  await page.route('**/api/pricing**', route => {
    if (route.request().method() === 'POST') return route.fulfill({ json: { pricingState: 'approval_required' } });
    return route.fulfill({ json: pricingWorkspace({
      orderId, orderNumber,
      lines: [pricingLine({
        lineId, targetMarginPrice: guidance ? 250 : null, currentCost: guidance ? 200 : null,
        cost: guidance ? {
          id: 'cost-1', amount: 200, kind: 'purchase', effectiveAt: '2026-10-01T20:00:00Z',
          sourceReference: 'PUR-ACCEPT-001', sourceVersion: 'cost-v1',
          previousAmount: null, changeAmount: null, changePercent: null,
        } : null,
      })],
    }) });
  });
  await page.goto('/?view=orders-workspace');
  await page.getByRole('button', { name: new RegExp(`^${orderNumber},`) }).click();
  const bar = detail(page, isMobile).getByRole('region', { name: 'Order next step', exact: true });
  await bar.getByRole('button', { name: 'Enter price', exact: true }).click();
  return { posts, bar, sheet: bar.getByRole('region', { name: 'Enter price', exact: true }) };
}

test('Enter price focuses the custom rate and keeps the rate and submit action in the viewport', async ({ page, isMobile }) => {
  const { sheet } = await openEnterPrice(page, isMobile);
  const rate = sheet.getByRole('spinbutton', { name: 'Custom selling rate', exact: true });
  // Do not scroll or focus in this test: opening the sheet must do both itself.
  await expect(rate).toBeFocused();
  await expect(rate).toBeInViewport();
  await expect(sheet.getByRole('button', { name: 'Submit for approval', exact: true })).toBeInViewport();
});

test('available cost guidance fills the rate only when chosen and does not submit pricing', async ({ page, isMobile }) => {
  const { sheet, bar, posts } = await openEnterPrice(page, isMobile, true);
  const rate = sheet.getByRole('spinbutton', { name: 'Custom selling rate', exact: true });
  await expect(rate).toHaveValue('');
  await expect(sheet.getByText('Cost as of 2 Oct 2026 · PUR-ACCEPT-001', { exact: true })).toBeVisible();
  const usePrice = sheet.getByRole('button', { name: /^Use ₹250(?:\.00)? · target margin$/ });
  await expect(usePrice).toBeVisible();
  await usePrice.click();
  await expect(rate).toHaveValue('250');
  await expect(sheet.getByLabel('Decision reason', { exact: true })).toHaveValue('Target-margin price from current cost');
  await expect(sheet.getByRole('button', { name: 'Submit for approval', exact: true })).toBeEnabled();
  await bar.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  expect(posts).toHaveLength(0);
});

test('missing cost and price history are explicit and leave the custom rate empty', async ({ page, isMobile }) => {
  const { sheet, posts } = await openEnterPrice(page, isMobile);
  await expect(sheet.getByText('No purchase cost on record for this item.', { exact: true })).toBeVisible();
  await expect(sheet.getByText('No cost-based price: purchase cost or target margin is unavailable.', { exact: true })).toBeVisible();
  await expect(sheet.getByText('No earlier prices for this customer.', { exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: /target margin/ })).toHaveCount(0);
  await expect(sheet.getByRole('spinbutton', { name: 'Custom selling rate', exact: true })).toHaveValue('');
  await expect(sheet.getByLabel('Decision reason', { exact: true })).toHaveValue('');
  await expect(sheet.getByRole('button', { name: 'Submit for approval', exact: true })).toBeDisabled();
  expect(posts).toHaveLength(0);
});
