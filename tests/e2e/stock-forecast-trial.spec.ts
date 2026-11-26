import { expect, test, type FrameLocator, type Page } from '@playwright/test';

const forecastPayload = () => ({
  view: 'forecast_trial', asOf: '2027-01-04', computedAt: '2027-01-03T21:20:05Z',
  throughMonth: '2026-12-01', stale: false, uncertifiedMonths: [] as string[],
  check: [
    { horizon: 1, segment: 'established', method: 'base', cutoffs: 6, itemMonths: 1425, wape: 63.9, bias: 2.7 },
    { horizon: 1, segment: 'established', method: 'avg6', cutoffs: 6, itemMonths: 1425, wape: 57.9, bias: 1.2 },
    { horizon: 1, segment: 'established', method: 'cap12', cutoffs: 6, itemMonths: 1425, wape: 52, bias: 0 },
    { horizon: 2, segment: 'established', method: 'base', cutoffs: 6, itemMonths: 1425, wape: 60, bias: -3.5 },
    { horizon: 1, segment: 'new', method: 'base', cutoffs: 6, itemMonths: 25, wape: 80, bias: 5 },
    { horizon: 1, segment: 'new', method: 'avg6', cutoffs: 6, itemMonths: 25, wape: 75, bias: null },
    { horizon: 1, segment: 'new', method: 'cap12', cutoffs: 6, itemMonths: 25, wape: null, bias: null },
  ],
  itemCount: 3,
  items: [
    { itemKey: 'Reagent A', isNew: false, firstSaleMonth: '2024-03-01', nowMonthly: 12, nowDaysLeft: 40, avg6Monthly: 10, avg6DaysLeft: 48, cap12Monthly: 8, cap12DaysLeft: 60 },
    { itemKey: 'New reagent', isNew: true, firstSaleMonth: '2026-10-01', nowMonthly: 6, nowDaysLeft: 20, avg6Monthly: 5, avg6DaysLeft: 24, cap12Monthly: 4, cap12DaysLeft: 30 },
    { itemKey: 'Reagent without cover', isNew: false, firstSaleMonth: '2024-03-01', nowMonthly: 0, nowDaysLeft: null, avg6Monthly: 0, avg6DaysLeft: null, cap12Monthly: 0, cap12DaysLeft: null },
  ],
});

async function harness(page: Page, payload: unknown = forecastPayload(), canSeeForecast = true, status = 200) {
  const requests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).searchParams.get('view') === 'forecast_trial') requests.push(request.url());
  });
  await page.route('**/forecast-trial-test', route => route.fulfill({
    contentType: 'text/html',
    body: '<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0;display:block}</style><iframe src="/stockflow.html"></iframe>',
  }));
  await page.route('**/api/stock?view=dashboard', route => route.fulfill({ json: {
    company: 'Test company', fetchedAtIso: new Date().toISOString(), fetchedAt: '4 Jan 2027', groups: ['Reagents'],
    rows: [{ group: 'Reagents', item: 'Reagent A', closing: 1, reorderLevel: 2, minimumOrder: 1, shortfall: 1, orderToBePlaced: 1 }],
  } }));
  await page.route('**/api/orders?summary=1', route => route.fulfill({ json: {} }));
  await page.route('**/api/requirements?*', route => {
    const view = new URL(route.request().url()).searchParams.get('view');
    switch (view) {
      case 'forecast_trial': return route.fulfill({ status, json: payload });
      case 'reorder_check': return route.fulfill({ json: {
        view: 'reorder_check', coverDays: 60, leadTimeDays: 7, reviewDays: 1, shortCount: 1, levelCount: 0,
        short: [{ itemKey: 'Reagent A', closing: 1, onOrder: 0, usedLast90: 30, daysCover: 3, reorderPoint: 8, orderUpTo: 20, suggestedQty: 19 }], level: [],
      } });
      case 'on_po': return route.fulfill({ json: { view: 'on_po', items: [] } });
      case 'cover': return route.fulfill({ json: { view: 'cover', leadTimeDays: 7, salesThrough: null, runsOutCount: 0, items: [] } });
      case 'idle': return route.fulfill({ json: { view: 'idle', idleCount: 1, inStockCount: 3, asOf: '2027-01-04', historyFrom: '2024-01-01', items: [
        { itemKey: 'Idle reagent', group: 'Reagents', closing: 1, baseUnit: 'pack', lastSoldOn: null, buyerCount: 0 },
      ] } });
      case 'to_order': return route.fulfill({ json: { view: 'to_order', total: 1, waitingCount: 0, items: [] } });
      default: return route.fulfill({ status: 400, json: {} });
    }
  });
  await page.goto('/forecast-trial-test');
  const stock = page.frameLocator('iframe');
  await expect(stock.locator('#company')).toHaveText('Test company');
  await expect(stock.locator('#refresh')).toBeEnabled();
  const response = canSeeForecast ? page.waitForResponse(r => new URL(r.url()).searchParams.get('view') === 'forecast_trial') : null;
  await postAccount(page, canSeeForecast);
  if (response) {
    await (await response).finished();
    await stock.locator('body').evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  }
  return { stock, requests };
}

