import { expect, test } from '@playwright/test';

const stockPayload = (sourceFetchedAtIso?: Record<string, unknown>) => ({
  company: 'Test company',
  fetchedAtIso: new Date().toISOString(),
  fetchedAt: '29 Sep 2026, 3:30 pm',
  fetchedAtShort: '29 Sep 2026, 3:30 pm',
  rows: [] as Array<{ group: string; item: string; closing: number; reorderLevel: number; minimumOrder: number; shortfall: number; orderToBePlaced: number; lastSuppliedParty?: string; lastSuppliedQty?: number | null; lastSuppliedDate?: string }>,
  groups: [] as string[],
  ...(sourceFetchedAtIso ? { sourceFetchedAtIso } : {}),
});

test.beforeEach(async ({ page }) => {
  await page.route('**/api/requirements?view=idle&page=*', (route) => route.fulfill({
    json: idlePayload(Number(new URL(route.request().url()).searchParams.get('page'))),
  }));
  await page.route('**/api/requirements?view=cover', (route) => route.fulfill({
    json: { view: 'cover', leadTimeDays: 7, salesThrough: null, runsOutCount: 0, items: [] },
  }));
  await page.route('**/api/requirements?view=to_order&page=1', (route) => route.fulfill({
    json: { view: 'to_order', total: 21, waitingCount: 6, unknownCount: 0, page: 1, pageSize: 25, items: [] },
  }));
});

const idlePayload = (page: number) => ({
  view: 'idle', asOf: '2026-11-18', windowDays: 180, historyFrom: '2025-01-01', salesThrough: '2026-11-18',
  idleCount: 51, inStockCount: 900, page, pageSize: 50,
  items: Array.from({ length: page === 1 ? 50 : 1 }, (_, index) => ({
    itemKey: `Idle Item ${String((page - 1) * 50 + index + 1).padStart(2, '0')}`,
    group: index === 0 ? 'Other group' : index === 1 ? null : 'Test group', closing: 3.125, baseUnit: 'Nos',
    lastSoldOn: index === 0 ? null : '2026-05-02',
  })),
});

