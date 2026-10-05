import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { sameStaffOrigin, staffAuthEnabled, staffCookie, staffPasswordLogin } from '@/lib/staff-auth';

const headers = { 'cache-control': 'private, no-store' };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

export async function POST(request: Request) {
  try {
    if (!staffAuthEnabled()) return fail(404, 'Staff sign-in is not enabled');
    if (!sameStaffOrigin(request.headers.get('origin'))) return fail(403, 'Request denied');
    const body = await readBoundedJsonRequest(request, 4096);
    if (!body || typeof body !== 'object' || !('email' in body) || !('password' in body) || typeof body.email !== 'string' || typeof body.password !== 'string' || body.email.length > 254 || !body.email.includes('@') || !body.password || body.password.length > 1024) return fail(400, 'Enter your email and password');
    const session = await staffPasswordLogin(body.email, body.password);
    if (!session) return fail(401, 'Unable to sign in with this account');
    return Response.json({ ok: true }, { headers: { ...headers, 'set-cookie': staffCookie(session.token, session.expiresIn) } });
  } catch (error) {
    if (error instanceof BoundedJsonRequestError) return fail(error.status, 'Invalid sign-in request');
    // Never expose provider payloads, passwords, tokens or membership details.
    return fail(401, 'Unable to sign in with this account');
  }
}

export async function DELETE(request: Request) {
  try {
    if (!staffAuthEnabled()) return fail(404, 'Staff sign-in is not enabled');
    if (!sameStaffOrigin(request.headers.get('origin'))) return fail(403, 'Request denied');
    return Response.json({ ok: true }, { headers: { ...headers, 'set-cookie': staffCookie('', 0) } });
  } catch { return fail(503, 'Sign-out is temporarily unavailable'); }
}
