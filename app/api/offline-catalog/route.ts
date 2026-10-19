import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import { hasAnyStockFlowRole } from '@/lib/user-types';
import type { CatalogItem, CustomerDirectoryEntry } from '@/lib/order-types';

const headers = { 'cache-control': 'private, no-store' };
export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: 'Sign in required' }, { status: 401, headers });
    const session = await getStockFlowSession(user.email);
    if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'sales', 'operations', 'management'])) {
      return Response.json({ error: 'Order entry access required' }, { status: 403, headers });
    }
    const params = new URL(request.url).searchParams;
    const kind = params.get('kind');
    if (!['products', 'customers'].includes(kind || '') || [...params.keys()].some((key) => key !== 'kind')) {
      return Response.json({ error: 'Invalid catalogue request' }, { status: 400, headers });
    }
    // One explicitly requested directory at a time; never bootstrap orders or pricing.
    const result = kind === 'products'
      ? await callOrderGateway<{ catalogVersion: string; catalog: CatalogItem[] }>(user.email, 'get_catalog')
      : await callOrderGateway<{ customerVersion: string; customers: CustomerDirectoryEntry[] }>(user.email, 'get_customers');
    const rows = 'catalog' in result
      ? result.catalog.filter((item) => item.active).map(({ tallyKey, item, group, baseUnit }) => ({ tallyKey, item, group, baseUnit }))
      : result.customers.map(({ id, name }) => ({ id, name }));
    const version = 'catalogVersion' in result ? result.catalogVersion : result.customerVersion;
    // Existing gateways return complete directories. Fetch once rather than
    // refetching the whole directory for every client-side page.
    if (rows.length > 10_000 || new TextEncoder().encode(JSON.stringify(rows)).byteLength > 4_000_000) {
      return Response.json({ error: 'Directory exceeds offline preparation limit.' }, { status: 413, headers });
    }
    return Response.json({ actorEmail: session.email, version, rows }, { headers });
  } catch (error) {
    const status = error instanceof OrderGatewayError ? error.status : 502;
    return Response.json({ error: 'Offline preparation is unavailable. Reconnect and retry.' }, { status, headers });
  }
}