test('idle stock is paginated, searchable and returns to groups on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openStockDashboard(page, { ...coverStockPayload(), groups: ['Test group', 'Other group'] });
  const chip = page.locator('[data-action="idle"]');
  await expect(chip.locator('strong')).toHaveText('51 not selling');
  await expect(chip.locator('small')).toHaveText('no sale in 6 months');
  await expect(chip).toHaveAttribute('aria-label', 'Show items with no sale in 6 months');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Not sold in 6 months', exact: true })).toBeVisible();
  await expect(page.locator('#groupCards')).toBeHidden();
  await expect(page.locator('.idle-row')).toHaveCount(50);
  await expect(page.locator('.idle-row').first().locator('.idle-meta')).toHaveText('Other group · No sale since 1 Jan 2025');
  await expect(page.locator('.idle-row').nth(1).locator('.idle-meta')).toHaveText('Last sold 2 May 2026');
  await expect(page.locator('#idleView .panel-head')).toContainText('no sale since 22 May 2026');
  await page.getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(page.locator('.idle-row')).toHaveCount(51);
  await expect(page.getByRole('button', { name: 'Show more', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#search').fill('idle ITEM 51');
  await expect(page.locator('.idle-row')).toHaveCount(1);
  await expect(page.locator('.idle-row')).toContainText('Idle Item 51');
  await page.locator('#search').fill('');
  await page.locator('#group').selectOption('Other group');
  await expect(page.locator('.idle-row')).toHaveCount(2);
  await page.locator('#group').selectOption('All Groups');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#idleView')).toBeHidden();
  await expect(page.locator('#groupCards')).toBeVisible();
  await expect(page.locator('#groupCards details')).toHaveCount(2);
});

test('idle and reorder chip selections clear each other', async ({ page }) => {
  await openStockDashboard(page, coverStockPayload());
  const reorder = page.locator('[data-action="items"]'), idle = page.locator('[data-action="idle"]');
  await expect(idle).toBeVisible();
  await reorder.click();
  await expect(reorder).toHaveAttribute('aria-pressed', 'true');
  await idle.click();
  await expect(reorder).toHaveAttribute('aria-pressed', 'false');
  await expect(idle).toHaveAttribute('aria-pressed', 'true');
  await reorder.click();
  await expect(idle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#groupCards')).toBeVisible();
});

test('idle failure hides its chip and leaves Stock groups available', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/requirements?view=idle&page=*', (route) => route.fulfill({ status: 500, json: {} }));
  await openStockDashboard(page, coverStockPayload());
  await expect(page.locator('#refresh')).toBeEnabled();
  await expect(page.locator('[data-action="idle"]')).toBeHidden();
  await expect(page.locator('#groupCards')).toBeVisible();
  await expect(page.locator('#groupCards summary')).toContainText('Test group');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

const coverStockPayload = () => ({
  ...stockPayload(), groups: ['Test group'], rows: [
    { group: 'Test group', item: 'Test reagent B', closing: 30, reorderLevel: 50, minimumOrder: 1, shortfall: 20, orderToBePlaced: 20 },
    { group: 'Test group', item: 'Test reagent C', closing: 5, reorderLevel: 10, minimumOrder: 1, shortfall: 5, orderToBePlaced: 5 },
    { group: 'Test group', item: 'Test reagent A', closing: 2, reorderLevel: 3, minimumOrder: 1, shortfall: 1, orderToBePlaced: 1 },
  ],
});

test('stock cover puts items that run out first and explains the delivery comparison on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/requirements?view=cover', (route) => route.fulfill({ json: {
    view: 'cover', leadTimeDays: 7, salesThrough: '2026-11-18', runsOutCount: 1,
    items: [
      { itemKey: 'Test reagent A', daysLeft: 5, state: 'runs_out' },
      { itemKey: 'Test reagent B', daysLeft: 300, state: 'covered' },
      { itemKey: 'Test reagent C', daysLeft: null, state: 'no_recent_use' },
    ],
  } }));
  await openStockDashboard(page, coverStockPayload());
  await page.locator('#groupCards summary').click();
  await expect(page.locator('.gi-cover[data-cover="runs_out"]')).toHaveText('Runs out in 5 days · 7-day delivery');
  await expect(page.locator('.group-item[data-cover="runs_out"] .gi-order')).toHaveCSS('background-color', 'rgb(253, 236, 234)');
  await expect(page.locator('.gi-cover[data-cover="covered"]')).toHaveText('300 days left');
  await expect(page.locator('.gi-cover[data-cover="no_recent_use"]')).toHaveText('No sales in 90 days');
  await expect(page.locator('.group-item').first().locator('.gi-name')).toHaveText('Test reagent A');
  await expect(page.locator('#itemHint')).toContainText('1 run out before delivery');
  await expect(page.locator('#coverCaption')).toContainText('Delivery lead time: 7 days');
  await expect(page.locator('#coverCaption')).toContainText('Sales up to 18 Nov.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('cover failure leaves reorder rows visible in their original order without cover lines', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/requirements?view=cover', (route) => route.fulfill({ status: 500, json: {} }));
  await openStockDashboard(page, coverStockPayload());
  await expect(page.locator('#refresh')).toBeEnabled();
  await page.locator('#groupCards summary').click();
  await expect(page.locator('.group-item')).toHaveCount(3);
  await expect(page.locator('.group-item').first().locator('.gi-name')).toHaveText('Test reagent B');
  await expect(page.locator('.gi-cover')).toHaveCount(0);
  await expect(page.locator('#coverCaption')).toBeHidden();
  await expect(page.locator('#itemHint')).not.toContainText('run out before delivery');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

async function openStockDashboard(page: import('@playwright/test').Page, payload: ReturnType<typeof stockPayload>) {
  await page.route('**/api/stock?view=dashboard', (route) => route.fulfill({ json: payload }));
  await page.route('**/api/orders?summary=1', (route) => route.fulfill({ json: {} }));
  await page.goto('/stockflow.html');
  await expect(page.locator('details dl')).toContainText('Stock');
}

test('phone Stock shows unified Requests counts with Groups as the only view and no page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const payload = stockPayload();
  await openStockDashboard(page, payload);

  const reorderRows = payload.rows.filter((row) => (+row.orderToBePlaced || 0) > 0);
  const n = reorderRows.length;
  const c = reorderRows.filter((row) => {
    const base = Math.max(+row.reorderLevel || 0, +row.minimumOrder || 0, 1);
    const ratio = (+row.shortfall || +row.orderToBePlaced || 0) / base;
    return ratio >= 0.75;
  }).length;
  await expect(page.locator('.metric-chips [data-action="items"] strong')).toHaveText(`${n} to reorder`);
  await expect(page.locator('#itemHint')).toHaveText(`${c} critical`);
  await expect(page.locator('.metric-chips [data-action="critical"]')).toContainText('6 customers waiting');
  await expect(page.locator('.metric-chips [data-action="critical"]')).toHaveClass(/has-critical/);
  await expect(page.getByRole('button', { name: 'Reorder list', exact: true })).toHaveCount(0);
  await expect(page.getByText('Order to be placed', { exact: true })).toHaveCount(0);
  await expect(page.locator('.tab')).toHaveCount(0);
  await expect(page.locator('#operationsView')).toHaveCount(0);
  await expect(page.locator('#insightsView')).toHaveCount(0);
  await expect(page.locator('#groupsView')).toHaveClass(/active/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('customers waiting chip opens Requests to order', async ({ page }) => {
  const messages: unknown[] = [];
  await page.exposeFunction('captureStockMessage', (message: unknown) => messages.push(message));
  await page.addInitScript(() => {
    if (window.parent !== window) return;
    window.addEventListener('message', (event) => {
      if (event.origin === location.origin && event.data?.type === 'stockflow-open-requests') {
        void (window as unknown as { captureStockMessage: (message: unknown) => Promise<void> }).captureStockMessage(event.data);
      }
    });
  });
  await page.route('**/requests-link-test', (route) => route.fulfill({ contentType: 'text/html', body: '<iframe src="/stockflow.html"></iframe>' }));
  await page.route('**/api/stock?view=dashboard', (route) => route.fulfill({ json: stockPayload() }));
  await page.route('**/api/orders?summary=1', (route) => route.fulfill({ json: {} }));
  await page.goto('/requests-link-test');
  const stock = page.frameLocator('iframe');
  await stock.locator('.metric-chips [data-action="critical"]').click();
  await expect.poll(() => messages).toEqual([
    { type: 'stockflow-open-requests', section: 'to-order' },
  ]);
});

test('to reorder chip expands the reorder list on Stock', async ({ page }) => {
  await page.route('**/requests-link-test', (route) => route.fulfill({ contentType: 'text/html', body: '<iframe src="/stockflow.html"></iframe>' }));
  await page.route('**/api/stock?view=dashboard', (route) => route.fulfill({ json: {
    ...stockPayload(), groups: ['Group A', 'Group B'], rows: [
      { group: 'Group A', item: 'Item A', closing: 0, reorderLevel: 2, minimumOrder: 1, shortfall: 2, orderToBePlaced: 2 },
      { group: 'Group B', item: 'Item B', closing: 0, reorderLevel: 2, minimumOrder: 1, shortfall: 2, orderToBePlaced: 2 },
    ],
  } }));
  await page.route('**/api/orders?summary=1', (route) => route.fulfill({ json: {} }));
  await page.goto('/requests-link-test');
  const stock = page.frameLocator('iframe');
  const chip = stock.locator('.metric-chips [data-action="items"]');
  await expect(chip.locator('strong')).toHaveText('2 to reorder');
  await expect(stock.locator('#itemHint')).toHaveText('2 critical');
  await chip.click();
  await expect(page).toHaveURL(/requests-link-test/);
  await expect(stock.locator('#groupCards details')).toHaveCount(2);
  for (const group of await stock.locator('#groupCards details').all()) await expect(group).toHaveAttribute('open', '');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await chip.click();
  for (const group of await stock.locator('#groupCards details').all()) await expect(group).not.toHaveAttribute('open', '');
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
});

test("requirements failure leaves the customers waiting count unknown and Stock's reorder count intact", async ({ page }) => {
  await page.route('**/api/requirements?view=to_order&page=1', (route) => route.fulfill({ status: 503, json: {} }));
  const payload = stockPayload();
  await openStockDashboard(page, payload);
  const reorderRows = payload.rows.filter((row) => (+row.orderToBePlaced || 0) > 0);
  await expect(page.locator('#itemCount')).toHaveText(String(reorderRows.length));
  await expect(page.locator('#criticalCount')).toHaveText('—');
  await expect(page.locator('.metric-chips button')).toHaveCount(3);
  for (const chip of await page.locator('.metric-chips button').all()) await expect(chip).toBeEnabled();
});

test('source update times stay collapsed and safely display per-source timestamps', async ({ page }) => {
  await openStockDashboard(page, stockPayload({
    stock: '2026-09-29T10:00:00Z',
    catalog: '2026-09-28T08:30:00Z',
    customers: '<img src=x onerror=alert(1)>',
    sales: '2026-09-29T11:00:00Z',
    purchase: '2026-09-29T06:00:00Z',
  }));

  const details = page.getByText('Source update times').locator('..');
  await expect(details).not.toHaveAttribute('open', '');
  await details.locator('summary').click();
  await expect(details).toContainText('Stock');
  await expect(details).toContainText('Catalog');
  await expect(details).toContainText('Customers');
  await expect(details).toContainText('Sales');
  await expect(details).toContainText('Purchases');
  await expect(details).toContainText('Not available');
  await expect(details.getByText('Not available')).toHaveCount(1);
  await expect(details.locator('img')).toHaveCount(0);
});

test('older stock payloads without source timestamps remain supported', async ({ page }) => {
  await openStockDashboard(page, stockPayload());

  const details = page.getByText('Source update times').locator('..');
  await details.locator('summary').click();
  await expect(details.getByText('Not available')).toHaveCount(5);
});

test('fresh extraction clears the previous overdue warning and later stale data restores it', async ({ page }) => {
  let stale = true;
  await page.route('**/api/stock?view=dashboard', (route) => route.fulfill({ json: {
    ...stockPayload(),
    fetchedAtIso: new Date(Date.now() - (stale ? 30 * 60 * 1000 : 0)).toISOString(),
  } }));
  await page.route('**/api/orders?summary=1', (route) => route.fulfill({ json: {} }));
  await page.goto('/stockflow.html');
  await expect(page.locator('#liveText')).toHaveText('Tally sync overdue');
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#error')).toContainText('Tally stock extraction is overdue');

  stale = false;
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.locator('#liveText')).toHaveText('Cloud snapshot current');
  await expect(page.locator('#error')).toHaveText('');
  await expect(page.locator('#error')).toBeHidden();

  stale = true;
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.locator('#liveText')).toHaveText('Tally sync overdue');
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#error')).toContainText('Tally stock extraction is overdue');
});

test('hidden stock tabs stop polling and refresh when visible again', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(document, 'hidden', { configurable: true, value: true }));
  await page.clock.install();
  let stockRequests = 0;
  await page.route('**/api/stock?view=dashboard', (route) => {
    stockRequests++;
    return route.fulfill({ json: stockPayload() });
  });
  await page.route('**/api/orders?summary=1', (route) => route.fulfill({ json: {} }));
  await page.goto('/stockflow.html');
  await expect.poll(() => stockRequests).toBe(1);
  await page.clock.fastForward(5 * 60 * 1000);
  expect(stockRequests).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => stockRequests).toBe(2);
});

test('a stalled Stock response body times out and a later refresh recovers', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    let stall = true;
    window.fetch = (input, init) => {
      if (stall && (input instanceof Request ? input.url : String(input)).includes('/api/stock?view=dashboard')) {
        stall = false;
        const body = new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
          },
        });
        return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'application/json' } }));
      }
      return nativeFetch(input, init);
    };
  });
  await page.route('**/api/stock?view=dashboard', (route) => route.fulfill({ json: stockPayload() }));
  await page.route('**/api/orders?summary=1', (route) => route.fulfill({ json: {} }));
  await page.goto('/stockflow.html');
  await page.clock.fastForward(20_001);
  await expect(page.locator('#refresh')).toBeEnabled();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.locator('#company')).toHaveText('Test company');
});