async function postAccount(page: Page, canSeeForecast: boolean, email = 'management@example.test') {
  await page.evaluate(({ allowed, email }) => document.querySelector('iframe')?.contentWindow?.postMessage({
    type: 'stockflow-cache-account', email, canCreatePo: true, canSeeBuyers: true, canSeeForecast: allowed,
  }, location.origin), { allowed: canSeeForecast, email });
}

async function openForecast(stock: FrameLocator) {
  const chip = stock.locator('[data-action="forecast"]');
  await expect(chip).toContainText('Forecast trial');
  await expect(stock.locator('#forecastHint')).toHaveText('3 items');
  await chip.click();
  await expect(stock.locator('#forecastView h2')).toHaveText('Forecast trial');
}

async function expectForecast(stock: FrameLocator) {
  const panel = stock.locator('#forecastView');
  await expect(panel.locator('.levels-caption')).toHaveText("Two ways to read sales, shown next to today's 90-day average. Nothing changes in Stock until the owner chooses. Today uses the last 90 days; the trial uses complete months to Dec 2026. New items can carry a manager's expected use until they have 6 months of sales.");
  await expect(panel.locator('.forecast-check')).toBeVisible();
  await expect(panel.locator('td').filter({ hasText: '63.9% off · +2.7%' })).toHaveCount(1);
  await expect(panel.locator('td').filter({ hasText: '57.9% off · +1.2%' })).toHaveCount(1);
  await expect(panel.locator('td').filter({ hasText: '52.0% off · +0.0%' })).toHaveCount(1);
  await expect(panel.locator('td').filter({ hasText: '60.0% off · −3.5%' })).toHaveCount(1);
  await expect(panel).toContainText('New items (first 6 months): 80.0% / 75.0% / — off next month. Treat their figures as rough.');
  await expect(panel.locator('.idle-row')).toHaveCount(3);
  await expect(panel.locator('.forecast-new')).toHaveText('New');
  await expect(panel.locator('.idle-row').last()).toContainText('today 0/month · —');
  await expect(stock.locator('#groupCards')).toBeHidden();
  await expect(stock.locator('.groups-title')).toBeHidden();
  await expect(stock.locator('#coverCaption')).toBeHidden();
}

test('operations cannot see or request the forecast trial', async ({ page }) => {
  const { stock, requests } = await harness(page, forecastPayload(), false);
  await expect(stock.locator('[data-action="forecast"]')).toBeHidden();
  await stock.locator('[data-action="items"]').click();
  expect(requests).toEqual([]);
});

async function fillExpectedUse(stock: FrameLocator) {
  await stock.getByRole('button', { name: 'Set expected use', exact: true }).click();
  const form = stock.locator('#forecastEstimateEditor');
  await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await form.getByLabel('Expected use per month').fill('12.5');
  await form.getByLabel('Why', { exact: true }).fill('Principal plan: 2 labs from Jan');
  const reviewOn = await form.getByLabel('Review on').inputValue();
  await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  return { form, reviewOn };
}

