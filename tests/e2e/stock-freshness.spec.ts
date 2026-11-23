import { expect, test, type Page } from '@playwright/test';

const stockPayload = (sourceFetchedAtIso?: Record<string, unknown>) => ({
  company: 'Test company',
  fetchedAtIso: new Date().toISOString(),
  fetchedAt: '29 Sep 2026, 3:30 pm',
  fetchedAtShort: '29 Sep 2026, 3:30 pm',
  rows: [] as Array<{ group: string; item: string; closing: number; reorderLevel: number; minimumOrder: number; shortfall: number; orderToBePlaced: number; lastSuppliedParty?: string; lastSuppliedQty?: number | null; lastSuppliedDate?: string }>,
  groups: [] as string[],
  ...(sourceFetchedAtIso ? { sourceFetchedAtIso } : {}),
});

async function stockPoHarness(page: Page, canCreatePo?: boolean, longName = false) {
  const messages: unknown[] = [];
  const payload = coverStockPayload();
  payload.rows[0].orderToBePlaced = 4.2;
  if (longName) payload.rows[0].item = 'Very long reagent name that wraps across several lines on a small phone screen';
  await page.exposeFunction('captureStockPoMessage', (message: unknown) => messages.push(message));
  await page.addInitScript(() => {
    if (window.parent !== window) return;
    window.addEventListener('message', event => {
      if (event.origin === location.origin && event.data?.type === 'stockflow-create-po') {
        void (window as unknown as { captureStockPoMessage: (message: unknown) => Promise<void> }).captureStockPoMessage(event.data);
      }
    });
  });
  await page.route('**/stock-po-test', route => route.fulfill({ contentType: 'text/html', body:
    '<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0;display:block}</style><iframe src="/stockflow.html"></iframe>',
  }));
  await page.route('**/api/stock?view=dashboard', route => route.fulfill({ json: payload }));
  await page.route('**/api/orders?summary=1', route => route.fulfill({ json: {} }));
  await page.route('**/api/requirements?view=cover', route => route.fulfill({ json: {
    view: 'cover', leadTimeDays: 7, salesThrough: '2026-11-18', runsOutCount: 2,
    items: payload.rows.map((row, index) => ({ itemKey: row.item, state: index < 2 ? 'runs_out' : 'ok', daysLeft: index + 1 })),
  } }));
  await page.goto('/stock-po-test');
  const stock = page.frameLocator('iframe');
  await expect(stock.locator('#refresh')).toBeEnabled();
  await expect(stock.locator('#company')).toHaveText('Test company');
  await page.evaluate(allowed => document.querySelector('iframe')?.contentWindow?.postMessage({
    type: 'stockflow-cache-account', email: 'stock-po@example.test', ...(allowed === undefined ? {} : { canCreatePo: allowed }),
  }, location.origin), canCreatePo);
  if (canCreatePo) await expect(stock.locator('.gi-pick')).toHaveCount(3);
  await stock.locator('#groupCards summary').click();
  return { stock, payload, messages };
}

for (const allowed of [false, undefined]) {
  test(`Stock has no PO controls when access is ${String(allowed)}`, async ({ page }) => {
    const { stock } = await stockPoHarness(page, allowed);
    await expect(stock.locator('.gi-pick')).toHaveCount(0);
    await expect(stock.locator('#poBar')).toBeHidden();
    await expect(stock.locator('#pickRunsOut')).toHaveCount(0);
  });
}

test('Stock creates a draft from two ticks and clears the bar', async ({ page }) => {
  const { stock, payload, messages } = await stockPoHarness(page, true);
  for (const row of payload.rows.slice(0, 2)) await stock.getByRole('checkbox', { name: `Select ${row.item} for a purchase order`, exact: true }).check();
  await expect(stock.locator('#poCount')).toHaveText('2 selected');
  await stock.getByRole('button', { name: 'Create PO', exact: true }).click();
  await expect.poll(() => messages).toEqual([{ type: 'stockflow-create-po', items: payload.rows.slice(0, 2).map(row => ({ itemKey: row.item, quantity: Math.ceil(row.orderToBePlaced) })) }]);
  await expect(stock.locator('#poBar')).toBeHidden();
  await expect(stock.locator('input[data-pick]:checked')).toHaveCount(0);
});

test('Stock selects exactly the rows that run out before delivery', async ({ page }) => {
  const { stock, payload } = await stockPoHarness(page, true);
  await stock.getByRole('button', { name: 'Select all that run out before delivery', exact: true }).click();
  await expect(stock.locator('input[data-pick]:checked')).toHaveCount(2);
  for (const row of payload.rows.slice(0, 2)) await expect(stock.getByRole('checkbox', { name: `Select ${row.item} for a purchase order`, exact: true })).toBeChecked();
  await expect(stock.locator('#poCount')).toHaveText('2 selected');
});

