import { describe, expect, it } from 'vitest';
import { installedAssetsFromOrders, searchInstalledAssets } from '../../lib/service-types';

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
