import { expect, test, type Page } from '@playwright/test';

const linkId = '19300000-0000-4000-8000-000000000001';
const areaLinkId = '19300000-0000-4000-8000-000000000002';
const brands = [{ code: 'BIOMERIEUX', name: 'bioMérieux', areas: ['IMMUNO', 'CULTURE'] }];
const allBrands = [...brands, { code: 'TEST_PRINCIPAL', name: 'Test Principal', areas: [] }, { code: 'SECOND_PRINCIPAL', name: 'Second Principal', areas: [] }];
const noLink = { linkId: null, kind: null, brandCode: null };
const noArea = { areaLinkId: null, areaCode: null };
const row = (group: string, parent: string | null, top: string, depth: number, items: number, salesPaise: number, extra: Record<string, unknown> = {}) =>
  ({ group, parent, top, depth, items, salesPaise, ...noLink, inheritedBrandCode: null, ...noArea, ...extra });
const tree = [
  row('Test Principal Diagnostics Pvt Ltd', null, 'Test Principal Diagnostics Pvt Ltd', 0, 0, 0),
  row('Line A', 'Test Principal Diagnostics Pvt Ltd', 'Test Principal Diagnostics Pvt Ltd', 1, 4, 4000000),
  row('Line B', 'Test Principal Diagnostics Pvt Ltd', 'Test Principal Diagnostics Pvt Ltd', 1, 2, 2000000, { linkId, kind: 'brand', brandCode: 'BIOMERIEUX', areaLinkId, areaCode: 'HAEM' }),
  row('Second Principal Ltd', null, 'Second Principal Ltd', 0, 3, 1500000),
  row('Unknown Agency', null, 'Unknown Agency', 0, 2, 500000),
  row('Linked Maker', null, 'Linked Maker', 0, 0, 0, { linkId, kind: 'brand', brandCode: 'BIOMERIEUX' }),
  row('Line C', 'Linked Maker', 'Linked Maker', 1, 1, 100000, { inheritedBrandCode: 'BIOMERIEUX' }),
];
async function fixture(page: Page, statuses: (number | 'network')[] = [], shape: 'tree' | 'old' = 'tree') {
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
    return route.fulfill({ json: { brands: allBrands,
      groups: [{ group: '\u0004 Primary', label: 'Primary', items: 2, salesPaise: 100000, linkId: null, kind: null, brandCode: null }],
      items: [{ itemKey: 'item-key', name: 'Reagent', group: 'Primary', salesPaise: 12000, linkId, brandKind: 'none', kind: itemKind, kindSource, autoKind: 'instrument', companyId: 'company-1', productId: 'product-1', brandCode: null }],
      equipment: [{ itemKey: 'machine-key', name: 'Machine', installs: 3, linkId: null, areaCode: null }],
      total: 1, page: Number(url.searchParams.get('page')), unmappedSalesPaise: 180000, totalSalesPaise: 1000000,
      ...(shape === 'tree' ? { tree, catalogObservedAt: '2026-11-13T05:00:00Z' } : {}),
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

const principal = 'Test Principal Diagnostics Pvt Ltd';
test('Accept posts set_group_brand for the raw group with no expected link', async ({ page }) => {
  const { section, posts } = await fixture(page);
  await section.getByRole('button', { name: `Accept Test Principal for ${principal}`, exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ action: 'set_group_brand', group: principal, expectedLinkId: null, brandCode: 'TEST_PRINCIPAL', idempotencyKey: expect.any(String) });
});

test('Accept all posts one command per suggestion', async ({ page }) => {
  const { section, posts } = await fixture(page);
  await section.getByRole('button', { name: 'Accept all suggestions (2)', exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts.map(post => [post.action, post.group, post.expectedLinkId, post.brandCode])).toEqual([
    ['set_group_brand', principal, null, 'TEST_PRINCIPAL'],
    ['set_group_brand', 'Second Principal Ltd', null, 'SECOND_PRINCIPAL'],
  ]);
  expect(posts[0].idempotencyKey).not.toBe(posts[1].idempotencyKey);
});

test('A line Test area select posts set_group_area with the area link', async ({ page }) => {
  const { section, posts } = await fixture(page);
  await section.getByLabel('Test area for Line B', { exact: true }).selectOption('IMMUNO');
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ action: 'set_group_area', group: 'Line B', expectedLinkId: areaLinkId, areaCode: 'IMMUNO', idempotencyKey: expect.any(String) });
});

test('Add as brand posts add_brand with the cleaned name and does not link', async ({ page }) => {
  const { section, posts } = await fixture(page);
  await section.getByRole('button', { name: 'Add Unknown Agency as a brand', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ action: 'add_brand', name: 'Unknown Agency', idempotencyKey: expect.any(String) });
});

test('Tree shows inheritance, observation date and other groups', async ({ page }) => {
  const { section } = await fixture(page);
  await expect(section.getByLabel('Brand for Line C', { exact: true }).locator('option:checked')).toHaveText('bioMérieux (from group)');
  await expect(section.getByText('Tally groups as of 13 Nov 2026', { exact: true })).toBeVisible();
  await expect(section.getByRole('region', { name: 'Brands from Tally groups' })).toBeVisible();
  await expect(section.getByText('Other groups', { exact: true })).toBeVisible();
});

test('The old response shape still renders Stock groups', async ({ page }) => {
  const { section } = await fixture(page, [], 'old');
  await expect(section.getByRole('region', { name: 'Stock groups' })).toBeVisible();
  await expect(section.getByRole('region', { name: 'Brands from Tally groups' })).toHaveCount(0);
});

test('Brands setup has no sideways scroll at 375 px', async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 375, height: 812 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('Screenshots of the brand tree at 375 and 1280', async ({ page }) => {
  const { section } = await fixture(page);
  const tree = section.getByRole('region', { name: 'Brands from Tally groups' });
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 3200 });
    await page.addStyleTag({ content: 'nav, footer{display:none !important}' });
    await tree.scrollIntoViewIfNeeded();
    await tree.screenshot({ path: `work/bl3-${width}.png` });
  }
});