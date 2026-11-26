import { getChatGPTUser } from '@/app/chatgpt-auth';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { normalizeGrowthCohorts, normalizeGrowthCohortLabs } from '@/lib/growth-cohort-types';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';

const headers = { 'cache-control': 'private, no-store' };
export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: 'Sign in required' }, { status: 401, headers });
    const session = await getStockFlowSession(user.email);
    if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management'])) return Response.json({ error: 'Growth is for management only.' }, { status: 403, headers });
    const params = new URL(request.url).searchParams;
    const cohort = params.get('cohort');
    if (params.size !== 0 && (params.size !== 1 || cohort === null || !/^(existing|\d{4})$/.test(cohort))) return Response.json({ error: 'Invalid growth cohorts parameters' }, { status: 400, headers });
    const raw: unknown = await callOrderGateway(session.email, 'get_growth_cohorts', cohort === null ? {} : { cohort });
    const data = cohort === null ? normalizeGrowthCohorts(raw) : normalizeGrowthCohortLabs(raw);
    if (!data || ('cohort' in data && data.cohort !== cohort)) throw new Error('Malformed growth cohorts response');
    return Response.json(data, { headers });
  } catch (error) {
    return Response.json({ error: 'Growth is unavailable. Try again.' }, { status: error instanceof OrderGatewayError ? error.status : 502, headers });
  }
}
export function POST() {
  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'GET' } });
}
