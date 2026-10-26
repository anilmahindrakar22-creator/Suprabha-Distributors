import { test, expect } from '@playwright/test';
import { orderBootstrap, orderLine, orderSummary } from '../fixtures/api-builders';

test('office request review loads on demand and retries the same versioned decision', async ({ page }) => {
  const decisions: unknown[] = [];
  let reads = 0;
  await page.route('**/api/product-requests', async (route) => {
    if (route.request().method() === 'GET') {
      reads += 1;
      await route.fulfill({ json: { requests: [{ id: '11111111-1111-4111-8111-111111111111', product_name: 'Missing reagent', details: '50-test pack', created_by_email: 'sales@example.test', version: 1 }] } });
    } else {
      decisions.push(route.request().postDataJSON());
      await route.fulfill(decisions.length === 1 ? { status: 502, json: { error: 'Unknown outcome' } } : { json: { requestId: '11111111-1111-4111-8111-111111111111' } });
    }
  });
  await page.goto('/?view=product-requests');
  expect(reads).toBe(0);
  await page.getByRole('button', { name: 'Product requests', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resolve request' })).toBeDisabled();
  await page.getByLabel('Review reason for Missing reagent').fill('Added in Tally; awaiting sync');
  await page.getByRole('button', { name: 'Resolve request' }).click();
  await expect(page.getByLabel('Review reason for Missing reagent')).toBeDisabled();
  await page.getByRole('button', { name: 'Retry review' }).click();
  await expect(page.getByText('No open product requests.')).toBeVisible();
  expect(decisions).toHaveLength(2);
  expect(decisions[0]).toEqual(decisions[1]);
});

test('missing-product request retries one command without creating an order', async ({ page }) => {
  const requests: unknown[] = [];
  let orders = 0;
  await page.route('**/api/orders**', async (route) => {
    if (route.request().method() === 'POST') orders += 1;
    await route.fulfill({ json: orderBootstrap({ orders: [], pagination: { page: 1, pageCount: 1, pageSize: 20, total: 0 } }) });
  });
  await page.route('**/api/product-requests', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill(requests.length === 1 ? { status: 502, json: { error: 'Connection unavailable' } } : { json: { requestId: 'request-test-1' } });
  });
  await page.goto('/?view=order-entry');
  await page.getByRole('combobox', { name: 'Find product' }).fill('Missing reagent');
  await page.getByRole('button', { name: 'Request new product' }).click();
  await page.getByLabel('Product request details').fill('Customer asks for a 50-test pack');
  await page.getByRole('button', { name: 'Send product request' }).click();
  await expect(page.getByLabel('Product request details')).toBeDisabled();
  await page.getByRole('button', { name: 'Retry product request' }).click();
  await expect(page.getByText('Product request saved for office review. No product was added to Tally.')).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  expect(orders).toBe(0);
});

test('five-product keyboard capture saves exact quantities once and records local timing', async ({ page }) => {
  const commands: Array<{ payload: { customerId: string; lines: Array<{ tallyKey: string; quantity: number }> } }> = [];
  let pricingRequests = 0;
  await page.route('**/api/pricing**', async (route) => { pricingRequests += 1; await route.fulfill({ status: 403, json: {} }); });
  await page.route('**/api/orders**', async (route) => {
    if (route.request().method() === 'POST') {
      commands.push(route.request().postDataJSON());
      await route.fulfill({ json: { orderNumber: 'SF-TEST-FIVE' } });
    } else await route.fulfill({ json: orderBootstrap({ orders: [], pagination: { page: 1, pageCount: 1, pageSize: 20, total: 0 } }) });
  });
  await page.goto('/?view=order-entry');
  const customer = page.getByRole('combobox', { name: 'Name' });
  await customer.fill('Beta');
  await customer.press('Enter');
  const product = page.getByRole('combobox', { name: 'Find product' });
  for (const [index, name] of ['Glucose A', 'Glucose B', 'CRP', 'HbA1c', 'Cleaner'].entries()) {
    await product.fill(name);
    await product.press('Enter');
    const quantity = page.getByRole('spinbutton', { name: `Quantity for ${name} in ` });
    await expect(quantity).toBeFocused();
    await quantity.fill(String(index + 1));
    await quantity.press('Enter');
  }
  await page.getByRole('button', { name: 'Save order', exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0].payload.customerId).toBe('22222222-2222-4222-8222-222222222222');
  expect(commands[0].payload.lines).toEqual([
    { tallyKey: 'GLUCOSE-A', quantity: 1 }, { tallyKey: 'GLUCOSE-B', quantity: 2 },
    { tallyKey: 'CRP', quantity: 3 }, { tallyKey: 'HBA1C', quantity: 4 }, { tallyKey: 'CLEANER', quantity: 5 },
  ]);
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName('order_capture_ms', 'measure').length)).toBe(1);
  expect(pricingRequests).toBe(0);
});