test('Stock Clear empties the ticks and hides the bar', async ({ page }) => {
  const { stock } = await stockPoHarness(page, true);
  await stock.locator('input[data-pick]').first().check();
  await stock.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(stock.locator('input[data-pick]:checked')).toHaveCount(0);
  await expect(stock.locator('#poBar')).toBeHidden();
});

test('Stock PO controls fit a phone and the bar leaves the last row reachable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { stock, payload } = await stockPoHarness(page, true, true);
  expect(await stock.locator('body').evaluate(() => innerWidth)).toBeLessThanOrEqual(375);
  const row = stock.locator('.group-item').filter({ has: stock.getByRole('button', { name: payload.rows[0].item, exact: true }) });
  await row.locator('input').check();
  const name = await row.locator('.gi-name').boundingBox();
  const pill = await row.locator('.gi-order').boundingBox();
  const tick = await row.locator('.gi-pick input').boundingBox();
  expect(Math.abs(pill!.y - name!.y)).toBeLessThanOrEqual(4);
  expect(tick!.x + tick!.width).toBeLessThanOrEqual(name!.x);
  expect(pill!.x).toBeGreaterThan(name!.x);
  expect(name!.height).toBeGreaterThan(pill!.height);
  expect(Math.abs(tick!.y + tick!.height / 2 - (name!.y + 10))).toBeLessThanOrEqual(4);
  const last = stock.locator('.group-item').last();
  await last.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(last).toBeInViewport();
  const lastBox = await last.boundingBox(), barBox = await stock.locator('#poBar').boundingBox();
  expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(barBox!.y);
  expect(await stock.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test.beforeEach(async ({ page }) => {
  await page.route('**/api/requirements?view=on_po', (route) => route.fulfill({ json: { view: 'on_po', items: [] } }));
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
const onPoItem = (itemKey: string, poCount = 1, dueQuantity = 10) => ({
  itemKey, poCount, dueQuantity, latestPoNumber: 'PO/26-27/0007',
  // Noon IST four calendar days earlier avoids a midnight boundary in the assertion.
  latestCreatedAt: new Date((Math.floor((Date.now() + 19_800_000) / 86_400_000) - 4) * 86_400_000 + 43_200_000 - 19_800_000).toISOString(),
});

test('Stock shows one PO with age, multiple POs with count, and no line for absent items', async ({ page }) => {
  await page.route('**/api/requirements?view=on_po', (route) => route.fulfill({ json: {
    view: 'on_po', items: [onPoItem('Test reagent A'), onPoItem('Test reagent B', 2, 15)],
  } }));
  await openStockDashboard(page, coverStockPayload());
  await expect(page.locator('#refresh')).toBeEnabled();
  await page.locator('#groupCards summary').click();
  await expect(page.locator('.group-item').filter({ hasText: 'Test reagent A' }).locator('.gi-onpo')).toHaveText('On PO 10 · PO/26-27/0007 · 4 days ago');
  await expect(page.locator('.group-item').filter({ hasText: 'Test reagent B' }).locator('.gi-onpo')).toHaveText('On PO 15 · 2 POs');
  await expect(page.locator('.group-item').filter({ hasText: 'Test reagent C' }).locator('.gi-onpo')).toHaveCount(0);
});

for (const invalid of ['server failure', 'invalid body']) {
  test(`on-PO ${invalid} silently leaves Stock rows available`, async ({ page }) => {
    await page.route('**/api/requirements?view=on_po', (route) => route.fulfill({
      status: invalid === 'server failure' ? 500 : 200, json: { view: 'on_po', items: 'x' },
    }));
    await openStockDashboard(page, coverStockPayload());
    await expect(page.locator('#refresh')).toBeEnabled();
    await page.locator('#groupCards summary').click();
    await expect(page.locator('.group-item')).toHaveCount(3);
    await expect(page.locator('.gi-onpo')).toHaveCount(0);
    await expect(page.locator('#error')).toBeHidden();
  });
}

test('long reorder names keep the order and stock on the right on a phone', async ({ page }) => {
  await page.route('**/api/requirements?view=on_po', (route) => route.fulfill({ json: { view: 'on_po', items: [onPoItem('Stromatolyser WH 500 Ml 3 Part Sysmex Long Name Pack')] } }));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/requirements?view=cover', (route) => route.fulfill({ json: {
    view: 'cover', leadTimeDays: 7, salesThrough: '2026-11-18', runsOutCount: 0,
    items: [
      { itemKey: 'Stromatolyser WH 500 Ml 3 Part Sysmex Long Name Pack', daysLeft: 300, state: 'covered' },
      { itemKey: 'Short item', daysLeft: 300, state: 'covered' },
    ],
  } }));
  await openStockDashboard(page, { ...stockPayload(), groups: ['Test group'], rows: [
    { group: 'Test group', item: 'Stromatolyser WH 500 Ml 3 Part Sysmex Long Name Pack', closing: 2, reorderLevel: 3, minimumOrder: 1, shortfall: 1, orderToBePlaced: 1 },
    { group: 'Test group', item: 'Short item', closing: 2, reorderLevel: 3, minimumOrder: 1, shortfall: 1, orderToBePlaced: 1 },
  ] });
  await page.locator('#groupCards summary').click();
  const row = page.locator('.group-item').filter({ hasText: 'Stromatolyser WH 500 Ml 3 Part Sysmex Long Name Pack' });
  await expect(row.locator('.gi-onpo')).toHaveText('On PO 10 · PO/26-27/0007 · 4 days ago');
  const name = row.locator('.gi-name'), order = row.locator('.gi-order'), qty = row.locator('.gi-qty');
  const nameBox = await name.boundingBox(), orderBox = await order.boundingBox(), qtyBox = await qty.boundingBox(), rowBox = await row.boundingBox();
  expect(nameBox && orderBox && qtyBox && rowBox).toBeTruthy();
  const mid = orderBox!.y + orderBox!.height / 2;
  expect(mid).toBeGreaterThanOrEqual(nameBox!.y);
  expect(mid).toBeLessThanOrEqual(nameBox!.y + 26);
  expect(Math.abs((qtyBox!.x + qtyBox!.width) - (rowBox!.x + rowBox!.width))).toBeLessThanOrEqual(4);
  expect(nameBox!.height).toBeGreaterThan(30);
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

const itemDetailPayload = (itemKey = 'Test reagent A') => ({
  view: 'item_detail', itemKey, asOf: '2026-11-23',
  months: ['06', '07', '08', '09', '10', '11'].map((month, i) => ({ month: '2026-' + month, sold: i * 2 })),
  openPos: [
    { poNumber: 'PO/26-27/0007', due: 10, createdAt: onPoItem(itemKey).latestCreatedAt },
    { poNumber: 'PO/26-27/0006', due: 3, createdAt: onPoItem(itemKey).latestCreatedAt },
  ],
  openPoCount: 12, waiting: { orders: 2, quantity: 7 },
  supplierPrice: { name: 'Test supplier', unit: 'kit', effectiveAt: '2026-11-22', rate: 1234.56 },
});

async function tapStockItem(page: import('@playwright/test').Page, name = 'Test reagent A') {
  await expect(page.locator('#refresh')).toBeEnabled();
  if ((await page.locator('#groupCards details').first().getAttribute('open')) === null) {
    await page.locator('#groupCards summary').first().click();
  }
  await page.getByRole('button', { name, exact: true }).click();
}

test('item detail reads only on tap and shows monthly sales, POs, waiting orders and the supplied rate', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/requirements?view=item_detail*', (route) => {
    reads++;
    return route.fulfill({ json: itemDetailPayload() });
  });
  await openStockDashboard(page, coverStockPayload());
  await expect(page.locator('#refresh')).toBeEnabled();
  expect(reads).toBe(0);
  await tapStockItem(page);
  const sheet = page.getByRole('dialog', { name: 'Test reagent A' });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('#itemSheetTitle')).toHaveText('Test reagent A');
  await expect(sheet.locator('.item-month-bar')).toHaveCount(6);
  await expect(sheet.locator('.item-month-value')).toHaveText(['0', '2', '4', '6', '8', '10']);
  await expect(sheet.locator('.item-month-label').last()).toHaveText('Nov (so far)');
  await expect(sheet).toContainText('PO/26-27/0007 · 10 due · 4 days ago');
  await expect(sheet).toContainText('PO/26-27/0006 · 3 due · 4 days ago');
  await expect(sheet).toContainText('and 10 more');
  await expect(sheet).toContainText('2 orders · 7 to deliver');
  await expect(sheet).toContainText('Test supplier');
  await expect(sheet).toContainText('₹1,234.56 per kit');
  await expect(sheet).toContainText('as of 22 Nov 2026');
  expect(reads).toBe(1);
});

