import { getChatGPTUser } from '@/app/chatgpt-auth';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { sameStaffOrigin, staffAuthEnabled, staffInvitationClient, staffOrigin } from '@/lib/staff-auth';

const headers = { 'cache-control': 'private, no-store' };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

export async function POST(request: Request) {
  try {
    if (!staffAuthEnabled()) return fail(404, 'Staff invitations are not enabled');
    if (!sameStaffOrigin(request.headers.get('origin'))) return fail(403, 'Request denied');
    const actor = await getChatGPTUser();
    if (!actor) return fail(401, 'Sign in required');
    // The existing gateway requires Administrator for this action.
    const directory = await callOrderGateway<{ users: { email: string; status: string }[] }>(actor.email, 'list_users');
    const body = await readBoundedJsonRequest(request, 4096);
    if (!body || typeof body !== 'object' || !('email' in body) || typeof body.email !== 'string' || body.email.length > 254) return fail(400, 'Select an active approved staff account');
    const email = body.email.trim().toLowerCase();
    if (!directory.users.some(member => member.email === email && member.status === 'active')) return fail(400, 'Select an active approved staff account');
    if (process.env.STOCKFLOW_AUTH_EMAIL_RESET_ENABLED !== 'true') return fail(503, 'Access is saved, but invitation email delivery is not enabled');
    const { error } = await staffInvitationClient().auth.admin.inviteUserByEmail(email, { redirectTo: `${staffOrigin()}/staff-password-reset` });
    if (error) return fail(502, 'Invitation not confirmed. Check the staff account before retrying; existing accounts may need a password reset');
    return Response.json({ ok: true, message: 'Invitation requested. Staff must use the email link to set their own password.' }, { headers });
  } catch (error) {
    if (error instanceof BoundedJsonRequestError) return fail(error.status, error.message);
    if (error instanceof OrderGatewayError) return fail(error.status, 'Invitation could not be authorized');
    return fail(503, 'Invitation outcome is unconfirmed. Check the staff account before retrying');
  }
}
