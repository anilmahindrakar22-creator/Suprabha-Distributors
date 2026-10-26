import { expect, test } from '@playwright/test';
import { orderBootstrap } from '../fixtures/api-builders';

for (const surface of ['service', 'instrument-economics', 'embedded-economics']) {
  test(`${surface} lets users scroll to the lower evidence without scrolling the workspace header`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: testInfo.project.name.includes('mobile') ? 375 : 1280, height: 532 });
    await page.route('**/api/service', route => route.fulfill({ json: {
      assets: Array.from({ length: 3 }, (_, index) => ({
        installationId: `installation-${index}`, orderId: null, orderNumber: 'Tally TEST-INVOICE', customerName: 'Test Laboratory',
        customerPhone: null, tallyKey: 'TEST-ANALYZER', itemName: `Test analyzer ${index + 1}`, serialNumber: `TEST-SERIAL-${index}`,
        installedAt: '2026-07-23T00:00:00Z', siteContact: null, engineerEmail: null, commissioningNotes: 'Confirmed historical installation',
      })), tickets: [],
    } }));
    await page.route('**/api/instrument-economics', route => route.fulfill({ json: {
      actorEmail: 'staff@example.test', businessDate: '2026-10-10', businessTimezone: 'Asia/Kolkata', targets: [], mappings: [],
      exceptions: [], leakage: [], cases: [], customers: [], installations: [], sourceLines: [], canManage: true,
      canApprove: false, canAct: false, generation: 'scroll-run', lastRebuiltAt: '2026-10-10T07:00:00Z',
      sourceImportedAt: '2026-10-10T07:00:00Z', sourceLineCount: 0, unattributedPaise: '0', reportingFrom: '2026-09-01', reportingTo: '2026-10-01',
      policy: { attractiveMonths: 24, reviewMonths: 36, exceptionMonths: 48, forecastWindowMonths: 3, watchRevenuePercent: 80, criticalRevenuePercent: 50 },
    } }));
    await page.route('**/api/orders**', route => route.fulfill({ json: orderBootstrap({ actor: { email: 'staff@example.test', role: 'staff' }, orders: [], customers: [], operations: {} }) }));
    if (surface === 'embedded-economics') {
      await page.goto('/?view=frame&role=management');
      // Phones keep Economics under More in the bottom navigation.
      const more = page.getByRole('button', { name: 'More', exact: true });
      if (await more.isVisible()) await more.click();
      await page.getByRole('button', { name: 'economics', exact: true }).click();
    } else await page.goto(`/?view=${surface}`);
    await expect(page.getByRole('heading', { name: surface === 'service' ? 'Equipment & service' : 'Instrument economics', exact: true })).toBeVisible();
    if (surface === 'service') await expect(page.getByRole('region', { name: 'Service overview' })).toBeVisible();
    if (surface !== 'service') {
      // The long evidence lists now live in Advanced → Reports.
      await page.getByRole('navigation', { name: 'Economics sections' }).getByRole('button', { name: 'Advanced', exact: true }).click();
      await page.getByRole('navigation', { name: 'Advanced sections' }).getByRole('button', { name: 'Reports', exact: true }).click();
      await page.getByRole('main').last().evaluate(element => { element.scrollTop = 0; });
    }
    const scrollArea = surface === 'service' ? page.getByRole('main').locator(':scope > div').first() : page.getByRole('main').last();
    // The app deliberately locks body scroll: ordinary wheel input must reach
    // lower records through a container contained within the visible viewport.
    expect(await scrollArea.evaluate(element => element.getBoundingClientRect().bottom <= innerHeight + 1)).toBe(true);
    const lowerEvidence = surface === 'service'
      ? page.getByRole('region', { name: 'Installed equipment register' }).getByText('Installation details', { exact: true }).last()
      : page.getByText('Current source line evidence (0)', { exact: true });
    await expect(lowerEvidence).not.toBeInViewport();
    const box = (await scrollArea.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 30);
    await page.mouse.wheel(0, 3000);
    await expect(lowerEvidence).toBeInViewport();
    if (surface === 'embedded-economics') await expect(page.getByRole('navigation', { name: 'Application sections' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (surface === 'service') await page.screenshot({ path: `docs/UI-PREVIEWS/service-scroll-${testInfo.project.name}.png` });
  });
}
