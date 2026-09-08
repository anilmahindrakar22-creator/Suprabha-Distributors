import { describe, expect, it } from 'vitest';
import { installedAssetsFromOrders, searchInstalledAssets, searchServiceWorkspace, validateServiceCommand } from '../../lib/service-types';

const order = {
  id: 'order-1', orderNumber: 'SF-101', customerName: 'City Hospital', customerPhone: '9876543210', status: 'delivered', source: 'phone', notes: null, version: 1,
  createdAt: '2026-09-01T08:00:00Z', updatedAt: '2026-09-02T08:00:00Z', lineCount: 1, totalQuantity: 1, reservedQuantity: 0, tallyInvoiceNumber: 'INV-10', lines: [], events: [], exceptions: [],
  installations: [
    { id: 'install-1', tallyKey: 'AN-1', itemName: 'Analyzer One', status: 'completed' as const, scheduledDate: '2026-09-01', engineerEmail: 'engineer@example.com', siteContact: 'Dr Rao', serialNumber: 'SN-100', commissioningNotes: 'Checks passed', createdBy: 'ops@example.com', createdAt: '2026-09-01T09:00:00Z', completedBy: 'ops@example.com', completedAt: '2026-09-02T10:00:00Z' },
    { id: 'install-2', tallyKey: 'AN-2', itemName: 'Analyzer Two', status: 'scheduled' as const, scheduledDate: '2026-09-05', engineerEmail: null, siteContact: null, serialNumber: null, commissioningNotes: null, createdBy: 'ops@example.com', createdAt: '2026-09-01T09:00:00Z', completedBy: null, completedAt: null },
  ],
};

describe('installed equipment register', () => {
  it('derives assets only from completed installations with durable identity', () => {
    const assets = installedAssetsFromOrders([order]);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ customerName: 'City Hospital', itemName: 'Analyzer One', serialNumber: 'SN-100', orderNumber: 'SF-101' });
  });

  it('searches customer, instrument, serial, contact, and order references', () => {
    const assets = installedAssetsFromOrders([order]);
    for (const query of ['city', 'analyzer', 'sn-100', 'dr rao', 'sf-101', '9876']) expect(searchInstalledAssets(assets, query)).toHaveLength(1);
    expect(searchInstalledAssets(assets, 'missing')).toEqual([]);
  });
});

describe('service ticket commands', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  it('accepts bounded create and resolve commands', () => {
    expect(validateServiceCommand({ action: 'create_service_ticket', payload: { installationId: id, category: 'breakdown', priority: 'urgent', summary: 'Analyzer will not start', idempotencyKey: '1234567890abcdef' } })?.action).toBe('create_service_ticket');
    expect(validateServiceCommand({ action: 'resolve_service_ticket', payload: { ticketId: id, expectedVersion: 1, resolution: 'Power supply replaced', idempotencyKey: 'abcdef1234567890' } })?.action).toBe('resolve_service_ticket');
  });

  it('rejects invalid identity, choices, bounds, and versions', () => {
    expect(validateServiceCommand({ action: 'create_service_ticket', payload: { installationId: 'bad', category: 'sale', priority: 'urgent', summary: 'x', idempotencyKey: 'short' } })).toBeNull();
    expect(validateServiceCommand({ action: 'resolve_service_ticket', payload: { ticketId: id, expectedVersion: 0, resolution: 'ok', idempotencyKey: 'abcdef1234567890' } })).toBeNull();
  });

  it('searches tickets and keeps their linked equipment visible', () => {
    const assets = installedAssetsFromOrders([order]);
    const ticket = { id, ticketNumber: 'ST-001', installationId: 'install-1', category: 'breakdown' as const, priority: 'urgent' as const, status: 'open' as const, summary: 'Display error', resolution: null, createdBy: 'ops@example.com', createdAt: '2026-09-03T00:00:00Z', resolvedBy: null, resolvedAt: null, version: 1, events: [] };
    const result = searchServiceWorkspace({ assets, tickets: [ticket] }, 'display');
    expect(result.tickets).toHaveLength(1);
    expect(result.assets).toHaveLength(1);
  });
});
