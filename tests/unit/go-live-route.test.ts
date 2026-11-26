import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeGoLive } from '../../lib/go-live-types';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET } from '@/app/api/go-live/route';
const valid = {
 weeks: ['2026-11-23','2026-11-16','2026-11-09','2026-11-02','2026-10-26'].map(weekStart => ({ weekStart, ordersEntered: 2, ordersLinkedToTally: 1, tallySaleInvoices: 0, visitsLogged: 3, activePeople: 1 })),
 people: [{ email: 'staff@example.test', roles: ['management'], actionsThisWeek: 4, ordersThisWeek: 2, visitsThisWeek: 3, lastActionAt: null }],
 membersByRole: { sales: 0, operations: 0, warehouse: 0, accounts: 0, billing: 0, management: 1, administrator: 0, viewer: 0 },
 generatedAt: '2026-11-26T00:00:00Z',
};
describe('go-live route', () => {
 beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ email: 'manager@example.test' }); mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: ['management'] }); mocks.gateway.mockResolvedValue(valid); });
 const request = (query = '') => GET(new Request('https://local/api/go-live' + query));
 it('requires sign-in', async () => { mocks.user.mockResolvedValue(null); expect((await request()).status).toBe(401); expect(mocks.gateway).not.toHaveBeenCalled(); });
 it.each(['operations','sales','warehouse','accounts','billing','viewer'])('refuses %s', async role => { mocks.session.mockResolvedValue({ roles: [role] }); expect((await request()).status).toBe(403); expect(mocks.gateway).not.toHaveBeenCalled(); });
 it('rejects query parameters', async () => expect((await request('?x=1')).status).toBe(400));
 it.each(['management','administrator'])('returns normalized data for %s', async role => {
 mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: [role] });
 const response = await request(); expect(response.status).toBe(200); expect(await response.json()).toEqual(valid);
 expect(response.headers.get('cache-control')).toBe('private, no-store');
 expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test','get_go_live',{});
 });
 it('rejects bad gateway shape', async () => { mocks.gateway.mockResolvedValue({}); expect((await request()).status).toBe(502); });
 it.each([null, {}, { ...valid, extra: true }, { ...valid, weeks: [] }, { ...valid, people: [{ ...valid.people[0], actionsThisWeek: -1 }] }, { ...valid, generatedAt: 'bad' }])('strict normalization %#', body => expect(() => normalizeGoLive(body)).toThrow());
});