test('Stock makes no order request and shows tappable groups', async ({ page }) => {
  const orderRequests: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/api/orders')) orderRequests.push(request.url()); });
  await page.route('**/api/stock?view=dashboard', (route) => route.fulfill({ json: { ...stockPayload(), groups: ['Generic group'], rows: [{ group: 'Generic group', item: 'Generic reagent', closing: 1, reorderLevel: 5, minimumOrder: 1, shortfall: 4, orderToBePlaced: 4 }] } }));
  await page.goto('/stockflow.html');
  await expect(page.locator('#company')).toHaveText('Test company');
  await expect(page.locator('#groupCards summary')).toContainText('Generic group');
  const firstGroup = page.locator('#groupCards details.group-row').first();
  await expect(firstGroup).toBeVisible();
  await firstGroup.locator('summary').click();
  await expect(firstGroup.locator('.group-item').first()).toBeVisible();
  await expect(firstGroup.locator('.gi-order').first()).toBeVisible();
  await expect(firstGroup.locator('.gi-order').first()).toHaveText(/^Order \d/);
  await expect(firstGroup.locator('.group-meta .gi-order-total')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.locator('#refresh')).toBeEnabled();
  expect(orderRequests).toEqual([]);
});

test('offline Stock cache is not shared between signed-in accounts', async ({ page }) => {
  await page.addInitScript(() => {
    if (window.parent !== window) return;
    const body = { company: 'FIRST ACCOUNT CACHE', fetchedAtIso: '2026-09-29T12:00:00Z', fetchedAt: '29 Sep 2026', groups: [], rows: [] };
    const saved = JSON.stringify({ savedAt: '2026-09-29T12:00:00Z', body });
    localStorage.setItem('stockflow-last-snapshot-v2', saved);
    localStorage.setItem('stockflow-last-snapshot-v3:first%40example.com', saved);
  });
  await page.route('**/cache-test', (route) => route.fulfill({ contentType: 'text/html', body: '<iframe src="/stockflow.html"></iframe>' }));
  await page.route('**/api/stock?view=dashboard', (route) => route.fulfill({ status: 503, json: { error: 'Offline' } }));
  await page.route('**/api/orders?summary=1', (route) => route.fulfill({ status: 503, json: { error: 'Offline' } }));
  await page.goto('/cache-test');
  const stock = page.frameLocator('iframe');
  await expect(stock.locator('#company')).toBeAttached();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('stockflow-last-snapshot-v2'))).toBeNull();
  await page.evaluate(() => document.querySelector('iframe')?.contentWindow?.postMessage({ type: 'stockflow-cache-account', email: 'second@example.com' }, location.origin));
  await expect(stock.locator('#company')).not.toHaveText('FIRST ACCOUNT CACHE');
  await page.evaluate(() => document.querySelector('iframe')?.contentWindow?.postMessage({ type: 'stockflow-cache-account', email: 'first@example.com' }, location.origin));
  await expect(stock.locator('#company')).toHaveText('FIRST ACCOUNT CACHE');
});

