import { expect, test, type Page } from '@playwright/test';
import { orderBootstrap, orderLine, orderSummary, toOrderItem, toOrderResponse } from '../fixtures/api-builders';

// Use the route-mocked workspace and frame hosts from order-opening and work-notifications.
const customer = { id: '11111111-1111-4111-8111-111111111111', name: 'Test Laboratory', phone: null, city: null, tallyKey: 'LAB' };
const catalog = [{ tallyKey: 'GLUCOSE', item: 'Glucose', group: 'Diasys', baseUnit: 'Nos', closing: 10, active: true }];
function recentOrder() {
  return orderSummary({
    id: '22222222-2222-4222-8222-222222222222', orderNumber: 'SF-REPEAT-001', customerName: customer.name,
    customerPhone: null, status: 'confirmed', source: 'phone', notes: null, version: 1,
    createdAt: new Date(Date.now() - 86400000).toISOString(), updatedAt: new Date().toISOString(),
    lineCount: 1, totalQuantity: 2, reservedQuantity: 0, tallyInvoiceNumber: null,
    lines: [orderLine({ tallyKey: 'GLUCOSE', itemName: 'Glucose', itemGroup: 'Diasys', quantity: 2, reservedQuantity: 0, baseUnit: 'Nos' })],
    events: [], exceptions: [], installations: [],
  });
}

async function mockOrders(page: Page, baseUnit = 'Nos') {
  const order = recentOrder();
  const commands: Array<{ payload: { lines: Array<{ tallyKey: string; quantity: number }> } }> = [];
  const queries: string[] = [];
  await page.route('**/api/orders**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST') {
      commands.push(route.request().postDataJSON());
      await route.fulfill({ json: { orderNumber: 'SF-SAVED-002' } });
      return;
    }
    queries.push(url.searchParams.get('query') || '');
    await route.fulfill({ json: { ...orderBootstrap({
      actor: { email: 'order-desk@example.test', role: 'sales', roles: ['sales'] },
      snapshot: { company: 'TEST', fetchedAt: new Date().toISOString(), catalogVersion: 'clarity', catalog: catalog.map((item) => ({ ...item, baseUnit })) },
      customerVersion: 'clarity', customers: [customer], orders: [order], operations: {},
      pagination: { total: 1, page: 1, pageCount: 1, pageSize: 20 },
    }),
      catalogVersion: 'clarity', catalog: catalog.map((item) => ({ ...item, baseUnit })),
      exceptions: [], installations: [], events: [],
    } });
  });
  return { order, commands, queries };
}

async function capture(page: Page) {
  await page.goto('/?view=orders-workspace');
  await page.getByRole('button', { name: '+ Order' }).click();
  const dialog = page.getByRole('dialog', { name: 'New order' });
  const name = dialog.getByRole('combobox', { name: 'Name', exact: true });
  await name.fill(customer.name);
  await name.press('Enter');
  const product = dialog.getByRole('combobox', { name: 'Find product' });
  await product.fill('Glucose');
  await product.press('Enter');
  return dialog;
}

