import { getChatGPTUser } from '@/app/chatgpt-auth';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { measuredJsonResponse } from '@/lib/measured-json-response';
import { parseMarketOverviewQuery, type MarketOverview } from '@/lib/market-overview-types';

const privateHeaders = { 'cache-control': 'private, no-store' };
const failure = (error: string, status: number) => Response.json({ error }, { status, headers: privateHeaders });
export async function GET(request: Request) {
  const startedAt = performance.now();
  try {
    const user = await getChatGPTUser();
    if (!user) throw new OrderGatewayError('Sign in required', 401);
    const query = parseMarketOverviewQuery(new URL(request.url).searchParams);
    if (!query) return failure('Invalid market request', 400);
    return measuredJsonResponse(await callOrderGateway<MarketOverview>(user.email, 'get_market_overview', query), startedAt);
  } catch (error) {
    return error instanceof OrderGatewayError ? failure(error.message, error.status) : failure('Market is temporarily unavailable', 502);
  }
}
