import { expect, test, type Page } from '@playwright/test';

const linkId = '19300000-0000-4000-8000-000000000001';
const brands = [{ code: 'BIOMERIEUX', name: 'bioMérieux', areas: ['IMMUNO', 'CULTURE'] }];
async function fixture(page: Page, statuses: (number | 'network')[] = []) {
  const posts: Record<string, unknown>[] = [];
  const reads: URL[] = [];
  let itemKind = 'instrument';
  let kindSource = 'auto';
  await page.route('**/api/accounts**', route => route.fulfill({ json: { accounts: [], page: { page: 1, pageSize: 50, total: 0 }, owners: [], territories: [], canAssign: true, canSeeProspects: true, canEraseContacts: false, canSeePowerMap: false, actorEmail: 'manager@example.test', today: '2026-11-01', classPolicy: { aMinPaise: '20000000', bMinPaise: '7500000' } } }));
  await page.route('**/api/customer-map?**', route => route.fulfill({ json: { brand: brands[0], brands, rows: [], total: 0, page: 1, mappedShare: { unmappedSalesPaise: 180000, totalSalesPaise: 1000000 } } }));
  await page.route('**/api/brand-mapping**', route => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      const status = statuses[posts.length - 1] ?? 200;
      if (status === 'network') return route.abort('failed');
      const body = posts.at(-1)!;
      if (status === 200 && body.action === 'set_item_kind') {
        itemKind = body.kind === 'auto' ? 'instrument' : String(body.kind); kindSource = body.kind === 'auto' ? 'auto' : 'override';
        return route.fulfill({ json: { companyId: body.companyId, productId: body.productId, kind: itemKind, source: kindSource } });
      }
      return route.fulfill({ status, json: status === 200 ? { ok: true, linkId } : { error: 'Untrusted failure text' } });
    }
    const url = new URL(route.request().url()); reads.push(url);
    return route.fulfill({ json: { brands,
      groups: [{ group: '\u0004 Primary', label: 'Primary', items: 2, salesPaise: 100000, linkId: null, kind: null, brandCode: null }],
      items: [{ itemKey: 'item-key', name: 'Reagent', group: 'Primary', salesPaise: 12000, linkId, brandKind: 'none', kind: itemKind, kindSource, autoKind: 'instrument', companyId: 'company-1', productId: 'product-1', brandCode: null }],
      equipment: [{ itemKey: 'machine-key', name: 'Machine', installs: 3, linkId: null, areaCode: null }],
      total: 1, page: Number(url.searchParams.get('page')), unmappedSalesPaise: 180000, totalSalesPaise: 1000000,
    } });
  });
  await page.route('**/api/me', route => route.fulfill({ json: { roles: ['management'] } }));
  await page.route('**/api/push-subscription**', route => route.fulfill({ json: { enabled: false, publicKey: '' } }));
  await page.route('**/api/wallet?**', route => route.fulfill({ json: { coverage: { certified: true } } }));
  await page.route('**/api/today**', route => route.fulfill({ json: { policyVersion: 'today-v1', generatedAt: '2026-11-01T06:00:00Z', coverageCertified: true, unblock: { total: 0, rows: [] }, grow: { total: 0, rows: [] } } }));
  await page.goto('/?view=frame&role=management&roles=management');
  const accounts = page.getByRole('button', { name: /^accounts$/i });
  if (!await accounts.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await accounts.click();
  await page.getByRole('button', { name: 'Prospects', exact: true }).click();
  await page.getByRole('button', { name: 'Brands setup', exact: true }).first().click();
  const section = page.getByRole('region', { name: 'Brands setup', exact: true });
  await expect(section.getByLabel('Brand for Primary', { exact: true })).toBeEnabled();
  return { section, posts, reads };
}

test('Group select posts the exact raw Tally group and expected link', async ({ page }) => {
  const { section, posts } = await fixture(page);
  const select = section.getByLabel('Brand for Primary', { exact: true });
  expect(await select.evaluate(el => el.parentElement?.tagName)).not.toBe('LABEL');
  await select.selectOption('BIOMERIEUX');
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ action: 'set_group_brand', group: '\u0004 Primary', expectedLinkId: null, brandCode: 'BIOMERIEUX', idempotencyKey: expect.any(String) });
  expect(posts[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
});

test('Kind requires an inline reason and saves a consumable override', async ({ page }) => {
  const { section, posts } = await fixture(page);
  const select = section.getByLabel('Kind for Reagent', { exact: true });
  await expect(select).toHaveValue('auto');
  await expect(select.locator('option:checked')).toHaveText('Auto (Instrument)');
  await select.selectOption('consumable');
  expect(posts).toHaveLength(0);
  await expect(section.getByRole('button', { name: 'Save kind', exact: true })).toBeDisabled();
  await section.getByLabel('Kind reason for Reagent', { exact: true }).fill('Costly reagent');
  await section.getByRole('button', { name: 'Save kind', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ action: 'set_item_kind', requestId: expect.any(String), companyId: 'company-1', productId: 'product-1', kind: 'consumable', reason: 'Costly reagent' });
  await expect(select).toHaveValue('consumable');
  await expect(section.getByText('Kind saved.', { exact: true })).toBeVisible();
});

test('A 409 shows the reload text and reads mapping again', async ({ page }) => {
  const { section, reads } = await fixture(page, [409]);
  const before = reads.length;
  await section.getByLabel('Brand for Primary', { exact: true }).selectOption('BIOMERIEUX');
  await expect(section.getByText('Changed by someone else. Reloaded.', { exact: true })).toBeVisible();
  await expect.poll(() => reads.length).toBeGreaterThan(before);
  await expect(section).not.toContainText('Untrusted failure text');
});

test('Item search debounces for 300 ms and sends q', async ({ page }) => {
  const { section, reads } = await fixture(page);
  await page.clock.install();
  const before = reads.length;
  await section.getByLabel('Search items', { exact: true }).fill('Rea');
  await page.clock.fastForward(200);
  await section.getByLabel('Search items', { exact: true }).fill('Reagent');
  await page.clock.fastForward(299);
  expect(reads.length).toBe(before);
  await page.clock.fastForward(1);
  await expect.poll(() => reads.at(-1)?.searchParams.get('q')).toBe('Reagent');
  expect(reads.at(-1)?.searchParams.get('page')).toBe('1');
});

test('Use group posts clear true for an item override', async ({ page }) => {
  const { section, posts } = await fixture(page);
  await section.getByLabel('Brand for Reagent', { exact: true }).selectOption('inherit');
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ action: 'set_item_brand', itemKey: 'item-key', expectedLinkId: linkId, clear: true, idempotencyKey: expect.any(String) });
});

test('Equipment select posts set_equipment_area', async ({ page }) => {
  const { section, posts } = await fixture(page);
  await section.getByLabel('Area for Machine', { exact: true }).selectOption('IMMUNO');
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ action: 'set_equipment_area', itemKey: 'machine-key', expectedLinkId: null, areaCode: 'IMMUNO', idempotencyKey: expect.any(String) });
});

test('Retry after a network error reuses the idempotency key', async ({ page }) => {
  const { section, posts, reads } = await fixture(page, ['network', 200]);
  await section.getByLabel('Brand for Primary', { exact: true }).selectOption('BIOMERIEUX');
  await expect(section.getByText('Mapping save could not be confirmed. Retry the same save.', { exact: false })).toBeVisible();
  const before = reads.length;
  await section.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1]).toEqual(posts[0]);
  await expect.poll(() => reads.length).toBeGreaterThan(before);
});
