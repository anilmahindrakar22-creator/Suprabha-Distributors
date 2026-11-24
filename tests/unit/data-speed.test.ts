import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gatewayLabel, normalizeDataSpeed, overBudget } from '../../lib/data-speed-types';

const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET } from '@/app/api/data-speed/route';

const valid = { statsAvailable: true, statsResetAt: '2026-11-01T00:00:00Z', windowFrom: null, reads: [{ gateway: 'economics', calls: 5, meanMs: 1200, previousMeanMs: null, maxMs: 4000 }], budget: { meanMs: 1000, maxMs: 3000 }, lastImportAt: null, lastRebuildAt: null, exceptions: [{ reason: 'bad reason', total: 3, under7Days: 1, from7To30Days: 1, over30Days: 1 }], snapshotCount: 0 };
describe('data speed normalization', () => {
  it('accepts valid data', () => expect(normalizeDataSpeed(valid)).toEqual(valid));
  it.each([
    null, [], {}, { ...valid, statsAvailable: 1 }, { ...valid, statsResetAt: 1 }, { ...valid, windowFrom: false },
    { ...valid, reads: Array(31).fill(valid.reads[0]) }, { ...valid, reads: [{ ...valid.reads[0], calls: -1 }] },
    { ...valid, reads: [{ ...valid.reads[0], meanMs: Infinity }] }, { ...valid, reads: [{ ...valid.reads[0], previousMeanMs: '1' }] },
    { ...valid, budget: { meanMs: 1.5, maxMs: 3 } }, { ...valid, lastImportAt: 3 }, { ...valid, lastRebuildAt: false },
    { ...valid, exceptions: Array(51).fill(valid.exceptions[0]) }, { ...valid, exceptions: [{ ...valid.exceptions[0], reason: 3 }] },
    { ...valid, exceptions: [{ ...valid.exceptions[0], total: -1 }] }, { ...valid, exceptions: [{ ...valid.exceptions[0], over30Days: 0 }] },
    { ...valid, snapshotCount: -1 },
  ])('throws on malformed data %#', body => expect(() => normalizeDataSpeed(body)).toThrow());
  it('labels mapped and fallback gateways', () => {
    expect(gatewayLabel('economics')).toBe('Instrument economics');
    expect(gatewayLabel('stockflow_my_new_gateway')).toBe('My new');
  });
  it('selects mean over max when both exceed their budgets', () => {
    expect(overBudget({ meanMs: 1001, maxMs: 4000 }, { meanMs: 1000, maxMs: 3000 })).toBe('mean');
    expect(overBudget({ meanMs: 1000, maxMs: 3001 }, { meanMs: 1000, maxMs: 3000 })).toBe('max');
    expect(overBudget({ meanMs: 1, maxMs: 2 }, { meanMs: 1000, maxMs: 3000 })).toBeNull();
  });
});
describe('data speed route', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ email: 'manager@example.test' }); mocks.session.mockImplementation(async (_email: string) => ({ email: 'manager@example.test', roles: ['management'] })); mocks.gateway.mockResolvedValue(valid); });
  it.each(['accounts', 'sales', 'operations'])('returns 403 for %s', async role => {
    mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: [role] });
    expect((await GET(new Request('https://local/api/data-speed'))).status).toBe(403);
  });
  it('rejects query keys', async () => expect((await GET(new Request('https://local/api/data-speed?x=1'))).status).toBe(400));
  it('calls the exact gateway action and disables caching', async () => {
    const response = await GET(new Request('https://local/api/data-speed'));
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_data_speed_report', {});
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('returns 502 for a bad shape', async () => {
    mocks.gateway.mockResolvedValue({});
    expect((await GET(new Request('https://local/api/data-speed'))).status).toBe(502);
  });
});