test('Stock shows no history chart, clears legacy shared history and keeps other accounts untouched', async ({ page }) => {
  const older = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await page.addInitScript((stamp) => {
    localStorage.setItem('stockflow-history-daily-v1', JSON.stringify([{ stamp, label: 'Legacy daily history', count: 90, qty: 900 }]));
    localStorage.setItem('stockflow-history-v2', JSON.stringify([{ stamp, label: 'Legacy migrated history', count: 91, qty: 901 }]));
    localStorage.setItem('stockflow-history-daily-v2:first%40example.com', JSON.stringify([{ stamp, label: 'First account history', count: 11, qty: 111 }]));
    localStorage.setItem('stockflow-history-daily-v2:second%40example.com', JSON.stringify([{ stamp, label: 'Second account history', count: 22, qty: 222 }]));
  }, older);
  await page.route('**/cache-test', (route) => route.fulfill({ contentType: 'text/html', body: '<iframe src="/stockflow.html"></iframe>' }));
  await page.route('**/api/stock?view=dashboard', (route) => route.fulfill({ json: stockPayload() }));
  await page.route('**/api/orders?summary=1', (route) => route.fulfill({ json: {} }));
  await page.goto('/cache-test');
  const stock = page.frameLocator('iframe');
  await expect(stock.locator('#company')).toHaveText('Test company');
  await expect(stock.locator('#history .history-col')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => [localStorage.getItem('stockflow-history-daily-v1'), localStorage.getItem('stockflow-history-v2')])).toEqual([null, null]);

  await page.evaluate(() => document.querySelector('iframe')?.contentWindow?.postMessage({ type: 'stockflow-cache-account', email: 'first@example.com' }, location.origin));

  await page.evaluate(() => document.querySelector('iframe')?.contentWindow?.postMessage({ type: 'stockflow-cache-account', email: 'second@example.com' }, location.origin));

  await page.evaluate(() => document.querySelector('iframe')?.contentWindow?.postMessage({ type: 'stockflow-cache-account', email: 'first@example.com' }, location.origin));
  await expect(stock.locator('#history')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('stockflow-history-daily-v2:second%40example.com'))).toContain('Second account history');
});