test('order desk can select customer and products, enter quantities, and keep the order unsent', async ({ page }) => {
  let submissions = 0;
  await page.route('**/api/orders**', async (route) => {
    if (route.request().method() === 'POST') submissions += 1;
    await route.fulfill({ json: orderBootstrap({ orders: [], pagination: { page: 1, pageCount: 1, pageSize: 20, total: 0 } }) });
  });
  await page.goto('/?view=order-entry');
  const customer = page.getByRole('combobox', { name: 'Name' });
  await customer.fill('Test');
  await customer.press('ArrowDown');
  await customer.press('Enter');
  await expect(customer).toHaveValue('Test Beta Laboratory');

  const product = page.getByRole('combobox', { name: 'Find product' });
  await expect(product).toBeFocused();
  await product.fill('Glucose');
  await product.press('ArrowDown');
  await product.press('Enter');
  const glucoseQuantity = page.getByRole('spinbutton', { name: 'Quantity for Glucose B' });
  await expect(glucoseQuantity).toBeFocused();
  await glucoseQuantity.fill('3');
  await glucoseQuantity.press('Enter');
  await expect(product).toBeFocused();

  await product.fill('CRP');
  await product.press('Enter');
  await expect(page.getByRole('spinbutton', { name: 'Quantity for CRP' })).toBeFocused();
  await expect(glucoseQuantity).toHaveValue('3');
  await expect(page.getByText('2 products · ready to save')).toBeVisible();
  expect(submissions).toBe(0);
});

test('optional order details stay compact and retain entered values', async ({ page }) => {
  await page.goto('/?view=order-entry');
  const details = page.locator('details').filter({ hasText: 'Order details' });
  await expect(details).toBeVisible();
  await expect(page.getByLabel('Received via')).toBeHidden();
  await details.locator('summary').click();
  await page.getByLabel('Received via').selectOption('whatsapp');
  await page.getByLabel('Order priority').selectOption('urgent');
  await page.getByLabel('Promised delivery').fill('2026-10-05');
  await page.getByLabel('Order notes').fill('Call before delivery');
  await details.locator('summary').click();
  await expect(page.getByLabel('Received via')).toBeHidden();
  await expect(details.locator('summary')).toContainText('WhatsApp');
  await expect(details.locator('summary')).toContainText('Urgent');
  await expect(details.locator('summary')).toContainText('Promised delivery');
  await expect(details.locator('summary')).toContainText('Notes added');
  await details.locator('summary').click();
  await expect(page.getByLabel('Received via')).toHaveValue('whatsapp');
  await expect(page.getByLabel('Order priority')).toHaveValue('urgent');
  await expect(page.getByLabel('Promised delivery')).toHaveValue('2026-10-05');
  await expect(page.getByLabel('Order notes')).toHaveValue('Call before delivery');
});

test('device draft protection stays explicit without dominating the form', async ({ page }) => {
  await page.goto('/?view=order-entry');
  const consent = page.getByRole('checkbox', { name: 'Save draft on this device' });
  await expect(consent).not.toBeChecked();
  const explanation = page.locator('details').filter({ hasText: 'About device drafts' });
  await expect(explanation).toBeVisible();
  await expect(explanation.getByText('Unsubmitted drafts expire after seven days.')).toBeHidden();
  await explanation.locator('summary').click();
  await expect(explanation.getByText('Unsubmitted drafts expire after seven days.')).toBeVisible();
  await consent.check();
  await page.reload();
  await expect(consent).toBeChecked();
  await consent.uncheck();
  await page.reload();
  await expect(consent).not.toBeChecked();
});

