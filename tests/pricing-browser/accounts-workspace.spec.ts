import { expect, test, type Page } from '@playwright/test';
import type { AccountRow, AccountsResponse } from '../../lib/account-types';

const customerId = '11111111-1111-4111-8111-111111111111';
const territoryId = '22222222-2222-4222-8222-222222222222';
const visitId = '88888888-8888-4888-8888-888888888888';
const base: AccountRow = { id: customerId, name: 'Care Lab', city: 'Pune', appContacts: [], owner: { email: 'sales@example.test', territoryId, territoryName: 'West', since: '2026-10-01', version: 3 }, location: null, lastVisit: null, nextVisitOn: '2026-10-03', lastOrderOn: null, class: { state: 'not_available', monthlyPaise: null, window: { from: '2026-07-01', to: '2026-09-30' } } };
const fixture: AccountsResponse = {
  accounts: [{ ...base }, { ...base, id: '33333333-3333-4333-8333-333333333333', name: 'City Lab', nextVisitOn: '2026-10-21' }, { ...base, id: '44444444-4444-4444-8444-444444444444', name: 'New Lab', nextVisitOn: null }],
  page: { page: 1, pageSize: 50, total: 3 }, owners: [{ email: 'sales@example.test', name: 'Salesperson' }, { email: 'other@example.test', name: 'Other salesperson' }],
  territories: [{ id: territoryId, name: 'West' }], canAssign: false, canEraseContacts: false, canSeePowerMap: false, actorEmail: 'sales@example.test', today: '2026-10-14',
  classPolicy: { aMinPaise: '20000000', bMinPaise: '7500000' },
};
type Command = Record<string, unknown>;
async function mockAccounts(page: Page, options: { location?: AccountRow['location']; actorEmail?: string; canSeeStyle?: boolean; canAssign?: boolean; canEraseContacts?: boolean; canSeePowerMap?: boolean; powerAlerts?: AccountRow['powerAlerts']; lastVisit?: AccountRow['lastVisit']; emptyMine?: boolean; status?: number; networkOnce?: boolean; paginate?: boolean; classes?: boolean; appContacts?: AccountRow['appContacts']; duplicatePhone?: boolean } = {}) {
  const gets: string[] = [];
  const posts: Command[] = [];
  const territories = [...fixture.territories];
  await page.route('**/api/accounts**', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Command;
      posts.push(body);
      if (options.networkOnce && posts.length === 1) { await route.abort('failed'); return; }
      if (options.status) { await route.fulfill({ status: options.status, json: { error: 'Account changed' } }); return; }
      if (body.action === 'create_territory') territories.push({ id: '55555555-5555-4555-8555-555555555555', name: String(body.name) });
      await route.fulfill({ json: { ok: true, ...(body.action === 'log_visit' ? { visitId } : {}), duplicatePhone: options.duplicatePhone ?? false } });
    } else {
      gets.push(route.request().url());
      const query = new URL(route.request().url()).searchParams;
      const classRows: AccountRow[] = (['A', 'B', 'below_b', 'not_available', 'not_linked'] as const).map((state, index) => ({ ...base, id: `class-${index}`, name: `Class ${state} Lab`, class: { ...base.class, state, monthlyPaise: index < 3 ? ['21000000', '7500000', '5000000'][index] : null } }));
      const accounts = options.classes ? classRows.filter(row => !query.get('class') || row.class.state === query.get('class')) : options.emptyMine && query.get('scope') === 'mine' ? [] : options.paginate ? [fixture.accounts[Number(query.get('page')) - 1]] : fixture.accounts;
      await route.fulfill({ json: { ...fixture, actorEmail: options.actorEmail ?? fixture.actorEmail, accounts: accounts.map(row => ({ ...row, ...(row.id === customerId && options.location ? { location: options.location } : {}), canSeeStyle: options.canSeeStyle ?? false, appContacts: row.id === customerId ? options.appContacts ?? [] : [], ...(row.id === customerId && options.powerAlerts ? { powerAlerts: options.powerAlerts } : {}), ...(row.id === customerId && options.lastVisit ? { lastVisit: options.lastVisit } : {}) })), territories, canAssign: options.canAssign ?? false, canEraseContacts: options.canEraseContacts ?? false, canSeePowerMap: options.canSeePowerMap ?? false, page: { page: Number(query.get('page')), pageSize: options.paginate ? 1 : 50, total: options.paginate ? 3 : accounts.length } } });
    }
  });
  await page.goto('/?view=accounts');
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
  await expect(page.getByText('Loading accounts…')).toHaveCount(0);
  return { gets, posts };
}
const firstCard = (page: Page) => page.getByRole('list', { name: 'Accounts' }).getByRole('listitem').first();
const appContact: AccountRow['appContacts'][number] = { id: '66666666-6666-4666-8666-666666666666', name: 'App buyer', businessRole: 'Purchase', phone: '+91 98765 43210', email: 'buyer@example.test', addedBy: 'sales@example.test', version: 3, canEdit: true };
const powerContacts: AccountRow['appContacts'] = [
  { ...appContact, name: 'Asha', canEdit: false, lastMetOn: '2026-10-03', assessment: { decisionRole: 'decision_maker', stance: 'sceptical', influence: 'high', reason: 'Chose competitor', recordedAt: '2026-10-14', actor: 'manager@example.test' } },
  { ...appContact, id: '77777777-7777-4777-8777-777777777777', name: 'Ravi' },
];

const analytical: NonNullable<AccountRow['appContacts'][number]['style']> = { state: 'analytical', computedStyle: 'analytical', confidence: 'high', observations: 3, distinctDates: 3, assertiveness: 1.5, responsiveness: 1.5, override: null, cues: {} };
const recentVisit: NonNullable<AccountRow['lastVisit']> = { id: visitId, visitedOn: '2026-10-03', outcome: 'met', visitedBy: 'sales@example.test', note: null, metContacts: powerContacts.map(({ id, name }) => ({ id, name })) };
test('account states and rating choices use semantic colours and decorative icons', async ({ page }) => {
  const blocker = { ...appContact, assessment: { ...powerContacts[0].assessment!, stance: 'blocker' as const } };
  await mockAccounts(page, { canSeePowerMap: true, appContacts: [blocker], lastVisit: { ...recentVisit, metContacts: [{ id: blocker.id, name: blocker.name }] } });
  const card = firstCard(page);
  await expect(card.getByText('Visit overdue · due 3 Oct', { exact: true })).toHaveClass(/bg-sf-danger-soft/);
  await expect(card.getByText('Blocker', { exact: true })).toHaveClass(/text-sf-danger/);
  await expect(page.locator('[aria-label="Accounts"] svg:not([aria-hidden="true"])')).toHaveCount(0);
  await card.getByRole('button', { name: /^Rate behaviour for App buyer/ }).click();
  const choices = card.getByRole('radio').locator('..');
  await expect(choices.nth(0)).toHaveClass(/bg-sf-cool-soft/);
  await expect(choices.nth(3)).toHaveClass(/bg-sf-warm-soft/);
  await expect(page.locator('[aria-label="Accounts"] svg:not([aria-hidden="true"])')).toHaveCount(0);
});

