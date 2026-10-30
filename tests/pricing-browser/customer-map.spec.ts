import { expect, test, type Page } from '@playwright/test';

const customerId = '66111111-1111-4111-8111-111111111111';
const name = 'Example Diagnostic Laboratory';
const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAarVyFEAAAAASUVORK5CYII=', 'base64');
const tones = ['red', 'amber', 'green', 'grey'] as const;
const meanings = ['Overdue action or stuck order', 'Needs a plan, diagnosis or decider', 'Share on target', 'No data yet'];
const ids = tones.map((_, i) => `66111111-1111-4111-8111-11111111111${i + 1}`);
const mapPins = tones.map((tone, index) => ({ customerId: ids[index], name: index === 0 ? name : `${tone} Lab`, lat: 17.3 + index * 0.12, lng: 76.8 + index * 0.12, tone, focus: index === 0, openOrders: index === 0 ? 2 : 0 }));
const base = { customerId, name, town: 'Bidar', owner: { email: 'manager@example.test' }, class: 'A', decisionMaker: { label: 'No decider known', canAddContact: true }, actions: { pin: 'place', orderCustomerId: customerId, call: 'tel:+919876543210' } };
function fullSheet(sales = false) {
  return { ...base, ...(sales ? {} : { sharePermille: 200, certified: true }),
    tiles: { ...(sales ? { openOrders: 2, nextActionDue: '2026-11-01', overdue: 1 } : { walletPaise: 10000000, salesPaise: 2000000, gapPaise: 6000000 }), lastVisit: { visitedOn: '2026-10-29', outcome: 'met' } },
    heldBackBy: { category: 'price', label: 'Price (not proven)', priceUnproven: true },
    nextAction: { id: '99111111-1111-4111-8111-111111111111', actionType: 'visit', detail: 'Discuss the quote', dueOn: '2026-11-01', canPlan: !sales, canDone: sales },
    decisionMaker: { contactId: 'contact-1', name: 'Meena', businessRole: 'Director', decisionRole: 'decision_maker', stance: 'supporter' },
    route: { steps: [{ contactId: 'contact-2', name: 'Asha', decisionRole: 'champion', stance: 'supporter' }, { contactId: 'contact-1', name: 'Meena', decisionRole: 'decision_maker', stance: 'supporter' }] },
    instruments: { rows: [{ kind: 'ours', model: 'Analyzer A', serial: 'SN-001', placedOn: '2026-01-01', ...(sales ? {} : { payback: 'Paying back' }) }, { kind: 'theirs', analyser: 'Analyzer B', owner: 'competitor_placed', closedSystem: 'yes' }, { kind: 'theirs', competitor: 'Competitor C', daysLeft: 20, endsOn: '2026-11-20' }], moreCount: 2 },
    openWork: [{ orderId: '88111111-1111-4111-8111-111111111111', number: 'SF-100', stage: 'packed', date: '2026-10-29T00:00:00Z', kind: 'order', ...(sales ? {} : { valuePaise: 100000 }) }, { orderId: '88111111-1111-4111-8111-111111111112', number: 'SF-101', stage: 'awaiting_approval', date: '2026-10-30T00:00:00Z', kind: 'price', approximate: true, ...(sales ? {} : { valuePaise: 200000 }) }],
    recentOrders: [{ orderId: '88111111-1111-4111-8111-111111111113', number: 'SF-099', stage: 'delivered', date: '2026-10-28T00:00:00Z', ...(sales ? {} : { valuePaise: 150000 }) }], contacts: { total: 3, champions: 1 },
  };
}
async function fixture(page: Page, options: { sales?: boolean; empty?: boolean; located?: boolean; townOnly?: boolean } = {}) {
  const posts: Record<string, unknown>[] = []; const reads: URL[] = [];
  let saved = false;
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: transparentPng }));
  // Same Accounts bootstrap as wallet.spec.ts, with the role-shaped capabilities.
  await page.route('**/api/accounts**', route => {
    if (route.request().method() === 'POST') { posts.push(route.request().postDataJSON()); saved = true; return route.fulfill({ json: { ok: true } }); }
    if (options.townOnly && new URL(route.request().url()).searchParams.get('search') === name) return route.fulfill({ json: { accounts: [{ id: customerId, location: { precision: 'town', version: 5 } }], page: { page: 1, pageSize: 50, total: 1 } } });
    return route.fulfill({ json: { accounts: [], page: { page: 1, pageSize: 50, total: 0 }, owners: [], territories: [], canAssign: !options.sales, canSeeMyActions: !!options.sales, canEraseContacts: false, canSeePowerMap: false, actorEmail: options.sales ? 'sales@example.test' : 'manager@example.test', today: '2026-10-30', classPolicy: { aMinPaise: '20000000', bMinPaise: '7500000' } } });
  });
  await page.route('**/api/customer-map**', route => {
    const url = new URL(route.request().url()); reads.push(url);
    if (url.searchParams.has('customer')) return route.fulfill({ json: { ...(options.empty ? base : fullSheet(options.sales)), ...(options.located || saved ? { location: { precision: 'pin', lat: 17.3, lng: 76.8, version: saved ? 3 : 2 } } : {}) } });
    if (url.searchParams.has('notOnMap')) return route.fulfill({ json: { page: Number(url.searchParams.get('page')), pageSize: 20, total: 21, rows: [{ customerId, name: url.searchParams.get('q') ? 'Search match Lab' : name, city: 'Bidar' }] } });
    return route.fulfill({ json: { coverage: { placed: 4, total: 25 }, pins: mapPins, notOnMapCount: 21 } });
  });
  await page.goto('/?view=accounts');
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.getByText('4 of 25 placed', { exact: true })).toBeVisible();
  return { posts, reads };
}
async function openSheet(page: Page) {
  await page.getByRole('button', { name: `${name}, ${meanings[0]}`, exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Customer details' });
  await expect(sheet.getByRole('heading', { name, exact: true })).toBeVisible();
  return sheet;
}
async function geolocation(page: Page, mode: 'success' | 'outside' | 'denied') {
  await page.addInitScript(mode => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition(success: PositionCallback, failure: PositionErrorCallback, options: PositionOptions) {
      (window as unknown as { gpsOptions: PositionOptions }).gpsOptions = options;
      if (mode === 'denied') failure({ code: 1, message: 'Denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      else success({ coords: { latitude: mode === 'outside' ? 12.9 : 17.3, longitude: mode === 'outside' ? 77.6 : 76.8, accuracy: 14, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) }, timestamp: Date.now(), toJSON: () => ({}) });
    } } });
  }, mode);
}