test('recent customer products come from Tally bills, independently of StockFlow orders', async ({ page }, testInfo) => {
  let historyRequests = 0;
  let submissions = 0;
  await page.route('**/api/orders?recentProductsFor=*', route => route.fulfill({ json: {
    customerId: '22222222-2222-4222-8222-222222222222', linked: true, billCount: 2,
    products: [{ tallyKey: 'GLUCOSE-B', billCount: 2, lastBilledAt: '2026-09-20', lastQuantity: 3 }, { tallyKey: 'CRP', billCount: 1, lastBilledAt: '2026-09-19', lastQuantity: 1 }, { tallyKey: 'OLD-ITEM', billCount: 1, lastBilledAt: '2026-09-19', lastQuantity: 1 }],
  } }));
  await page.route('**/api/orders?list=1*', async (route) => {
    historyRequests += 1;
    await route.fulfill({ json: orderBootstrap({ orders: [orderSummary({
      id: '33333333-3333-4333-8333-333333333333', orderNumber: 'SF-TEST-1', customerName: 'Test Beta Laboratory',
      customerPhone: null, status: 'delivered', source: 'phone', notes: null, version: 1,
      createdAt: '2026-09-20T10:00:00Z', updatedAt: '2026-09-20T10:00:00Z', lineCount: 3,
      totalQuantity: 3, reservedQuantity: 0, tallyInvoiceNumber: null,
      lines: [
        orderLine({ tallyKey: 'CLEANER', itemName: 'Cleaner', quantity: 99 }),
      ], events: [], exceptions: [], installations: [],
    })], pagination: { total: 1, page: 1, pageCount: 1, pageSize: 20 } }) });
  });
  await page.route('**/api/orders', async (route) => {
    if (route.request().method() === 'POST') submissions += 1;
    await route.fulfill({ json: orderBootstrap({ orders: [] }) });
  });
  await page.goto('/?view=order-entry');
  const customer = page.getByRole('combobox', { name: 'Name' });
  await customer.fill('Beta');
  await customer.press('Enter');
  const recent = page.getByRole('region', { name: 'Recently ordered products' });
  await expect(recent.getByRole('button', { name: 'Add Glucose B' })).toBeVisible();
  await expect(recent.getByRole('button', { name: 'Add CRP' })).toBeVisible();
  await expect(recent.getByRole('button', { name: 'Add Old item' })).toHaveCount(0);
  await expect(recent.getByRole('button', { name: 'Add Cleaner' })).toHaveCount(0);
  await expect(recent).toContainText('imported Tally bills');
  await recent.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('tally-recent-products.png') });
  const quickQuantity = recent.getByRole('spinbutton', { name: 'Recent quantity for Glucose B' });
  await quickQuantity.fill('0');
  await quickQuantity.press('Enter');
  await expect(page.getByRole('spinbutton', { name: /^Quantity for Glucose B in / })).toHaveCount(0);
  await quickQuantity.fill('4');
  await quickQuantity.press('Enter');
  await expect(page.getByRole('spinbutton', { name: 'Quantity for Glucose B' })).toBeFocused();
  await expect(page.getByRole('spinbutton', { name: 'Quantity for Glucose B' })).toHaveValue('4');
  await expect(recent.getByRole('button', { name: 'Add Glucose B' })).toHaveCount(0);
  expect(historyRequests).toBe(1);
  expect(submissions).toBe(0);
});

