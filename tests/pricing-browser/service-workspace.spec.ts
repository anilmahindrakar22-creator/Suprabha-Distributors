import { expect, test } from '@playwright/test';
import type { ServiceWorkspaceData } from '../../lib/service-types';

const fixture: ServiceWorkspaceData = {
  assets: [{
    installationId: 'i1',
    orderId: null,
    orderNumber: 'SF-26-1001',
    customerName: 'Care Hospital',
    customerPhone: null,
    tallyKey: 'CHEMISTRY-ANALYZER',
    itemName: 'Chemistry analyzer',
    serialNumber: 'SN-1',
    installedAt: '2026-07-23T00:00:00Z',
    siteContact: null,
    engineerEmail: null,
    commissioningNotes: null,
  }],
  tickets: [{
    id: 't1',
    ticketNumber: 'SV-1',
    installationId: 'i1',
    category: 'breakdown',
    priority: 'urgent',
    status: 'open',
    summary: 'Pump noise',
    resolution: null,
    createdBy: 'staff@example.test',
    createdAt: '2026-10-10T05:00:00Z',
    resolvedBy: null,
    resolvedAt: null,
    version: 1,
    events: [],
  }],
};

test('service shows a compact overview and plain ticket labels', async ({ page }) => {
  await page.route('**/api/service', async route => {
    await route.fulfill({ json: fixture });
  });
  await page.goto('/?view=service');
  const overview = page.getByRole('region', { name: 'Service overview' });
  await expect(overview).toBeVisible();
  await expect(overview).toContainText('Open tickets');
  await expect(overview).toContainText('Urgent');
  const ticket = page.getByRole('region', { name: 'Service tickets' }).getByRole('article');
  await expect(ticket.getByText('Urgent', { exact: true })).toBeVisible();
  await expect(ticket.getByText('Open', { exact: true })).toBeVisible();
  await expect(page.getByText('urgent', { exact: true })).not.toBeVisible();
  await expect(page.getByText('open', { exact: true })).not.toBeVisible();
});

test('logging an issue keeps the typed description when saving fails', async ({ page }) => {
  await page.route('**/api/service', async route => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 500, json: { error: 'Service save failed' } });
    } else await route.fulfill({ json: fixture });
  });
  await page.goto('/?view=service');
  await page.getByText('Log service issue', { exact: true }).click();
  await page.getByLabel('Issue description').fill('Display flickers');
  await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Service save failed');
  await expect(page.getByLabel('Issue description')).toHaveValue('Display flickers');
});

test('log-issue fields have accessible names', async ({ page }) => {
  await page.route('**/api/service', async route => {
    await route.fulfill({ json: fixture });
  });
  await page.goto('/?view=service');
  await page.getByText('Log service issue', { exact: true }).click();
  await expect(page.getByLabel('Issue category')).toBeVisible();
  await expect(page.getByLabel('Priority')).toBeVisible();
  await expect(page.getByLabel('Issue description')).toBeVisible();
});
