import { expect, test, type Page } from '@playwright/test';

async function mockFrame(page: Page) {
  await page.route('**/api/me', route => route.fulfill({ json: { roles: ['sales'] } }));
  await page.route('**/api/push-subscription**', route => route.fulfill({ json: { enabled: false, publicKey: '' } }));
  await page.route('**/api/data-checks**', route => route.fulfill({ status: 403, json: {} }));
  await page.route('**/api/data-speed**', route => route.fulfill({ status: 503, json: {} }));
}

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 800 }]] as const) {
  test(`Role guide card on ${name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockFrame(page);
    await page.goto('/?view=frame&role=sales&roles=sales&roleGuide=show');
    const card = page.getByRole('region', { name: 'What you can do' });
    await expect(card).toBeVisible();
    await expect(card.getByText('Your roles: Sales')).toBeVisible();
    await expect(card.getByText('Users', { exact: true })).toHaveCount(0);
    if (name === 'phone') expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await card.getByRole('button', { name: 'Got it' }).click();
    await expect(card).toBeHidden();
    await page.reload();
    await expect(page.getByRole('button', { name: 'What I can do' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'What you can do' })).toBeHidden();

    await page.getByRole('button', { name: 'What I can do' }).click();
    await expect(page.getByRole('region', { name: 'What you can do' })).toBeVisible();
    if (name === 'phone') expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
