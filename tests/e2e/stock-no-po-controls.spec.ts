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
      if (event.origin === location.origin && event.data?.type === 'stockflow-open-requests') {
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
  await stock.locator('#groupCards summary').click();
  return { stock, payload, messages };
}

const coverStockPayload = () => ({
  ...stockPayload(), groups: ['Test group'], rows: [
    { group: 'Test group', item: 'Test reagent B', closing: 30, reorderLevel: 50, minimumOrder: 1, shortfall: 20, orderToBePlaced: 20 },
    { group: 'Test group', item: 'Test reagent C', closing: 5, reorderLevel: 10, minimumOrder: 1, shortfall: 5, orderToBePlaced: 5 },
    { group: 'Test group', item: 'Test reagent A', closing: 2, reorderLevel: 3, minimumOrder: 1, shortfall: 1, orderToBePlaced: 1 },
  ],
});

test.beforeEach(async ({ page }) => {
  await page.route('**/api/requirements?view=to_order&page=1', route => route.fulfill({
    json: { view: 'to_order', total: 25, waitingCount: 6, items: [] },
  }));
  await page.route('**/api/requirements?view=on_po', route => route.fulfill({ json: { view: 'on_po', items: [] } }));
  await page.route('**/api/requirements?view=idle&page=*', route => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/requirements?view=reorder_check', route => route.fulfill({ status: 503, json: {} }));
});

for (const allowed of [true, false, undefined]) {
  test('Stock has no PO selection controls with access ' + String(allowed), async ({ page }) => {
    const { stock } = await stockPoHarness(page, allowed);
    await expect(stock.getByRole('checkbox')).toHaveCount(0);
    await expect(stock.locator('#poBar, #poPickAll, #pickRunsOut')).toHaveCount(0);
    await expect(stock.locator('.group-meta')).toHaveText('3 items · 2 run out before delivery');
    await expect(stock.locator('.gi-stock').first()).toBeVisible();
  });
}

test('to order chip uses the Purchase total and opens Purchase', async ({ page }) => {
  const { stock, messages } = await stockPoHarness(page, true);
  const chip = stock.getByRole('button', { name: 'Open Purchase to order', exact: true });
  await expect(chip.locator('strong')).toHaveText('25 to order');
  await expect(stock.locator('#itemHint')).toHaveText('2 run out before delivery');
  await expect(chip).not.toHaveAttribute('aria-pressed');
  await stock.locator('#refresh').click();
  await expect(stock.locator('#refresh')).toBeEnabled();
  await expect(chip.locator('strong')).toHaveText('25 to order');
  await chip.click();
  await expect.poll(() => messages).toEqual([{ type: 'stockflow-open-requests', section: 'to-order' }]);
});