test('quantity shows its unit at 375px and Possible repeat allows submission', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { order, commands } = await mockOrders(page);
  const dialog = await capture(page);
  const quantity = dialog.getByRole('spinbutton', { name: 'Quantity for Glucose in Nos', exact: true });
  await expect(quantity).toBeVisible();
  await expect(quantity.locator('..').getByText('Nos', { exact: true })).toBeVisible();
  expect((await quantity.boundingBox())!.width).toBeGreaterThan(70);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await quantity.fill('12');
  const warning = dialog.getByRole('region', { name: 'Possible repeat order', exact: true });
  await expect(warning).toContainText(`Possible repeat: order ${order.orderNumber} from`);
  await expect(warning).toContainText('already has 1 of these items (Glucose).');
  const showOrder = warning.getByRole('button', { name: `Show order ${order.orderNumber}`, exact: true });
  await expect(showOrder).toHaveAttribute('aria-expanded', 'false');
  await showOrder.click();
  await expect(warning.getByRole('button', { name: `Hide order ${order.orderNumber}`, exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(warning.getByText('Glucose — 2 Nos', { exact: true })).toBeVisible();
  await expect(warning).toContainText('Confirmed');
  await expect(warning.locator('time')).toHaveText(new Date(order.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }));
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Save draft on this device' })).not.toBeChecked();
  await expect(dialog.getByRole('combobox', { name: 'Name', exact: true })).toHaveValue(customer.name);
  await expect(quantity).toHaveValue('12');
  await dialog.getByRole('button', { name: 'Save order', exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0].payload.lines).toEqual([{ tallyKey: 'GLUCOSE', quantity: 12 }]);
  await expect(page.getByText('SF-SAVED-002 captured successfully.')).toBeVisible();
});

test('Possible repeat details toggle inline and preserve entered lines', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { order, commands } = await mockOrders(page);
  const dialog = await capture(page);
  const quantity = dialog.getByRole('spinbutton', { name: 'Quantity for Glucose in Nos', exact: true });
  await quantity.fill('7');
  const warning = dialog.getByRole('region', { name: 'Possible repeat order', exact: true });
  await warning.getByRole('button', { name: `Show order ${order.orderNumber}`, exact: true }).click();
  await expect(warning.getByText('Glucose — 2 Nos', { exact: true })).toBeVisible();
  await warning.getByRole('button', { name: `Hide order ${order.orderNumber}`, exact: true }).click();
  await expect(warning.getByRole('button', { name: `Show order ${order.orderNumber}`, exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(warning.getByText('Glucose — 2 Nos', { exact: true })).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(quantity).toHaveValue('7');
  expect(commands).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Save order', exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0].payload.lines).toEqual([{ tallyKey: 'GLUCOSE', quantity: 7 }]);
  await expect(page.getByText('SF-SAVED-002 captured successfully.')).toBeVisible();
});

test('blank unit shows units and the Tally hint', async ({ page }) => {
  await mockOrders(page, '  ');
  const dialog = await capture(page);
  const quantity = dialog.getByRole('spinbutton', { name: 'Quantity for Glucose in units', exact: true });
  await expect(quantity.locator('..').getByText('units', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Unit not set in Tally')).toBeVisible();
});

test('Requirements contributing order opens that order through the frame', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { order, queries } = await mockOrders(page);
  // Unified To order summary with lazy waiting-order details.
  await page.route('**/api/requirements?*', async (route) => {
    const url = new URL(route.request().url());
    const pagination = { page: 1, pageCount: 1, total: 1 };
    if (url.searchParams.has('alerts')) {
      await route.fulfill({ json: { windowDays: 7, alerts: [], pagination: { ...pagination, total: 0 } } });
    } else if (url.searchParams.has('itemKey')) {
      await route.fulfill({ json: { orders: [{ orderId: order.id, orderNumber: order.orderNumber, customerName: customer.name, status: 'confirmed', remainingQuantity: 2, priority: 'normal', createdAt: order.createdAt }], pagination } });
    } else {
      expect(url.searchParams.get('view')).toBe('to_order');
      expect(url.searchParams.get('page')).toBe('1');
      await route.fulfill({ json: toOrderResponse({ total: 1, waitingCount: 1, items: [
        toOrderItem({ itemKey: 'GLUCOSE', itemName: 'Glucose', openDemand: 2, closing: 0, reorderLevel: null, suggestedQty: 2, waitingOrders: 1, reasons: ['waiting_orders'], oldestOrderAt: order.createdAt }),
      ] }) });
    }
  });
  await page.goto('/?view=frame&role=sales');
  await page.getByRole('button', { name: /^requests/i }).click();
  await expect(page.getByRole('heading', { name: 'To order', level: 2, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'To order', exact: true }).getByText('1 to order', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View waiting orders' }).click();
  const contributing = page.getByRole('button', { name: `Open order ${order.orderNumber}`, exact: true });
  await expect(contributing).toContainText(`${customer.name} · ${order.orderNumber}`);
  await contributing.click();
  await expect(page.getByRole('dialog', { name: `Order ${order.orderNumber}`, exact: true })).toBeVisible();
  expect(queries).toContain(order.orderNumber);
});
