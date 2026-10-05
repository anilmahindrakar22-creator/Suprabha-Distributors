import { expect, test } from '@playwright/test';

test('button feedback keeps keyboard focus visible and respects reduced motion', async ({ page }) => {
  await page.goto('/?view=frame&role=administrator');
  const button = page.getByRole('button', { name: /^orders$/i });
  await button.focus();
  await expect(button).toBeFocused();
  await expect(button).toHaveCSS('outline-style', 'solid');
  await expect(button).toHaveCSS('outline-width', '2px');
  await expect(button).toHaveCSS('transition-duration', /^0\.12s(, 0\.12s)*$/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(button).toHaveCSS('transition-duration', '0s');
  await expect(button).toHaveCSS('translate', 'none');
});
