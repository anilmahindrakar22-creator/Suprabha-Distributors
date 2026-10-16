import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { buildInstrumentPortfolio } from '@/lib/instrument-portfolio';
import type { ServiceWorkspaceData } from '@/lib/service-types';

const headers = { 'cache-control': 'private, no-store' };
export async function GET() {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: 'Sign in required' }, { status: 401, headers });
    const session = await getStockFlowSession(user.email);
    if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management', 'operations', 'sales'])) {
      return Response.json({ error: 'Instrument workspace access required' }, { status: 403, headers });
    }
    const data = await callOrderGateway<ServiceWorkspaceData>(session.email, 'get_service_workspace');
    return Response.json(buildInstrumentPortfolio(data, new Date().toISOString()), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof OrderGatewayError ? error.message : 'Instrument portfolio is temporarily unavailable' },
      { status: error instanceof OrderGatewayError ? error.status : 502, headers });
  }
}
