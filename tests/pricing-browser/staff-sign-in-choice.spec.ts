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
  await expect(page.getByText('Opens the older StockFlow site. It does not sign you into this staff site.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('ChatGPT handoff responds immediately, blocks duplicate clicks and offers a timed fallback', async ({ page }) => {
  await page.clock.install();
  await page.goto('/?view=staff-signin-choice');
  // Simulate a stalled external navigation without invoking the real identity provider.
  await page.evaluate(() => document.addEventListener('click', event => event.preventDefault()));
  await page.getByRole('link', { name: 'Sign in with ChatGPT', exact: true }).click();
  const opening = page.getByRole('link', { name: 'Opening ChatGPT…', exact: true });
  await expect(opening).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('status')).toContainText('Your staff email and password are not sent');
  await opening.dispatchEvent('click');
  await page.clock.fastForward(8000);
  await expect(page.getByRole('status')).toContainText('Use staff email and password above');
  await expect(page.getByRole('link', { name: 'Sign in with ChatGPT', exact: true })).toHaveAttribute('aria-disabled', 'false');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
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
