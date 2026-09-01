import { callOrderGateway, OrderGatewayError } from './order-gateway';

export type StockFlowSession = { email: string; role: string };

export async function getStockFlowSession(email: string): Promise<StockFlowSession | null> {
  try {
    return await callOrderGateway<StockFlowSession>(email, 'session');
  } catch (error) {
    if (error instanceof OrderGatewayError && error.status === 403) return null;
    throw error;
  }
}