test('phone card fits alerts, outside pin, Power Map chips and open More actions', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'pricing-mobile', 'Phone layout');
  await page.setViewportSize({ width: 375, height: 812 });
  await mockAccounts(page, { location: { precision: 'pin', latitude: '18.52', longitude: '73.85', town: null, verifiedBy: 'sales@example.test', verifiedAt: '2026-10-14', version: 1 }, canSeePowerMap: true, canSeeStyle: true, canAssign: true, powerAlerts: ['no_decision_maker', 'decision_maker_not_met', 'influential_blocker'], appContacts: [{ ...appContact, assessment: powerContacts[0].assessment, style: analytical, styleObservations: [] }] });
  const card = firstCard(page);
  await expect(card.getByText('· outside market area', { exact: true })).toBeVisible();
  await expect(card.getByText('High influence', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'More actions for App buyer', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Remove App buyer', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.locator('[aria-label="Accounts"] svg:not([aria-hidden="true"])')).toHaveCount(0);
});
const behaviours = [
  ['Speaks slowly and carefully', 'Speaks quickly and firmly'],
  ['Asks questions, holds back opinions', 'States opinions'],
  ['Follows our agenda', 'Takes control of the meeting'],
  ['Wants time and consults others', 'Decides on the spot'],
  ['Talks tasks, facts, numbers', 'Talks people, stories'],
  ['Formal, reserved', 'Warm, animated'],
  ['Strict on time, straight to business', 'Relaxed, enjoys small talk'],
  ['Asks for proof and data', 'Goes by trust and peer labs'],
] as const;
async function fillRating(page: Page, name: string) {
  const form = firstCard(page).getByRole('form', { name: `Rate behaviour for ${name}`, exact: false });
  const questions = [`How did ${name} speak?`, `Did ${name} ask or tell?`, 'Who led the meeting?', `How did ${name} decide?`, `What did ${name} talk about?`, `How did ${name} come across?`, `How did ${name} treat time?`, `What convinced ${name}?`];
  for (const [index, value] of [1, 2, 3, 4, 4, 3, 2, 1].entries()) {
    await expect(form.getByRole('group', { name: questions[index], exact: true })).toBeVisible();
    const strength = value === 1 || value === 4 ? 'Clearly' : 'Slightly';
    const behaviour = behaviours[index][value <= 2 ? 0 : 1];
    const phrase = behaviour.charAt(0).toLowerCase() + behaviour.slice(1);
    await form.getByRole('radio', { name: `${strength} ${phrase}`, exact: true }).locator('..').click();
    await expect(form.getByText(`Rate ${name} · ${index < 7 ? `${index + 2} of 8` : 'last step'}`, { exact: true })).toBeVisible();
  }
  await form.getByRole('checkbox', { name: `Validation or QC papers for ${name}`, exact: false }).check();
  await form.getByRole('checkbox', { name: `Reference labs for ${name}`, exact: false }).check();
  return form;
}

test('two met contacts open focused ratings in order and send the returned visit id', async ({ page }) => {
  const { posts } = await mockAccounts(page, { appContacts: powerContacts });
  await firstCard(page).getByRole('button', { name: 'Log visit for Care Lab', exact: false }).click();
  const visit = firstCard(page).getByRole('form', { name: 'Log visit' });
  for (const name of ['Asha', 'Ravi']) await visit.getByRole('checkbox', { name: `Met ${name} for Care Lab`, exact: false }).check();
  await visit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Log visit for/ })).toHaveCount(0);
  await expect(page.getByLabel('Search accounts')).toBeHidden();
  await expect(page.getByText('After visit · person 1 of 2 people met', { exact: true })).toBeVisible();
  const openedForm = firstCard(page).getByRole('form', { name: /^Rate behaviour for Asha/ });
  await expect(openedForm.getByText('Rate Asha · 1 of 8', { exact: true })).toBeVisible();
  const headerBox = await openedForm.getByText('Rate Asha · 1 of 8', { exact: true }).boundingBox();
  expect(headerBox).not.toBeNull();
  expect(headerBox!.y).toBeGreaterThanOrEqual(0);
  expect(headerBox!.y + headerBox!.height).toBeLessThanOrEqual(400);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect(openedForm.getByRole('radio')).toHaveCount(4);
  for (const radio of await openedForm.getByRole('radio').all()) await expect(radio).toBeVisible();
  await expect(openedForm.getByText('Pace and control', { exact: true })).toBeVisible();
  const form = await fillRating(page, 'Asha');
  await form.getByRole('button', { name: /^Save rating for Asha/ }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByText('Rate Ravi · 1 of 8', { exact: true })).toBeVisible();
  await expect(page.getByText('After visit · person 2 of 2 people met', { exact: true })).toBeVisible();
  expect(posts[1]).toEqual({ action: 'record_style_observation', contactId: powerContacts[0].id, visitId, a: [1, 2, 3, 4], r: [4, 3, 2, 1], cues: ['validation_data', 'reference_labs'], idempotencyKey: expect.any(String) });
  await firstCard(page).getByRole('button', { name: /^Skip rating Ravi/ }).click();
  await expect(page.getByRole('listitem')).toHaveCount(3);
  await expect(page.getByRole('form', { name: /^Rate behaviour/ })).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('Saved.');
});

test('already rated after a visit advances the queue and finishes with Saved', async ({ page }) => {
  await mockAccounts(page, { appContacts: powerContacts });
  await firstCard(page).getByRole('button', { name: /^Log visit for/ }).click();
  const visit = page.getByRole('form', { name: 'Log visit', exact: true });
  for (const name of ['Asha', 'Ravi']) await visit.getByRole('checkbox', { name: `Met ${name} for Care Lab`, exact: false }).check();
  await visit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Rate Asha · 1 of 8', { exact: true })).toBeVisible();
  await page.route('**/api/accounts', route => route.fulfill({ status: 409, json: { code: 'PT409', error: 'Already rated for this visit' } }));
  const form = await fillRating(page, 'Asha');
  await form.getByRole('button', { name: /^Save rating for Asha/ }).click();
  await expect(page.getByText('Rate Ravi · 1 of 8', { exact: true })).toBeVisible();
  await expect(page.getByText('After visit · person 2 of 2 people met', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Skip rating Ravi/ }).click();
  await expect(page.getByRole('listitem')).toHaveCount(3);
  await expect(page.getByRole('status')).toHaveText('Saved.');
});

for (const leave of ['Cancel', 'Back to accounts']) {
  test(`${leave} ends the whole after-visit queue without a rating POST`, async ({ page }) => {
    const { posts } = await mockAccounts(page, { appContacts: powerContacts });
    await firstCard(page).getByRole('button', { name: /^Log visit for/ }).click();
    const visit = page.getByRole('form', { name: 'Log visit', exact: true });
    for (const name of ['Ravi', 'Asha']) await visit.getByRole('checkbox', { name: `Met ${name} for Care Lab`, exact: false }).check();
    await visit.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Rate Asha · 1 of 8', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: leave === 'Cancel' ? /^Cancel rating for Asha/ : /^Back to accounts, stop rating Asha/ }).click();
    await expect(page.getByRole('listitem')).toHaveCount(3);
    await expect(page.getByRole('heading', { name: 'Care Lab', exact: true })).toBeFocused();
    await expect(page.getByRole('form', { name: /^Rate behaviour/ })).toHaveCount(0);
    expect(posts).toHaveLength(1);
    expect(posts[0].action).toBe('log_visit');
  });

  test(`${leave} restores focus after a contact rating`, async ({ page }) => {
    const { posts } = await mockAccounts(page, { lastVisit: recentVisit, appContacts: powerContacts });
    const opener = firstCard(page).getByRole('button', { name: /^Rate behaviour for Asha/ });
    await opener.click();
    await expect(page.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByLabel('Search accounts')).toBeHidden();
    await expect(page.getByRole('button', { name: /^Skip rating/ })).toHaveCount(0);
    await page.getByRole('button', { name: leave === 'Cancel' ? /^Cancel rating for Asha/ : /^Back to accounts, stop rating Asha/ }).click();
    await expect(page.getByRole('listitem')).toHaveCount(3);
    await expect(opener).toBeFocused();
    expect(posts).toHaveLength(0);
  });
}

