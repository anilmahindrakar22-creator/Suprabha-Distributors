import { cookies } from 'next/headers';
import { OrderGatewayError } from '@/lib/order-gateway';
import { renewStaffSession, sameStaffOrigin, STAFF_REFRESH_COOKIE, staffAuthEnabled, staffCookie, staffRefreshCookie } from '@/lib/staff-auth';

const headers = { 'cache-control': 'private, no-store' };
export async function POST(request: Request) {
  try {
    if (!staffAuthEnabled()) return Response.json({ error: 'Staff sign-in is not enabled' }, { status: 404, headers });
    if (!sameStaffOrigin(request.headers.get('origin'))) return Response.json({ error: 'Request denied' }, { status: 403, headers });
    const token = (await cookies()).get(STAFF_REFRESH_COOKIE)?.value;
    const session = token ? await renewStaffSession(token) : null;
    if (!session) return Response.json({ error: 'Sign in required' }, { status: 401, headers });
    const response = Response.json({ ok: true }, { headers });
    response.headers.append('set-cookie', staffCookie(session.token, session.expiresIn));
    response.headers.append('set-cookie', staffRefreshCookie(session.refreshToken));
    return response;
  } catch (error) {
    // No cookies on denial or uncertain outcome. Never send provider details.
    const denied = error instanceof OrderGatewayError && [401, 403].includes(error.status);
    return Response.json({ error: denied ? 'Access denied' : 'Session renewal is temporarily unavailable' }, { status: denied ? 403 : 503, headers });
  }
}
