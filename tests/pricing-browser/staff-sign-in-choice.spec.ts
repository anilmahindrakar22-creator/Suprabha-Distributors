import { expect, test } from '@playwright/test';

test('staff sign-in offers a top-level ChatGPT peer without submitting credentials', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/staff-auth', route => { requests++; return route.abort(); });
  await page.goto('/?view=staff-signin-choice');
  const link = page.getByRole('link', { name: 'Sign in with ChatGPT', exact: true });
  await expect(link).toHaveAttribute('href', 'https://stockflow.chatgpt.site/signin-with-chatgpt?return_to=%2F');
  await expect(link).toHaveAttribute('target', '_top');
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(requests).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('staff sign-out waits at most 15 seconds, blocks duplicate clicks and preserves failure notice', async ({ page }) => {
  await page.route('**/stockflow.html', route => route.fulfill({ contentType: 'text/html', body: '<p>Fixture</p>' }));
  await page.addInitScript(() => {
    const original = window.fetch;
    Object.assign(window, { signOutRequests: 0 });
    window.fetch = (input, init) => {
      if (input === '/api/staff-auth' && init?.method === 'DELETE') {
        const state = window as typeof window & { signOutRequests: number };
        state.signOutRequests++;
        return new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true }));
      }
      return original(input, init);
    };
  });
  await page.goto('/?view=staff-frame');
  await page.clock.install();
  const button = page.getByRole('button', { name: 'Sign out staff@example.test', exact: true });
  await button.click();
  await expect(button).toBeDisabled();
  await page.clock.fastForward(15001);
  await expect(button).toBeEnabled();
  await expect(page.locator('output')).toContainText('Sign-out failed. Please retry before sharing this device.');
  expect(await page.evaluate(() => (window as typeof window & { signOutRequests: number }).signOutRequests)).toBe(1);
  expect(new URL(page.url()).searchParams.get('view')).toBe('staff-frame');
});
