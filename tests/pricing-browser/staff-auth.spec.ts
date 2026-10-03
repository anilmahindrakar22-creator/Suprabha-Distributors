import { expect, test } from '@playwright/test';

test('staff login stays in browser, clears rejected password and fits mobile', async ({ page }) => {
  await page.route('**/api/staff-auth', route => route.fulfill({ status: 401, json: { error: 'denied' } }));
  await page.goto('/?view=staff-signin');
  await page.getByLabel('Email', { exact: true }).fill('staff@example.test');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Unable to sign in');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await expect(page).toHaveURL(/view=staff-signin/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('missing recovery link blocks submission', async ({ page }) => {
  await page.goto('/?view=staff-reset');
  await expect(page.getByRole('alert')).toContainText('Recovery link is missing');
  await expect(page.getByRole('button', { name: 'Set password' })).toBeDisabled();
});

test('recovery survives StrictMode, removes fragment and validates confirmation before sending', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/staff-password-reset', async route => {
    requests++;
    expect(route.request().postDataJSON()).toEqual({ token: 'synthetic-recovery', password: 'new-synthetic-password' });
    await route.fulfill({ status: 400, json: { error: 'Request a new recovery link' } });
  });
  await page.goto('/?view=staff-reset#type=recovery&access_token=synthetic-recovery');
  const button = page.getByRole('button', { name: 'Set password' });
  await expect(button).toBeEnabled();
  expect(new URL(page.url()).hash).toBe('');
  await page.getByLabel('New password', { exact: true }).fill('new-synthetic-password');
  await page.getByLabel('Confirm password', { exact: true }).fill('different-password');
  await button.click();
  await expect(page.getByRole('alert')).toHaveText('Passwords must match.');
  expect(requests).toBe(0);
  await page.getByLabel('Confirm password', { exact: true }).fill('new-synthetic-password');
  await button.click();
  await expect(page.getByRole('alert')).toHaveText('Request a new recovery link');
  expect(requests).toBe(1);
  await expect(page.getByLabel('New password', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

for (const failure of ['network', 'partial'] as const) {
  test(`uncertain ${failure} reset blocks blind resubmission`, async ({ page }) => {
    let requests = 0;
    await page.route('**/api/staff-password-reset', async route => {
      requests++;
      if (failure === 'network') await route.abort();
      else await route.fulfill({ status: 503, json: { error: 'Password changed, but session revocation is unconfirmed. Contact your administrator' } });
    });
    await page.goto('/?view=staff-reset#type=recovery&access_token=synthetic-recovery');
    const button = page.getByRole('button', { name: 'Set password' });
    await expect(button).toBeEnabled();
    await page.getByLabel('New password', { exact: true }).fill('new-synthetic-password');
    await page.getByLabel('Confirm password', { exact: true }).fill('new-synthetic-password');
    await button.click();
    await expect(page.getByRole('alert')).toContainText(failure === 'network' ? 'unknown' : 'unconfirmed');
    await expect(button).toBeDisabled();
    expect(requests).toBe(1);
  });
}

test('account-switch failure stays visible and retry remains available', async ({ page }) => {
  await page.route('**/api/staff-auth', route => route.abort());
  await page.goto('/?view=staff-switch');
  await page.getByRole('button', { name: 'Use another account' }).click();
  await expect(page.getByRole('alert')).toHaveText('Unable to sign out. Please retry.');
  await expect(page.getByRole('button', { name: 'Use another account' })).toBeEnabled();
});
