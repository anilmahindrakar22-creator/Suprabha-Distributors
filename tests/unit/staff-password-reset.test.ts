import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ actor: vi.fn(), gateway: vi.fn(), reset: vi.fn(), verified: vi.fn(), fetch: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.actor }));
vi.mock('@/lib/order-gateway', () => ({ callOrderGateway: mocks.gateway }));
vi.mock('@/lib/staff-auth', () => ({
  staffAuthEnabled: () => process.env.STOCKFLOW_AUTH_MODE === 'supabase',
  sameStaffOrigin: (origin: string | null) => origin === 'https://staff.example.test',
  staffOrigin: () => 'https://staff.example.test',
  staffAuthClient: () => ({ auth: { resetPasswordForEmail: mocks.reset } }),
  verifiedStaff: mocks.verified,
  staffCookie: () => 'clear-cookie',
}));
import { POST, PUT } from '@/app/api/staff-password-reset/route';
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('STOCKFLOW_AUTH_MODE', 'supabase'); vi.stubEnv('STOCKFLOW_AUTH_EMAIL_RESET_ENABLED', 'true');
  vi.stubEnv('SUPABASE_URL', 'https://db.example.test'); vi.stubEnv('STOCKFLOW_AUTH_PUBLISHABLE_KEY', 'publishable');
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.actor.mockResolvedValue({ email: 'admin@example.test' });
  mocks.gateway.mockResolvedValue({ users: [{ email: 'staff@example.test', status: 'active' }] });
  mocks.reset.mockResolvedValue({ error: null });
  mocks.verified.mockResolvedValue({ email: 'staff@example.test' });
  mocks.fetch.mockImplementation(async () => new Response(null, { status: 200 }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const request = (body: unknown, origin = 'https://staff.example.test') => new Request('https://staff.example.test/api/staff-password-reset', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
it('keeps recovery disabled on existing Sites deployment', async () => { vi.stubEnv('STOCKFLOW_AUTH_MODE', 'sites'); expect((await POST(request({}))).status).toBe(404); expect((await PUT(request({}))).status).toBe(404); });
it('does not send email until delivery is explicitly configured', async () => { vi.stubEnv('STOCKFLOW_AUTH_EMAIL_RESET_ENABLED', ''); expect((await POST(request({ email: 'staff@example.test' }))).status).toBe(503); expect(mocks.reset).not.toHaveBeenCalled(); });
it('rejects unauthenticated and cross-origin reset requests', async () => { mocks.actor.mockResolvedValue(null); expect((await POST(request({}))).status).toBe(401); expect((await POST(request({}, 'https://evil.example.test'))).status).toBe(403); });
it('uses the server gateway for Administrator authorization', async () => { mocks.gateway.mockRejectedValue(new Error('Administrator required')); expect((await POST(request({ email: 'staff@example.test', role: 'administrator' }))).status).toBe(403); expect(mocks.reset).not.toHaveBeenCalled(); });
it('rejects targets absent from the active membership list', async () => { expect((await POST(request({ email: 'outsider@example.test' }))).status).toBe(400); expect(mocks.reset).not.toHaveBeenCalled(); });
it('requests recovery for exact approved email without returning secrets', async () => { const response = await POST(request({ email: 'STAFF@example.test' })); expect(response.status).toBe(200); expect(mocks.gateway).toHaveBeenCalledWith('admin@example.test', 'list_users'); expect(mocks.reset).toHaveBeenCalledWith('staff@example.test', { redirectTo: 'https://staff.example.test/staff-password-reset' }); expect(response.headers.get('cache-control')).toContain('no-store'); });
it('does not claim successful email delivery on a provider error', async () => { mocks.reset.mockResolvedValue({ error: new Error('private provider details') }); const response = await POST(request({ email: 'staff@example.test' })); expect(response.status).toBe(503); expect(await response.text()).not.toContain('private provider'); });
it('rejects expired tokens and weak passwords before update', async () => { expect((await PUT(request({ token: 'token', password: 'short' }))).status).toBe(400); mocks.verified.mockResolvedValue(null); expect((await PUT(request({ token: 'expired', password: 'long-test-password' }))).status).toBe(401); expect(mocks.fetch).not.toHaveBeenCalled(); });
it('requires active membership after recovery verification', async () => { mocks.gateway.mockRejectedValue(new Error('inactive')); expect((await PUT(request({ token: 'token', password: 'long-test-password' }))).status).toBe(503); expect(mocks.fetch).not.toHaveBeenCalled(); });
it('updates provider password and revokes refresh sessions without storing it', async () => { const response = await PUT(request({ token: 'token', password: 'long-test-password' })); expect(response.status).toBe(200); expect(mocks.fetch).toHaveBeenCalledTimes(2); expect(mocks.fetch.mock.calls[1][0]).toBe('https://db.example.test/auth/v1/logout?scope=global'); expect(await response.json()).toEqual({ ok: true }); expect(response.headers.get('set-cookie')).toBe('clear-cookie'); });
it('reports partial reset when revocation fails', async () => { mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 200 })).mockResolvedValueOnce(new Response(null, { status: 500 })); const response = await PUT(request({ token: 'token', password: 'long-test-password' })); expect(response.status).toBe(503); expect(await response.text()).toContain('Password changed'); });
