import { expect, test } from '@playwright/test';

test('another signed-in session sees a committed next stage without refreshing or losing an invoice draft', async ({ browser, baseURL, isMobile }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  let current = {
    id: '61000000-0000-4000-8000-000000000001', orderNumber: 'SF-CROSS-001', customerName: 'Cross-session Lab', status: 'packed',
    version: 1, customerPhone: null, source: 'phone', notes: null, pricingState: 'approved', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    lineCount: 1, totalQuantity: 2, reservedQuantity: 0, tallyInvoiceNumber: null,
    lines: [{ tallyKey: 'G', itemName: 'Glucose', itemGroup: 'Diasys', quantity: 2, baseUnit: 'Nos', fulfilledQuantity: 2 }], events: [], exceptions: [], installations: [],
  };
  try {
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index];
      await page.setViewportSize({ width: isMobile ? 375 : 1280, height: 800 });
      await page.clock.install();
      await page.route('**/api/orders**', async (route) => {
        const url = new URL(route.request().url());
        if (route.request().method() === 'POST') {
          const command = route.request().postDataJSON();
          if (command.payload.expectedVersion !== current.version) return route.fulfill({ status: 409, json: { error: 'Order changed; refresh and retry.' } });
          current = { ...current, status: command.payload.toStatus, version: current.version + 1 };
          return route.fulfill({ json: { ok: true, orderId: current.id, status: current.status, version: current.version } });
        }
        if (url.searchParams.has('summary')) return route.fulfill({ json: { operations: { awaitingTallyBilling: current.status === 'awaiting_tally_billing' ? 1 : 0 }, orderRevision: current.version.toString(16).padStart(32, '0') } });
        if (url.searchParams.has('detailsFor')) return route.fulfill({ json: { exceptions: [], installations: [] } });
        return route.fulfill({ json: { actor: { email: `accounts-${index}@example.test`, role: 'accounts', roles: ['accounts'] }, snapshot: { company: 'TEST', fetchedAt: new Date().toISOString(), catalog: [] }, customers: [], operations: {}, orders: [current], pagination: { total: 1, page: 1, pageCount: 1, pageSize: 20 } } });
      });
      await page.goto(`${baseURL}/?view=orders-workspace&actor=accounts-${index}@example.test`);
      await expect(page.getByText('Cross-session Lab', { exact: true }).first()).toBeVisible();
      const compactRow = page.getByRole('button', { name: /SF-CROSS-001, Cross-session Lab/ });
      if (isMobile && await compactRow.count()) await compactRow.click();
      await expect(page.getByRole('button', { name: 'Send to Tally billing', exact: true })).toBeVisible();
      await page.clock.runFor(2_000);
    }
    // Observer is looking at the same live details in a separate browser context.
    await pages[0].getByRole('button', { name: 'Send to Tally billing', exact: true }).click();
    await expect(pages[0].getByRole('button', { name: 'Mark billed', exact: true })).toBeVisible();
    await pages[1].clock.runFor(16_000);
    await expect(pages[1].getByRole('button', { name: 'Mark billed', exact: true })).toBeVisible();
    await expect(pages[1].getByRole('button', { name: 'Send to Tally billing', exact: true })).toHaveCount(0);
    const invoice = pages[1].getByRole('textbox', { name: /Tally invoice number/i }).first();
    await invoice.fill('SD/26-27/DRAFT');
    current = { ...current, version: current.version + 1 }; // Other user adds a note in the same stage.
    await pages[1].clock.runFor(16_000);
    await expect(invoice).toHaveValue('SD/26-27/DRAFT');
  } finally { await Promise.all(contexts.map((context) => context.close())); }
});
