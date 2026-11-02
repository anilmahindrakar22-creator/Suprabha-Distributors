import { expect, test, type Page } from '@playwright/test';

const customerId = '66111111-1111-4111-8111-111111111111';
const otherId = '66111111-1111-4111-8111-111111111112';
const brands = [{ code: 'BIOMERIEUX', name: 'bioMérieux', areas: ['IMMUNO', 'CULTURE'] }, { code: 'SYSMEX', name: 'Sysmex', areas: ['HAEM'] }];

async function fixture(page: Page, role = 'sales', diagnosisStatus: number | number[] = 200) {
  const requests: URL[] = [];
  const opportunityPosts: unknown[] = [];
  const financial = role === 'management';
  await page.route('**/api/accounts**', route => route.fulfill({ json: {
    accounts: [], page: { page: 1, pageSize: 50, total: 0 }, owners: [], territories: [], canAssign: financial,
    canSeeProspects: role !== 'operations', canSeeMyActions: true, canEraseContacts: false, canSeePowerMap: false,
    actorEmail: `${role}@example.test`, today: '2026-11-01', classPolicy: { aMinPaise: '20000000', bMinPaise: '7500000' },
  } }));
  await page.route('**/api/customer-map?**', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('customer')) return route.fulfill({ json: { customerId, name: 'Central Lab', labAccess: true, town: 'Bidar', owner: { email: 'sales@example.test' }, class: 'A', decisionMaker: { label: 'No decider known', canAddContact: true }, actions: { pin: 'place', orderCustomerId: customerId } } });
    if (!url.searchParams.has('prospects')) return route.fulfill({ json: {} });
    requests.push(url);
    if (url.searchParams.get('prospects') === 'OLDBRAND') return route.fulfill({ status: 400, json: { error: 'x' } });
    const brand = brands.find(item => item.code === url.searchParams.get('prospects'))!;
    const immuno = brand.areas.includes('IMMUNO');
    const row = { customerId, name: 'Central Lab', city: 'Bidar', reportedOn: '2026-07-01', stale: true,
      fit: immuno ? 'clia' : null, packWasteRisk: immuno ? true : null,
      areas: [{ area: immuno ? 'IMMUNO' : 'HAEM', name: immuno ? 'Hormones' : 'Haematology', status: 'in_house', min: immuno ? 15 : 21, max: immuno ? 30 : 50, exact: false }],
      volume: immuno ? 15 : 21, hasOurMachine: true, focus: true,
    };
    return route.fulfill({ json: { brand, brands, page: Number(url.searchParams.get('page')), total: 41,
      mappedShare: financial ? { unmappedSalesPaise: 180000, totalSalesPaise: 1000000 } : null,
      rows: [{ ...row, ...(financial ? { brandSalesPaise: 1240000 } : { buysBrand: true }) },
        { ...row, customerId: otherId, name: 'New Lab', focus: false, ...(financial ? { brandSalesPaise: 0 } : { buysBrand: false }) }],
    } });
  });
  await page.route('**/api/me', route => route.fulfill({ json: { roles: [role] } }));
  let diagnosisRequestCount = 0;
  await page.route('**/api/wallet/diagnosis', async route => {
    if (route.request().method() === 'POST') opportunityPosts.push(route.request().postDataJSON());
    const status = Array.isArray(diagnosisStatus)
      ? diagnosisStatus[Math.min(diagnosisRequestCount, diagnosisStatus.length - 1)]
      : diagnosisStatus;
    diagnosisRequestCount += 1;
    await route.fulfill({ status, json: status === 200 ? { id: 'opp-1' } : { error: 'fixture' } });
  });
  await page.route('**/api/push-subscription**', route => route.fulfill({ json: { enabled: false, publicKey: '' } }));
  await page.route('**/api/wallet?**', route => route.fulfill({ json: { coverage: { certified: true } } }));
  await page.route('**/api/my-actions?**', route => route.fulfill({ json: { page: 1, pageSize: 50, total: 0, overdueCount: 0, rows: [] } }));
  await page.route('**/api/today**', route => route.fulfill({ json: { policyVersion: 'today-v1', generatedAt: '2026-11-01T06:00:00Z', coverageCertified: true, unblock: { total: 0, rows: [] }, grow: { total: 0, rows: [] } } }));
  await page.goto(`/?view=frame&role=${role}&roles=${role}`);
  const accounts = page.getByRole('button', { name: /^accounts$/i });
  if (!await accounts.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await accounts.click();
  if (role !== 'operations') {
    await page.getByRole('button', { name: 'Prospects', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Prospect labs' })).toBeVisible();
  }
  return { requests, opportunityPosts, section: page.getByRole('region', { name: 'Prospects', exact: true }) };
}

test('Operations has no Prospects button', async ({ page }) => {
  await fixture(page, 'operations');
  await expect(page.getByRole('button', { name: 'Prospects', exact: true })).toHaveCount(0);
});

test('The first Focus-band prospect shows Focus lab', async ({ page }) => {
  const { section } = await fixture(page);
  const rows = section.getByRole('list', { name: 'Prospect labs' }).getByRole('listitem');
  await expect(rows.nth(0)).toContainText('Focus lab');
  await expect(rows.nth(1)).not.toContainText('Focus lab');
});

test('Sales sees brand chips, Buys without amounts, machine text and Re-check chips', async ({ page }) => {
  const { section } = await fixture(page);
  for (const brand of brands) await expect(section.getByRole('button', { name: brand.name, exact: true })).toBeVisible();
  await expect(section.getByText(/ · Buys$/)).toBeVisible();
  await expect(section.getByText(/ · Not buying$/)).toBeVisible();
  await expect(section.getByText(/Has our machine/).first()).toBeVisible();
  await expect(section.getByText('Re-check', { exact: true }).first()).toBeVisible();
  await expect(section).not.toContainText('₹');
});

test('Remembered brand is used by the only request before the list shows', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sf-prospects-brand', 'SYSMEX'));
  const { requests, section } = await fixture(page);
  await expect(section.getByRole('list', { name: 'Prospect labs' })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].searchParams.get('prospects')).toBe('SYSMEX');
});

