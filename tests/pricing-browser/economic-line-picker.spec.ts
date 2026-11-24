import { expect, test, type Page } from '@playwright/test';

const invoice = (index: number) => ({
  id: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`, companyId: 'company', voucherId: `invoice-${index}`,
  voucherNumber: `INV-${index}`, revision: '7', lineKey: '1', date: '2026-07-23', kind: 'sale', customerSourceId: 'customer',
  productId: 'analyzer', productName: `Analyzer ${index} with a long descriptive invoice label that wraps on a phone`, quantity: '1',
  unit: 'Nos', netSalesPaise: '100000', batchId: `SERIAL-${index}`,
});
const workspace = {
  actorEmail: 'manager@example.com', businessDate: '2026-10-09', targets: [], mappings: [], exceptions: [], leakage: [], cases: [],
  installations: [], customers: [], canManage: true, canApprove: false, canAct: false, generation: 'run-1', lastRebuiltAt: null,
  sourceImportedAt: null, sourceLineCount: 51, unattributedPaise: '0', reportingFrom: '2026-09-01', reportingTo: '2026-10-01',
  policy: { attractiveMonths: 24, reviewMonths: 36, exceptionMonths: 48, forecastWindowMonths: 3, watchRevenuePercent: 80, criticalRevenuePercent: 50 },
};

async function openPicker(page: Page) {
  await page.route('**/api/instrument-economics', route => route.fulfill({ json: workspace }));
  await page.goto('/?view=instrument-economics');
  await page.getByRole('navigation', { name: 'Economics sections' }).getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.getByRole('navigation', { name: 'Advanced sections' }).getByRole('button', { name: 'All actions', exact: true }).click();
  await page.getByLabel('Action', { exact: true }).selectOption('register_historical_instrument');
  return page.getByRole('combobox', { name: 'Instrument selling line', exact: true });
}

for (const width of [375, 1280]) {
  test(`invoice picker searches, pages and retains selected evidence at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    const requests: URLSearchParams[] = [];
    const rows = Array.from({ length: 51 }, (_, index) => invoice(index + 1));
    await page.route('**/api/instrument-economics/lines**', route => {
      const params = new URL(route.request().url()).searchParams;
      requests.push(params);
      const matches = params.get('q') === 'missing words' ? [] : rows;
      const offset = Number(params.get('offset') ?? 0);
      return route.fulfill({ json: { rows: matches.slice(offset, offset + 50), total: matches.length, limit: 50, offset } });
    });
    const picker = await openPicker(page);
    expect(requests).toHaveLength(0);
    await picker.fill('analyzer invoice');
    await expect.poll(() => requests.some(params => params.get('q') === 'analyzer invoice')).toBe(true);
    const search = requests.find(params => params.get('q') === 'analyzer invoice')!;
    expect(Object.fromEntries(search)).toMatchObject({ kind: 'sale', quantityOne: '1', minNetSalesPaise: '1', limit: '50', offset: '0', q: 'analyzer invoice' });
    await expect(page.getByRole('option')).toHaveCount(50);
    await page.getByRole('button', { name: 'Show more (1 left)', exact: true }).click();
    await expect.poll(() => requests.some(params => params.get('offset') === '50' && params.get('q') === 'analyzer invoice')).toBe(true);
    await expect(page.getByRole('option')).toHaveCount(51);
    await page.getByRole('option', { name: /Analyzer 51 with/ }).click();
    await expect(page.locator('input[name="sourceLineId"]')).toHaveValue(invoice(51).id);
    await expect(page.getByLabel('Confirmed serial number')).toHaveValue('SERIAL-51');
    await picker.fill('missing words');
    await expect(page.getByText('No matching invoices.', { exact: true })).toBeVisible();
    await expect(page.locator('input[name="sourceLineId"]')).toHaveValue(invoice(51).id);
    await expect(page.locator('input[name="expectedSourceRevision"]')).toHaveValue('7');
    await expect(page.getByLabel('Confirmed serial number')).toHaveValue('SERIAL-51');
    await picker.press('Escape');
    await expect(picker).toHaveValue(/Analyzer 51 with/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await picker.click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`invoice picker retries a failed request at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    let calls = 0;
    await page.route('**/api/instrument-economics/lines**', route => {
      calls++;
      if (calls === 1) return route.fulfill({ status: 502, json: { error: 'Unavailable' } });
      return route.fulfill({ json: { rows: [invoice(1)], total: 1, limit: 50, offset: 0 } });
    });
    const picker = await openPicker(page);
    await picker.click();
    await expect(page.getByRole('alert')).toContainText('Could not load invoices.');
    await expect(page.getByRole('alert')).toBeVisible();
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await expect(page.getByRole('listbox').getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
    expect(await retry.evaluate(element => (element as HTMLElement).offsetHeight)).toBeGreaterThanOrEqual(44);
    await retry.click();
    await expect(page.getByRole('option', { name: /Analyzer 1 with/ })).toBeVisible();
    expect(calls).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
