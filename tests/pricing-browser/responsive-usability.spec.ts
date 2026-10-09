import { expect, test } from '@playwright/test';

const longName = 'Laboratory' + 'Customer'.repeat(18);
const longEmail = 'staff'.repeat(24) + '@example.test';
for (const width of [320, 375, 768, 1280]) {
  test(`staff accounts wrap long emails and expose touch controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 532 });
    await page.route('**/api/users', route => route.fulfill({ json: { users: [{ id: 1, email: longEmail, role: 'sales', roles: ['sales', 'warehouse'], status: 'active' }] } }));
    await page.goto('/?view=staff-users');
    const email = page.locator('strong').filter({ hasText: longEmail });
    await expect(email).toBeVisible();
    expect(await email.evaluate(element => element.getBoundingClientRect().right <= innerWidth)).toBe(true);
    await page.getByText('Roles: sales, warehouse', { exact: true }).click();
    for (const name of ['Save roles', 'Suspend']) {
      const button = page.getByRole('button', { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport();
      expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`pricing evidence wraps and decisions have touch targets at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 532 });
    await page.route('**/api/orders?customers=1', route => route.fulfill({ json: { customers: [] } }));
    await page.route('**/api/pricing**', route => route.fulfill({ json: route.request().url().includes('policies=1') ? { policies: [] } : { contracts: [{ id: 'test', customerId: 'test', customerName: longName, tallyKey: 'REAGENT'.repeat(24), price: 445, validFrom: '2026-01-01', status: 'pending_approval', source: 'customer_contract', reason: 'Review', createdBy: longEmail, version: 1 }] } }));
    await page.goto('/?view=workspace');
    const approve = page.getByRole('button', { name: 'Approve', exact: true });
    await approve.scrollIntoViewIfNeeded();
    for (const name of ['Approve', 'Reject']) {
      const button = page.getByRole('button', { name, exact: true });
      await expect(button).toBeInViewport();
      expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByLabel(`Decision note for ${longName} — ${'REAGENT'.repeat(24)}`)).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