test('recent products rank by frequency and default to last quantity', async ({ page }) => {
  await page.route('**/api/orders?recentProductsFor=*', route => route.fulfill({ json: {
    customerId: '22222222-2222-4222-8222-222222222222', linked: true, billCount: 3,
    products: [{ tallyKey: 'GLUCOSE-A', billCount: 3, lastBilledAt: '2026-09-23', lastQuantity: 6 }, { tallyKey: 'CRP', billCount: 1, lastBilledAt: '2026-09-23', lastQuantity: 2 }],
  } }));
  await page.route('**/api/orders?list=1*', async (route) => {
    const orders = [
      { id: 'rank-newest', createdAt: '2026-09-23T10:00:00Z', status: 'delivered', lines: [{ tallyKey: 'GLUCOSE-A', itemName: 'Glucose A', quantity: 6 }, { tallyKey: 'CRP', itemName: 'CRP', quantity: 2 }] },
      { id: 'rank-middle', createdAt: '2026-09-22T10:00:00Z', status: 'delivered', lines: [{ tallyKey: 'GLUCOSE-A', itemName: 'Glucose A', quantity: 4 }] },
      { id: 'rank-oldest', createdAt: '2026-09-21T10:00:00Z', status: 'delivered', lines: [{ tallyKey: 'GLUCOSE-A', itemName: 'Glucose A', quantity: 1 }] },
      { id: 'rank-cancelled', createdAt: '2026-09-24T10:00:00Z', status: 'cancelled', lines: [{ tallyKey: 'CLEANER', itemName: 'Cleaner', quantity: 9 }] },
    ].map((order) => orderSummary({
      orderNumber: order.id, customerName: 'Test Beta Laboratory', customerPhone: null,
      source: 'phone', notes: null, version: 1, updatedAt: order.createdAt,
      lineCount: order.lines.length, totalQuantity: order.lines.reduce((sum, line) => sum + line.quantity, 0),
      reservedQuantity: 0, tallyInvoiceNumber: null, events: [], exceptions: [], installations: [], ...order,
      lines: order.lines.map((line) => orderLine(line)),
    }));
    await route.fulfill({ json: orderBootstrap({ orders, pagination: { total: 4, page: 1, pageCount: 1, pageSize: 20 } }) });
  });
  await page.goto('/?view=order-entry');
  const customer = page.getByRole('combobox', { name: 'Name' });
  await customer.fill('Beta');
  await customer.press('Enter');
  const recent = page.getByRole('region', { name: 'Recently ordered products' });
  await expect(recent.getByRole('button')).toHaveText(['Add', 'Add']);
  await expect(recent.getByRole('button').nth(0)).toHaveAttribute('aria-label', 'Add Glucose A');
  await expect(recent.getByRole('button').nth(1)).toHaveAttribute('aria-label', 'Add CRP');
  await expect(recent.getByRole('button', { name: 'Add Cleaner' })).toHaveCount(0);
  await expect(recent.getByRole('spinbutton', { name: 'Recent quantity for Glucose A' })).toHaveValue('6');
  await expect(recent.getByRole('spinbutton', { name: 'Recent quantity for CRP' })).toHaveValue('2');
  await expect(recent.getByRole('button', { name: 'Add Glucose A' }).locator('..')).toContainText('3 of last 3 imported Tally bills');
});

test('switching back to a customer reuses only that customer’s history', async ({ page }) => {
  const historyQueries: string[] = [];
  const tallyQueries: string[] = [];
  await page.route('**/api/orders?recentProductsFor=*', route => {
    const customerId = new URL(route.request().url()).searchParams.get('recentProductsFor')!;
    tallyQueries.push(customerId);
    return route.fulfill({ json: { customerId, linked: true, billCount: 1, products: [{ tallyKey: customerId.startsWith('1111') ? 'GLUCOSE-A' : 'CRP', billCount: 1, lastBilledAt: '2026-09-20', lastQuantity: 1 }] } });
  });
  await page.route('**/api/orders?list=1*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('query') || '';
    historyQueries.push(query);
    const alpha = query.includes('Alpha');
    await route.fulfill({ json: orderBootstrap({ orders: [orderSummary({
      id: alpha ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      orderNumber: alpha ? 'SF-ALPHA' : 'SF-BETA', customerName: alpha ? 'Test Alpha Laboratory' : 'Test Beta Laboratory',
      customerPhone: null, status: 'delivered', source: 'phone', notes: null, version: 1,
      createdAt: '2026-09-20T10:00:00Z', updatedAt: '2026-09-20T10:00:00Z', lineCount: 1,
      totalQuantity: 1, reservedQuantity: 0, tallyInvoiceNumber: null,
      lines: [orderLine({ tallyKey: alpha ? 'GLUCOSE-A' : 'CRP', itemName: alpha ? 'Glucose A' : 'CRP', quantity: 1 })],
      events: [], exceptions: [], installations: [],
    })], pagination: { total: 1, page: 1, pageCount: 1, pageSize: 20 } }) });
  });
  await page.goto('/?view=order-entry');
  const customer = page.getByRole('combobox', { name: 'Name' });
  const recent = page.getByRole('region', { name: 'Recently ordered products' });
  await customer.fill('Beta');
  await expect(customer).toHaveAttribute('aria-expanded', 'true');
  await customer.press('Enter');
  await expect(customer).toHaveValue('Test Beta Laboratory');
  await expect(recent.getByRole('button', { name: 'Add CRP' })).toBeVisible();
  await customer.fill('Alpha');
  await expect(customer).toHaveAttribute('aria-expanded', 'true');
  await customer.press('Enter');
  await expect(customer).toHaveValue('Test Alpha Laboratory');
  await expect(recent.getByRole('button', { name: 'Add Glucose A' })).toBeVisible();
  await expect(recent.getByRole('button', { name: 'Add CRP' })).toHaveCount(0);
  await customer.fill('Beta');
  await expect(customer).toHaveAttribute('aria-expanded', 'true');
  await customer.press('Enter');
  await expect(customer).toHaveValue('Test Beta Laboratory');
  await expect(recent.getByRole('button', { name: 'Add CRP' })).toBeVisible();
  await expect(recent.getByRole('button', { name: 'Add Glucose A' })).toHaveCount(0);
  expect(historyQueries).toHaveLength(2);
  expect(tallyQueries).toHaveLength(2);
});

