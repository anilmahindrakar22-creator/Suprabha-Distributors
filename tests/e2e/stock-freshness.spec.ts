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

async function openStockDashboard(page: import('@playwright/test').Page, payload: ReturnType<typeof stockPayload>) {
  await page.route('**/api/stock?view=dashboard', (route) => route.fulfill({ json: payload }));
  await page.route('**/api/orders?summary=1', (route) => route.fulfill({ json: {} }));
  await page.goto('/stockflow.html');
  await expect(page.locator('details dl')).toContainText('Stock');
}

test('phone stock overview shows the first reorder row without scrolling or page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const payload = stockPayload();
  payload.fetchedAtIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  payload.groups = ['Test group'];
  payload.rows = [{ group: 'Test group', item: 'First reorder item', closing: 0, reorderLevel: 10, minimumOrder: 1, shortfall: 10, orderToBePlaced: 10 }];
  await openStockDashboard(page, payload);

  const firstRow = page.locator('#rows tr').first();
  await expect(firstRow).toBeVisible();
  await expect(page.locator('#syncNotice')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear focus', exact: true })).toBeHidden();
  const bounds = await firstRow.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeLessThan(600);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByText('Total order qty', { exact: true })).toHaveCount(0);

  await page.locator('.metric-chips [data-action="items"]').click();
  await expect(page.getByRole('button', { name: 'Clear focus', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear focus', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Clear focus', exact: true })).toBeHidden();
});

test('phone reorder rows show the last sale without a dropdown', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const payload = stockPayload();
  payload.groups = ['Test group'];
  payload.rows = [{ group: 'Test group', item: 'Reorder item', closing: 0, reorderLevel: 10, minimumOrder: 1, shortfall: 10, orderToBePlaced: 10, lastSuppliedParty: 'Sysmex India Pvt Ltd', lastSuppliedQty: 4, lastSuppliedDate: '12 Oct 2026' }];
  await openStockDashboard(page, payload);

  const line = page.locator('#rows .supply-line');
  await expect(line).toBeVisible();
  await expect(line).toHaveText('Last sold: 12 Oct 2026 · 4 · Sysmex India Pvt Ltd');
  await expect(line.locator('strong')).toHaveText('Sysmex India Pvt Ltd');
  await expect(line).toHaveAttribute('title', 'Last sold: Sysmex India Pvt Ltd · 4 · 12 Oct 2026');
  await expect(line).toHaveAttribute('aria-label', 'Last sold to Sysmex India Pvt Ltd, quantity 4, on 12 Oct 2026');
  await expect(page.locator('details.supply-drop')).toHaveCount(0);
});

test('phone reorder rows without sale data show the history window', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const payload = stockPayload();
  payload.rows = [{ group: 'Test group', item: 'No sale item', closing: 0, reorderLevel: 10, minimumOrder: 1, shortfall: 10, orderToBePlaced: 10 }];
  await openStockDashboard(page, payload);

  await expect(page.locator('#rows .supply-line.muted')).toBeVisible();
  await expect(page.locator('#rows .supply-line.muted')).toContainText('No sale in');
});

test('a long last-sale party stays on one line without phone page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const payload = stockPayload();
  const party = 'S'.repeat(120);
  payload.rows = [{ group: 'Test group', item: 'Long party item', closing: 0, reorderLevel: 10, minimumOrder: 1, shortfall: 10, orderToBePlaced: 10, lastSuppliedParty: party, lastSuppliedQty: 4, lastSuppliedDate: '12 Oct 2026' }];
  await openStockDashboard(page, payload);

  const line = page.locator('#rows .supply-line');
  await expect(line).toBeVisible();
  await expect(line.locator('strong')).toHaveText(party);
  await expect(line).toHaveAttribute('title', `Last sold: ${party} · 4 · 12 Oct 2026`);
  await expect(line).toHaveText(`Last sold: 12 Oct 2026 · 4 · ${party}`);
  await expect(line.locator('.supply-date')).toBeVisible();
  await expect(line.locator('.supply-date')).toHaveText('12 Oct 2026');
  await expect(line.locator('.supply-qty')).toBeVisible();
  await expect(line.locator('.supply-qty')).toHaveText('4');
  expect(await line.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return ['.supply-date', '.supply-qty'].every((selector) => {
      const value = element.querySelector(selector)!;
      const rect = value.getBoundingClientRect();
      return rect.left >= bounds.left && rect.right <= bounds.right && value.scrollWidth <= value.clientWidth;
    });
  })).toBe(true);
  await expect(line).toHaveCSS('white-space', 'nowrap');
  await expect(line.locator('.supply-party')).toHaveCSS('text-overflow', 'ellipsis');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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

test('a stalled order summary body times out without discarding Stock and refresh can recover', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    let stall = true;
    window.fetch = (input, init) => {
      if (stall && (input instanceof Request ? input.url : String(input)).includes('/api/orders?summary=1')) {
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
  await expect(page.locator('#company')).toHaveText('Test company');
  await expect(page.locator('#refresh')).toBeEnabled();
  await expect(page.locator('#opsSource')).toHaveText('Orders unavailable');
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.locator('#opsSource')).toHaveText('Live Orders');
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

test('Stock history stays scoped to the trusted account and ignores legacy shared history', async ({ page }) => {
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
  await expect(stock.locator('#history')).toContainText('First account history');
  await expect(stock.locator('#history')).not.toContainText('Second account history');
  await expect(stock.locator('#history')).not.toContainText('Legacy');

  await page.evaluate(() => document.querySelector('iframe')?.contentWindow?.postMessage({ type: 'stockflow-cache-account', email: 'second@example.com' }, location.origin));
  await expect(stock.locator('#history')).toContainText('Second account history');
  await expect(stock.locator('#history')).not.toContainText('First account history');
  await expect(stock.locator('#history')).not.toContainText('Legacy');

  await page.evaluate(() => document.querySelector('iframe')?.contentWindow?.postMessage({ type: 'stockflow-cache-account', email: 'first@example.com' }, location.origin));
  await expect(stock.locator('#history')).toContainText('First account history');
  await expect(stock.locator('#history')).not.toContainText('Second account history');
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
  await expect(stock.locator('#history')).toContainText('Early account history');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('stockflow-history-daily-v2:early%40example.com'))).not.toBeNull();
});
