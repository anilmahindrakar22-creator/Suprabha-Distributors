import { expect, test, type Page } from '@playwright/test';
import type { AccountsResponse } from '../../lib/account-types';
import type { PowerMap, PowerMapCommand, PowerMapContact } from '../../lib/power-map-types';

const customerId = '11111111-1111-4111-8111-111111111111';
const championId = '22222222-2222-4222-8222-222222222222';
const pathologistId = '33333333-3333-4333-8333-333333333333';
const deciderId = '44444444-4444-4444-8444-444444444444';
const linkId = '55555555-5555-4555-8555-555555555555';
const contact = (id: string, name: string, decisionRole: string, stance: string): PowerMapContact => ({ id, name, decisionRole, stance, businessRole: null, influence: 'high', lastMetOn: null });
const contacts = [contact(championId, 'Asha', 'champion', 'supporter'), contact(pathologistId, 'Ravi', 'influencer', 'neutral'), contact(deciderId, 'Meena', 'decision_maker', 'neutral')];
const mapFixture: PowerMap = {
  contacts,
  links: [{ id: linkId, fromContactId: championId, toContactId: pathologistId, strength: 'strong', evidence: 'Ravi asks Asha for advice', recordedBy: 'manager@example.test', recordedAt: '2026-10-29T10:00:00Z' }],
  route: { steps: contacts.map(c => ({ contactId: c.id, name: c.name, decisionRole: c.decisionRole, stance: c.stance })), strengths: ['strong', 'medium'] },
};
const accounts: AccountsResponse = {
  accounts: [{ id: customerId, name: 'Care Lab', city: null, appContacts: [], class: { state: 'not_available', monthlyPaise: null, window: { from: '2026-07-01', to: '2026-09-30' } }, owner: null, location: null, lastVisit: null, nextVisitOn: null, lastOrderOn: null }],
  page: { page: 1, pageSize: 50, total: 1 }, classPolicy: { aMinPaise: '20000000', bMinPaise: '7500000' }, owners: [], territories: [], canAssign: false, canEraseContacts: false, canSeePowerMap: true, actorEmail: 'manager@example.test', today: '2026-10-29',
};
async function setup(page: Page, initial: PowerMap = mapFixture, options: { visible?: boolean; firstStatus?: number; networkOnce?: boolean; readFailsOnce?: boolean } = {}) {
  let map = structuredClone(initial);
  let reads = 0;
  const posts: Exclude<PowerMapCommand, { action: 'get_power_map' }>[] = [];
  await page.route('**/api/accounts**', route => route.fulfill({ json: { ...accounts, canSeePowerMap: options.visible ?? true } }));
  await page.route('**/api/power-map**', async route => {
    if (route.request().method() === 'GET') {
      reads++;
      expect(new URL(route.request().url()).searchParams.get('customerId')).toBe(customerId);
      expect(new URL(route.request().url()).searchParams.get('action')).toBe('get_power_map');
      if (options.readFailsOnce && reads === 1) { await route.fulfill({ status: 502, json: { error: 'Gateway unavailable' } }); return; }
      await route.fulfill({ json: { ...map, futureField: true, contacts: map.contacts.map(c => ({ ...c, futureField: true })), links: map.links.map(l => ({ ...l, futureField: true })), route: map.route ? { ...map.route, futureField: true, steps: map.route.steps.map(s => ({ ...s, futureField: true })) } : null } });
      return;
    }
    const command = route.request().postDataJSON() as Exclude<PowerMapCommand, { action: 'get_power_map' }>;
    posts.push(command);
    if (posts.length === 1 && options.networkOnce) { await route.abort('failed'); return; }
    if (posts.length === 1 && options.firstStatus) { await route.fulfill({ status: options.firstStatus, json: { error: 'Gateway detail' } }); return; }
    if (command.action === 'set_influence') {
      map.links = [...map.links.filter(l => l.fromContactId !== command.payload.fromContactId || l.toContactId !== command.payload.toContactId), { id: linkId, ...command.payload, recordedBy: 'manager@example.test', recordedAt: '2026-10-29T10:00:00Z' }];
    } else if (command.action === 'end_influence') map = { ...map, links: map.links.filter(l => l.id !== command.payload.influenceId), route: null };
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/?view=accounts');
  await expect(page.getByRole('heading', { name: 'Care Lab', exact: true })).toBeVisible();
  const panel = page.getByRole('region', { name: 'Influence for Care Lab', exact: true });
  if (options.visible !== false && !options.readFailsOnce) await expect(panel.getByRole('button', { name: /^Influence \(/ })).toBeVisible();
  return { panel, posts, reads: () => reads };
}
async function addForm(page: Page) {
  const panel = page.getByRole('region', { name: 'Influence for Care Lab', exact: true });
  await panel.getByRole('button', { name: /^Influence \(/ }).click();
  await panel.getByRole('button', { name: 'Add influence', exact: true }).click();
  const form = panel.getByRole('form', { name: 'Add influence', exact: true });
  await expect(form.getByLabel('From', { exact: true })).toBeFocused();
  await expect(form.getByLabel('Strength', { exact: true })).toHaveValue('');
  await form.getByLabel('From', { exact: true }).selectOption(championId);
  await expect(form.getByLabel('To', { exact: true }).locator(`option[value="${championId}"]`)).toBeDisabled();
  await form.getByLabel('To', { exact: true }).selectOption(deciderId);
  await form.getByLabel('Strength', { exact: true }).selectOption('medium');
  await form.getByLabel('Evidence', { exact: true }).fill('Meena asks Asha for advice');
  await expect(form.getByText("What you saw; don't write personal details", { exact: true })).toBeVisible();
  return form;
}

for (const width of [375, 1280]) {
  test.describe(`power map at ${width}px`, () => {
    test.use({ viewport: { width, height: 812 } });
    test('summary shows the route with only the decider bold', async ({ page }) => {
      const { panel } = await setup(page);
      await expect(panel.locator('p').first()).toHaveText('Route to decider: Asha → Ravi → Meena');
      await expect(panel.locator('strong')).toHaveText(['Meena']);
      await expect(panel.getByRole('list', { name: 'Influence links' })).toHaveCount(0);
      await expect(panel.getByRole('button', { name: 'Add influence', exact: true })).toHaveCount(0);
    });
    test('summary supports a supporter who is the decider', async ({ page }) => {
      const decider = { ...contacts[0], decisionRole: 'decision_maker' };
      const { panel } = await setup(page, { contacts: [decider], links: [], route: { steps: [{ ...decider, contactId: decider.id }], strengths: [] } });
      await expect(panel.locator('p').first()).toHaveText('Route to decider: Asha');
      await expect(panel.locator('strong')).toHaveText('Asha');
    });
    const states: Array<{ title: string; map: PowerMap; summary: string }> = [
      { title: 'no supporter', map: { contacts: contacts.map(c => ({ ...c, stance: 'neutral' })), links: [], route: null }, summary: 'No supporter yet: find a champion' },
      { title: 'no decision maker', map: { contacts: contacts.slice(0, 2), links: [], route: null }, summary: 'No decision maker known' },
      { title: 'no known path', map: { contacts, links: [], route: null }, summary: 'No known route to Meena: ask who they listen to' },
    ];
    for (const state of states) test(`summary shows ${state.title}`, async ({ page }) => { const { panel } = await setup(page, state.map); await expect(panel.locator('p').first()).toHaveText(state.summary); });
    test('quiet toggle reveals and hides links, strength and evidence', async ({ page }) => {
      const { panel } = await setup(page);
      const toggle = panel.getByRole('button', { name: 'Influence (1)', exact: true });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const list = panel.getByRole('list', { name: 'Influence links' });
      await expect(list.getByRole('listitem')).toHaveCount(1);
      await expect(list).toContainText('Asha → Ravi');
      await expect(list).toContainText('Strong');
      await expect(list).toContainText('Ravi asks Asha for advice');
      await toggle.click();
      await expect(list).toHaveCount(0);
    });
    test('adding influence posts the contract and refreshes the list', async ({ page }) => {
      const { panel, posts, reads } = await setup(page, { contacts, links: [], route: null });
      const form = await addForm(page);
      await form.getByRole('button', { name: 'Save influence', exact: true }).click();
      await expect(panel.getByRole('status')).toHaveText('Saved.');
      expect(posts[0]).toEqual({ action: 'set_influence', payload: { requestId: expect.any(String), customerId, fromContactId: championId, toContactId: deciderId, strength: 'medium', evidence: 'Meena asks Asha for advice' } });
      await expect(panel.getByRole('list', { name: 'Influence links' })).toContainText('Asha → Meena');
      expect(reads()).toBeGreaterThan(1);
      await expect(form).toHaveCount(0);
    });
    test('End requires a reason, posts the contract and refreshes', async ({ page }) => {
      const { panel, posts } = await setup(page);
      await panel.getByRole('button', { name: 'Influence (1)', exact: true }).click();
      const end = panel.getByRole('button', { name: 'End influence from Asha to Ravi', exact: true });
      await end.click();
      const form = panel.getByRole('form', { name: 'End influence', exact: true });
      await expect(form.getByLabel('Reason', { exact: true })).toBeFocused();
      await form.getByRole('button', { name: 'End influence', exact: true }).click();
      expect(posts).toHaveLength(0);
      await form.getByLabel('Reason', { exact: true }).fill('No longer observed');
      await form.getByRole('button', { name: 'End influence', exact: true }).click();
      await expect(panel.getByRole('status')).toHaveText('Saved.');
      expect(posts[0]).toEqual({ action: 'end_influence', payload: { requestId: expect.any(String), influenceId: linkId, reason: 'No longer observed' } });
      await expect(panel.getByRole('button', { name: 'Influence (0)', exact: true })).toBeVisible();
    });
    test('network retry keeps the same request ID', async ({ page }) => {
      const { panel, posts } = await setup(page, mapFixture, { networkOnce: true });
      const form = await addForm(page);
      await form.getByRole('button', { name: 'Save influence', exact: true }).click();
      await expect(panel.getByRole('alert')).toHaveText('Not saved. Check the connection and try again.');
      await form.getByRole('button', { name: 'Save influence', exact: true }).click();
      await expect(panel.getByRole('status')).toHaveText('Saved.');
      expect(posts).toHaveLength(2); expect(posts[1]).toEqual(posts[0]);
    });
    for (const status of [502, 408, 429, 422]) test(`retry ${status === 422 ? 'renews' : 'preserves'} request ID after ${status}`, async ({ page }) => {
      const { panel, posts } = await setup(page, mapFixture, { firstStatus: status });
      const form = await addForm(page);
      await form.getByRole('button', { name: 'Save influence', exact: true }).click();
      await expect(panel.getByRole('alert')).toHaveText('Gateway detail');
      await form.getByRole('button', { name: 'Save influence', exact: true }).click();
      await expect(panel.getByRole('status')).toHaveText('Saved.');
      expect(posts).toHaveLength(2);
      if (status === 422) expect(posts[1].payload.requestId).not.toBe(posts[0].payload.requestId);
      else expect(posts[1]).toEqual(posts[0]);
    });
    test('409 closes the form and refreshes with a notice', async ({ page }) => {
      const { panel, posts, reads } = await setup(page, mapFixture, { firstStatus: 409 });
      const form = await addForm(page);
      await form.getByRole('button', { name: 'Save influence', exact: true }).click();
      await expect(panel.getByRole('status')).toHaveText('Someone else changed this power map. The list has been refreshed.');
      await expect(form).toHaveCount(0); expect(reads()).toBeGreaterThan(1); expect(posts).toHaveLength(1);
    });
    test('Cancel restores focus to Add influence', async ({ page }) => {
      const { panel, posts } = await setup(page);
      const form = await addForm(page);
      await form.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(panel.getByRole('button', { name: 'Add influence', exact: true })).toBeFocused();
      expect(posts).toHaveLength(0);
    });
    test('failed reads show Retry without a misleading empty summary', async ({ page }) => {
      const { panel } = await setup(page, mapFixture, { readFailsOnce: true });
      await expect(panel.getByRole('alert')).toHaveText('Gateway unavailable');
      await expect(panel.getByText('No supporter yet: find a champion')).toHaveCount(0);
      await panel.getByRole('button', { name: 'Retry influence', exact: true }).click();
      await expect(panel.locator('p').first()).toHaveText('Route to decider: Asha → Ravi → Meena');
    });
    test('canSeePowerMap false prevents mounting and fetching', async ({ page }) => {
      const { panel, reads } = await setup(page, mapFixture, { visible: false });
      await expect(panel).toHaveCount(0); expect(reads()).toBe(0);
    });
    test('no horizontal scroll with summary, details, Add and End forms', async ({ page }) => {
      const longMap = structuredClone(mapFixture);
      longMap.contacts[0].name = 'Asha'.repeat(35);
      longMap.route!.steps[0].name = longMap.contacts[0].name;
      longMap.links[0].evidence = 'Observed'.repeat(35);
      const { panel } = await setup(page, longMap);
      const noOverflow = async () => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      };
      await noOverflow();
      const form = await addForm(page); await noOverflow();
      await form.getByRole('button', { name: 'Cancel', exact: true }).click();
      await panel.getByRole('button', { name: /^End influence from/ }).click();
      await expect(panel.getByRole('form', { name: 'End influence', exact: true })).toBeVisible();
      await noOverflow();
    });
  });
}
