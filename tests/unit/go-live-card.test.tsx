import React, { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
const valid = {
 weeks: ['2026-11-23','2026-11-16','2026-11-09','2026-11-02','2026-10-26'].map(weekStart => ({ weekStart, ordersEntered: 2, ordersLinkedToTally: 1, tallySaleInvoices: 0, visitsLogged: 3, activePeople: 1 })),
 people: [{ email: 'staff@example.test', roles: ['management'], actionsThisWeek: 4, ordersThisWeek: 2, visitsThisWeek: 3, lastActionAt: null }],
 membersByRole: { sales: 0, operations: 0, warehouse: 0, accounts: 0, billing: 0, management: 1, administrator: 0, viewer: 0 },
 generatedAt: '2026-11-26T00:00:00Z',
};
vi.mock('react', async importOriginal => {
 const actual = await importOriginal<typeof import('react')>();
 return { ...actual, useEffect: vi.fn(), useState: vi.fn((initial: unknown) => [initial === null ? valid : initial, vi.fn()]) };
});
import { GoLiveCard } from '../../components/go-live-card';
describe('GoLiveCard', () => {
 it('names its retry button without colliding with other Accounts cards', () => {
 vi.mocked(useState).mockReturnValueOnce([null, vi.fn()]).mockReturnValueOnce([true, vi.fn()]);
 const html = renderToStaticMarkup(<GoLiveCard />);
 expect(html).toContain('aria-label="Retry go-live view"');
 expect(html).toContain('>Retry</button>');
 });
 it('renders weekly summary and no-staff note', () => {
 const html = renderToStaticMarkup(<GoLiveCard />);
 expect(html).toContain('Go-live · this week: 2 orders for 0 Tally sales · 3 visits · 1 people active');
 expect(html).toContain('No sales, operations or accounts staff added yet');
 });
 it('renders coverage dash and people counts', () => {
 const html = renderToStaticMarkup(<GoLiveCard />);
 expect(html).toContain('<td>–</td>');
 expect(html).toContain('staff · management · 4 actions · 2 orders · 3 visits · Last active: never');
 expect(html).toContain('overflow-x-auto');
 });
});
