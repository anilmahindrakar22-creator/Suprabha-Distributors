import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ actor: vi.fn(), gateway: vi.fn(), invite: vi.fn(), reset: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.actor }));
vi.mock('@/lib/order-gateway', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
vi.mock('@/lib/staff-auth', () => ({
  staffAuthEnabled: () => process.env.STOCKFLOW_AUTH_MODE === 'supabase',
  sameStaffOrigin: (origin: string | null) => origin === 'https://staff.example.test',
  staffOrigin: () => 'https://staff.example.test',
  staffInvitationClient: () => ({ auth: { admin: { inviteUserByEmail: mocks.invite } } }),
  staffAuthClient: () => ({ auth: { resetPasswordForEmail: mocks.reset } }),
}));
import { POST } from '@/app/api/staff-invitation/route';
import { OrderGatewayError } from '@/lib/order-gateway';
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('STOCKFLOW_AUTH_MODE', 'supabase'); vi.stubEnv('STOCKFLOW_AUTH_EMAIL_RESET_ENABLED', 'true');
  mocks.actor.mockResolvedValue({ email: 'admin@example.test' });
  mocks.gateway.mockResolvedValue({ users: [{ email: 'staff@example.test', status: 'active' }] });
  mocks.invite.mockResolvedValue({ error: null });
  mocks.reset.mockResolvedValue({ error: null });
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
it('invites exact approved email with explicit setup redirect and no provider data', async () => { const response = await POST(request('STAFF@example.test')); expect(response.status).toBe(200); expect(mocks.gateway).toHaveBeenCalledWith('admin@example.test', 'list_users'); expect(mocks.invite).toHaveBeenCalledWith('staff@example.test', { redirectTo: 'https://staff.example.test/staff-password-reset' }); expect(response.headers.get('cache-control')).toContain('no-store'); expect(await response.json()).toEqual({ ok: true, kind: 'invite', message: 'Invitation requested. Staff must use the email link to set their own password.' }); expect(mocks.invite).toHaveBeenCalledTimes(1); expect(mocks.reset).not.toHaveBeenCalled(); });
it('does not expose provider errors or automatically retry', async () => { mocks.invite.mockResolvedValue({ error: new Error('secret-provider-error') }); const response = await POST(request()); expect(response.status).toBe(502); expect(await response.json()).toEqual({ error: 'Invitation not confirmed. Check the staff account before retrying; existing accounts may need a password reset' }); expect(mocks.invite).toHaveBeenCalledTimes(1); expect(mocks.reset).not.toHaveBeenCalled(); });
it.each([{ code: 'email_exists' }, { status: 422, code: 'email_exists' }, { status: 422, code: 'user_already_exists' }])('sends a set-password email for an existing login %j', async error => {
  mocks.invite.mockResolvedValue({ error });
  const response = await POST(request('STAFF@example.test'));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, kind: 'reset', message: 'This person already has a StockFlow login. A link to set a new password was emailed to them.' });
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(mocks.invite).toHaveBeenCalledTimes(1);
  expect(mocks.reset).toHaveBeenCalledTimes(1);
  expect(mocks.reset).toHaveBeenCalledWith('staff@example.test', { redirectTo: 'https://staff.example.test/staff-password-reset' });
});
it.each(['returns an error', 'throws'])('reports an unconfirmed set-password email when recovery %s', async failure => {
  mocks.invite.mockResolvedValue({ error: { status: 422, code: 'email_exists' } });
  if (failure === 'throws') mocks.reset.mockRejectedValue(new Error('secret-provider-error'));
  else mocks.reset.mockResolvedValue({ error: new Error('secret-provider-error') });
  const response = await POST(request());
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: 'Set-password email not confirmed. Check the staff account before retrying.' });
  expect(mocks.invite).toHaveBeenCalledTimes(1);
  expect(mocks.reset).toHaveBeenCalledTimes(1);
});
it.each([{ status: 422, code: 'other_error' }, { status: 400, code: 'user_already_exists' }])('does not send recovery for another invite error %j', async error => {
  mocks.invite.mockResolvedValue({ error });
  const response = await POST(request());
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: 'Invitation not confirmed. Check the staff account before retrying; existing accounts may need a password reset' });
  expect(mocks.invite).toHaveBeenCalledTimes(1);
  expect(mocks.reset).not.toHaveBeenCalled();
});
it('reports uncertain provider failures without retry', async () => { mocks.invite.mockRejectedValue(new Error('secret')); const response = await POST(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain('secret'); expect(mocks.invite).toHaveBeenCalledTimes(1); });
