import { getChatGPTUser } from '@/app/chatgpt-auth';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { buildGrowthDecision, growthInboxFilters, normalizeGrowthDecision, normalizeGrowthInbox, type GrowthInboxFilter } from '@/lib/growth-inbox-types';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';

const headers = { 'cache-control': 'private, no-store' };
const unavailable = 'Growth inbox is unavailable. Try again.';
const knownMessages = new Set(['Card is no longer current', 'Link the ledger first', 'Card already decided', 'Already in progress']);
function failure(error: unknown) {
  const status = error instanceof OrderGatewayError ? error.status : 502;
  const message = error instanceof OrderGatewayError && [400, 409].includes(status) && knownMessages.has(error.message) ? error.message : unavailable;
  return Response.json({ error: message }, { status, headers });
}
async function authorize() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: 'Sign in required' }, { status: 401, headers });
  const session = await getStockFlowSession(user.email);
  if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management'])) return Response.json({ error: 'Growth is for management only.' }, { status: 403, headers });
  return session;
}

export async function GET(request: Request) {
  try {
    const session = await authorize();
    if (session instanceof Response) return session;
    const params = new URL(request.url).searchParams;
    const filter = params.get('filter'), pageText = params.get('page');
    const page = Number(pageText);
    if ([...params.keys()].some(key => !['filter', 'page'].includes(key) || params.getAll(key).length !== 1)
      || !growthInboxFilters.includes(filter as GrowthInboxFilter)
      || pageText === null || !/^[1-9]\d*$/.test(pageText) || !Number.isSafeInteger(page)) {
      return Response.json({ error: 'Invalid growth inbox parameters' }, { status: 400, headers });
    }
    const data = normalizeGrowthInbox(await callOrderGateway(session.email, 'get_growth_inbox', { filter, page }));
    if (!data || data.filter !== filter || data.page !== page) throw new Error('Malformed growth inbox response');
    return Response.json({ ...data, viewerEmail: session.email }, { headers });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const session = await authorize();
    if (session instanceof Response) return session;
    let body: unknown;
    try { body = await request.json(); } catch {
      return Response.json({ error: 'Invalid growth decision' }, { status: 400, headers });
    }
    const payload = buildGrowthDecision(body);
    if (!payload) return Response.json({ error: 'Invalid growth decision' }, { status: 400, headers });
    const data = normalizeGrowthDecision(await callOrderGateway(session.email, 'decide_growth_card', payload));
    if (!data || data.cardKey !== payload.cardKey || data.decision !== payload.decision) throw new Error('Malformed growth decision response');
    return Response.json(data, { headers });
  } catch (error) { return failure(error); }
}
