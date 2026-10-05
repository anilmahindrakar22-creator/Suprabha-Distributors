import { getChatGPTUser } from '@/app/chatgpt-auth';
import { callOrderGateway } from '@/lib/order-gateway';
import { readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { sameStaffOrigin, staffAuthClient, staffAuthEnabled, staffCookie, staffOrigin, verifiedStaff } from '@/lib/staff-auth';

const headers = { 'cache-control': 'private, no-store' };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

export async function POST(request: Request) {
  try {
    if (!staffAuthEnabled()) return fail(404, 'Staff recovery is not enabled');
    if (!sameStaffOrigin(request.headers.get('origin'))) return fail(403, 'Request denied');
    if (process.env.STOCKFLOW_AUTH_EMAIL_RESET_ENABLED !== 'true') return fail(503, 'Recovery email delivery has not been configured');
    const actor = await getChatGPTUser();
    if (!actor) return fail(401, 'Sign in required');
    // Existing gateway enforces Administrator, not a client-supplied role.
    const directory = await callOrderGateway<{ users: { email: string; status: string }[] }>(actor.email, 'list_users');
    const body = await readBoundedJsonRequest(request, 4096);
    if (!body || typeof body !== 'object' || !('email' in body) || typeof body.email !== 'string') return fail(400, 'A staff email is required');
    const email = body.email.trim().toLowerCase();
    if (!directory.users.some(member => member.email === email && member.status === 'active')) return fail(400, 'Select an active approved staff account');
    const { error } = await staffAuthClient().auth.resetPasswordForEmail(email, { redirectTo: `${staffOrigin()}/staff-password-reset` });
    if (error) return fail(503, 'Recovery request failed. Please retry later');
    return Response.json({ ok: true, message: 'Recovery requested. The staff member must use the email link to choose a password.' }, { headers });
  } catch { return fail(403, 'Recovery request could not be authorized'); }
}

export async function PUT(request: Request) {
  try {
    if (!staffAuthEnabled()) return fail(404, 'Staff recovery is not enabled');
    if (!sameStaffOrigin(request.headers.get('origin'))) return fail(403, 'Request denied');
    const body = await readBoundedJsonRequest(request, 12288);
    if (!body || typeof body !== 'object' || !('token' in body) || !('password' in body) || typeof body.token !== 'string' || typeof body.password !== 'string' || body.token.length > 8192 || body.password.length < 12 || body.password.length > 1024) return fail(400, 'Use a valid recovery link and a password of at least 12 characters');
    const user = await verifiedStaff(body.token);
    if (!user) return fail(401, 'Recovery link is invalid or expired');
    await callOrderGateway(user.email, 'session');
    // GoTrue verifies the bearer token; no admin credential or password storage.
    const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT', cache: 'no-store', signal: AbortSignal.timeout(15000),
      headers: { apikey: process.env.STOCKFLOW_AUTH_PUBLISHABLE_KEY!, authorization: `Bearer ${body.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ password: body.password }),
    });
    if (!response.ok) return fail(400, 'Password could not be changed. Request a new recovery link');
    // Password update and revocation are provider operations, not one DB transaction.
    // Do not report a complete reset if global refresh-session revocation fails.
    const logout = await fetch(`${process.env.SUPABASE_URL}/auth/v1/logout?scope=global`, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15000),
      headers: { apikey: process.env.STOCKFLOW_AUTH_PUBLISHABLE_KEY!, authorization: `Bearer ${body.token}` },
    });
    if (!logout.ok) return fail(503, 'Password changed, but session revocation is unconfirmed. Contact your administrator');
    return Response.json({ ok: true }, { headers: { ...headers, 'set-cookie': staffCookie('', 0) } });
  } catch { return fail(503, 'Recovery outcome is unconfirmed. Contact your administrator before retrying'); }
}
