import { test, expect, type Page } from '@playwright/test';
import type { ObservedChanges, ObservedChangeRow } from '../../lib/observed-change-types';

const base: ObservedChangeRow = {
  customerName: 'Test Lab A', itemKey: 'Reagent A', changedOn: '2026-06-01', windowDays: 90,
  direction: 'up', volume: 'fell', beforeRatePaise: 10000, afterRatePaise: 11000, changePct: 10,
  beforeQty: 30, afterQty: 15, beforeRevenuePaise: 300000, afterRevenuePaise: 165000,
  beforeGpPaise: 60000, afterGpPaise: 33000,
};
const observed: ObservedChanges = {
  view: 'observed_changes', asOf: '2026-11-19', salesThrough: '2026-11-19', page: 1, pageSize: 10, total: 12,
  summary: { changes: 78, increases: 65, decreases: 13, increasesFell: 12, increasesHeld: 16, increasesRose: 37, labs: 26, unitChanges: 0 },
  rows: [base, { ...base, customerName: 'Test Lab B', volume: 'held', afterGpPaise: null },
    { ...base, customerName: 'VeryLongLaboratoryNameWithoutSpaces'.repeat(5), itemKey: 'VeryLongReagentName'.repeat(5), direction: 'down', volume: 'rose', changePct: -4.2 }],
};

async function setup(page: Page, role: 'management' | 'administrator' | 'accounts' | 'operations' = 'management', status = 200) {
  const requests: string[] = [];
  await page.route('**/api/me', route => route.fulfill({ json: { roles: [role] } }));
  await page.route('**/api/push-subscription**', route => route.fulfill({ json: { enabled: false, publicKey: '' } }));
  await page.route('**/api/today**', route => route.fulfill({ json: { policyVersion: 'today-v1', generatedAt: '2026-11-18T09:00:00Z', coverageCertified: true, unblock: { total: 0, rows: [] }, grow: { total: 0, rows: [] } } }));
  await page.route('**/api/orders**', route => {
    const params = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: params.has('customers') ? { customers: [] } : params.has('priceInbox') ? { orders: [] } : { orders: [], snapshot: { company: 'Test', fetchedAt: '2026-11-18T09:00:00Z', catalog: [] }, customers: [], operations: {}, actor: { email: 'staff@example.test', role, roles: [role] } } });
  });
  await page.route('**/api/pricing**', route => {
    expect(route.request().method()).toBe('GET');
    const params = new URL(route.request().url()).searchParams;
    if (params.get('observed') === '1') {
      requests.push(route.request().url());
      const rows = observed.rows.filter(row => (!params.has('volume') || row.volume === params.get('volume')) && (!params.has('direction') || row.direction === params.get('direction')));
      return route.fulfill({ status, json: { ...observed, rows, page: Number(params.get('page') || 1) } });
    }
    return route.fulfill({ json: params.has('contracts') ? { contracts: [] } : params.has('policies') ? { policies: [] } : { orders: [], checkedCount: 0 } });
  });
  await page.goto(`/?view=workspace&role=${role}`);
  return requests;
}

test('management expands lazily, sees volumes and GP, filters and pages', async ({ page }) => {
  const requests = await setup(page);
  const panel = page.getByRole('region', { name: 'Changes seen in Tally', exact: true });
  const header = panel.getByRole('button', { name: /^Changes seen in Tally/ });
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  expect(requests).toEqual([]);
  await header.click();
  await expect(panel).toContainText('65 increases: volume fell in 12, held in 16, rose in 37 · 13 decreases');
  await expect(header).toHaveText('Changes seen in Tally · 78');
  const rows = panel.getByRole('list', { name: 'Price changes seen in Tally' }).getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('1 Jun · ₹100 → ₹110 (+10.0%) · qty 30 → 15');
  await rows.first().getByRole('button').click();
  await expect(rows.first()).toContainText('Over 90 days before and after · sales ₹3,000 → ₹1,650 · GP ₹600 → ₹330');
  await rows.nth(1).getByRole('button').click();
  await expect(rows.nth(1)).toContainText('GP not shown: cost missing');
  await panel.getByRole('button', { name: 'Next', exact: true }).click();
  await expect.poll(() => new URL(requests.at(-1)!).searchParams.get('page')).toBe('2');
  await expect(panel.getByRole('button', { name: 'Previous', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'Volume fell', exact: true }).click();
  await expect.poll(() => new URL(requests.at(-1)!).searchParams.get('volume')).toBe('fell');
  expect(new URL(requests.at(-1)!).searchParams.get('page')).toBe('1');
  await expect(rows).toHaveCount(1);
  await expect(panel.getByRole('button', { name: 'Volume fell', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('button', { name: 'Increases', exact: true }).click();
  await expect(rows).toHaveCount(2);
  expect(new URL(requests.at(-1)!).searchParams.get('direction')).toBe('up');
  expect(new URL(requests.at(-1)!).searchParams.has('volume')).toBe(false);
  await panel.getByRole('button', { name: 'Increases', exact: true }).click();
  await expect(rows).toHaveCount(3);
  expect(new URL(requests.at(-1)!).searchParams.has('direction')).toBe(false);
  const count = requests.length;
  await header.click();
  await header.click();
  await expect(rows).toHaveCount(3);
  expect(requests).toHaveLength(count);
});

for (const role of ['accounts', 'operations'] as const) {
  test(`${role} does not see or request observed changes`, async ({ page }) => {
    const requests = await setup(page, role);
    await expect(page.getByRole('heading', { name: 'Pricing', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Changes seen in Tally', exact: true })).toHaveCount(0);
    expect(requests).toEqual([]);
  });
}

test('administrator sees the collapsed panel', async ({ page }) => {
  const requests = await setup(page, 'administrator');
  await expect(page.getByRole('button', { name: 'Changes seen in Tally', exact: true })).toHaveAttribute('aria-expanded', 'false');
  expect(requests).toEqual([]);
});

for (const status of [401, 403]) {
  test(`hides the panel on ${status}`, async ({ page }) => {
    await setup(page, 'management', status);
    await page.getByRole('button', { name: 'Changes seen in Tally', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Changes seen in Tally', exact: true })).toHaveCount(0);
  });
}

test('expanded panel wraps long names at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setup(page);
  const panel = page.getByRole('region', { name: 'Changes seen in Tally', exact: true });
  await panel.getByRole('button', { name: 'Changes seen in Tally', exact: true }).click();
  await expect(panel.getByRole('listitem')).toHaveCount(3);
  await panel.getByRole('listitem').last().getByRole('button').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 375)).toBe(true);
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});