test('only New rows offer Set expected use', async ({ page }) => {
  const { stock } = await harness(page);
  await openForecast(stock);
  await expect(stock.locator('.idle-row').filter({ hasText: 'New reagent' }).getByRole('button', { name: 'Set expected use' })).toBeVisible();
  await expect(stock.locator('.idle-row').filter({ hasText: 'Reagent A' }).getByRole('button')).toHaveCount(0);
  await expect(stock.locator('.idle-row').filter({ hasText: 'Reagent without cover' }).getByRole('button')).toHaveCount(0);
});

test('saving expected use posts the exact contract and reloads the forecast', async ({ page }) => {
  const requestId = '123e4567-e89b-42d3-a456-426614174000';
  await page.addInitScript(id => { Object.defineProperty(crypto, 'randomUUID', { value: () => id }); }, requestId);
  let posted: unknown;
  await page.route('**/api/item-estimates', async route => {
    posted = route.request().postDataJSON();
    await route.fulfill({ json: { saved: true } });
  });
  const { stock, requests } = await harness(page);
  await openForecast(stock);
  const { form, reviewOn } = await fillExpectedUse(stock);
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(posted).toEqual({ requestId, itemKey: 'New reagent', monthlyQty: 12.5, reason: 'Principal plan: 2 labs from Jan', reviewOn });
  await expect(stock.locator('#forecastEstimateEditor')).toHaveCount(0);
});

test('an estimate shows expected use and can be changed', async ({ page }) => {
  const payload = forecastPayload();
  const items = payload.items.map(item => ({ ...item, estimate: item.isNew ? {
    monthly: 12.5, daysLeft: 10, reason: 'Principal plan: 2 labs from Jan', reviewOn: '2027-02-12',
    setBy: 'manager@example.test', setAt: '2026-11-26T12:00:00Z',
  } : null }));
  const { stock } = await harness(page, { ...payload, items });
  await openForecast(stock);
  const row = stock.locator('.idle-row').filter({ hasText: 'New reagent' });
  await expect(row).toContainText('expected 12.5/month · 10 days left · Principal plan: 2 labs from Jan · review 12 Feb');
  await row.getByRole('button', { name: 'Change expected use' }).click();
  await expect(row.getByLabel('Expected use per month')).toHaveValue('12.5');
  await expect(row.getByLabel('Why', { exact: true })).toHaveValue('Principal plan: 2 labs from Jan');
  await row.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(stock.locator('#forecastEstimateEditor')).toHaveCount(0);
});

test('a 400 displays the server message and retries reuse the request id', async ({ page }) => {
  const posted: { requestId: string; reason: string }[] = [];
  await page.route('**/api/item-estimates', async route => {
    posted.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, json: { error: 'Only new items take an expected use' } });
  });
  const { stock, requests } = await harness(page);
  await openForecast(stock);
  const { form } = await fillExpectedUse(stock);
  await form.getByLabel('Why', { exact: true }).fill('   short   ');
  await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await form.getByLabel('Why', { exact: true }).fill(' Principal plan: 2 labs from Jan ');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('Only new items take an expected use');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => posted.length).toBe(2);
  expect(posted[0].requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(posted[1].requestId).toBe(posted[0].requestId);
  expect(posted[0].reason).toBe('Principal plan: 2 labs from Jan');
  expect(requests).toHaveLength(1);
});

test('expected use form fits a 375px phone without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { stock } = await harness(page);
  await openForecast(stock);
  const { form } = await fillExpectedUse(stock);
  for (const control of [form, form.getByLabel('Expected use per month'), form.getByLabel('Why', { exact: true }), form.getByLabel('Review on')]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  }
  expect(await stock.locator('body').evaluate(() => document.documentElement.scrollWidth <= 375)).toBe(true);
});

test('management can read the forecast trial on a 375px phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { stock } = await harness(page);
  await openForecast(stock);
  await expectForecast(stock);
  expect(await stock.locator('body').evaluate(() => document.documentElement.scrollWidth <= 375)).toBe(true);
});

