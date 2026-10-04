import { expect, test } from '@playwright/test';

for (const invitationFails of [false, true]) {
  test(`staff user access is saved before invitation; email failure=${invitationFails}`, async ({ page }) => {
    const calls: string[] = [];
    await page.route('**/api/users', async route => {
      if (route.request().method() === 'POST') {
        calls.push('save');
        expect(route.request().postDataJSON()).toMatchObject({ email: 'staff@example.test', role: 'viewer', status: 'active' });
        await route.fulfill({ json: { ok: true } });
      } else await route.fulfill({ json: { users: [{ id: 1, email: 'staff@example.test', role: 'viewer', status: 'active' }] } });
    });
    await page.route('**/api/staff-invitation', async route => {
      calls.push('invite');
      expect(route.request().postDataJSON()).toEqual({ email: 'staff@example.test' });
      await route.fulfill({ status: invitationFails ? 503 : 200, json: invitationFails ? { error: 'Invitation outcome is unconfirmed' } : { message: 'Invitation requested.' } });
    });
    await page.goto('/?view=staff-users');
    await page.getByLabel('Email', { exact: true }).fill('staff@example.test');
    await page.getByRole('button', { name: 'Add and invite' }).click();
    await expect(page.locator('output')).toContainText(invitationFails ? 'User access saved. Invitation outcome is unconfirmed' : 'User access saved. Invitation requested.');
    expect(calls).toEqual(['save', 'invite']);
    if (invitationFails) {
      await expect(page.getByRole('button', { name: 'Add and invite' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Invite / resend to staff@example.test' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Send reset link to staff@example.test' })).toBeEnabled();
    }
  });
}

test('staff user membership remains available while email actions are disabled', async ({ page }) => {
  const calls: string[] = [];
  await page.route('**/api/users', async route => {
    if (route.request().method() === 'POST') {
      calls.push('save');
      expect(route.request().postDataJSON()).toMatchObject({ email: 'staff@example.test', role: 'viewer', status: 'active' });
      await route.fulfill({ json: { ok: true } });
    } else await route.fulfill({ json: { users: [{ id: 1, email: 'staff@example.test', role: 'viewer', status: 'active' }] } });
  });
  await page.route('**/api/staff-invitation', async route => {
    calls.push('invite');
    await route.fulfill({ json: { message: 'Invitation requested.' } });
  });
  await page.route('**/api/staff-password-reset', async route => {
    calls.push('reset');
    await route.fulfill({ json: { message: 'Reset requested.' } });
  });

  await page.goto('/?view=staff-users-disabled');
  await expect(page.getByText('Staff invitation and reset emails are not enabled yet.')).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill('staff@example.test');
  await page.getByRole('button', { name: 'Add user', exact: true }).click();
  await expect(page.locator('output')).toContainText('User access updated.');
  await expect(page.getByRole('button', { name: 'Invite / resend to staff@example.test' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send reset link to staff@example.test' })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Role for staff@example.test' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Suspend', exact: true })).toBeEnabled();
  expect(calls).toEqual(['save']);
});

for (const view of ['staff-signin', 'staff-reset']) {
  test(`${view} has a bounded wait and does not duplicate in-flight requests`, async ({ page }) => {
    await page.addInitScript(() => {
      const original = window.fetch;
      Object.assign(window, { authRequestCount: 0 });
      window.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
        if (url.startsWith('/api/staff-')) {
          const state = window as typeof window & { authRequestCount: number };
          state.authRequestCount++;
          return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true }));
        }
        return original(input, init);
      };
    });
    await page.goto(`/?view=${view}${view === 'staff-reset' ? '#type=recovery&access_token=synthetic-recovery' : ''}`);
    const button = page.getByRole('button', { name: view === 'staff-reset' ? 'Set password' : 'Sign in', exact: true });
    await expect(button).toBeEnabled();
    await page.clock.install();
    if (view === 'staff-signin') {
      await page.getByLabel('Email', { exact: true }).fill('staff@example.test');
      await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
    } else {
      await page.getByLabel('New password', { exact: true }).fill('synthetic-password');
      await page.getByLabel('Confirm password', { exact: true }).fill('synthetic-password');
    }
    await button.click();
    await page.locator('form').evaluate(form => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(await page.evaluate(() => (window as typeof window & { authRequestCount: number }).authRequestCount)).toBe(1);
    await page.clock.runFor(16000);
    await expect(page.getByRole('alert')).toContainText(view === 'staff-reset' ? 'unknown' : 'Unable to sign in');
    if (view === 'staff-reset') await expect(button).toBeDisabled();
    else await expect(button).toBeEnabled();
  });
}

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

for (const linkType of ['recovery', 'invite']) {
test(`${linkType} survives StrictMode, removes fragment and validates confirmation before sending`, async ({ page }) => {
  let requests = 0;
  await page.route('**/api/staff-password-reset', async route => {
    requests++;
    expect(route.request().postDataJSON()).toEqual({ token: 'synthetic-recovery', password: 'new-synthetic-password' });
    await route.fulfill({ status: 400, json: { error: 'Request a new recovery link' } });
  });
  await page.goto(`/?view=staff-reset#type=${linkType}&access_token=synthetic-recovery`);
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
}

test('unrelated email-link type cannot enable password setup', async ({ page }) => {
  await page.goto('/?view=staff-reset#type=signup&access_token=synthetic-token');
  await expect(page.getByRole('button', { name: 'Set password' })).toBeDisabled();
  expect(new URL(page.url()).hash).toBe('');
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
