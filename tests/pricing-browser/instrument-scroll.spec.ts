import { expect, test } from '@playwright/test';

for (const surface of ['instruments', 'instrument-economics', 'embedded-economics']) {
  test(`${surface} lets users scroll to the lower evidence without scrolling the workspace header`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: testInfo.project.name.includes('mobile') ? 375 : 1280, height: 532 });
    await page.route('**/api/instruments', route => route.fulfill({ json: {
      generatedAt: '2026-10-10T07:00:00Z', economicsReadiness: 'separate_workspace', instruments: [{
        installationId: 'installation-1', orderId: null, orderNumber: 'Tally TEST-INVOICE', customerName: 'Test Laboratory',
        itemName: 'Test analyzer', serialNumber: 'TEST-SERIAL', installedAt: '2026-07-23', serviceStatus: 'clear',
        openTicketCount: 0, openTicketNumbers: [], economicStatus: 'separate_workspace', commissioningNotes: 'Confirmed historical installation',
      }],
    } }));
    await page.route('**/api/instrument-economics', route => route.fulfill({ json: {
      actorEmail: 'staff@example.test', businessDate: '2026-10-10', businessTimezone: 'Asia/Kolkata', targets: [], mappings: [],
      exceptions: [], leakage: [], cases: [], customers: [], installations: [], sourceLines: [], canManage: true,
      canApprove: false, canAct: false, generation: 'scroll-run', lastRebuiltAt: '2026-10-10T07:00:00Z',
      sourceImportedAt: '2026-10-10T07:00:00Z', sourceLineCount: 0, unattributedPaise: '0', reportingFrom: '2026-09-01', reportingTo: '2026-10-01',
      policy: { attractiveMonths: 24, reviewMonths: 36, exceptionMonths: 48, forecastWindowMonths: 3, watchRevenuePercent: 80, criticalRevenuePercent: 50 },
    } }));
    await page.route('**/api/orders**', route => route.fulfill({ json: { actor: { email: 'staff@example.test' }, orders: [], customers: [], operations: {} } }));
    if (surface === 'embedded-economics') {
      await page.goto('/?view=frame&role=management');
      // Phones keep Economics under More in the bottom navigation.
      const more = page.getByRole('button', { name: 'More', exact: true });
      if (await more.isVisible()) await more.click();
      await page.getByRole('button', { name: 'economics', exact: true }).click();
    } else await page.goto(`/?view=${surface}`);
    await expect(page.getByRole('heading', { name: surface === 'instruments' ? 'Instrument portfolio' : 'Instrument economics', exact: true })).toBeVisible();
    if (surface !== 'instruments') {
      // The long evidence lists now live in Advanced → Reports.
      await page.getByRole('navigation', { name: 'Economics sections' }).getByRole('button', { name: 'Advanced', exact: true }).click();
      await page.getByRole('navigation', { name: 'Advanced sections' }).getByRole('button', { name: 'Reports', exact: true }).click();
      await page.getByRole('main').last().evaluate(element => { element.scrollTop = 0; });
    }
    const scrollArea = page.getByRole('main').last();
    // The app deliberately locks body scroll: ordinary wheel input must reach
    // lower records through a container contained within the visible viewport.
    expect(await scrollArea.evaluate(element => element.getBoundingClientRect().bottom <= innerHeight + 1)).toBe(true);
    const lowerEvidence = surface === 'instruments'
      ? page.getByText('Installation evidence', { exact: true })
      : page.getByText('Current source line evidence (0)', { exact: true });
    await expect(lowerEvidence).not.toBeInViewport();
    const box = (await scrollArea.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 30);
    await page.mouse.wheel(0, 3000);
    await expect(lowerEvidence).toBeInViewport();
    if (surface === 'embedded-economics') await expect(page.getByRole('navigation', { name: 'Application sections' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (surface === 'instruments') await page.screenshot({ path: `docs/UI-PREVIEWS/instrument-scroll-${testInfo.project.name}.png` });
  });
}