test('owner sees style and tip without management controls', async ({ page }) => {
  await mockAccounts(page, { canSeeStyle: true, appContacts: [{ ...appContact, style: analytical }] });
  await expect(firstCard(page).getByText('Analytical · high confidence', { exact: true })).toBeVisible();
  await expect(firstCard(page).getByText("Bring the data: cost per test, validation papers, a written comparison. Don't rush.", { exact: true })).toBeVisible();
  await expect(firstCard(page).getByRole('button', { name: /^Ratings|^Override style/ })).toHaveCount(0);
});

test('management expands ratings and saves an override with its reason', async ({ page }) => {
  const { posts } = await mockAccounts(page, { canSeeStyle: true, appContacts: [{ ...appContact, style: analytical, styleObservations: [{ observer: 'Manager', recordedAt: '2026-10-03T10:00:00Z', a: [1, 2, 3, 4], r: [1, 1, 2, 2], cues: ['validation_data'] }] }] });
  await firstCard(page).getByRole('button', { name: 'More actions for App buyer', exact: true }).click();
  await firstCard(page).getByRole('button', { name: /^Ratings for App buyer/ }).click();
  await expect(firstCard(page).getByRole('list', { name: /^Ratings for App buyer/ })).toHaveText('3 Oct · Manager · A 2.50 · R 1.50 · Validation or QC papers');
  await firstCard(page).getByRole('button', { name: /^Override style for App buyer/ }).click();
  const form = firstCard(page).getByRole('form', { name: /^Override style for App buyer/ });
  await expect(form.locator('label select')).toHaveCount(0);
  await form.getByLabel(/^Style for App buyer/).selectOption('amiable');
  await form.getByLabel(/^Override reason for App buyer/).fill('Prefers a trusted service team');
  await form.getByRole('button', { name: /^Save override for App buyer/ }).click();
  await expect(form).toHaveCount(0);
  expect(posts[0]).toEqual({ action: 'set_style_override', contactId: appContact.id, style: 'amiable', reason: 'Prefers a trusted service team', idempotencyKey: expect.any(String) });
});

test('management contact actions share a row and More toggles secondary buttons', async ({ page }) => {
  await mockAccounts(page, { canSeeStyle: true, canSeePowerMap: true, lastVisit: recentVisit, appContacts: [{ ...powerContacts[0], canEdit: true, style: analytical, styleObservations: [] }] });
  const card = firstCard(page);
  const more = card.getByRole('button', { name: 'More actions for Asha', exact: true });
  const actions = more.locator('..');
  await expect(actions.getByRole('button')).toHaveText(['Rate behaviour', 'Set role', 'Edit', 'More']);
  for (const button of await actions.getByRole('button').all()) await expect(button).toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const secondary = card.locator(`[id="${await more.getAttribute('aria-controls')}"]`);
  await expect(secondary.getByRole('button')).toHaveText(['Ratings (0)', 'Override style', 'Remove']);
  for (const button of await secondary.getByRole('button').all()) await expect(button).toBeVisible();
  await secondary.getByRole('button', { name: /^Override style for Asha/ }).click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await actions.getByRole('button', { name: 'Set role for Asha', exact: true }).click();
  await expect(card.getByRole('form', { name: /^Override style for Asha/ })).toHaveCount(0);
  await expect(card.getByRole('form', { name: /^Set role for Asha at/ })).toBeVisible();
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(secondary).toHaveCount(0);
});