test('item detail without a rate shows the supplier without any money', async ({ page }) => {
  const payload = itemDetailPayload();
  const { rate: _rate, ...supplierPrice } = payload.supplierPrice;
  await page.route('**/api/requirements?view=item_detail*', (route) => route.fulfill({ json: { ...payload, supplierPrice } }));
  await openStockDashboard(page, coverStockPayload());
  await tapStockItem(page);
  await expect(page.locator('#itemSheetBody')).toContainText('Test supplier');
  await expect(page.locator('#itemSheetBody')).not.toContainText('₹');
});

test('item detail without supplierPrice has no Supplier price heading', async ({ page }) => {
  const { supplierPrice: _supplierPrice, ...payload } = itemDetailPayload();
  await page.route('**/api/requirements?view=item_detail*', (route) => route.fulfill({ json: payload }));
  await openStockDashboard(page, coverStockPayload());
  await tapStockItem(page);
  await expect(page.locator('#itemSheetBody')).toContainText('Waiting customer orders');
  await expect(page.locator('#itemSheetBody').getByRole('heading', { name: 'Supplier price' })).toHaveCount(0);
});

test('item detail server failure offers Retry and recovers', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/requirements?view=item_detail*', (route) => {
    reads++;
    return route.fulfill(reads === 1 ? { status: 500, json: {} } : { json: itemDetailPayload() });
  });
  await openStockDashboard(page, coverStockPayload());
  await tapStockItem(page);
  await expect(page.locator('#itemSheetBody')).toContainText('Item details could not load');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('#itemSheetBody')).toContainText('Test supplier');
  expect(reads).toBe(2);
});