test('a trusted account handoff before the live Stock response saves history in that account scope', async ({ page }) => {
  const older = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await page.addInitScript((stamp) => {
    localStorage.setItem('stockflow-history-daily-v2:early%40example.com', JSON.stringify([{ stamp, label: 'Early account history', count: 33, qty: 333 }]));
  }, older);
  let releaseStock!: () => void;
  const stockGate = new Promise<void>((resolve) => { releaseStock = resolve; });
  let stockRequested = false;
  await page.route('**/cache-test', (route) => route.fulfill({ contentType: 'text/html', body: '<iframe src="/stockflow.html"></iframe>' }));
  await page.route('**/api/stock?view=dashboard', async (route) => {
    stockRequested = true;
    await stockGate;
    await route.fulfill({ json: stockPayload() });
  });
  await page.route('**/api/orders?summary=1', (route) => route.fulfill({ json: {} }));
  await page.goto('/cache-test');
  const stock = page.frameLocator('iframe');
  await expect.poll(() => stockRequested).toBe(true);
  await expect(stock.locator('#history .history-col')).toHaveCount(0);
  await page.evaluate(() => document.querySelector('iframe')?.contentWindow?.postMessage({ type: 'stockflow-cache-account', email: 'early@example.com' }, location.origin));
  releaseStock();
  await expect(stock.locator('#company')).toHaveText('Test company');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('stockflow-history-daily-v2:early%40example.com'))).not.toBeNull();
});