test('phone contact action buttons are at least 44 pixels high with More and role form open', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'pricing-mobile', 'Phone layout');
  await mockAccounts(page, { canSeeStyle: true, canSeePowerMap: true, lastVisit: recentVisit, appContacts: [{ ...powerContacts[0], canEdit: true, style: analytical, styleObservations: [] }] });
  await page.setViewportSize({ width: 375, height: 812 });
  const card = firstCard(page);
  const more = card.getByRole('button', { name: 'More actions for Asha', exact: true });
  const contact = more.locator('../..');
  await more.click();
  for (const button of await contact.getByRole('button').all()) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await card.getByRole('button', { name: 'Set role for Asha', exact: true }).click();
  await expect(card.getByRole('form', { name: /^Set role for Asha at/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  for (const button of await card.getByRole('form', { name: /^Set role for Asha at/ }).getByRole('button').all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

test('non-owner sales can rate a recent meeting without seeing styles', async ({ page }) => {
  await mockAccounts(page, { actorEmail: 'other@example.test', lastVisit: { ...recentVisit, visitedBy: 'other@example.test' }, appContacts: powerContacts.map(contact => ({ ...contact, canEdit: false, style: analytical, styleObservations: [] })) });
  await expect(firstCard(page).getByText(/confidence|Bring the data/)).toHaveCount(0);
  await expect(firstCard(page).getByRole('button', { name: /^Ratings|^Override style/ })).toHaveCount(0);
  const opener = firstCard(page).getByRole('button', { name: /^Rate behaviour for Asha/ });
  await expect(opener.locator('..').getByRole('button')).toHaveText(['Rate behaviour']);
  await expect(firstCard(page).getByRole('button', { name: 'More actions for Asha', exact: true })).toHaveCount(0);
  await opener.click();
  const form = await fillRating(page, 'Asha');
  await form.getByRole('button', { name: /^Cancel rating for Asha/ }).click();
  await expect(opener).toBeFocused();
});

test('a different visitors meeting has no rating action', async ({ page }) => {
  await mockAccounts(page, { lastVisit: { ...recentVisit, visitedBy: 'other@example.test' }, appContacts: powerContacts });
  await expect(firstCard(page).getByRole('button', { name: /^Rate behaviour/ })).toHaveCount(0);
});

test('Back keeps the rating answer', async ({ page }) => {
  await mockAccounts(page, { lastVisit: recentVisit, appContacts: powerContacts });
  await firstCard(page).getByRole('button', { name: /^Rate behaviour for Asha/ }).click();
  const form = firstCard(page).getByRole('form', { name: /^Rate behaviour for Asha/ });
  const firstChoice = form.getByRole('radio', { name: 'Clearly speaks slowly and carefully', exact: true });
  await firstChoice.locator('..').click();
  await expect(form.getByText('Rate Asha · 2 of 8', { exact: true })).toBeVisible();
  await expect(form.getByRole('radio', { name: 'Slightly states opinions', exact: true }).locator('..').locator('svg')).toHaveCount(1);
  await form.getByRole('button', { name: /^Back, rating Asha/ }).click();
  await expect(form.getByText('Rate Asha · 1 of 8', { exact: true })).toBeVisible();
  await expect(firstChoice).toBeChecked();
  await expect(firstChoice.locator('..').locator('svg')).toHaveCount(3);
  await expect(firstChoice.locator('..').locator('svg[aria-hidden="true"]')).toHaveCount(3);
  await form.getByRole('button', { name: /^Next, rating Asha/ }).click();
  await expect(form.getByText('Rate Asha · 2 of 8', { exact: true })).toBeVisible();
});

test('keyboard rating selection does not auto-advance', async ({ page }) => {
  await mockAccounts(page, { lastVisit: recentVisit, appContacts: powerContacts });
  await firstCard(page).getByRole('button', { name: /^Rate behaviour for Asha/ }).click();
  const form = firstCard(page).getByRole('form', { name: /^Rate behaviour for Asha/ });
  const firstChoice = form.getByRole('radio', { name: 'Clearly speaks slowly and carefully', exact: true });
  await firstChoice.focus();
  await firstChoice.press('ArrowDown');
  await expect(form.getByRole('radio', { name: 'Slightly speaks slowly and carefully', exact: true })).toBeChecked();
  await page.waitForTimeout(300); // Wait beyond the pointer advance delay.
  await expect(form.getByText('Rate Asha · 1 of 8', { exact: true })).toBeVisible();
  await expect(form.getByRole('button', { name: /^Next, rating Asha/ })).toBeEnabled();
});

test('phone rating choices have large tap targets and no horizontal overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'pricing-mobile', 'Phone layout');
  await mockAccounts(page, { lastVisit: recentVisit, appContacts: powerContacts });
  await page.setViewportSize({ width: 375, height: 812 });
  await firstCard(page).getByRole('button', { name: /^Rate behaviour for Asha/ }).click();
  const form = firstCard(page).getByRole('form', { name: /^Rate behaviour for Asha/ });
  await expect(form.getByText('Rate Asha · 1 of 8', { exact: true })).toBeVisible();
  const headingBox = await form.getByText('Rate Asha · 1 of 8', { exact: true }).boundingBox();
  expect(headingBox).not.toBeNull();
  expect(headingBox!.y).toBeGreaterThanOrEqual(0);
  expect(headingBox!.y + headingBox!.height).toBeLessThanOrEqual(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  for (let step = 0; step < 8; step++) {
    for (const radio of await form.getByRole('radio').all()) {
      const box = await radio.locator('..').boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(48);
    }
    if (step === 6) {
      const label = form.getByRole('radio', { name: 'Clearly strict on time, straight to business', exact: true }).locator('..');
      const labelBox = (await label.boundingBox())!;
      const textBox = (await label.locator('span').first().boundingBox())!;
      const iconsBox = (await label.locator('span[aria-hidden="true"]').boundingBox())!;
      expect(textBox.height).toBeGreaterThan(20);
      expect(textBox.x + textBox.width).toBeLessThanOrEqual(iconsBox.x);
      expect(iconsBox.x + iconsBox.width).toBeLessThanOrEqual(labelBox.x + labelBox.width);
      expect(iconsBox.x + iconsBox.width).toBeLessThanOrEqual(375);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await form.getByRole('radio').first().locator('..').click();
    await expect(form.getByText(`Rate Asha · ${step < 7 ? `${step + 2} of 8` : 'last step'}`, { exact: true })).toBeVisible();
  }
  await expect(form.getByText('Rate Asha · last step', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('already rated PT409 is a notice', async ({ page }) => {
  await mockAccounts(page, { lastVisit: recentVisit, appContacts: powerContacts });
  await page.route('**/api/accounts', route => route.fulfill({ status: 409, json: { code: 'PT409', error: 'Already rated for this visit' } }));
  await firstCard(page).getByRole('button', { name: /^Rate behaviour for Asha/ }).click();
  const form = await fillRating(page, 'Asha');
  await form.getByRole('button', { name: /^Save rating for Asha/ }).click();
  await expect(firstCard(page).getByRole('status')).toHaveText('Already rated for this visit');
  await expect(firstCard(page).getByRole('alert')).toHaveCount(0);
});

for (const failure of [502, 408, 429, 422, 'network'] as const) {
  test(`rating retry handles ${failure} with the correct key`, async ({ page }) => {
    await mockAccounts(page, { lastVisit: recentVisit, appContacts: powerContacts });
    const attempts: Command[] = [];
    await page.route('**/api/accounts', async route => {
      attempts.push(route.request().postDataJSON() as Command);
      if (attempts.length === 1 && failure === 'network') { await route.abort('failed'); return; }
      await route.fulfill(attempts.length === 1 ? { status: failure as number, json: { error: 'Try again' } } : { json: { ok: true } });
    });
    await firstCard(page).getByRole('button', { name: /^Rate behaviour for Asha/ }).click();
    const form = await fillRating(page, 'Asha');
    const save = form.getByRole('button', { name: /^Save rating for Asha/ });
    await save.click();
    await expect(firstCard(page).getByRole('alert')).toHaveText(failure === 'network' ? 'Not saved. Check the connection and try again.' : 'Try again');
    await save.click();
    await expect(form).toHaveCount(0);
    expect(attempts).toHaveLength(2);
    if (failure === 422) expect(attempts[1].idempotencyKey).not.toEqual(attempts[0].idempotencyKey);
    else expect(attempts[1]).toEqual(attempts[0]);
  });
}

test('management sees Power Map and saves a preset role assessment with a reload', async ({ page }) => {
  const { gets, posts } = await mockAccounts(page, { canSeePowerMap: true, powerAlerts: ['no_decision_maker', 'decision_maker_not_met', 'influential_blocker'], appContacts: powerContacts });
  const card = firstCard(page);
  for (const text of ['No decision maker known', 'Decision maker not met in 60 days', 'Influential blocker']) await expect(card.getByText(text, { exact: true })).toBeVisible();
  for (const text of ['Decision maker', 'Sceptical', 'High influence', 'Last met 3 Oct']) await expect(card.getByText(text, { exact: true })).toBeVisible();
  for (const text of ['Role not set', 'Not met yet']) await expect(card.getByText(text, { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Set role for Asha', exact: true }).click();
  const form = card.getByRole('form', { name: 'Set role for Asha at Care Lab', exact: false });
  await expect(form.getByLabel('Decision role for Asha', { exact: false })).toHaveValue('decision_maker');
  await expect(form.getByLabel('Stance for Asha', { exact: false })).toHaveValue('sceptical');
  await expect(form.getByLabel('Influence for Asha', { exact: false })).toHaveValue('high');
  await expect(form.getByLabel('Reason for Asha', { exact: false })).toHaveValue('Chose competitor');
  await expect(form.getByLabel('Reason for Asha', { exact: false })).toHaveAttribute('maxlength', '300');
  await expect(form.locator('label select')).toHaveCount(0);
  await form.getByLabel('Decision role for Asha', { exact: false }).selectOption('influencer');
  await form.getByLabel('Stance for Asha', { exact: false }).selectOption('supporter');
  await form.getByLabel('Influence for Asha', { exact: false }).selectOption('medium');
  await form.getByLabel('Reason for Asha', { exact: false }).fill('Recommended our offer');
  const before = gets.length;
  await form.getByRole('button', { name: 'Save role for Asha', exact: false }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts[0]).toEqual({ action: 'set_assessment', contactId: appContact.id, decisionRole: 'influencer', stance: 'supporter', influence: 'medium', reason: 'Recommended our offer', idempotencyKey: expect.any(String) });
  await expect.poll(() => gets.length).toBeGreaterThan(before);
  await expect(form).toHaveCount(0);
});

test('management sees Who decides while sales does not, and the line fits on mobile', async ({ page }, testInfo) => {
  const decisionMaker = { ...appContact, name: 'Asha', assessment: { decisionRole: 'decision_maker' as const, stance: 'supporter' as const, influence: 'high' as const, reason: null, recordedAt: '2026-10-14', actor: 'manager@example.test' }, lastMetOn: '2026-09-12' };
  await mockAccounts(page, { canSeePowerMap: true, appContacts: [decisionMaker] });
  const line = 'Decides: Asha · Supporter · met 12 Sep';
  await expect(firstCard(page).getByText(line, { exact: true })).toBeVisible();
  await mockAccounts(page, { appContacts: [decisionMaker] });
  await expect(firstCard(page).getByText(/^Decides:/)).toHaveCount(0);

  test.skip(testInfo.project.name !== 'pricing-mobile', 'Phone layout');
  const longName = 'L'.repeat(60);
  await mockAccounts(page, { canSeePowerMap: true, appContacts: [{ ...decisionMaker, name: longName }] });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(firstCard(page).getByText(new RegExp(`^Decides: ${longName}`))).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('sales response without Power Map contact keys hides all Power Map UI', async ({ page }) => {
  await mockAccounts(page, { appContacts: [appContact] });
  await expect(page.getByLabel('Power Map', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Set role for/ })).toHaveCount(0);
  for (const text of ['No decision maker known', 'Decision maker not met in 60 days', 'Influential blocker', 'Role not set · Not met yet']) await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  await expect(firstCard(page).getByText(/Last met|influence/)).toHaveCount(0);
});

test('visit contacts are available to sales and send two met ids with last visit names', async ({ page }) => {
  const appContacts = powerContacts.map(({ assessment, lastMetOn, ...contact }) => contact);
  const { posts } = await mockAccounts(page, { appContacts, lastVisit: { id: visitId, visitedOn: '2026-10-03', outcome: 'met', visitedBy: 'sales@example.test', note: null, metContacts: appContacts.map(({ id, name }) => ({ id, name })) } });
  await expect(firstCard(page).getByText(/Last visit 3 Oct · Met · with Asha, Ravi/)).toBeVisible();
  await firstCard(page).getByRole('button', { name: 'Log visit for Care Lab', exact: false }).click();
  const form = page.getByRole('form', { name: 'Log visit' });
  await expect(form.getByRole('group', { name: 'Who did you meet?', exact: true })).toBeVisible();
  await form.getByRole('checkbox', { name: 'Met Asha for Care Lab', exact: false }).check();
  await form.getByRole('checkbox', { name: 'Met Ravi for Care Lab', exact: false }).check();
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts[0]).toMatchObject({ action: 'log_visit', metContactIds: appContacts.map(contact => contact.id) });
});

test('visit hides the meeting fieldset without contacts', async ({ page }) => {
  await mockAccounts(page);
  await firstCard(page).getByRole('button', { name: 'Log visit for Care Lab', exact: false }).click();
  await expect(page.getByRole('group', { name: 'Who did you meet?', exact: true })).toHaveCount(0);
});

test('Power Map filter sends the alert query parameter', async ({ page }) => {
  const { gets } = await mockAccounts(page, { canSeePowerMap: true });
  await page.getByLabel('Power Map', { exact: true }).selectOption('no_decision_maker');
  await expect.poll(() => new URL(gets.at(-1)!).searchParams.get('alert')).toBe('no_decision_maker');
});

for (const failure of [502, 408, 429, 422, 'network'] as const) {
  test(`assessment retry handles ${failure} with the correct idempotency key`, async ({ page }) => {
    await mockAccounts(page, { canSeePowerMap: true, appContacts: powerContacts });
    const attempts: Command[] = [];
    await page.route('**/api/accounts', async route => {
      attempts.push(route.request().postDataJSON() as Command);
      if (attempts.length === 1 && failure === 'network') { await route.abort('failed'); return; }
      await route.fulfill(attempts.length === 1 ? { status: failure as number, json: { error: 'Try again' } } : { json: { ok: true } });
    });
    await firstCard(page).getByRole('button', { name: 'Set role for Asha', exact: true }).click();
    const save = firstCard(page).getByRole('button', { name: 'Save role for Asha', exact: false });
    await save.click();
    await expect(firstCard(page).getByRole('alert')).toHaveText(failure === 'network' ? 'Not saved. Check the connection and try again.' : 'Try again');
    await save.click();
    await expect(page.getByRole('status')).toHaveText('Saved.');
    expect(attempts).toHaveLength(2);
    if (failure === 422) expect(attempts[1].idempotencyKey).not.toEqual(attempts[0].idempotencyKey);
    else expect(attempts[1]).toEqual(attempts[0]);
  });
}

test('assessment conflict closes the form and refreshes; Cancel restores focus', async ({ page }) => {
  const { gets } = await mockAccounts(page, { canSeePowerMap: true, appContacts: powerContacts, status: 409 });
  const opener = firstCard(page).getByRole('button', { name: 'Set role for Asha', exact: true });
  await opener.click();
  await firstCard(page).getByRole('button', { name: 'Cancel role for Asha', exact: false }).click();
  await expect(opener).toBeFocused();
  await opener.click();
  const before = gets.length;
  await firstCard(page).getByRole('button', { name: 'Save role for Asha', exact: false }).click();
  await expect(page.getByRole('status')).toHaveText('Someone else changed this account. The list has been refreshed.');
  await expect.poll(() => gets.length).toBeGreaterThan(before);
  await expect(firstCard(page).getByRole('form')).toHaveCount(0);
});

test('phone layout has no horizontal overflow with Set role open', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'pricing-mobile', 'Phone layout');
  await mockAccounts(page, { canSeePowerMap: true, appContacts: powerContacts });
  await page.setViewportSize({ width: 375, height: 812 });
  await firstCard(page).getByRole('button', { name: 'Set role for Asha', exact: true }).click();
  await expect(firstCard(page).getByLabel('Decision role for Asha', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('adds an app contact with a flat command and duplicate-phone notice', async ({ page }) => {
  const { gets, posts } = await mockAccounts(page, { duplicatePhone: true });
  const addContact = firstCard(page).getByRole('button', { name: 'Add contact for Care Lab', exact: false });
  const actions = addContact.locator('..');
  await expect(actions.getByRole('button')).toHaveText(['Log visit', 'Location', 'Add contact']);
  expect(await addContact.getAttribute('class')).toEqual(await actions.getByRole('button', { name: 'Location for Care Lab', exact: false }).getAttribute('class'));
  await addContact.click();
  const form = page.getByRole('form', { name: 'Add contact for Care Lab', exact: false });
  await expect(form.getByLabel('Contact name for Care Lab', { exact: false })).toBeFocused();
  await form.getByLabel('Contact name for Care Lab', { exact: false }).fill('App buyer');
  await form.getByLabel('Contact role for Care Lab', { exact: false }).fill('Purchase');
  await form.getByLabel('Contact phone for Care Lab', { exact: false }).fill('+91 98765 43210');
  await form.getByLabel('Contact email for Care Lab', { exact: false }).fill('buyer@example.test');
  const before = gets.length;
  await form.getByRole('button', { name: 'Save contact for Care Lab', exact: false }).click();
  await expect(page.getByRole('status')).toHaveText('Saved. This phone is already on the account.');
  expect(posts[0]).toEqual({ action: 'add_contact', customerId, name: 'App buyer', businessRole: 'Purchase', phone: '+91 98765 43210', email: 'buyer@example.test', idempotencyKey: expect.any(String) });
  expect(String(posts[0].idempotencyKey).length).toBeGreaterThanOrEqual(16);
  await expect.poll(() => gets.length).toBeGreaterThan(before);
  await expect(form).toHaveCount(0);
});

test('edits an app contact using its current version', async ({ page }) => {
  const { posts } = await mockAccounts(page, { appContacts: [appContact] });
  const card = firstCard(page);
  await expect(card.getByText('App buyer · Purchase', { exact: true })).toBeVisible();
  await expect(card.getByText('added by sales@example.test', { exact: true })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Call App buyer for Care Lab', exact: false })).toHaveAttribute('href', 'tel:919876543210');
  await expect(card.getByRole('link', { name: 'Email App buyer for Care Lab', exact: false })).toHaveAttribute('href', 'mailto:buyer@example.test');
  const contactLine = card.getByRole('link', { name: 'Call App buyer for Care Lab', exact: false }).locator('..');
  await expect(contactLine.getByRole('link')).toHaveCount(2);
  await expect(contactLine.getByRole('button')).toHaveCount(0);
  await expect(contactLine).not.toContainText('added by');
  const attributionLine = card.getByText('added by sales@example.test', { exact: true }).locator('..');
  await expect(attributionLine.getByRole('button')).toHaveCount(0);
  await card.getByRole('button', { name: 'Edit App buyer', exact: true }).click();
  const form = page.getByRole('form', { name: 'Edit App buyer for Care Lab', exact: false });
  await expect(form.getByLabel('Contact name for Care Lab', { exact: false })).toHaveValue('App buyer');
  await form.getByLabel('Contact role for Care Lab', { exact: false }).fill('Lab head');
  await form.getByRole('button', { name: 'Save contact for Care Lab', exact: false }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts[0]).toMatchObject({ action: 'update_contact', contactId: appContact.id, expectedVersion: 3, name: 'App buyer', businessRole: 'Lab head' });
});

test('remove uses an inline confirmation with Keep and the current version', async ({ page }) => {
  const { posts } = await mockAccounts(page, { appContacts: [appContact] });
  const card = firstCard(page);
  await card.getByRole('button', { name: 'More actions for App buyer', exact: true }).click();
  const remove = card.getByRole('button', { name: 'Remove App buyer', exact: true });
  await remove.click();
  await expect(card.getByText('Remove App buyer?', { exact: true })).toBeVisible();
  expect(posts).toHaveLength(0);
  await card.getByRole('button', { name: 'Keep App buyer for Care Lab', exact: false }).click();
  await expect(card.getByText('Remove App buyer?', { exact: true })).toHaveCount(0);
  await remove.click();
  await card.getByRole('button', { name: 'Confirm remove App buyer for Care Lab', exact: false }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts[0]).toMatchObject({ action: 'remove_contact', contactId: appContact.id, expectedVersion: 3, idempotencyKey: expect.any(String) });
});

test('administrator can erase personal data with a checked reason and reloads the list', async ({ page }) => {
  const { gets, posts } = await mockAccounts(page, { canEraseContacts: true, appContacts: [appContact] });
  const card = firstCard(page);
  const before = gets.length;
  await card.getByRole('button', { name: 'More actions for App buyer', exact: true }).click();
  await card.getByRole('button', { name: 'Remove App buyer', exact: true }).click();
  await card.getByRole('button', { name: 'Erase personal data of App buyer for Care Lab', exact: false }).click();
  const form = card.getByRole('form', { name: 'Erase App buyer at Care Lab', exact: false });
  await expect(form.getByText(/Replaces the name, role, phone and email with "Erased contact"/)).toBeVisible();
  await form.getByRole('button', { name: 'Erase permanently App buyer for Care Lab', exact: false }).click();
  await expect(form.getByRole('alert')).toHaveText('Enter a reason with at least 3 characters.');
  expect(posts).toHaveLength(0);
  await form.getByLabel('Erasure reason for App buyer at Care Lab', { exact: false }).fill('Erasure request by phone');
  await form.getByRole('button', { name: 'Erase permanently App buyer for Care Lab', exact: false }).click();
  await expect(page.getByRole('status')).toHaveText('Erased contact.');
  expect(posts[0]).toEqual({ action: 'erase_contact', contactId: appContact.id, reason: 'Erasure request by phone', idempotencyKey: expect.any(String) });
  await expect.poll(() => gets.length).toBeGreaterThan(before);
});

test('management can remove a contact but cannot erase personal data', async ({ page }) => {
  await mockAccounts(page, { canEraseContacts: false, appContacts: [appContact] });
  const card = firstCard(page);
  await card.getByRole('button', { name: 'More actions for App buyer', exact: true }).click();
  await card.getByRole('button', { name: 'Remove App buyer', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Confirm remove App buyer for Care Lab', exact: false })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Keep App buyer for Care Lab', exact: false })).toBeVisible();
  await expect(card.getByText('Erase personal data', { exact: true })).toHaveCount(0);
});

test('phone layout has no horizontal overflow with erase form open', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'pricing-mobile', 'Phone layout');
  await mockAccounts(page, { canEraseContacts: true, appContacts: [appContact] });
  await page.setViewportSize({ width: 375, height: 812 });
  const card = firstCard(page);
  await card.getByRole('button', { name: 'More actions for App buyer', exact: true }).click();
  await card.getByRole('button', { name: 'Remove App buyer', exact: true }).click();
  await card.getByRole('button', { name: 'Erase personal data of App buyer for Care Lab', exact: false }).click();
  await expect(card.getByRole('form', { name: 'Erase App buyer at Care Lab', exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('app contacts without canEdit have no Edit or Remove controls', async ({ page }) => {
  await mockAccounts(page, { appContacts: [{ ...appContact, canEdit: false }] });
  const card = firstCard(page);
  await expect(card.getByText('App buyer · Purchase', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: /Edit App buyer|Remove App buyer/ })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Add contact for Care Lab', exact: false })).toBeVisible();
});

test('a contact conflict closes its form and refreshes accounts', async ({ page }) => {
  const { gets } = await mockAccounts(page, { appContacts: [appContact], status: 409 });
  await firstCard(page).getByRole('button', { name: 'Edit App buyer', exact: true }).click();
  const form = page.getByRole('form', { name: 'Edit App buyer for Care Lab', exact: false });
  const before = gets.length;
  await form.getByRole('button', { name: 'Save contact for Care Lab', exact: false }).click();
  await expect(page.getByRole('status')).toHaveText('Someone else changed this account. The list has been refreshed.');
  await expect.poll(() => gets.length).toBeGreaterThan(before);
  await expect(form).toHaveCount(0);
});

test('a contact network retry preserves its idempotency key', async ({ page }) => {
  const { posts } = await mockAccounts(page, { networkOnce: true });
  await firstCard(page).getByRole('button', { name: 'Add contact for Care Lab', exact: false }).click();
  const form = page.getByRole('form', { name: 'Add contact for Care Lab', exact: false });
  await form.getByLabel('Contact name for Care Lab', { exact: false }).fill('App buyer');
  await form.getByRole('button', { name: 'Save contact for Care Lab', exact: false }).click();
  await expect(firstCard(page).getByRole('alert')).toHaveText('Not saved. Check the connection and try again.');
  await form.getByRole('button', { name: 'Save contact for Care Lab', exact: false }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts[1]).toEqual(posts[0]);
});

for (const status of [502, 408, 429, 422]) {
  test(`contact retry ${status < 500 && status !== 408 && status !== 429 ? 'renews' : 'preserves'} the key after ${status}`, async ({ page }) => {
    await mockAccounts(page);
    const attempts: Command[] = [];
    await page.route('**/api/accounts', async route => {
      attempts.push(route.request().postDataJSON() as Command);
      await route.fulfill(attempts.length === 1 ? { status, json: { error: 'Try again' } } : { json: { ok: true } });
    });
    await firstCard(page).getByRole('button', { name: 'Add contact for Care Lab', exact: false }).click();
    const form = page.getByRole('form', { name: 'Add contact for Care Lab', exact: false });
    await form.getByLabel('Contact name for Care Lab', { exact: false }).fill('App buyer');
    await form.getByRole('button', { name: 'Save contact for Care Lab', exact: false }).click();
    await expect(firstCard(page).getByRole('alert')).toHaveText('Try again');
    await form.getByRole('button', { name: 'Save contact for Care Lab', exact: false }).click();
    await expect(page.getByRole('status')).toHaveText('Saved.');
    expect(attempts).toHaveLength(2);
    if (status === 422) expect(attempts[1].idempotencyKey).not.toEqual(attempts[0].idempotencyKey);
    else expect(attempts[1]).toEqual(attempts[0]);
  });
}

test("3 app contacts show 2 + '+1 more'", async ({ page }) => {
  await mockAccounts(page, { appContacts: [
    { ...appContact, id: 'asha', name: 'Asha', businessRole: null },
    { ...appContact, id: 'ravi', name: 'Ravi', businessRole: null, phone: '9876543211' },
    { ...appContact, id: 'meena', name: 'Meena', businessRole: null, email: 'meena@example.test' },
  ] });
  const card = firstCard(page);
  await expect(card.getByText('Asha', { exact: true })).toBeVisible();
  await expect(card.getByText('Ravi', { exact: true })).toBeVisible();
  await expect(card.getByText('Meena', { exact: true })).toHaveCount(0);
  await expect(card.getByRole('link', { name: 'Call Asha for Care Lab', exact: false })).toHaveAttribute('href', 'tel:919876543210');
  const toggle = card.getByRole('button', { name: '1 more contacts for Care Lab', exact: false });
  await expect(toggle).toHaveText('+1 more');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const controls = await toggle.getAttribute('aria-controls');
  await toggle.click();
  await expect(card.getByText('Ravi', { exact: true })).toBeVisible();
  await expect(card.getByText('Meena', { exact: true })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Call Ravi for Care Lab', exact: false })).toHaveAttribute('href', 'tel:9876543211');
  await expect(card.getByRole('link', { name: 'Email Meena for Care Lab', exact: false })).toHaveAttribute('href', 'mailto:meena@example.test');
  const expanded = card.locator(`[id="${controls}"]`);
  await expect(expanded).toContainText('Meena');
  const hide = card.getByRole('button', { name: 'Hide contacts for Care Lab', exact: false });
  await expect(hide).toHaveText('Hide');
  await expect(hide).toHaveAttribute('aria-expanded', 'true');
  await hide.click();
  await expect(card.getByText('Ravi', { exact: true })).toBeVisible();
  await expect(card.getByText('Meena', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Accounts' }).getByRole('listitem').nth(1).getByText('No contacts yet', { exact: true })).toBeVisible();
});

test('all class states render and the Class filter applies in Mine and All', async ({ page }) => {
  const { gets } = await mockAccounts(page, { classes: true });
  const cards = page.getByRole('list', { name: 'Accounts' });
  await expect(cards.getByText('A', { exact: true })).toHaveAttribute('title', 'A · ₹2.1 L a month, Jul–Sep');
  await expect(cards.getByText('B', { exact: true })).toHaveAttribute('title', 'B · ₹75 K a month, Jul–Sep');
  await expect(cards.getByText('Below B', { exact: true })).toBeVisible();
  await expect(cards.getByText('Class not available yet', { exact: true })).toHaveCount(0);
  const unlinkedCard = cards.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Class not_linked Lab', exact: true }) });
  await expect(unlinkedCard.locator('p').first()).toHaveText('Pune · West · Not linked to Tally sales');
  const note = page.getByText('Account classes appear once full Tally sales for Jul–Sep are imported.', { exact: true });
  await expect(note).toHaveCount(1);
  await expect(note).toBeVisible();
  await page.getByLabel('Class', { exact: true }).selectOption('A');
  await expect.poll(() => new URL(gets.at(-1)!).searchParams.get('class')).toBe('A');
  await expect(cards.getByRole('listitem')).toHaveCount(1);
  await expect(note).toHaveCount(0);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByLabel('Class', { exact: true })).toHaveValue('A');
  await expect.poll(() => new URL(gets.at(-1)!).searchParams.get('scope')).toBe('all');
  expect(new URL(gets.at(-1)!).searchParams.get('class')).toBe('A');
  await page.getByLabel('Class', { exact: true }).selectOption('not_available');
  await expect.poll(() => new URL(gets.at(-1)!).searchParams.get('class')).toBe('not_available');
  await expect(cards.getByRole('heading')).toHaveText(['Class not_available Lab']);
  await expect(note).toHaveCount(1);
  await expect(cards.getByText('Class not available yet', { exact: true })).toHaveCount(0);
});

// The pricing browser configuration runs this suite on pricing-desktop and pricing-mobile.
test('server order and overdue, next and never chips', async ({ page }) => {
  const { gets } = await mockAccounts(page);
  await expect(page.getByRole('list', { name: 'Accounts' }).getByRole('heading')).toHaveText(['Care Lab', 'City Lab', 'New Lab']);
  await expect(page.getByText('Visit overdue · due 3 Oct', { exact: true })).toBeVisible();
  await expect(page.getByText('Next visit 21 Oct', { exact: true })).toBeVisible();
  await expect(page.getByText('Never visited', { exact: true })).toBeVisible();
  await expect(page.getByText('3 accounts · 1 visit due')).toBeVisible();
  expect(new URL(gets[0]).search).toBe('?scope=mine&page=1');
});
test('Mine empty switches to All', async ({ page }) => {
  const { gets } = await mockAccounts(page, { emptyMine: true });
  await expect(page.getByText('No accounts are assigned to you yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Show all accounts', exact: true }).click();
  await expect.poll(() => new URL(gets.at(-1)!).searchParams.get('scope')).toBe('all');
  await expect(firstCard(page)).toContainText('Care Lab');
});
test('log visit quick date posts the flat body and reloads', async ({ page }) => {
  const { gets, posts } = await mockAccounts(page);
  await firstCard(page).getByRole('button', { name: 'Log visit for Care Lab', exact: false }).click();
  const form = page.getByRole('form', { name: 'Log visit' });
  await expect(form.getByLabel('Date', { exact: true })).toBeFocused();
  await expect(form.getByLabel('Date', { exact: true })).toHaveAttribute('min', '2026-09-14');
  await expect(form.getByLabel('Date', { exact: true })).toHaveAttribute('max', '2026-10-14');
  await form.getByLabel('Date', { exact: true }).fill('2026-10-10');
  await form.getByLabel('Note', { exact: true }).fill('Met the buyer');
  await form.getByRole('button', { name: '+7 days', exact: true }).click();
  await expect(form.getByLabel('Next visit', { exact: true })).toHaveValue('2026-10-17');
  const before = gets.length;
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts[0]).toEqual({ action: 'log_visit', customerId, visitedOn: '2026-10-10', outcome: 'met', note: 'Met the buyer', nextVisitOn: '2026-10-17', idempotencyKey: expect.any(String) });
  await expect.poll(() => gets.length).toBeGreaterThan(before);
  await expect(form).toHaveCount(0);
});
test('location parses a map link and blocks invalid input', async ({ page }) => {
  const { posts } = await mockAccounts(page);
  await firstCard(page).getByRole('button', { name: 'Location for Care Lab', exact: false }).click();
  const form = page.getByRole('form', { name: 'Account location' });
  await form.getByLabel('Google Maps link or lat, long').fill('not a location');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('Paste a Google Maps link or two numbers like 18.52, 73.85');
  expect(posts).toHaveLength(0);
  await form.getByLabel('Google Maps link or lat, long').fill('https://www.google.com/maps/@18.52,73.85,15z');
  await expect(form.getByText('18.52, 73.85', { exact: true })).toBeVisible();
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts[0]).toMatchObject({ action: 'set_location', customerId, expectedVersion: null, precision: 'pin', latitude: '18.52', longitude: '73.85', source: 'pasted_link' });
});
test('location warns outside the market area without blocking Save and clears inside', async ({ page }) => {
  const { posts } = await mockAccounts(page);
  await firstCard(page).getByRole('button', { name: 'Location for Care Lab', exact: false }).click();
  const form = page.getByRole('form', { name: 'Account location' });
  const input = form.getByLabel('Google Maps link or lat, long');
  const warning = form.getByText('This pin is outside the five-district market area (Kalaburagi, Bidar, Raichur, Yadgir, Bijapur). Check the link before saving.', { exact: true });
  await input.fill('18.52, 73.85');
  await expect(form.getByText('18.52, 73.85', { exact: true })).toBeVisible();
  await expect(warning).toBeVisible();
  await expect(warning).not.toHaveAttribute('role', 'alert');
  await expect(form.getByRole('alert')).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await input.fill('17.33, 76.83');
  await expect(form.getByText('17.33, 76.83', { exact: true })).toBeVisible();
  await expect(warning).toHaveCount(0);
  await input.fill('18.52, 73.85');
  await expect(warning).toBeVisible();
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ action: 'set_location', customerId, expectedVersion: null, precision: 'pin', latitude: '18.52', longitude: '73.85', source: 'manual_pin' });
});
test('assignment controls respect canAssign', async ({ page }) => {
  await mockAccounts(page);
  await expect(page.getByRole('button', { name: 'Owner for Care Lab', exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByLabel('Owner', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Territory', { exact: true })).toHaveCount(0);
});
test('All filters and owner form use assignment choices and version', async ({ page }) => {
  const { gets, posts } = await mockAccounts(page, { canAssign: true });
  await expect(page.getByLabel('Owner', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByLabel('Owner', { exact: true }).selectOption('other@example.test');
  await page.getByLabel('Territory', { exact: true }).selectOption(territoryId);
  await expect.poll(() => new URL(gets.at(-1)!).searchParams.get('territory')).toBe(territoryId);
  expect(new URL(gets.at(-1)!).searchParams.get('owner')).toBe('other@example.test');
  await firstCard(page).getByRole('button', { name: 'Owner for Care Lab', exact: false }).click();
  const form = page.getByRole('form', { name: 'Account owner' });
  await form.getByLabel('Owner', { exact: true }).selectOption('other@example.test');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts[0]).toMatchObject({ action: 'assign_account', customerId, ownerEmail: 'other@example.test', territoryId, expectedVersion: 3 });
});
test('409 refreshes the list with a clear notice', async ({ page }) => {
  const { gets } = await mockAccounts(page, { status: 409 });
  await firstCard(page).getByRole('button', { name: 'Log visit for Care Lab', exact: false }).click();
  const before = gets.length;
  await page.getByRole('form', { name: 'Log visit' }).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Someone else changed this account. The list has been refreshed.');
  await expect.poll(() => gets.length).toBeGreaterThan(before);
});
test('network retry keeps the same idempotency key and Cancel restores focus', async ({ page }) => {
  const { posts } = await mockAccounts(page, { networkOnce: true });
  const opener = firstCard(page).getByRole('button', { name: 'Log visit for Care Lab', exact: false });
  await opener.click();
  const form = page.getByRole('form', { name: 'Log visit' });
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('Not saved. Check the connection and try again.');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts[1]).toEqual(posts[0]);
  await opener.click();
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(opener).toBeFocused();
});

test('gateway timeout retry preserves the command key when the first write may have committed', async ({ page }) => {
  const { posts } = await mockAccounts(page);
  const attempts: Command[] = [];
  await page.route('**/api/accounts', async route => {
    const body = route.request().postDataJSON() as Command;
    attempts.push(body);
    if (attempts.length === 1) {
      await route.fulfill({ status: 502, json: { error: 'Accounts are temporarily unavailable' } });
    } else await route.fulfill({ json: { ok: true } });
  });
  await firstCard(page).getByRole('button', { name: 'Log visit for Care Lab', exact: false }).click();
  const form = page.getByRole('form', { name: 'Log visit' });
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('Accounts are temporarily unavailable');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(posts).toHaveLength(0);
});
test('new territory reloads choices and selects the new territory', async ({ page }) => {
  const { posts } = await mockAccounts(page, { canAssign: true });
  await firstCard(page).getByRole('button', { name: 'Owner for Care Lab', exact: false }).click();
  const form = page.getByRole('form', { name: 'Account owner' });
  await form.getByLabel('New territory', { exact: true }).fill('North');
  await form.getByRole('button', { name: 'New territory', exact: true }).click();
  await expect(form.getByLabel('Territory', { exact: true })).toHaveValue('55555555-5555-4555-8555-555555555555');
  expect(posts[0]).toMatchObject({ action: 'create_territory', name: 'North' });
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(posts[1]).toMatchObject({ action: 'assign_account', territoryId: '55555555-5555-4555-8555-555555555555' });
});
test('search debounces and pagination returns the server page', async ({ page }) => {
  const { gets } = await mockAccounts(page, { paginate: true });
  await expect(page.getByText('Showing 1–1 of 3')).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Showing 2–2 of 3')).toBeVisible();
  await page.getByLabel('Search accounts').fill('Pune');
  await expect.poll(() => new URL(gets.at(-1)!).searchParams.get('search')).toBe('Pune');
  expect(new URL(gets.at(-1)!).searchParams.get('page')).toBe('1');
});
test('phone layout has no horizontal overflow including open forms', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'pricing-mobile', 'Phone layout');
  await mockAccounts(page, { canAssign: true, appContacts: [appContact] });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(firstCard(page).getByRole('button', { name: 'Add contact for Care Lab', exact: false }).locator('..').getByRole('button')).toHaveText(['Log visit', 'Location', 'Add contact', 'Owner']);
  await firstCard(page).getByRole('button', { name: 'More actions for App buyer', exact: true }).click();
  await firstCard(page).getByRole('button', { name: 'Remove App buyer', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await firstCard(page).getByRole('button', { name: 'Keep App buyer for Care Lab', exact: false }).click();
  for (const action of ['Log visit', 'Location', 'Owner']) {
    await firstCard(page).getByRole('button', { name: `${action} for Care Lab`, exact: false }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  await firstCard(page).getByRole('button', { name: 'Add contact for Care Lab', exact: false }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
