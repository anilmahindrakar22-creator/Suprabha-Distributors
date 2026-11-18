import { test, expect, type Page } from '@playwright/test';
import type { PriceOutcomes, PriceOutcomeRow } from '../../lib/price-outcome-types';

const base: PriceOutcomeRow = {
  priceId: '11111111-1111-4111-8111-111111111111', customerId: '22222222-2222-4222-8222-222222222222',
  customerName: 'Test Laboratory', itemKey: 'Reagent', approvedPaise: 220000, effectiveFrom: '2026-10-27', validTo: null,
  state: 'different', reason: null, lines: 5, packLines: 0, lastBilledOn: '2026-11-14', lastBilledPaise: 205000,
  worstDiffPaise: -15000, differentLines: 3,
};
const outcomes: PriceOutcomes = {
  view: 'price_outcomes', asOf: '2026-11-18', toleranceRupees: 1, page: 1, pageSize: 10, total: 4,
  counts: { different: 1, not_billed: 1, matches: 1, cannot_match: 1 }, salesThrough: '2026-11-14', matureCount: 0,
  rows: [base,
    { ...base, priceId: '33333333-3333-4333-8333-333333333333', state: 'not_billed', lines: 0, differentLines: 0, lastBilledOn: null, lastBilledPaise: null, worstDiffPaise: null },
    { ...base, priceId: '44444444-4444-4444-8444-444444444444', state: 'matches', packLines: 1, lastBilledPaise: 220050, worstDiffPaise: 50, differentLines: 0 },
    { ...base, priceId: '55555555-5555-4555-8555-555555555555', state: 'cannot_match', reason: 'no_ledger_link', lines: 0, differentLines: 0, lastBilledOn: null, lastBilledPaise: null, worstDiffPaise: null }],
};

async function setup(page: Page, role: 'management' | 'accounts' | 'operations' = 'management') {
  const requests: string[] = [];
  // Same direct Pricing workspace entry and API route mocks as price-book.
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
    if (params.get('outcomes') === '1') {
      requests.push(route.request().url());
      const rows = params.has('state') ? outcomes.rows.filter(row => row.state === params.get('state')) : outcomes.rows;
      return route.fulfill({ json: { ...outcomes, rows, total: rows.length, page: Number(params.get('page') || 1) } });
    }
    return route.fulfill({ json: params.has('contracts') ? { contracts: [] } : params.has('policies') ? { policies: [] } : { orders: [], checkedCount: 0 } });
  });
  await page.goto(`/?view=workspace&role=${role}`);
  return requests;
}

async function openPricing(page: Page) {
  await expect(page.getByRole('heading', { name: 'Approved vs billed', exact: true })).toBeVisible();
}

test('approved prices show outcomes and toggle the state filter', async ({ page }) => {
  const requests = await setup(page);
  await openPricing(page);
  const panel = page.getByRole('region', { name: 'Approved vs billed', exact: true });
  for (const label of ['Different 1', 'Not billed 1', 'Matches 1', "Can't match 1"]) {
    await expect(panel.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'false');
  }
  await expect(panel.getByRole('list', { name: 'Approved prices' })).toContainText('billed ₹2,050 on 14 Nov (₹150 less) · 3 of 5 invoices differ');
  await expect(panel).toContainText('customer not linked to a Tally ledger');
  await expect(panel).toContainText('1 in another pack ignored');
  await expect(panel).toContainText('(now: 0)');
  await panel.getByRole('button', { name: 'Different 1', exact: true }).click();
  await expect.poll(() => requests.some(url => new URL(url).searchParams.get('state') === 'different')).toBe(true);
  await expect(panel.getByRole('listitem')).toHaveCount(1);
  await expect(panel.getByRole('button', { name: 'Different 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('button', { name: 'Different 1', exact: true }).click();
  await expect(panel.getByRole('listitem')).toHaveCount(4);
  expect(new URL(requests.at(-1)!).searchParams.has('state')).toBe(false);
});

test('Accounts sees approved vs billed at 375px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setup(page, 'accounts');
  await openPricing(page);
  await expect(page.getByRole('list', { name: 'Approved prices' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.getByRole('region', { name: 'Approved vs billed', exact: true }).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('Operations never requests approved price outcomes', async ({ page }) => {
  const requests = await setup(page, 'operations');
  await expect(page.getByRole('heading', { name: 'Approved vs billed', exact: true })).toHaveCount(0);
  expect(requests).toEqual([]);
});
