import { expect, test } from '@playwright/test';

for (const role of ['administrator', 'sales', 'warehouse']) {
  test(`sign out is visible and uses the hosting session route for ${role}`, async ({ page }) => {
    await page.goto(`/?view=frame&role=${role}`);
    const link = page.getByRole('link', { name: 'Sign out staff@example.test', exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/signout-with-chatgpt?return_to=/');
    await expect(link).toHaveAttribute('target', '_top');
    await expect(link).toHaveAttribute('title', 'Signed in as staff@example.test');
    const bounds = await link.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  });
}
