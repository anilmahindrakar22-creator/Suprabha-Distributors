import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), signInWithPassword: vi.fn(), gateway: vi.fn(), headers: new Headers(), token: undefined as string | undefined }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: mocks.getUser, signInWithPassword: mocks.signInWithPassword } }) }));
vi.mock('@/lib/order-gateway', () => ({ callOrderGateway: mocks.gateway }));
vi.mock('next/headers', () => ({ headers: async () => mocks.headers, cookies: async () => ({ get: () => mocks.token ? { value: mocks.token } : undefined }) }));
import { staffAuthClient, staffAuthEnabled, sameStaffOrigin, staffCookie, staffInvitationClient, staffPasswordLogin, verifiedStaff } from '@/lib/staff-auth';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { GET, POST, DELETE } from '@/app/api/staff-auth/route';

beforeEach(() => {
  vi.stubEnv('STOCKFLOW_AUTH_MODE', 'supabase'); vi.stubEnv('STOCKFLOW_STAFF_ORIGIN', 'https://staff.example.test');
  vi.stubEnv('SUPABASE_URL', 'https://db.example.test'); vi.stubEnv('STOCKFLOW_AUTH_PUBLISHABLE_KEY', 'sb_publishable_012345678901234567890');
  vi.stubEnv('STOCKFLOW_AUTH_EXPECTED_PROJECT', '');
  vi.clearAllMocks(); mocks.token = undefined; mocks.headers = new Headers();
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'staff@example.test', email_confirmed_at: '2026-01-01', is_anonymous: false } }, error: null });
  mocks.signInWithPassword.mockResolvedValue({ data: { session: { access_token: 'verified-token', expires_in: 3600 } }, error: null });
  mocks.gateway.mockResolvedValue({ email: 'staff@example.test', role: 'sales' });
});
afterEach(() => vi.unstubAllEnvs());
const request = (body: unknown, origin = 'https://staff.example.test') => new Request('https://staff.example.test/api/staff-auth', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('isolated staff authentication', () => {
  it('confirms only a provider-verified cookie without returning identity or credentials', async () => {
    const check = () => GET(new Request('https://staff.example.test/api/staff-auth'));
    expect((await check()).status).toBe(401);
    expect(mocks.getUser).not.toHaveBeenCalled();
    mocks.token = 'verified-token';
    const response = await check();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('rejects failed, cross-origin and unavailable session confirmations', async () => {
    mocks.token = 'verified-token';
    expect((await GET(new Request('https://staff.example.test/api/staff-auth', { headers: { origin: 'https://evil.example.test' } }))).status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401, message: 'private provider error' } });
    expect((await GET(new Request('https://staff.example.test/api/staff-auth'))).status).toBe(401);
    mocks.getUser.mockRejectedValue(new Error('private provider error'));
    const response = await GET(new Request('https://staff.example.test/api/staff-auth'));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private provider error');
  });
  it('rejects acceptance credentials configured in a production build', () => {
    vi.stubEnv('STOCKFLOW_AUTH_EXPECTED_PROJECT', 'aormuidjbdqruglmyseh');
    vi.stubEnv('SUPABASE_URL', 'https://ayrvhemxzizpkfcycvip.supabase.co');
    expect(staffAuthClient).toThrow('does not match this deployment');
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });
  it('accepts the exact expected project and rejects malformed project guards', () => {
    vi.stubEnv('STOCKFLOW_AUTH_EXPECTED_PROJECT', 'aormuidjbdqruglmyseh');
    vi.stubEnv('SUPABASE_URL', 'https://aormuidjbdqruglmyseh.supabase.co');
    expect(staffAuthClient()).toBeDefined();
    vi.stubEnv('STOCKFLOW_AUTH_EXPECTED_PROJECT', 'aormuidjbdqruglmyseh/path');
    expect(staffAuthClient).toThrow('does not match this deployment');
  });
  it.each(['', 'sb_publishable_012345678901234567890', 'sb_secret_replace-with-key'])('rejects missing or invalid provisioning secret %s', key => {
    vi.stubEnv('STOCKFLOW_AUTH_ADMIN_KEY', key);
    expect(() => staffInvitationClient()).toThrow('Staff provisioning is not configured');
  });
  it('accepts a separately configured server-only provisioning key', () => {
    vi.stubEnv('STOCKFLOW_AUTH_ADMIN_KEY', 'sb_secret_012345678901234567890123456789');
    expect(staffInvitationClient()).toBeDefined();
  });
  it.each([0, -1, NaN, Infinity])('rejects invalid provider session lifetime %s', async expires_in => {
    mocks.signInWithPassword.mockResolvedValue({ data: { session: { access_token: 'verified-token', expires_in } }, error: null });
    expect(await staffPasswordLogin('staff@example.test', 'password')).toBeNull();
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('rejects Sites hosts in direct authentication mode', () => {
    vi.stubEnv('STOCKFLOW_STAFF_ORIGIN', 'https://stockflow.chatgpt.site');
    expect(() => sameStaffOrigin(null)).toThrow('direct host');
  });
  it('rejects secret auth keys without authenticating credentials', async () => {
    vi.stubEnv('STOCKFLOW_AUTH_PUBLISHABLE_KEY', 'sb_secret_do-not-use-as-publishable');
    expect((await POST(request({ email: 'staff@example.test', password: 'password' }))).status).toBe(401);
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });
  it('does not enable alternate auth by default', () => { vi.stubEnv('STOCKFLOW_AUTH_MODE', ''); expect(staffAuthEnabled()).toBe(false); });
  it('rejects unknown modes rather than trusting headers', () => { vi.stubEnv('STOCKFLOW_AUTH_MODE', 'typo'); expect(staffAuthEnabled).toThrow(); });
  it('ignores forged Sites identity without a verified cookie', async () => { mocks.headers = new Headers({ 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'admin@example.test' }); expect(await getChatGPTUser()).toBeNull(); });
  it('uses the verified provider identity, not metadata or headers', async () => { mocks.token = 'verified-token'; mocks.headers.set('oai-authenticated-user-email', 'admin@example.test'); expect((await getChatGPTUser())?.email).toBe('staff@example.test'); expect(mocks.getUser).toHaveBeenCalledWith('verified-token'); });
  it('rejects cross-origin authenticated requests', async () => { mocks.token = 'verified-token'; mocks.headers.set('origin', 'https://evil.example.test'); expect(await getChatGPTUser()).toBeNull(); expect(mocks.getUser).not.toHaveBeenCalled(); });
  it('requires exact HTTPS configured origin', () => { expect(sameStaffOrigin('https://staff.example.test.evil.test')).toBe(false); vi.stubEnv('STOCKFLOW_STAFF_ORIGIN', 'http://staff.example.test'); expect(() => sameStaffOrigin(null)).toThrow(); });
  it.each([0, 429, 500, 503])('does not turn provider failure %s into a signed-out identity', async status => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status, message: 'private details' } });
    await expect(verifiedStaff('verified-token')).rejects.toThrow('temporarily unavailable');
  });
  it('rejects invalid provider tokens and unconfirmed email', async () => { mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } }); expect(await verifiedStaff('bad')).toBeNull(); mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'staff@example.test' } }, error: null }); expect(await verifiedStaff('token')).toBeNull(); });
  it('does not authenticate inactive membership', async () => { mocks.gateway.mockRejectedValue(new Error('Membership is not active')); const response = await POST(request({ email: 'staff@example.test', password: 'secret-not-logged' })); expect(response.status).toBe(401); expect(response.headers.get('set-cookie')).toBeNull(); expect(await response.text()).not.toContain('Membership'); });
  it('bounds session expiry and never returns tokens in JSON', async () => { mocks.signInWithPassword.mockResolvedValue({ data: { session: { access_token: 'verified-token', expires_in: 99999 } }, error: null }); const response = await POST(request({ email: 'staff@example.test', password: 'secret-not-logged' })); expect(await response.json()).toEqual({ ok: true }); expect(response.headers.get('set-cookie')).toContain('Max-Age=3600'); expect(response.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Strict'); expect(response.headers.get('cache-control')).toContain('no-store'); });
  it('rejects cross-origin login before credential verification', async () => { expect((await POST(request({ email: 'staff@example.test', password: 'password' }, 'https://evil.example.test'))).status).toBe(403); expect(mocks.signInWithPassword).not.toHaveBeenCalled(); });
  it('fails closed when auth is disabled', async () => { vi.stubEnv('STOCKFLOW_AUTH_MODE', 'sites'); expect((await POST(request({}))).status).toBe(404); });
  it('rejects malformed or oversized login bodies', async () => { expect((await POST(request({ email: 'a', password: '' }))).status).toBe(400); expect((await POST(request({ email: 'staff@example.test', password: 'x'.repeat(5000) }))).status).toBe(413); });
  it('checks membership of provider user rather than submitted email', async () => { await staffPasswordLogin('fake@example.test', 'password'); expect(mocks.gateway).toHaveBeenCalledWith('staff@example.test', 'session'); });
  it('clears only the host-only secure cookie on same-origin signout', async () => { const response = await DELETE(request({})); expect(response.status).toBe(200); expect(response.headers.get('set-cookie')).toBe(staffCookie('', 0)); expect((await DELETE(request({}, 'https://evil.example.test'))).status).toBe(403); });
});