test('failed Tally history is explicit and retry does not create an order', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/orders?list=1*', route => route.fulfill({ json: orderBootstrap({ orders: [], pagination: { total: 0, page: 1, pageCount: 1, pageSize: 20 } }) }));
  await page.route('**/api/orders?recentProductsFor=*', route => {
    reads += 1;
    return reads === 1 ? route.fulfill({ status: 502, json: { error: 'Unavailable' } }) : route.fulfill({ json: { customerId: '22222222-2222-4222-8222-222222222222', linked: false, billCount: 0, products: [] } });
  });
  await page.goto('/?view=order-entry');
  await page.getByRole('combobox', { name: 'Name' }).fill('Beta');
  await page.getByRole('combobox', { name: 'Name' }).press('Enter');
  await page.getByRole('button', { name: 'Retry Tally purchases' }).click();
  await expect(page.getByText('No linked Tally ledger yet. Search products below to create this order.')).toBeVisible();
  expect(reads).toBe(2);
  await expect(page.getByRole('combobox', { name: 'Find product' })).toBeEnabled();
});

test('a late Tally response cannot replace the newly selected customer', async ({ page }) => {
  let releaseBeta!: () => void;
  let betaStarted!: () => void;
  const started = new Promise<void>(resolve => { betaStarted = resolve; });
  const gate = new Promise<void>(resolve => { releaseBeta = resolve; });
  await page.route('**/api/orders?list=1*', route => route.fulfill({ json: orderBootstrap({ orders: [], pagination: { total: 0, page: 1, pageCount: 1, pageSize: 20 } }) }));
  await page.route('**/api/orders?recentProductsFor=*', async route => {
    const customerId = new URL(route.request().url()).searchParams.get('recentProductsFor')!;
    const beta = customerId.startsWith('2222');
    if (beta) { betaStarted(); await gate; }
    await route.fulfill({ json: { customerId, linked: true, billCount: 1, products: [{ tallyKey: beta ? 'CRP' : 'GLUCOSE-A', billCount: 1, lastBilledAt: '2026-09-20', lastQuantity: beta ? 99 : 2 }] } });
  });
  await page.goto('/?view=order-entry');
  const customer = page.getByRole('combobox', { name: 'Name' });
  await customer.fill('Beta'); await customer.press('Enter'); await started;
  await customer.fill('Alpha'); await customer.press('Enter');
  const recent = page.getByRole('region', { name: 'Recently ordered products' });
  await expect(recent.getByRole('button', { name: 'Add Glucose A' })).toBeVisible();
  releaseBeta();
  await expect(recent.getByRole('button', { name: 'Add CRP' })).toHaveCount(0);
  await expect(recent.getByRole('spinbutton', { name: 'Recent quantity for Glucose A' })).toHaveValue('2');
});

test('returning to customer search cancels the earlier blur timer', async ({ page }) => {
  await page.clock.install();
  await page.goto('/?view=order-entry');
  const customer = page.getByRole('combobox', { name: 'Name' });
  await customer.fill('Beta');
  await customer.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Find product' })).toBeFocused();
  await customer.fill('Alpha');
  await expect(customer).toHaveAttribute('aria-expanded', 'true');
  await page.clock.runFor(150);
  await expect(customer).toHaveAttribute('aria-expanded', 'true');
  await customer.press('Enter');
  await expect(customer).toHaveValue('Test Alpha Laboratory');
});
