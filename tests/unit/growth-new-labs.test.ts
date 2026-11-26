import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeGrowthNewLabs } from '@/lib/growth-new-lab-types';

const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async original => ({ ...await original<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET } from '@/app/api/growth/lab-months/route';

const sampleRow = {
  labKey: 'c|x', customerId: '00000000-0000-4000-8000-000000000001', name: 'Lab A', town: 'Pune', phone: '+919876543210',
  firstPurchaseOn: '2026-10-05', firstOrderPaise: 8000, orderDays: 1, lastPurchaseOn: '2026-10-05',
  daysSinceFirst: 52, totalPaise: 8000, status: 'overdue',
};
const sample = { filter: 'new', windowDays: 90, asOf: '2026-11-26', totalLabs: 4, repeatLabs: 1, rows: [sampleRow] };

describe('normalizeGrowthNewLabs', () => {
  it('accepts valid data and returns only the contract fields', () => {
    expect(normalizeGrowthNewLabs({ ...sample, extra: true, rows: [{ ...sampleRow, extra: true }] })).toEqual(sample);
  });
  it.each(['overdue', 'due', 'early', 'repeat'])('accepts status %s and nullable contact fields', status => {
    const data = { ...sample, rows: [{ ...sampleRow, status, customerId: null, name: null, town: null, phone: null }] };
    expect(normalizeGrowthNewLabs(data)).toEqual(data);
  });
  it('rejects a bad status', () => {
    expect(normalizeGrowthNewLabs({ ...sample, rows: [{ ...sampleRow, status: 'unknown' }] })).toBeNull();
  });
  it.each(['firstOrderPaise', 'orderDays', 'daysSinceFirst', 'totalPaise'])('rejects negative %s', field => {
    expect(normalizeGrowthNewLabs({ ...sample, rows: [{ ...sampleRow, [field]: -1 }] })).toBeNull();
  });
  it('rejects repeatLabs greater than totalLabs', () => {
    expect(normalizeGrowthNewLabs({ ...sample, repeatLabs: 5 })).toBeNull();
  });
  it('rejects more than 50 rows', () => {
    expect(normalizeGrowthNewLabs({ ...sample, totalLabs: 51, rows: Array(51).fill(sampleRow) })).toBeNull();
    expect(normalizeGrowthNewLabs({ ...sample, totalLabs: 51, rows: Array(50).fill(sampleRow) })).not.toBeNull();
  });
  it.each([null, {}, { ...sample, filter: 'top' }, { ...sample, windowDays: 89 }, { ...sample, asOf: '2026-02-30' },
    { ...sample, totalLabs: -1 }, { ...sample, repeatLabs: -1 }, { ...sample, totalLabs: 0, repeatLabs: 0 },
    { ...sample, rows: [{ ...sampleRow, orderDays: 1.5 }] }, { ...sample, rows: [{ ...sampleRow, phone: undefined }] },
    { ...sample, rows: [{ ...sampleRow, customerId: 'invalid' }] }, { ...sample, rows: [{ ...sampleRow, lastPurchaseOn: 'bad' }] },
  ])('rejects malformed contract %#', value => {
    expect(normalizeGrowthNewLabs(value)).toBeNull();
  });
});

describe('New labs route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ email: 'manager@example.test' });
    mocks.session.mockResolvedValue({ email: 'manager@example.test', roles: ['management'] });
    mocks.gateway.mockResolvedValue(sample);
  });
  const get = (query = 'filter=new') => GET(new Request(`https://app.test/api/growth/lab-months?${query}`));
  it('forwards the exact new filter and normalizes the response', async () => {
    mocks.gateway.mockResolvedValue({ ...sample, extra: true });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual(sample);
    expect(mocks.gateway).toHaveBeenCalledExactlyOnceWith('manager@example.test', 'get_growth_lab_months', { filter: 'new' });
  });
  it.each(['filter=new&x=1', 'filter=new&filter=new'])('rejects extra parameters: %s', async query => {
    expect((await get(query)).status).toBe(400);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('returns 502 for malformed new labs data', async () => {
    mocks.gateway.mockResolvedValue({ ...sample, repeatLabs: 5 });
    const response = await get();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Growth is unavailable. Try again.' });
  });
  it('keeps the management role requirement', async () => {
    mocks.session.mockResolvedValue({ email: 'sales@example.test', roles: ['sales'] });
    expect((await get()).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
});
