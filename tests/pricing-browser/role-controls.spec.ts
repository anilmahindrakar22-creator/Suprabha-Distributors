import { expect, test } from '@playwright/test';
import { orderBootstrap, orderLine, orderSummary } from '../fixtures/api-builders';

for (const role of ['warehouse', 'accounts', 'billing', 'viewer', 'sales'] as const) {
  test(`${role} sees only permitted order controls`, async ({ page, isMobile }) => {
    const order = orderSummary({
      id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      orderNumber: 'SO/26-27/0060', status: role === 'billing' || role === 'viewer' ? 'awaiting_tally_billing' : 'confirmed',
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
    const addNote = page.getByRole('button', { name: '+ Add activity note', exact: true });
    const noteInput = page.getByPlaceholder('Call update or internal handoff note', { exact: true });
    if (role === 'billing') {
      await addNote.click();
      await expect(noteInput).toBeVisible();
    } else if (role === 'viewer') {
      await expect(addNote).toHaveCount(0);
      await expect(noteInput).toHaveCount(0);
    }
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

for (const scenario of [
  { role: 'viewer', hasHistory: true },
  { role: 'viewer', hasHistory: false },
  { role: 'operations', hasHistory: true },
  { role: 'operations', hasHistory: false },
] as const) {
  test(`${scenario.role} operational panels with history=${scenario.hasHistory}`, async ({ page, isMobile }) => {
    const { role, hasHistory } = scenario;
    const order = orderSummary({
      orderNumber: 'SF-ROLE-HISTORY', status: 'confirmed',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      exceptions: hasHistory ? [{
        id: 'exception-1', category: 'delayed', status: 'open', summary: 'Delivery delayed by rain',
        ownerEmail: null, resolution: null, createdBy: 'operations@example.test',
        createdAt: new Date().toISOString(), resolvedBy: null, resolvedAt: null,
      }] : [],
      installations: hasHistory ? [{
        id: 'installation-1', tallyKey: 'TEST-ITEM', itemName: 'Test equipment installation',
        status: 'scheduled', scheduledDate: '2026-10-29', engineerEmail: 'engineer@example.test',
        siteContact: null, serialNumber: null, commissioningNotes: null,
        createdBy: 'operations@example.test', createdAt: new Date().toISOString(), completedBy: null, completedAt: null,
      }] : [],
    });
    await page.route('**/api/orders**', route => {
      const url = new URL(route.request().url());
      if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: order.exceptions, installations: order.installations } });
      const orders = url.searchParams.get('status') === 'history' ? [] : [order];
      return route.fulfill({ json: orderBootstrap({
        actor: { email: `${role}@example.test`, role, roles: [role] }, orders,
        pagination: { total: orders.length, page: 1, pageCount: 1, pageSize: 20 },
      }) });
    });
    await page.route('**/api/procurement-requirements**', route => route.fulfill({ json: { requirements: [] } }));
    await page.goto('/?view=orders-workspace');
    const row = page.getByRole('button', { name: /^SF-ROLE-HISTORY/ });
    await expect(row).toBeVisible();
    if (isMobile) await row.click();
    await page.getByText('View order details', { exact: true }).click();
    await expect(page.getByText('Internal status', { exact: true })).toBeVisible();
    const exceptionsToggle = page.getByRole('button', { name: /Delivery exceptions/ });
    const installationsToggle = page.getByRole('button', { name: /Equipment installation/ });
    if (role === 'viewer' && !hasHistory) {
      await expect(exceptionsToggle).toHaveCount(0);
      await expect(installationsToggle).toHaveCount(0);
      return;
    }
    await exceptionsToggle.click();
    await installationsToggle.click();
    const exceptions = exceptionsToggle.locator('..');
    const installations = installationsToggle.locator('..');
    if (hasHistory) {
      await expect(exceptions).toContainText('Delivery delayed by rain');
      await expect(exceptions).toContainText('open');
      await expect(installations).toContainText('Test equipment installation');
      await expect(installations).toContainText('scheduled');
    }
    if (role === 'viewer') {
      for (const panel of [exceptions, installations]) {
        await expect(panel.getByRole('textbox')).toHaveCount(0);
        await expect(panel.getByRole('combobox')).toHaveCount(0);
        await expect(panel.locator('input, select, textarea')).toHaveCount(0);
        await expect(panel.getByRole('button')).toHaveCount(1);
      }
      await expect(page.getByRole('button', { name: 'Add exception', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Schedule installation', exact: true })).toHaveCount(0);
    } else {
      await expect(exceptions.getByRole('button', { name: 'Add exception', exact: true })).toBeVisible();
      await expect(exceptions.getByPlaceholder('What happened?', { exact: true })).toBeVisible();
      await expect(installations.getByRole('button', { name: 'Schedule installation', exact: true })).toBeVisible();
      await expect(installations.getByRole('combobox')).toBeVisible();
      if (hasHistory) {
        await expect(exceptions.getByRole('button', { name: 'Resolve', exact: true })).toBeVisible();
        await expect(installations.getByRole('button', { name: 'Complete', exact: true })).toBeVisible();
      }
    }
  });
}