test('desktop forecast renders and levels clears the forecast selection', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { stock } = await harness(page);
  await openForecast(stock);
  await expectForecast(stock);
  await stock.locator('[data-action="levels"]').click();
  await expect(stock.locator('#forecastView')).toBeHidden();
  await expect(stock.locator('[data-action="forecast"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(stock.locator('#levelsView')).toBeVisible();
});

test('stale and uncertified notices show the run time and month names', async ({ page }) => {
  const { stock } = await harness(page, { ...forecastPayload(), stale: true, uncertifiedMonths: ['2025-10-01', '2025-03-01'] });
  await openForecast(stock);
  await expect(stock.locator('#forecastView')).toContainText('Forecast not updated since');
  await expect(stock.locator('#forecastView')).toContainText('Some months are not reconciled yet: Oct 2025, Mar 2025');
});

test('no run keeps a loaded zero-item chip and explains the empty forecast', async ({ page }) => {
  const { stock } = await harness(page, { ...forecastPayload(), computedAt: null, throughMonth: null, check: null, items: [], itemCount: 0, stale: true });
  await expect(stock.locator('#forecastHint')).toHaveText('0 items');
  await stock.locator('[data-action="forecast"]').click();
  await expect(stock.locator('#forecastView')).toContainText('Forecast not run yet');
  await expect(stock.locator('.forecast-check')).toHaveCount(0);
  await expect(stock.locator('#forecastView .levels-caption')).not.toContainText('Today uses');
});

for (const [label, payload] of [
  ['wrong view', { ...forecastPayload(), view: 'other' }],
  ['fractional days', { ...forecastPayload(), items: [{ ...forecastPayload().items[0], nowDaysLeft: 2.5 }] }],
  ['incomplete estimate', { ...forecastPayload(), items: [{ ...forecastPayload().items[1], estimate: { monthly: 12 } }] }],
  ['zero estimate', { ...forecastPayload(), items: [{ ...forecastPayload().items[1], estimate: { monthly: 0, daysLeft: null, reason: 'Principal plan: 2 labs from Jan', reviewOn: '2027-02-12', setBy: 'manager@example.test', setAt: '2026-11-26T12:00:00Z' } }] }],
  ['invalid month', { ...forecastPayload(), throughMonth: '2026-13-01' }],
  ['missing fields', { view: 'forecast_trial' }],
  ['mixed no-run fields', { ...forecastPayload(), computedAt: null }],
  ['invalid check', { ...forecastPayload(), check: [{ ...forecastPayload().check[0], wape: '63.9' }] }],
] as const) {
  test('invalid payload stays hidden: ' + label, async ({ page }) => {
    const { stock, requests } = await harness(page, payload);
    await expect(stock.locator('[data-action="forecast"]')).toBeHidden();
    expect(requests).toHaveLength(1);
  });
}

test('403 hides the chip even when the frame flag permits a request', async ({ page }) => {
  const { stock } = await harness(page, { error: 'Forbidden' }, true, 403);
  await expect(stock.locator('[data-action="forecast"]')).toBeHidden();
});

test('permission removal clears the visible forecast and account changes reload it', async ({ page }) => {
  const { stock, requests } = await harness(page);
  await openForecast(stock);
  await postAccount(page, false);
  await expect(stock.locator('[data-action="forecast"]')).toBeHidden();
  await expect(stock.locator('#forecastView')).toBeEmpty();
  await postAccount(page, true);
  await expect(stock.locator('#forecastHint')).toHaveText('3 items');
  await postAccount(page, true, 'second-management@example.test');
  await expect.poll(() => requests.length).toBe(3);
  await expect(stock.locator('#forecastHint')).toHaveText('3 items');
  await expect(stock.locator('#forecastView')).toBeHidden();
});

test('idle selection clears the forecast view; the to-order chip opens Purchase', async ({ page }) => {
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
  const { stock } = await harness(page);
  await openForecast(stock);
  await stock.locator('[data-action="idle"]').click();
  await expect(stock.locator('#forecastView')).toBeHidden();
  await expect(stock.locator('[data-action="forecast"]')).toHaveAttribute('aria-pressed', 'false');

  await openForecast(stock);
  await stock.locator('[data-action="items"]').click();
  await expect.poll(() => messages).toEqual([
    { type: 'stockflow-open-requests', section: 'to-order' },
  ]);
  await expectForecast(stock);
  await expect(stock.locator('[data-action="forecast"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(stock.locator('[data-action="items"]')).not.toHaveAttribute('aria-pressed');
  await expect(stock.locator('#idleView')).toBeHidden();
  await expect(stock.locator('#levelsView')).toBeHidden();
});
