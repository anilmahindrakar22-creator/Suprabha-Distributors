import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const gateway = vi.fn();
import { getStockFlowSession } from '../../lib/stockflow-session';

describe('validated membership sessions', () => {
  beforeEach(() => {
    gateway.mockReset();
    vi.stubEnv('SUPABASE_URL', 'https://database.example');
    vi.stubEnv('STOCKFLOW_ORDER_GATEWAY_KEY', 'test-session-key');
    vi.stubGlobal('fetch', gateway);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it('retains legacy singleton responses', async () => {
    gateway.mockResolvedValue(Response.json({ email: 'staff@test.local', role: 'sales' }));
    expect(await getStockFlowSession('staff@test.local')).toEqual({ email: 'staff@test.local', role: 'sales', roles: ['sales'] });
  });
  it('normalizes stored combined roles without forwarding unrelated fields', async () => {
    gateway.mockResolvedValue(Response.json({ email: 'staff@test.local', role: 'sales', roles: ['warehouse', 'sales'], unexpected: 99 }));
    expect(await getStockFlowSession('staff@test.local')).toEqual({ email: 'staff@test.local', role: 'sales', roles: ['sales', 'warehouse'] });
  });
  it.each([null, [], {}, { email: 'other@test.local', role: 'administrator' },
    { email: 'staff@test.local', role: 'administrator', roles: [] },
    { email: 'staff@test.local', role: 'sales', roles: null },
    { email: 'staff@test.local', role: 'sales', roles: ['sales', 'unknown'] },
    { email: 'staff@test.local', role: 'sales', roles: ['sales', 'sales'] },
    { email: 'staff@test.local', role: 'administrator', roles: ['sales'] },
    { email: 'staff@test.local', role: ['sales'], roles: ['sales'] },
  ])('fails closed for malformed or mismatched membership: %j', async response => {
    gateway.mockResolvedValue(Response.json(response));
    await expect(getStockFlowSession('staff@test.local')).rejects.toMatchObject({ status: 502, message: 'Invalid membership response' });
  });
  it('returns no session for suspended/denied membership', async () => {
    gateway.mockResolvedValue(Response.json({ code: '42501', message: 'Denied' }, { status: 403 }));
    expect(await getStockFlowSession('staff@test.local')).toBeNull();
  });
  it('does not disguise service failures as membership denial', async () => {
    gateway.mockResolvedValue(Response.json({ message: 'Unavailable' }, { status: 503 }));
    await expect(getStockFlowSession('staff@test.local')).rejects.toMatchObject({ status: 502 });
  });
});
