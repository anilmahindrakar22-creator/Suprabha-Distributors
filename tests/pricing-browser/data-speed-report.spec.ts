import { expect, test, type Page } from '@playwright/test';
import type { AccountsResponse } from '../../lib/account-types';

const accounts: AccountsResponse = { accounts: [], page: { page: 1, pageSize: 50, total: 0 }, owners: [], territories: [], canAssign: true, canEraseContacts: false, canSeePowerMap: false, actorEmail: 'manager@example.test', today: '2026-11-18', classPolicy: { aMinPaise: '20000000', bMinPaise: '7500000' } };
const report = {
  statsAvailable: true, statsResetAt: '2026-11-01T00:00:00Z', windowFrom: '2026-11-11T00:00:00Z',
  reads: [{ gateway: 'economics', calls: 7, meanMs: 1977, previousMeanMs: 714, maxMs: 4200 }, { gateway: 'today', calls: 5, meanMs: 714, previousMeanMs: null, maxMs: 900 }],
  budget: { meanMs: 1000, maxMs: 3000 }, lastImportAt: new Date(Date.now() - 8 * 3600_000).toISOString(), lastRebuildAt: '2026-11-18T04:30:00Z',
  exceptions: [{ reason: 'Canonical customer GUID unavailable in the master export.', total: 4, under7Days: 1, from7To30Days: 2, over30Days: 1, acknowledgeable: 0 }], snapshotCount: 0,
};
async function setup(page: Page, speedStatus = 200, canAssign = true) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/api/power-map**', route => route.fulfill({ json: { contacts: [], links: [], route: null } }));
  await page.route('**/api/accounts**', route => route.fulfill({ json: { ...accounts, canAssign } }));
  await page.route('**/api/data-checks', route => route.fulfill({ status: 403, json: { error: 'Restricted' } }));
  await page.route('**/api/data-speed**', route => route.fulfill({ status: speedStatus, json: speedStatus === 200 ? report : { error: 'Unavailable' } }));
  await page.route('**/api/customer-links**', route => route.fulfill({ json: { companyId: null, sourceVersion: null, rows: [], waiting: true } }));
  await page.goto('/?view=accounts');
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
}
test('data and speed report shows freshness, timings, budgets and aged problems', async ({ page }) => {
  await setup(page);
  const card = page.getByRole('region', { name: 'Data and speed' });
  const details = card.locator('details');
  await expect(details).not.toHaveAttribute('open', '');
  const summary = card.locator('summary');
  await expect(summary).toContainText('1 screen over budget');
  await expect(summary).toContainText('No import for 8 h');
  await expect(summary).toContainText('4 open import problems');
  await summary.click();
  await expect(card.getByText('Instrument economics')).toBeVisible();
  await expect(card.getByRole('row', { name: /Instrument economics/ }).getByRole('cell').nth(1)).toHaveText('2.0 s');
  await expect(card.getByRole('row', { name: /Today/ }).getByRole('cell').nth(1)).toHaveText('714 ms');
  await expect(card.getByRole('row', { name: /Instrument economics/ }).getByRole('cell').nth(2)).toHaveText('714 ms');
  await expect(card.getByText('Over 1 s average')).toBeVisible();
  await expect(card.getByText(/No Tally import for 8 hours/)).toBeVisible();
  await expect(card.getByText(/The party ledger on this invoice/)).toBeVisible();
  const problemRow = card.getByRole('row', { name: /The party ledger on this invoice/ });
  await expect(problemRow.getByRole('cell')).toHaveText([/The party ledger on this invoice/, '4', '1', '2', '1', '']);
  await expect(card.getByText(/first weekly comparison appears/)).toBeVisible();
});
test('unavailable stats and failed request recover on retry', async ({ page }) => {
  await setup(page);
  await page.route('**/api/data-speed**', route => route.fulfill({ json: { ...report, statsAvailable: false } }));
  await page.reload();
  const card = page.getByRole('region', { name: 'Data and speed' });
  await expect(card.locator('summary')).toContainText('Speed unavailable');
  await card.locator('summary').click();
  await expect(card.getByText('Speed figures are not available.')).toBeVisible();
  await setup(page, 503);
  await expect(page.getByText('Data & speed is unavailable.')).toBeVisible();
  await page.route('**/api/data-speed**', route => route.fulfill({ json: report }));
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Data and speed' })).toBeVisible();
});
test('phone tables scroll internally and the page has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setup(page);
  const card = page.getByRole('region', { name: 'Data and speed' });
  await expect(card.locator('.overflow-x-auto')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
test('card is absent when Accounts does not allow assignment', async ({ page }) => {
  await setup(page, 200, false);
  await expect(page.getByRole('region', { name: 'Data and speed' })).toHaveCount(0);
});

test('manager acknowledges a reviewed stale problem and reloads the report', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/api/power-map**', route => route.fulfill({ json: { contacts: [], links: [], route: null } }));
  await page.route('**/api/accounts**', route => route.fulfill({ json: accounts }));
  await page.route('**/api/data-checks', route => route.fulfill({ status: 403, json: { error: 'Restricted' } }));
  await page.route('**/api/customer-links**', route => route.fulfill({ json: { companyId: null, sourceVersion: null, rows: [], waiting: true } }));
  let gets = 0;
  let posted: unknown;
  await page.route('**/api/data-speed', async route => {
    if (route.request().method() === 'POST') { posted = route.request().postDataJSON(); await route.fulfill({ json: { actionId: 'ack-1', acknowledged: 2 } }); }
    else { gets++; await route.fulfill({ json: { ...report, exceptions: [{ ...report.exceptions[0], acknowledgeable: 2 }] } }); }
  });
  await page.goto('/?view=accounts');
  const card = page.getByRole('region', { name: 'Data and speed' });
  await card.locator('summary').click();
  const row = card.getByRole('row', { name: /The party ledger on this invoice/ });
  await expect(row.getByRole('button', { name: /Acknowledge \(2\)/ })).toBeVisible();
  await row.getByRole('button', { name: /Acknowledge \(2\)/ }).click();
  const save = card.getByRole('button', { name: 'Acknowledge', exact: true });
  await card.getByLabel('Why they no longer need action').fill('short');
  await expect(save).toBeDisabled();
  const note = 'The owner confirmed these records need no further action.';
  await card.getByLabel('Why they no longer need action').fill(note);
  await expect(save).toBeEnabled();
  await save.click();
  await expect(card.getByRole('status')).toHaveText('Acknowledged 2.');
  await expect.poll(() => gets).toBe(2);
  expect(posted).toMatchObject({ action: 'acknowledge', reason: 'Canonical customer GUID unavailable in the master export.', expectedCount: 2, note });
  expect((posted as { requestId: string }).requestId).toMatch(/^[0-9a-f-]{36}$/i);
});

test('409 acknowledgement reloads and shows the changed count message', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/api/power-map**', route => route.fulfill({ json: { contacts: [], links: [], route: null } }));
  await page.route('**/api/accounts**', route => route.fulfill({ json: accounts }));
  await page.route('**/api/data-checks', route => route.fulfill({ status: 403, json: { error: 'Restricted' } }));
  await page.route('**/api/customer-links**', route => route.fulfill({ json: { companyId: null, sourceVersion: null, rows: [], waiting: true } }));
  let gets = 0;
  await page.route('**/api/data-speed', async route => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 409, json: { error: 'Problem count changed; reload' } });
    else { gets++; await route.fulfill({ json: { ...report, exceptions: [{ ...report.exceptions[0], acknowledgeable: 1 }] } }); }
  });
  await page.goto('/?view=accounts');
  const card = page.getByRole('region', { name: 'Data and speed' });
  await card.locator('summary').click();
  await card.getByRole('button', { name: /Acknowledge \(1\)/ }).click();
  await card.getByLabel('Why they no longer need action').fill('Reviewed after checking the owner decision.');
  await card.getByRole('button', { name: 'Acknowledge', exact: true }).click();
  await expect(card.getByRole('status')).toHaveText('The count changed. Reloaded — check again.');
  await expect.poll(() => gets).toBe(2);
});

test('phone acknowledgement panel stays within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setup(page);
  await page.route('**/api/data-speed**', route => route.fulfill({ json: { ...report, exceptions: [{ ...report.exceptions[0], acknowledgeable: 1 }] } }));
  await page.reload();
  const card = page.getByRole('region', { name: 'Data and speed' });
  await card.locator('summary').click();
  await card.getByRole('button', { name: /Acknowledge \(1\)/ }).click();
  await expect(card.getByText(/They stay on record; nothing is deleted/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect(card.getByLabel('Why they no longer need action')).toBeInViewport();
});