test('a delayed item A response cannot replace the newly opened item B detail', async ({ page }) => {
  let releaseA!: () => void;
  const gate = new Promise<void>((resolve) => { releaseA = resolve; });
  let requestedA = false;
  await page.route('**/api/requirements?view=item_detail*', async (route) => {
    const key = new URL(route.request().url()).searchParams.get('itemKey')!;
    if (key === 'Test reagent A') { requestedA = true; await gate; }
    await route.fulfill({ json: { ...itemDetailPayload(key), supplierPrice: { ...itemDetailPayload().supplierPrice, name: key + ' supplier' } } });
  });
  await openStockDashboard(page, coverStockPayload());
  await tapStockItem(page);
  await expect.poll(() => requestedA).toBe(true);
  await page.keyboard.press('Escape');
  await tapStockItem(page, 'Test reagent B');
  await expect(page.locator('#itemSheetBody')).toContainText('Test reagent B supplier');
  const aResponse = page.waitForResponse((response) => response.url().includes('view=item_detail') && response.url().includes('Test%20reagent%20A'));
  releaseA();
  await aResponse;
  await expect(page.locator('#itemSheetTitle')).toHaveText('Test reagent B');
  await expect(page.locator('#itemSheetBody')).toContainText('Test reagent B supplier');
  await expect(page.locator('#itemSheetBody')).not.toContainText('Test reagent A supplier');
});

test('Esc closes the item detail and returns focus to its item name', async ({ page }) => {
  await page.route('**/api/requirements?view=item_detail*', (route) => route.fulfill({ json: itemDetailPayload() }));
  await openStockDashboard(page, coverStockPayload());
  await tapStockItem(page);
  await expect(page.locator('#itemSheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#itemSheet')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Test reagent A', exact: true })).toBeFocused();
});

test('phone item sheet fits 375px, has a large Close button and preserves the long-name order layout', async ({ page }) => {
  const name = 'Stromatolyser WH 500 Ml 3 Part Sysmex Long Name Pack';
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/requirements?view=item_detail*', (route) => route.fulfill({ json: itemDetailPayload(name) }));
  await openStockDashboard(page, { ...stockPayload(), groups: ['Test group'], rows: [
    { group: 'Test group', item: name, closing: 2, reorderLevel: 3, minimumOrder: 1, shortfall: 1, orderToBePlaced: 1 },
  ] });
  await tapStockItem(page, name);
  await expect(page.locator('#itemSheet')).toBeVisible();
  await expect(page.locator('#itemSheetBody')).toContainText('Test supplier');
  const closeBox = await page.locator('#itemSheetClose').boundingBox(), sheetBox = await page.locator('#itemSheet').boundingBox();
  expect(closeBox!.height).toBeGreaterThanOrEqual(44);
  expect(sheetBox!.width).toBe(375);
  expect(sheetBox!.height).toBeLessThanOrEqual(812 * 0.85 + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#itemSheetClose').click();
  const row = page.locator('.group-item').filter({ hasText: name });
  const nameBox = await row.locator('.gi-name').boundingBox(), orderBox = await row.locator('.gi-order').boundingBox();
  expect(nameBox!.height).toBeGreaterThan(30);
  expect(orderBox!.y + orderBox!.height / 2).toBeGreaterThanOrEqual(nameBox!.y);
  expect(orderBox!.y + orderBox!.height / 2).toBeLessThanOrEqual(nameBox!.y + 26);
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
