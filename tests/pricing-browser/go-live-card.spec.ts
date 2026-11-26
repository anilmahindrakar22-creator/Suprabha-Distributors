import { expect, test } from '@playwright/test';
const valid = {
 weeks: ['2026-11-23','2026-11-16','2026-11-09','2026-11-02','2026-10-26'].map(weekStart => ({ weekStart, ordersEntered: 2, ordersLinkedToTally: 1, tallySaleInvoices: 0, visitsLogged: 3, activePeople: 1 })),
 people: [{ email: 'staff@example.test', roles: ['management'], actionsThisWeek: 4, ordersThisWeek: 2, visitsThisWeek: 3, lastActionAt: null }],
 membersByRole: { sales: 0, operations: 0, warehouse: 0, accounts: 0, billing: 0, management: 1, administrator: 0, viewer: 0 },
 generatedAt: '2026-11-26T00:00:00Z',
};
for (const width of [375,1280]) test('Go-live on Accounts at ' + width, async ({ page }) => {
 await page.setViewportSize({ width, height: 900 });
 await page.route('**/api/accounts**', route => route.fulfill({ json: { accounts: [], page: { page: 1, pageSize: 50, total: 0 }, owners: [], territories: [], canAssign: true, canEraseContacts: false, canSeePowerMap: false, actorEmail: 'admin@example.test', today: '2026-11-26', classPolicy: { aMinPaise: '20000000', bMinPaise: '7500000' } } }));
 await page.route('**/api/power-map**', route => route.fulfill({ json: { contacts: [], links: [], route: null } }));
 await page.route('**/api/data-checks**', route => route.fulfill({ status: 403, json: {} }));
 await page.route('**/api/data-speed**', route => route.fulfill({ status: 503, json: {} }));
 await page.route('**/api/customer-links**', route => route.fulfill({ json: { companyId: null, sourceVersion: null, rows: [], waiting: true } }));
 await page.route('**/api/go-live', route => route.fulfill({ json: valid }));
 await page.goto('/?view=accounts');
 const card = page.getByRole('region', { name: 'Go-live', exact: true });
 await expect(card).toBeVisible();
 await expect(card.locator('details')).not.toHaveAttribute('open', '');
 await card.getByText('Expand', { exact: true }).click();
 await expect(card.getByRole('table')).toBeVisible();
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
