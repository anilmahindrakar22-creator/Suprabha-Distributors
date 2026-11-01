import { expect, test, type Page } from '@playwright/test';
import { labAreaCodes, labPanelCodes, labTestCodes, type LabMix, type LabMixOptions } from '../../lib/lab-mix';

const customerId = '66111111-1111-4111-8111-111111111111';
const name = 'Example Diagnostic Laboratory';
const reportId = '19300000-0000-4000-8000-000000000001';
const genericBands = [{ min: 1, max: 20 }, { min: 21, max: 50 }, { min: 51, max: 100 }, { min: 101, max: null }];
const names = { HAEM: 'Haematology', BIOCHEM: 'Biochemistry', IMMUNO: 'Hormones / immunoassay', HBA1C: 'HbA1c', URINE: 'Urine', COAG: 'Coagulation', RAPID: 'Rapid tests / serology', CULTURE: 'Culture' };
const panelNames = { FERTILITY: 'Fertility', VITD_B12: 'Vitamin D/B12', CARDIAC: 'Cardiac', TUMOUR: 'Tumour markers', INFECTIOUS: 'Infectious', OTHER: 'Other' };
const options: LabMixOptions = {
  areas: labAreaCodes.map(code => ({ code, name: names[code], brandsHint: code === 'HBA1C' ? null : 'Brand hint', bands: code === 'IMMUNO' ? [{ min: 1, max: 14 }, { min: 15, max: 30 }, { min: 31, max: 60 }, { min: 61, max: null }] : genericBands })),
  tests: labTestCodes.map(code => ({ code, name: code })),
  panels: labPanelCodes.map(code => ({ code, name: panelNames[code] })),
  busiestBands: [{ min: 1, max: 3 }, { min: 4, max: 8 }, { min: 9, max: null }],
  policy: { version: 1, cliaCutoffPerDay: 15, packWastePerDay: 4, staleAfterDays: 90 },
};
const report: LabMix = {
  reportId, reportedBy: 'sales@example.test', reportedOn: '2026-07-01', stale: true,
  areas: [
    { area: 'HAEM', name: 'Haematology', status: 'in_house', min: 21, max: 50, exact: false },
    { area: 'IMMUNO', name: 'Hormones / immunoassay', status: 'in_house', min: 15, max: 30, exact: false },
    { area: 'URINE', name: 'Urine', status: 'sends_out', min: null, max: null, exact: false },
    { area: 'COAG', name: 'Coagulation', status: 'not_done', min: null, max: null, exact: false },
  ],
  busiest: { test: 'TSH', name: 'TSH', min: 1, max: 3, exact: false },
  panels: [{ panel: 'FERTILITY', name: 'Fertility', status: 'sent_out' }, { panel: 'CARDIAC', name: 'Cardiac', status: 'in_house' }, { panel: 'TUMOUR', name: 'Tumour markers', status: 'sent_out' }],
  fit: 'clia', packWasteRisk: true, policyVersion: 1,
};
const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAarVyFEAAAAASUVORK5CYII=', 'base64');

