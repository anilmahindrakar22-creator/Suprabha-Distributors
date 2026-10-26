import { expect, test } from '@playwright/test';
import { orderBootstrap, orderLine, orderSummary } from '../fixtures/api-builders';

for (const role of ['warehouse', 'accounts', 'billing', 'viewer', 'sales'] as const) {
  test(`${role} sees only permitted order controls`, async ({ page, isMobile }) => {
    const order = orderSummary({
      id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      orderNumber: 'SO/26-27/0060', status: 'confirmed',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      lines: [orderLine({ fulfilledQuantity: 0 })],
    });
    await page.route('**/api/orders**', (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
      const orders = url.searchParams.get('status') === 'history' ? [] : [order];
      return route.fulfill({ json: orderBootstrap({
        actor: { email: `${role}@example.test`, role, roles: [role] },
        snapshot: { company: 'TEST', fetchedAt: new Date().toISOString(), catalog: [] },
        customers: [], orders, operations: {},
        pagination: { total: orders.length, page: 1, pageCount: 1, pageSize: 20 },
      }) });
    });
    await page.route('**/api/procurement-requirements**', route => route.fulfill({ json: { requirements: [] } }));
    await page.goto('/?view=orders-workspace');
    const row = page.getByRole('button', { name: /^SO\/26-27\/0060/ });
    await expect(row).toBeVisible();
    const create = page.getByRole('button', { name: '+ Order', exact: true });
    if (role === 'sales') await expect(create).toBeVisible();
    else await expect(create).toHaveCount(0);

    if (isMobile) await row.click();
    await page.getByText('View order details', { exact: true }).click();
    await expect(page.getByText('Internal status', { exact: true })).toBeVisible();
    const edit = page.getByRole('button', { name: '+ Edit order', exact: true });
    if (role === 'sales') {
      await expect(edit).toBeVisible();
      await edit.click();
      await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeVisible();
    } else await expect(edit).toHaveCount(0);

    const fulfilment = page.getByRole('button', { name: '+ Fulfilment details', exact: true });
    if (role === 'viewer' || role === 'billing') await expect(fulfilment).toHaveCount(0);
    else await expect(fulfilment).toBeVisible();
  });
}
