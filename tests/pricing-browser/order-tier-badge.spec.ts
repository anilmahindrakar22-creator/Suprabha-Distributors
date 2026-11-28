import { expect, test, type Page } from '@playwright/test';
import { orderBootstrap, orderSummary } from '../fixtures/api-builders';

const diamondId = '61000000-0000-4000-8000-000000000001';
const silverId = '61000000-0000-4000-8000-000000000002';
const untieredId = '61000000-0000-4000-8000-000000000003';

async function mockOrders(page: Page, failTiers = false) {
  const requested: string[] = [];
  const orders = [
    orderSummary({ id: diamondId, orderNumber: 'SF-TIER-001', customerName: 'Diamond customer laboratory with a long name', status: 'packed', createdAt: new Date().toISOString() }),
    orderSummary({ id: silverId, orderNumber: 'SF-TIER-002', customerName: 'Silver laboratory', status: 'packed', createdAt: new Date().toISOString() }),
    orderSummary({ id: untieredId, orderNumber: 'SF-TIER-003', customerName: 'Untiered laboratory', status: 'packed', createdAt: new Date().toISOString() }),
  ];
  await page.route('**/api/customer-tiers', route => {
    const { orderIds } = route.request().postDataJSON() as { orderIds: string[] };
    requested.push(...orderIds);
    return route.fulfill(failTiers
      ? { status: 500, json: { error: 'Unavailable' } }
      : { json: { month: '2026-11-01', tiers: { ...(orderIds.includes(diamondId) ? { [diamondId]: 'diamond' } : {}), ...(orderIds.includes(silverId) ? { [silverId]: 'silver' } : {}) } } });
  });
  await page.route('**/api/orders**', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
    const rows = url.searchParams.get('status') === 'history' ? [] : orders;
    return route.fulfill({ json: orderBootstrap({
      actor: { email: 'staff@example.test', role: 'operations', roles: ['operations'] },
      orders: rows, pagination: { total: rows.length, page: 1, pageCount: 1, pageSize: 20 },
    }) });
  });
  return requested;
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`Orders tier badges and cached filter changes at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const requested = await mockOrders(page);
    await page.goto('/?view=orders-workspace');
    const diamond = page.getByRole('button', { name: /^SF-TIER-001,/ });
    const silver = page.getByRole('button', { name: /^SF-TIER-002,/ });
    const untiered = page.getByRole('button', { name: /^SF-TIER-003,/ });
    const badge = diamond.getByTitle('Diamond lab', { exact: true });
    await expect(badge).toBeVisible();
    await expect(badge.locator('svg')).toHaveCount(4);
    await expect(untiered).toBeVisible();
    await expect(silver.getByTitle('Silver lab', { exact: true }).locator('svg')).toHaveCount(1);
    await expect(untiered.locator('[title$=" lab"]')).toHaveCount(0);
    // A long name truncates without clipping the icon at either viewport.
    const rowBox = await diamond.boundingBox();
    const badgeBox = await badge.boundingBox();
    expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width);
    await expect.poll(() => requested.filter(id => id === untieredId).length).toBe(1);
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByLabel('Show orders', { exact: true }).selectOption('history');
    await expect(page.getByText('No matching orders', { exact: true })).toBeVisible();
    await page.getByLabel('Show orders', { exact: true }).selectOption('open');
    await expect(badge).toBeVisible();
    expect(requested.filter(id => id === diamondId)).toHaveLength(1);
    expect(requested.filter(id => id === untieredId)).toHaveLength(1);
    if (viewport.width < 1024) {
      await diamond.click();
      const headerBadge = page.getByRole('dialog', { name: 'Order SF-TIER-001', exact: true }).getByTitle('Diamond lab');
      await expect(headerBadge).toBeVisible();
      await expect(headerBadge.getByText('Diamond', { exact: true })).toBeVisible();
    }
  });


  test(`Orders survive optional tier failure at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const requested = await mockOrders(page, true);
    await page.goto('/?view=orders-workspace');
    await expect(page.getByRole('button', { name: /^SF-TIER-001,/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^SF-TIER-002,/ })).toBeVisible();
    await expect.poll(() => requested.length).toBe(3);
    expect([...new Set(requested)].sort()).toEqual([diamondId, silverId, untieredId].sort());
    await expect(page.getByTitle('Diamond lab')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}