async function fixture(page: Page, config: { hidden?: boolean; report?: LabMix; statuses?: (number | 'network')[] } = {}) {
  const posts: Record<string, unknown>[] = [];
  let sheetReads = 0;
  await page.clock.setFixedTime(new Date('2026-10-30T06:00:00Z'));
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: transparentPng }));
  await page.route('**/api/accounts**', route => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      const status = config.statuses?.[posts.length - 1] ?? 200;
      if (status === 'network') return route.abort('failed');
      return route.fulfill({ status, json: status === 200 ? { ok: true, reportId } : { error: 'Fixture failure' } });
    }
    return route.fulfill({ json: { accounts: [], page: { page: 1, pageSize: 50, total: 0 }, owners: [], territories: [], canAssign: false, canSeeMyActions: true, canEraseContacts: false, canSeePowerMap: false, actorEmail: 'sales@example.test', today: '2026-10-30', classPolicy: { aMinPaise: '20000000', bMinPaise: '7500000' } } });
  });
  await page.route('**/api/customer-map?**', route => {
    if (new URL(route.request().url()).searchParams.has('customer')) {
      sheetReads++;
      return route.fulfill({ json: { customerId, name, labAccess: !config.hidden, town: 'Bidar', owner: { email: 'sales@example.test' }, class: 'A', decisionMaker: { label: 'No decider known', canAddContact: true }, actions: { pin: 'place', orderCustomerId: customerId }, ...(config.hidden ? {} : { labMixOptions: options, labMix: config.report ?? null }) } });
    }
    return route.fulfill({ json: { coverage: { placed: 1, approx: 0, total: 1 }, pins: [{ customerId, name, lat: 17.3, lng: 76.8, tone: 'grey', focus: false, openOrders: 0 }], approxGroups: [], notOnMapCount: 0, freshness: { calculatedAt: '2026-10-30T05:12:00Z', certified: true } } });
  });
  const role = config.hidden ? 'operations' : 'sales';
  await page.route('**/api/me', route => route.fulfill({ json: { roles: [role] } }));
  await page.route('**/api/push-subscription**', route => route.fulfill({ json: { enabled: false, publicKey: '' } }));
  await page.route('**/api/wallet?**', route => route.fulfill({ json: { coverage: { certified: true } } }));
  await page.route('**/api/my-actions?**', route => route.fulfill({ json: { page: 1, pageSize: 50, total: 0, overdueCount: 0, rows: [] } }));
  await page.route('**/api/today**', route => route.fulfill({ json: { policyVersion: 'today-v1', generatedAt: '2026-10-30T06:00:00Z', coverageCertified: true, unblock: { total: 0, rows: [] }, grow: { total: 0, rows: [] } } }));
  await page.goto(`/?view=frame&role=${role}&roles=${role}`);
  const accounts = page.getByRole('button', { name: /^accounts$/i });
  if (!await accounts.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await accounts.click();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.getByRole('button', { name: `${name}, No data yet`, exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Customer details' });
  await expect(sheet.getByRole('heading', { name, exact: true })).toBeVisible();
  return { sheet, section: sheet.getByRole('region', { name: 'Test mix', exact: true }), posts, reads: () => sheetReads };
}

test('without labMixOptions the Test mix section is absent', async ({ page }) => {
  const { sheet } = await fixture(page, { hidden: true });
  await expect(sheet.getByText('Test mix', { exact: false })).toHaveCount(0);
});

test('read view shows areas, fit, pack-waste risk and Re-check', async ({ page }) => {
  const { section } = await fixture(page, { report });
  for (const line of ['Haematology 21–50/day', 'Urine sends out', 'Coagulation not done', 'CLIA fit · Busiest: TSH 1–3/day', 'CLIA pack-waste risk: busiest test under 4/day', 'Re-check', 'Sends out: Fertility, Tumour markers']) {
    await expect(section.getByText(line, { exact: true })).toBeVisible();
  }
  await expect(section).toContainText('Test mix · 1 Jul · sales');
  await expect(section.getByRole('form')).toHaveCount(0);
});

test('phone quick fill posts only the selected areas, busiest and panels', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { section, posts, reads } = await fixture(page);
  await section.getByRole('button', { name: 'Add test mix', exact: true }).click();
  await section.getByRole('button', { name: 'Haematology: 21–50 per day', exact: true }).click();
  await section.getByRole('button', { name: 'Hormones / immunoassay: 15–30 per day', exact: true }).click();
  const busiestLabelBounds = await section.getByText('Busiest hormone test', { exact: true }).boundingBox();
  const hba1cBounds = await section.getByRole('button', { name: 'HbA1c: not done', exact: true }).boundingBox();
  expect(busiestLabelBounds!.y).toBeLessThan(hba1cBounds!.y);
  await section.getByRole('button', { name: 'Busiest hormone test: 4–8 per day', exact: true }).click();
  const before = reads();
  await section.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ action: 'record_lab_mix', customerId, areas: [{ area: 'HAEM', status: 'in_house', min: 21, max: 50 }, { area: 'IMMUNO', status: 'in_house', min: 15, max: 30 }], busiest: { test: 'TSH', min: 4, max: 8 }, panels: [], idempotencyKey: expect.any(String) });
  expect(posts[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  await expect.poll(reads).toBeGreaterThan(before);
  await expect(section.getByRole('form')).toHaveCount(0);
});

test('re-tapping selected area and panel chips clears them from the POST', async ({ page }) => {
  const { section, posts } = await fixture(page);
  await section.getByRole('button', { name: 'Add test mix', exact: true }).click();
  const haem = section.getByRole('button', { name: 'Haematology: 21–50 per day', exact: true });
  await haem.click(); await haem.click();
  await expect(haem).toHaveAttribute('aria-pressed', 'false');
  await section.getByRole('button', { name: 'Urine: sends out', exact: true }).click();
  await section.getByText('Special tests (optional)', { exact: true }).click();
  const fertility = section.getByRole('button', { name: 'Fertility: sent out', exact: true });
  await fertility.click(); await fertility.click();
  await section.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ action: 'record_lab_mix', customerId, areas: [{ area: 'URINE', status: 'sends_out' }], busiest: null, panels: [], idempotencyKey: expect.any(String) });
});