for (const width of [375, 1280]) test.describe(`Customer map at ${width}px`, () => {
  test.use({ viewport: { width, height: 812 } });
  test('pins show tones, focus size, order badge, attribution and an always-visible legend', async ({ page }) => {
    const { reads } = await fixture(page);
    await page.getByRole('button', { name: 'Wallet', exact: true }).click();
    const legend = page.getByRole('complementary', { name: 'Map legend' });
    for (let i = 0; i < tones.length; i++) {
      const marker = page.getByRole('button', { name: `${mapPins[i].name}, ${meanings[i]}`, exact: true });
      await expect(marker).toBeVisible(); await expect(legend.getByText(meanings[i], { exact: true })).toBeVisible();
    }
    const focus = page.getByRole('button', { name: `${name}, ${meanings[0]}`, exact: true });
    await expect(focus).toContainText('2');
    expect(await focus.evaluate(el => el.querySelector('span')?.style.width)).toBe('44px');
    await expect(page.getByRole('link', { name: 'OpenStreetMap contributors' })).toBeVisible();
    const count = reads.length;
    await page.getByRole('button', { name: 'Orders', exact: true }).click();
    await expect(page.locator('.customer-map-marker')).toHaveCount(1); expect(reads.length).toBe(count);
    await expect(legend).toBeVisible();
    expect(await page.locator('.leaflet-tile-pane').evaluate(el => (el as HTMLElement).style.filter)).toBe('invert(0.9) hue-rotate(180deg) brightness(0.85) saturate(0.6)');
  });
  test('pin tap opens every sheet section in order and the sheet scrolls without horizontal overflow', async ({ page }) => {
    await fixture(page); const sheet = await openSheet(page);
    await expect(sheet.getByText('20% share', { exact: true })).toBeVisible();
    await expect(sheet.getByText('Held back by: Price (not proven)', { exact: true })).toBeVisible();
    for (const label of ['Wallet / month', 'Sales / month', 'Gap / month', 'Last visit']) await expect(sheet.getByText(label, { exact: true })).toBeVisible();
    expect(await sheet.locator('section[aria-label]').evaluateAll(elements => elements.map(el => el.getAttribute('aria-label')))).toEqual(['Next action', 'Decision maker', 'Instruments', 'Open work', 'Recent orders', 'Contacts']);
    await expect(sheet.getByText('Asha · Champion', { exact: true })).toBeAttached();
    await expect(sheet.getByText('Paying back', { exact: true })).toBeAttached();
    await expect(sheet.getByText('Closed system', { exact: true })).toBeAttached();
    await expect(sheet.getByText('+2 more', { exact: true })).toBeAttached();
    await expect(sheet.getByText('SF-100', { exact: true })).toBeAttached();
    await expect(sheet.getByText('≈ ₹2,000', { exact: true })).toBeAttached();
    const scroll = sheet.getByTestId('customer-sheet-scroll');
    expect(await scroll.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
    expect(await scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await expect(sheet.getByRole('link', { name: 'Call', exact: true })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Pin here', exact: true })).toBeVisible();
    expect(await sheet.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  test('empty sections are absent and the missing-decider row remains actionable', async ({ page }) => {
    await fixture(page, { empty: true }); const sheet = await openSheet(page);
    for (const title of ['Next action', 'Instruments', 'Open work', 'Recent orders', 'Contacts']) await expect(sheet.getByRole('region', { name: title, exact: true })).toHaveCount(0);
    await expect(sheet.getByText('Held back by:', { exact: false })).toHaveCount(0);
    await expect(sheet.getByRole('meter')).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: 'No decider known · Add contact' })).toBeVisible();
  });
  test('sales sheet has operational tiles and no rupee, share, wallet or payback text', async ({ page }) => {
    await fixture(page, { sales: true });
    await expect(page.getByRole('button', { name: 'Wallet', exact: true })).toHaveCount(0);
    const sheet = await openSheet(page);
    await expect(sheet).not.toContainText(/₹|share|wallet|paying back|payback/i);
    for (const label of ['Open orders', 'Last visit', 'Next action due', 'Overdue']) await expect(sheet.getByText(label, { exact: true })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  test('Pin here confirms accuracy and saves through the existing Accounts location write', async ({ page }) => {
    await geolocation(page, 'success'); const { posts } = await fixture(page); const sheet = await openSheet(page);
    await sheet.getByRole('button', { name: 'Pin here', exact: true }).click();
    await expect(sheet.getByText('±14 m', { exact: true })).toBeVisible(); expect(posts).toHaveLength(0);
    expect(await page.evaluate(() => (window as unknown as { gpsOptions: PositionOptions }).gpsOptions)).toEqual({ enableHighAccuracy: true, timeout: 10000 });
    await sheet.getByRole('button', { name: 'Confirm pin', exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ action: 'set_location', customerId, expectedVersion: null, precision: 'pin', source: 'manual_pin', latitude: '17.300000', longitude: '76.800000' });
    expect(posts[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    await expect(sheet.getByRole('button', { name: 'Move pin…', exact: true })).toBeVisible();
  });
  test('Pin here rejects positions outside the market area', async ({ page }) => {
    await geolocation(page, 'outside'); const { posts } = await fixture(page); const sheet = await openSheet(page);
    await sheet.getByRole('button', { name: 'Pin here', exact: true }).click();
    await expect(sheet.getByRole('alert')).toContainText('This pin is outside the five-district market area');
    await expect(sheet.getByRole('button', { name: 'Confirm pin', exact: true })).toHaveCount(0); expect(posts).toHaveLength(0);
  });
  test('Pin here permission denial shows one muted line and makes no write', async ({ page }) => {
    await geolocation(page, 'denied'); const { posts } = await fixture(page); const sheet = await openSheet(page);
    await sheet.getByRole('button', { name: 'Pin here', exact: true }).click();
    await expect(sheet.getByText('Location permission denied. You can add a pin manually.', { exact: true })).toHaveCount(1);
    await expect(sheet.getByRole('alert')).toHaveCount(0); expect(posts).toHaveLength(0);
  });
  test('Move pin keeps the existing version when confirming a new position', async ({ page }) => {
    await geolocation(page, 'success'); const { posts } = await fixture(page, { located: true }); const sheet = await openSheet(page);
    await expect(sheet.getByRole('button', { name: 'Pin here', exact: true })).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Move pin…', exact: true }).click();
    await sheet.getByRole('button', { name: 'Pin here', exact: true }).click();
    await sheet.getByRole('button', { name: 'Confirm pin', exact: true }).click();
    await expect.poll(() => posts[0]?.expectedVersion).toBe(2);
  });
  test('Pin here upgrades a town-only location using its Accounts version', async ({ page }) => {
    await geolocation(page, 'success'); const { posts } = await fixture(page, { townOnly: true }); const sheet = await openSheet(page);
    await sheet.getByRole('button', { name: 'Pin here', exact: true }).click();
    await sheet.getByRole('button', { name: 'Confirm pin', exact: true }).click();
    await expect.poll(() => posts[0]?.expectedVersion).toBe(5);
  });
  test('Not on map searches, paginates and opens the customer sheet', async ({ page }) => {
    const { reads } = await fixture(page);
    await page.getByRole('button', { name: 'Not on map (21)', exact: true }).click();
    const list = page.getByRole('region', { name: 'Not on map', exact: true });
    await list.getByRole('button', { name: 'Next', exact: true }).click();
    await expect.poll(() => reads.filter(url => url.searchParams.has('notOnMap')).at(-1)?.searchParams.get('page')).toBe('2');
    await list.getByLabel('Search unplaced customers').fill('Bidar');
    await expect.poll(() => reads.filter(url => url.searchParams.has('notOnMap')).at(-1)?.searchParams.get('q')).toBe('Bidar');
    expect(reads.filter(url => url.searchParams.has('notOnMap')).at(-1)?.searchParams.get('page')).toBe('1');
    await list.getByRole('button', { name: 'Search match Lab · Bidar', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name, exact: true })).toBeVisible();
  });
});