test('Inactive remembered brand falls back to BIOMERIEUX', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sf-prospects-brand', 'OLDBRAND'));
  const { requests, section } = await fixture(page);
  await expect(section.getByRole('list', { name: 'Prospect labs' })).toBeVisible();
  // Rare recovery path: one repeat read of the fallback brand is acceptable; OLDBRAND is asked only once.
  await expect.poll(() => requests.slice(0, 2).map(request => request.search)).toEqual(['?prospects=OLDBRAND&page=1', '?prospects=BIOMERIEUX&page=1']);
  expect(requests.filter(request => request.searchParams.get('prospects') === 'OLDBRAND')).toHaveLength(1);
  await page.waitForTimeout(500);
  expect(requests.length).toBeLessThanOrEqual(3);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('sf-prospects-brand'))).toBe('BIOMERIEUX');
});

test('Fit requests clia on page 1 and changing brand resets the page and fit', async ({ page }) => {
  const { section, requests } = await fixture(page);
  await section.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(section.getByText('Page 2 of 3', { exact: true })).toBeVisible();
  await section.getByRole('button', { name: 'CLIA fit', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.search).toBe('?prospects=BIOMERIEUX&page=1&fit=clia');
  await expect(section.getByText('Page 1 of 3', { exact: true })).toBeVisible();
  await section.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(section.getByText('Page 2 of 3', { exact: true })).toBeVisible();
  await section.getByRole('button', { name: 'Sysmex', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.search).toBe('?prospects=SYSMEX&page=1');
  await expect(section.getByText('Page 1 of 3', { exact: true })).toBeVisible();
});

test('Management sees brand amounts, the unmapped warning and Brands setup', async ({ page }) => {
  const { section } = await fixture(page, 'management');
  await expect(section.getByText(/ · Buys ₹12,400$/)).toBeVisible();
  await expect(section).toContainText('18% of sales (last 180 days) not yet mapped to a brand.');
  await expect(section.getByRole('button', { name: 'Brands setup', exact: true }).first()).toBeVisible();
});

test('A prospect row opens the CustomerSheet', async ({ page }) => {
  const { section } = await fixture(page);
  await section.getByRole('button', { name: /Central Lab/ }).click();
  await expect(page.getByRole('dialog', { name: 'Customer details' }).getByRole('heading', { name: 'Central Lab', exact: true })).toBeVisible();
});

test('Management can open a prospect opportunity', async ({ page }) => {
  const { section, opportunityPosts } = await fixture(page, 'management');
  await section.getByRole('button', { name: /Central Lab/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Customer details' });
  await dialog.getByRole('button', { name: 'Open opportunity', exact: true }).click();
  await expect.poll(() => opportunityPosts.length).toBe(1);
  const post = opportunityPosts[0] as { action: string; payload: { customerId: string; kind: string; origin: string; divisionCode: null; reason: string } };
  expect(post.action).toBe('open_opportunity');
  expect(post.payload).toMatchObject({ customerId, kind: 'capture', origin: 'manual', divisionCode: null });
  expect(post.payload.reason).toMatch(/^Prospect for bioM.rieux: /);
  await expect(dialog.getByRole('status')).toHaveText('Opportunity opened. Follow it up in Wallet.');
  await expect(dialog.getByRole('button', { name: 'Open opportunity', exact: true })).toHaveCount(0);
});

test('Management can retry opening a prospect opportunity with the same request ID', async ({ page }) => {
  const { section, opportunityPosts } = await fixture(page, 'management', [503, 200]);
  await section.getByRole('button', { name: /Central Lab/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Customer details' });
  const openButton = dialog.getByRole('button', { name: 'Open opportunity', exact: true });
  await openButton.click();
  await expect(dialog.getByRole('status')).toHaveText('Could not open. Try again.');
  await openButton.click();
  await expect(dialog.getByRole('status')).toHaveText('Opportunity opened. Follow it up in Wallet.');
  expect(opportunityPosts).toHaveLength(2);
  const firstPost = opportunityPosts[0] as { payload: { requestId: string } };
  const secondPost = opportunityPosts[1] as { payload: { requestId: string } };
  expect(secondPost.payload.requestId).toBe(firstPost.payload.requestId);
});

test('Management sees the existing opportunity response', async ({ page }) => {
  const { section } = await fixture(page, 'management', 409);
  await section.getByRole('button', { name: /Central Lab/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Customer details' });
  await dialog.getByRole('button', { name: 'Open opportunity', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('This lab already has an open opportunity in Wallet.');
});

test('Sales cannot open a prospect opportunity', async ({ page }) => {
  const { section } = await fixture(page, 'sales');
  await section.getByRole('button', { name: /Central Lab/ }).click();
  await expect(page.getByRole('dialog', { name: 'Customer details' }).getByRole('button', { name: 'Open opportunity', exact: true })).toHaveCount(0);
});

test('Phone prospects has no horizontal scroll at 375 by 812', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { section } = await fixture(page, 'management');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await section.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});
