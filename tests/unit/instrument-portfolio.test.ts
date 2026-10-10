import { describe, expect, it } from 'vitest';
import { buildInstrumentPortfolio, filterInstrumentPortfolio, serviceStatusForTickets } from '@/lib/instrument-portfolio';
import type { InstalledAsset, ServiceTicket } from '@/lib/service-types';

const asset: InstalledAsset = { installationId: 'install-1', orderId: 'order-1', orderNumber: 'SF-101', customerName: 'City Hospital', customerPhone: null, tallyKey: 'AN-1', itemName: 'SYS 240', serialNumber: 'SN-100', installedAt: '2026-09-02T10:00:00Z', siteContact: 'Dr Rao', engineerEmail: null, commissioningNotes: null };
const ticket: ServiceTicket = { id: 'ticket-1', ticketNumber: 'ST-001', installationId: 'install-1', category: 'breakdown', priority: 'normal', status: 'open', summary: 'Display error', resolution: null, createdBy: 'ops@example.com', createdAt: '2026-09-03T00:00:00Z', resolvedBy: null, resolvedAt: null, version: 1, events: [] };

describe('instrument portfolio evidence', () => {
  it('distinguishes urgent, routine and resolved issues without inventing uptime', () => {
    expect(serviceStatusForTickets([])).toBe('clear');
    expect(serviceStatusForTickets([ticket])).toBe('attention');
    expect(serviceStatusForTickets([{ ...ticket, priority: 'high' }])).toBe('urgent');
    expect(serviceStatusForTickets([{ ...ticket, category: 'training', priority: 'high' }])).toBe('attention');
    expect(serviceStatusForTickets([{ ...ticket, priority: 'urgent', status: 'resolved' }])).toBe('clear');
  });
  it('joins tickets by durable installation ID and keeps separate serials separate', () => {
    const result = buildInstrumentPortfolio({ assets: [asset, { ...asset, installationId: 'install-2', serialNumber: 'SN-200' }], tickets: [{ ...ticket, priority: 'urgent' }] }, '2026-10-07T00:00:00Z');
    expect(result.instruments).toHaveLength(2);
    expect(result.instruments[0]).toMatchObject({ installationId: 'install-1', serviceStatus: 'urgent', openTicketCount: 1, economicStatus: 'separate_workspace' });
    expect(result.instruments[1]).toMatchObject({ installationId: 'install-2', serviceStatus: 'clear', openTicketCount: 0 });
    expect(result.economicsReadiness).toBe('separate_workspace');
  });
  it('searches canonical records and applies status filters together', () => {
    const { instruments } = buildInstrumentPortfolio({ assets: [asset], tickets: [ticket] }, '2026-10-07T00:00:00Z');
    for (const query of ['CITY', 'sys', 'sn-100', 'ST-001', 'Dr Rao']) expect(filterInstrumentPortfolio(instruments, query, 'attention')).toHaveLength(1);
    expect(filterInstrumentPortfolio(instruments, 'city', 'urgent')).toEqual([]);
  });
});
