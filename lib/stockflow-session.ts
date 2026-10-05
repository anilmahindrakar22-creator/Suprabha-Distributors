import { callOrderGateway, OrderGatewayError } from './order-gateway';
import { normalizeStockFlowRoles, type StockFlowRole } from './user-types';

export type StockFlowSession = { email: string; role: StockFlowRole; roles: StockFlowRole[] };

export async function getStockFlowSession(email: string): Promise<StockFlowSession | null> {
  try {
    const response = await callOrderGateway<unknown>(email, 'session');
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
      throw new OrderGatewayError('Invalid membership response', 502);
    }
    const session = response as Record<string, unknown>;
    const primary = normalizeStockFlowRoles(session.role);
    // Only an absent field is legacy compatibility; malformed role sets cannot
    // fall back to a more privileged scalar value.
    const roles = normalizeStockFlowRoles(session.roles === undefined ? session.role : session.roles);
    if (typeof session.email !== 'string' || session.email !== email.trim().toLowerCase() ||
      typeof session.role !== 'string' || !primary || primary.length !== 1 || !roles || !roles.includes(primary[0])) {
      throw new OrderGatewayError('Invalid membership response', 502);
    }
    return { email: session.email, role: primary[0], roles };
  } catch (error) {
    if (error instanceof OrderGatewayError && error.status === 403) return null;
    throw error;
  }
}
