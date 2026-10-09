import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('session restoration hides the login form until a decision is available', async ({ page }) => {
  let release!: () => void;
  await page.route('**/api/staff-auth/refresh', async route => {
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ status: 401, json: { error: 'Sign in required' } });
  });
  await page.goto('/?view=staff-signin-resume');
  await expect(page.getByRole('status')).toHaveText('Opening StockFlow…');
  await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
  await expect.poll(() => typeof release).toBe('function');
  release();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
});

for (const width of [320, 375, 768, 1280]) {
  test(`app header and stock footer remain reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 532 });
    await page.route('**/api/staff-auth', route => route.fulfill({ json: { ok: true, renewAfterSeconds: 3000 } }));
    await page.route('**/api/stock', route => route.fulfill({ json: { rows: [], groups: [] } }));
    await page.route('**/stockflow.html', route => route.fulfill({ contentType: 'text/html', body: readFileSync('public/stockflow.html', 'utf8') }));
    await page.goto('/?view=staff-frame');
    const header = page.locator('header').first();
    const box = await header.boundingBox();
    expect(box?.y).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    await expect(page.getByRole('button', { name: 'Sign out staff@example.test', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('heading', { name: 'Stock & reorder', exact: true })).toBeVisible();
    await expect(frame.getByLabel('Find an item', { exact: true })).toBeInViewport();
    await expect(frame.locator('.mobile-nav')).toHaveCount(0);
    const stockViews = frame.getByRole('navigation', { name: 'Stock views' });
    for (const [label, view] of [['Daily', 'operations'], ['Insights', 'insights'], ['Groups', 'groups'], ['Reorder list', 'orders']]) {
      const button = stockViews.getByRole('button', { name: label, exact: true });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport();
      await button.click();
      await expect(frame.locator(`#${view}View`)).toHaveClass('view active');
      expect(await frame.locator(`#${view}View`).evaluate(element => getComputedStyle(element).display)).toBe('block');
    }
    expect(await stockViews.evaluate(nav => getComputedStyle(nav).position)).toBe('static');
    await frame.locator('.footer').scrollIntoViewIfNeeded();
    await expect(frame.locator('.footer')).toBeInViewport();
  });
}

test('active staff app renews on schedule without returning to login', async ({ page }) => {
  let renewals = 0;
  let checks = 0;
  await page.route('**/stockflow.html', route => route.fulfill({ contentType: 'text/html', body: '<p>Fixture</p>' }));
  await page.route('**/api/staff-auth', route => { checks++; return route.fulfill({ json: { ok: true, renewAfterSeconds: 30 } }); });
  await page.route('**/api/staff-auth/refresh', route => { renewals++; return route.fulfill({ json: { ok: true } }); });
  await page.clock.install();
  await page.goto('/?view=staff-frame');
  await expect.poll(() => checks).toBe(1);
  await page.clock.fastForward(30001);
  await expect.poll(() => renewals).toBe(1);
  await expect.poll(() => checks).toBe(3);
  expect(new URL(page.url()).searchParams.get('view')).toBe('staff-frame');
});

test('active app does not poll through a verification outage', async ({ page }) => {
  let checks = 0;
  await page.route('**/stockflow.html', route => route.fulfill({ contentType: 'text/html', body: '<p>Fixture</p>' }));
  await page.route('**/api/staff-auth', route => { checks++; return route.fulfill({ status: 503, json: { error: 'Unavailable' } }); });
  await page.clock.install();
  await page.goto('/?view=staff-frame');
  await expect(page.locator('output')).toContainText('saved drafts remain unchanged');
  await page.clock.fastForward(300000);
  expect(checks).toBe(1);
  expect(new URL(page.url()).searchParams.get('view')).toBe('staff-frame');
});

test('reopening restores a renewable session without entering a password', async ({ page }) => {
  let renewals = 0;
  await page.route('**/api/staff-auth/refresh', route => { renewals++; return route.fulfill({ json: { ok: true } }); });
  await page.route('**/api/staff-auth', route => route.fulfill({ json: { ok: true } }));
  await page.goto('/?view=staff-signin-resume');
  await expect(page).toHaveURL(new URL('/', test.info().project.use.baseURL).href);
  expect(renewals).toBe(1);
});

test('rejected renewal shows the sign-in form without a retry loop', async ({ page }) => {
  let renewals = 0;
  await page.route('**/api/staff-auth/refresh', route => { renewals++; return route.fulfill({ status: 403, json: { error: 'Access denied' } }); });
  await page.goto('/?view=staff-signin-resume');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  expect(renewals).toBe(1);
});

test('renewal outage is visible and does not retry automatically', async ({ page }) => {
  let renewals = 0;
  await page.route('**/api/staff-auth/refresh', route => { renewals++; return route.fulfill({ status: 503, json: { error: 'Unavailable' } }); });
  await page.goto('/?view=staff-signin-resume');
  await expect(page.getByRole('alert')).toContainText('drafts remain unchanged');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  expect(renewals).toBe(1);
});

test('accepted password with missing session stays on the form with a visible handoff error', async ({ page }) => {
  const methods: string[] = [];
  await page.route('**/api/staff-auth', route => {
    methods.push(route.request().method());
    return route.fulfill({ status: route.request().method() === 'POST' ? 200 : 401, json: { ok: route.request().method() === 'POST' } });
  });
  await page.goto('/?view=staff-signin');
  await page.getByLabel('Email', { exact: true }).fill('staff@example.test');
  await page.getByLabel('Password', { exact: true }).fill('test-only-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not verify the sign-in session');
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('staff@example.test');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  expect(methods).toEqual(['POST', 'GET']);
  expect(new URL(page.url()).searchParams.get('view')).toBe('staff-signin');
});

test('verified session completes the sign-in handoff', async ({ page }) => {
  const methods: string[] = [];
  await page.route('**/api/staff-auth', route => {
    methods.push(route.request().method());
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/?view=staff-signin');
  await page.getByLabel('Email', { exact: true }).fill('staff@example.test');
  await page.getByLabel('Password', { exact: true }).fill('test-only-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(new URL('/', test.info().project.use.baseURL).href);
  expect(methods).toEqual(['POST', 'GET']);
});

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
  // Web Lock acquisition and draft protection finish before the network timer starts.
  await expect.poll(() => page.evaluate(() => (window as typeof window & { signOutRequests: number }).signOutRequests)).toBe(1);
  await page.clock.fastForward(15001);
  await expect(button).toBeEnabled();
  await expect(page.locator('output')).toContainText('Sign-out failed. Please retry before sharing this device.');
  expect(await page.evaluate(() => (window as typeof window & { signOutRequests: number }).signOutRequests)).toBe(1);
  expect(new URL(page.url()).searchParams.get('view')).toBe('staff-frame');
});
