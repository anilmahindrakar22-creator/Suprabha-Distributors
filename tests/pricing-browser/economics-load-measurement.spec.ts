import { expect, test, type Page } from '@playwright/test';

// Synthetic read-only workspace. No real business commands or Tally connection.
const workspace = {
  actorEmail: 'manager@example.com', businessDate: '2026-10-12', businessTimezone: 'Asia/Kolkata',
  targets: [], mappings: [], exceptions: [], leakage: [], cases: [], sourceLines: [], installations: [], customers: [],
  canManage: false, canApprove: false, canAct: false, generation: 'measurement-fixture', sourceLineCount: 0,
  lastRebuiltAt: null, sourceImportedAt: null, unattributedPaise: '0', reportingFrom: '2026-10-01', reportingTo: '2026-10-12',
  policy: { attractiveMonths: 24, reviewMonths: 36, exceptionMonths: 48, forecastWindowMonths: 3, watchRevenuePercent: 80, criticalRevenuePercent: 50 },
};
const samples = (page: Page) => page.evaluate(() => ({
  loads: performance.getEntriesByName('sf-economics-load').map(entry => ({ start: entry.startTime, duration: entry.duration })),
  starts: performance.getEntriesByName('sf-economics-fetch-start').map(entry => entry.startTime),
  parsed: performance.getEntriesByName('sf-economics-parsed').map(entry => entry.startTime),
}));

test('each successful refresh replaces its sample; a failed refresh has no successful sample', async ({ page }) => {
  let reads = 0, fail = false;
  await page.route('**/api/instrument-economics', async route => {
    expect(route.request().method()).toBe('GET'); reads++;
    await route.fulfill(fail ? { status: 502, json: { error: 'Measurement fixture temporarily unavailable' } } : { json: workspace,
      headers: { 'server-timing': 'stockflow;dur=12.0, auth;dur=1.0, member;dur=2.0, rpc;dur=8.0, json;dur=1.0', 'x-stockflow-response-bytes': String(new TextEncoder().encode(JSON.stringify(workspace)).byteLength) },
    });
  });
  await page.goto('/?view=instrument-economics');
  await expect.poll(async () => (await samples(page)).loads.length).toBe(1);
  let previous = (await samples(page)).loads[0].start;
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect.poll(async () => (await samples(page)).loads[0]?.start ?? 0).toBeGreaterThan(previous);
    const current = await samples(page);
    expect(current.loads).toHaveLength(1); expect(current.starts).toHaveLength(1); expect(current.parsed).toHaveLength(1);
    expect(current.loads[0].start).toBe(current.starts[0]);
    expect(current.parsed[0]).toBeGreaterThanOrEqual(current.starts[0]); expect(current.loads[0].duration).toBeGreaterThanOrEqual(0);
    const diagnostic = JSON.parse((await page.locator('main[data-economics-workspace]').getAttribute('data-load-sample'))!);
    expect(diagnostic).toMatchObject({ serverTiming: 'stockflow;dur=12.0, auth;dur=1.0, member;dur=2.0, rpc;dur=8.0, json;dur=1.0',
      responseBytes: new TextEncoder().encode(JSON.stringify(workspace)).byteLength, targetCount: 0, sourceLineCount: 0, durationMs: current.loads[0].duration });
    expect(diagnostic.fetchParseMs + diagnostic.renderAfterParseMs).toBeCloseTo(diagnostic.durationMs, 5);
    previous = current.loads[0].start;
  }
  expect(reads).toBe(3);
  fail = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Measurement fixture temporarily unavailable');
  expect((await samples(page)).loads).toHaveLength(0);
  expect(await page.locator('main[data-economics-workspace]').getAttribute('data-load-sample')).toBeNull();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
});

test('optional timing failure does not block a valid workspace', async ({ page }) => {
  await page.addInitScript(() => { performance.mark = () => { throw new Error('Timing disabled by fixture'); }; });
  await page.route('**/api/instrument-economics', route => route.fulfill({ json: workspace }));
  await page.goto('/?view=instrument-economics');
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await expect(page.getByRole('navigation', { name: 'Economics sections' })).toBeVisible();
  expect((await samples(page)).loads).toHaveLength(0);
});
