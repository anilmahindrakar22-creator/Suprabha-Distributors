import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeGrowthLabMonths } from '@/lib/growth-lab-month-types';
import { parseGrowthStoppedItems } from '@/lib/growth-stopped-items';

const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async original => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET as getMonths } from '@/app/api/growth/lab-months/route';
import { GET as getStopped, POST } from '@/app/api/growth/stopped-items/route';

const row = {
  labKey: 'company|lab', customerId: null, name: 'Lab', town: null, totalPaise: 7000000,
  monthsPaise: [5000000, 2000000, ...Array(10).fill(0)], buyingMonths: 2, lastPurchaseOn: '2026-11-15',
  usualMonthlyPaise: 1666667, phone: null, previousNinetyPaise: 5000000, lastNinetyPaise: 2000000,
};
const body = () => ({
  window: { from: '2025-11-01', to: '2026-11-01' },
  months: ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
  totalLabs: 1, rows: [{ ...row }],
});
const item = {
  itemKey: 'reagent', itemName: 'Reagent', usualMonthlyQuantity: 1, unit: 'pack',
  lastBilledOn: '2026-08-01', lastRatePaise: 41152,
};
const stopped = () => ({ labs: [{ labKey: 'company|lab', items: [{ ...item }] }] });

describe('declining lab parser', () => {
  it('accepts and preserves the ninety-day fields', () => {
    expect(normalizeGrowthLabMonths(body(), 'declining')).toEqual({ ...body(), filter: 'declining' });
  });
  it.each(['previousNinetyPaise', 'lastNinetyPaise'] as const)('requires %s on declining rows', key => {
    const value = body();
    const { [key]: omitted, ...entry } = value.rows[0];
    expect(omitted).toBeTypeOf('number');
    expect(normalizeGrowthLabMonths({ ...value, rows: [entry] }, 'declining')).toBeNull();
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, null])('rejects invalid ninety-day paise %s', amount => {
    for (const key of ['previousNinetyPaise', 'lastNinetyPaise']) {
      expect(normalizeGrowthLabMonths({ ...body(), rows: [{ ...row, [key]: amount }] }, 'declining')).toBeNull();
    }
  });
  it('allows fifty declining rows and rejects fifty-one', () => {
    const value = { ...body(), totalLabs: 51, rows: Array.from({ length: 50 }, (_, i) => ({ ...row, labKey: `company|${i}` })) };
    expect(normalizeGrowthLabMonths(value, 'declining')?.rows).toHaveLength(50);
    expect(normalizeGrowthLabMonths({ ...value, rows: [...value.rows, row] }, 'declining')).toBeNull();
  });
  it('leaves the lapsing parse unchanged', () => {
    const { previousNinetyPaise, lastNinetyPaise, ...entry } = row;
    expect(previousNinetyPaise).toBe(5000000);
    expect(lastNinetyPaise).toBe(2000000);
    const value = { ...body(), rows: [{ ...entry, monthsMissed: 2 }] };
    expect(normalizeGrowthLabMonths(value, 'lapsing')).toEqual({ ...value, filter: 'lapsing' });
  });
});

describe('strict stopped items parser', () => {
  it('accepts paid and free items, null units, and empty labs in input order', () => {
    const value = { labs: [stopped().labs[0], { labKey: 'company|free', items: [{ ...item, unit: null, lastRatePaise: null }] }, { labKey: 'company|unknown', items: [] }] };
    expect(parseGrowthStoppedItems(value)).toEqual(value);
  });
  it('rejects four items', () => {
    expect(() => parseGrowthStoppedItems({ labs: [{ labKey: 'company|lab', items: Array.from({ length: 4 }, (_, i) => ({ ...item, itemKey: String(i) })) }] })).toThrow();
  });
  it.each([1.5, -1, Number.MAX_SAFE_INTEGER + 1, '41152'])('rejects invalid rates %s', lastRatePaise => {
    expect(() => parseGrowthStoppedItems({ labs: [{ labKey: 'company|lab', items: [{ ...item, lastRatePaise }] }] })).toThrow();
  });
  it.each([
    { ...stopped(), extra: true },
    { labs: [{ ...stopped().labs[0], extra: true }] },
    { labs: [{ labKey: 'company|lab', items: [{ ...item, extra: true }] }] },
    { labs: [{ labKey: 'company|lab', items: [{ ...item, unit: undefined }] }] },
    { labs: [{ labKey: 'company|lab', items: [{ ...item, lastBilledOn: '2026-02-30' }] }] },
    { labs: [{ labKey: 'company|lab', items: [{ ...item, usualMonthlyQuantity: 0 }] }] },
    { labs: [{ labKey: 'company|lab', items: [{ ...item, usualMonthlyQuantity: Infinity }] }] },
  ])('rejects malformed response %#', value => {
    expect(() => parseGrowthStoppedItems(value)).toThrow();
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'manager@example.test' });
  mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: ['management'] });
  mocks.gateway.mockResolvedValue(stopped());
});
const requestStopped = (query = '') => getStopped(new Request(`https://app.test/api/growth/stopped-items?${query}`));

describe('new growth route requests', () => {
  it('dispatches the exact declining filter', async () => {
    mocks.gateway.mockResolvedValue(body());
    const response = await getMonths(new Request('https://app.test/api/growth/lab-months?filter=declining'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ filter: 'declining' });
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_growth_lab_months', { filter: 'declining' });
  });
  it('takes repeated already-decoded lab parameters without splitting or double decoding', async () => {
    const keys = ['company|a,b', 'company|literal%2F'];
    mocks.gateway.mockResolvedValue({ labs: keys.map(labKey => ({ labKey, items: [] })) });
    const response = await requestStopped(new URLSearchParams(keys.map(key => ['lab', key])).toString());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.test', 'get_growth_stopped_items', { labKeys: keys });
  });
  it.each(['', 'labs=company%7Clab', 'lab=x', 'lab=company%7Clab&lab=company%7Clab', 'lab=company%7Clab&extra=x',
    new URLSearchParams(Array.from({ length: 9 }, (_, i) => ['lab', `company|${i}`])).toString(),
    `lab=${'x'.repeat(300)}%7Cy`])('rejects invalid stopped query %s', async query => {
    const response = await requestStopped(query);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid stopped items parameters' });
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('requires sign in', async () => {
    mocks.user.mockResolvedValue(null);
    expect((await requestStopped('lab=company%7Clab')).status).toBe(401);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it.each(['operations', 'accounts', 'sales'])('denies %s', async role => {
    mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: [role] });
    const response = await requestStopped('lab=company%7Clab');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Growth is for management only.' });
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('maps a parser failure to 502', async () => {
    mocks.gateway.mockResolvedValue({ labs: [], extra: true });
    expect((await requestStopped('lab=company%7Clab')).status).toBe(502);
  });
  it('rejects writes', () => { expect(POST().status).toBe(405); });
});
