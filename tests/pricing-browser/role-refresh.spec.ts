import { expect, test } from '@playwright/test';

async function setup(page: import('@playwright/test').Page, roles: string[]) {
  let checks = 0;
  await page.route('**/api/accounts**', route => route.fulfill({ json: { accounts: [], page: { page: 1, pageSize: 50, total: 0 }, owners: [], territories: [], canAssign: true, canEraseContacts: false, canSeePowerMap: false, actorEmail: 'sales@example.test', today: '2026-10-30', classPolicy: { aMinPaise: '20000000', bMinPaise: '7500000' } } }));
  await page.route('**/api/push-subscription**', route => route.fulfill({ json: { enabled: false, publicKey: '' } }));
  await page.route('**/api/orders**', route => route.fulfill({ json: {} }));
  await page.route('**/api/me', async route => {
    checks += 1;
    const role = checks === 1 ? 'sales' : roles[1];
    await route.fulfill({ json: { email: 'sales@example.test', role, roles: [role] } });
  });
  await page.goto('/?view=frame&role=sales&roles=sales');
  await expect(page.getByTitle('Suprabha stock dashboard')).toBeVisible();
  await expect.poll(() => checks).toBeGreaterThan(0);
  return () => checks;
}

test('visible changed roles show the reload bar and Reload navigates', async ({ page }) => {
  await page.clock.install();
  const checks = await setup(page, ['sales', 'billing']);
  await page.clock.fastForward(300_001);
  await expect.poll(checks).toBeGreaterThan(1);
  await expect(page.getByText('Your access has changed. Reload to update.')).toBeVisible();
  const reload = page.getByRole('button', { name: 'Reload' });
  const navigated = page.waitForEvent('framenavigated');
  await reload.click();
  await navigated;
});

test('identical roles do not reload or show the reload bar', async ({ page }) => {
  await page.clock.install();
  const checks = await setup(page, ['sales', 'sales']);
  await page.clock.fastForward(300_001);
  await expect.poll(checks).toBeGreaterThan(1);
  await expect(page.getByText('Your access has changed. Reload to update.')).toHaveCount(0);
});
