import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ actor: vi.fn(), gateway: vi.fn(), invite: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.actor }));
vi.mock('@/lib/order-gateway', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
vi.mock('@/lib/staff-auth', () => ({
  staffAuthEnabled: () => process.env.STOCKFLOW_AUTH_MODE === 'supabase',
  sameStaffOrigin: (origin: string | null) => origin === 'https://staff.example.test',
  staffOrigin: () => 'https://staff.example.test',
  staffInvitationClient: () => ({ auth: { admin: { inviteUserByEmail: mocks.invite } } }),
}));
import { POST } from '@/app/api/staff-invitation/route';
import { OrderGatewayError } from '@/lib/order-gateway';
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('STOCKFLOW_AUTH_MODE', 'supabase'); vi.stubEnv('STOCKFLOW_AUTH_EMAIL_RESET_ENABLED', 'true');
  mocks.actor.mockResolvedValue({ email: 'admin@example.test' });
  mocks.gateway.mockResolvedValue({ users: [{ email: 'staff@example.test', status: 'active' }] });
  mocks.invite.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());
const request = (email: unknown = 'staff@example.test', origin = 'https://staff.example.test') => new Request('https://staff.example.test/api/staff-invitation', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
it('keeps Sites deployments unchanged', async () => { vi.stubEnv('STOCKFLOW_AUTH_MODE', 'sites'); expect((await POST(request())).status).toBe(404); expect(mocks.invite).not.toHaveBeenCalled(); });
it('denies cross-origin requests before authorization', async () => { expect((await POST(request(undefined, 'https://evil.test'))).status).toBe(403); expect(mocks.gateway).not.toHaveBeenCalled(); });
it('denies unauthenticated requests', async () => { mocks.actor.mockResolvedValue(null); expect((await POST(request())).status).toBe(401); expect(mocks.invite).not.toHaveBeenCalled(); });
it('requires gateway administrator authorization', async () => { mocks.gateway.mockRejectedValue(new OrderGatewayError('private role details', 403)); const response = await POST(request()); expect(response.status).toBe(403); expect(await response.text()).not.toContain('private role'); expect(mocks.invite).not.toHaveBeenCalled(); });
it.each(['outsider@example.test', 42, 'x'.repeat(255)])('denies invalid or nonmember targets %s', async email => { expect((await POST(request(email))).status).toBe(400); expect(mocks.invite).not.toHaveBeenCalled(); });
it('denies suspended staff', async () => { mocks.gateway.mockResolvedValue({ users: [{ email: 'staff@example.test', status: 'suspended' }] }); expect((await POST(request())).status).toBe(400); expect(mocks.invite).not.toHaveBeenCalled(); });
it('keeps unverified email delivery disabled', async () => { vi.stubEnv('STOCKFLOW_AUTH_EMAIL_RESET_ENABLED', 'false'); expect((await POST(request())).status).toBe(503); expect(mocks.invite).not.toHaveBeenCalled(); });
it('invites exact approved email with explicit setup redirect and no provider data', async () => { const response = await POST(request('STAFF@example.test')); expect(response.status).toBe(200); expect(mocks.gateway).toHaveBeenCalledWith('admin@example.test', 'list_users'); expect(mocks.invite).toHaveBeenCalledWith('staff@example.test', { redirectTo: 'https://staff.example.test/staff-password-reset' }); expect(response.headers.get('cache-control')).toContain('no-store'); expect(await response.json()).toEqual({ ok: true, message: expect.any(String) }); });
it('does not expose provider errors or automatically retry', async () => { mocks.invite.mockResolvedValue({ error: new Error('secret-provider-error') }); const response = await POST(request()); expect(response.status).toBe(502); expect(await response.text()).not.toContain('secret-provider'); expect(mocks.invite).toHaveBeenCalledTimes(1); });
it('reports uncertain provider failures without retry', async () => { mocks.invite.mockRejectedValue(new Error('secret')); const response = await POST(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain('secret'); expect(mocks.invite).toHaveBeenCalledTimes(1); });