test('No change posts previousReportId and a 409 reloads with a message', async ({ page }) => {
  const { section, sheet, posts, reads } = await fixture(page, { report, statuses: [409] });
  const before = reads();
  await section.getByRole('button', { name: 'No change', exact: true }).click();
  await expect(sheet.getByText('Test mix changed. Reloaded.', { exact: true })).toBeVisible();
  expect(posts).toEqual([{ action: 'confirm_lab_mix', customerId, previousReportId: reportId, idempotencyKey: expect.any(String) }]);
  await expect.poll(reads).toBeGreaterThan(before);
});

test('phone form wraps without horizontal document scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { section } = await fixture(page);
  await section.getByRole('button', { name: 'Add test mix', exact: true }).click();
  await section.getByRole('button', { name: 'Hormones / immunoassay: 15–30 per day', exact: true }).click();
  await section.getByText('Special tests (optional)', { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await section.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const haemRow = section.getByRole('button', { name: 'Haematology: not done', exact: true }).locator('xpath=ancestor::*[@data-area-row][1]');
  const haemBounds = await haemRow.boundingBox();
  expect(haemBounds).not.toBeNull();
  expect(haemBounds!.height).toBeLessThan(200);
});

test('update prefills the report, exact overrides a band, and IMMUNO away clears busiest', async ({ page }) => {
  const { section, posts } = await fixture(page, { report });
  await section.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(section.getByRole('button', { name: 'Haematology: 21–50 per day', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(section.getByLabel('Busiest hormone test', { exact: true })).toHaveValue('TSH');
  await section.getByRole('button', { name: 'Haematology: Exact', exact: true }).click();
  await section.getByLabel('Exact tests per day for Haematology', { exact: true }).fill('35');
  const exactChip = section.getByRole('button', { name: 'Haematology: Exact', exact: true });
  await expect(exactChip).toHaveText('35/day');
  await expect(exactChip).toHaveAttribute('aria-pressed', 'true');
  await exactChip.click();
  await expect(section.getByLabel('Exact tests per day for Haematology', { exact: true })).toHaveCount(0);
  await section.getByRole('button', { name: 'Hormones / immunoassay: sends out', exact: true }).click();
  await expect(section.getByLabel('Busiest hormone test', { exact: true })).toHaveCount(0);
  await section.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ action: 'record_lab_mix', customerId, areas: [
    { area: 'HAEM', status: 'in_house', exact: 35 }, { area: 'IMMUNO', status: 'sends_out' },
    { area: 'URINE', status: 'sends_out' }, { area: 'COAG', status: 'not_done' },
  ], busiest: null, panels: report.panels.map(({ panel, status }) => ({ panel, status })), idempotencyKey: expect.any(String) });
});

test('empty Save is disabled and Cancel discards unsaved selections', async ({ page }) => {
  const { section, posts } = await fixture(page);
  await section.getByRole('button', { name: 'Add test mix', exact: true }).click();
  await expect(section.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await section.getByRole('button', { name: 'Haematology: 21–50 per day', exact: true }).click();
  await section.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(posts).toEqual([]);
  await section.getByRole('button', { name: 'Add test mix', exact: true }).click();
  await expect(section.getByRole('button', { name: 'Haematology: 21–50 per day', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(section.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
});

for (const status of [500, 408, 429, 'network', 409, 422] as const) {
  test(`No change retry after ${status} uses the appropriate idempotency key`, async ({ page }) => {
    const { section, sheet, posts } = await fixture(page, { report, statuses: [status, 200] });
    await section.getByRole('button', { name: 'No change', exact: true }).click();
    await expect(sheet.getByText(status === 409 ? 'Test mix changed. Reloaded.' : 'Test mix save could not be confirmed. Retry the same save.', { exact: true })).toBeVisible();
    await section.getByRole('button', { name: 'No change', exact: true }).click();
    await expect.poll(() => posts.length).toBe(2);
    if (status === 409 || status === 422) expect(posts[1].idempotencyKey).not.toBe(posts[0].idempotencyKey);
    else expect(posts[1]).toEqual(posts[0]);
  });
}
