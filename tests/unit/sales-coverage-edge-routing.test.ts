import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { RequestGate, readBoundedJson, isApprovedGatewayKey } from '../../supabase/functions/stockflow-orders/request-gate';

const source = readFileSync(new URL('../../supabase/functions/stockflow-orders/index.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const key = 'sales-coverage-routing-fixture-key-000000000000';
function fixture() {
  let handler!: (request: Request) => Promise<Response>;
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
  const values: Record<string, string> = { SUPABASE_URL: 'https://database.example.test', SUPABASE_SECRET_KEYS: '{"stockflowedge":"test-only-secret"}', STOCKFLOW_ORDER_GATEWAY_SHA256: createHash('sha256').update(key).digest('hex') };
  const deno = { serve: (callback: typeof handler) => { handler = callback; }, env: { get: (name: string) => values[name] } };
  new Function('Deno', 'fetch', 'RequestGate', 'readBoundedJson', 'isApprovedGatewayKey', javascript)(deno, fetcher, RequestGate, readBoundedJson, isApprovedGatewayKey);
  const send = (action: string, payload: Record<string, unknown> = {}) => handler(new Request('https://edge.example.test', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-order-gateway-key': key },
    body: JSON.stringify({ actorEmail: 'accounts@example.test', action, payload }),
  }));
  return { send, fetcher };
}

describe('Sales coverage Edge routing', () => {
  it('routes get_sales_coverage to the Economics gateway', async () => {
    const { send, fetcher } = fixture();
    expect((await send('get_sales_coverage', {})).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://database.example.test/rest/v1/rpc/stockflow_economics_gateway');
    expect(JSON.parse(options.body)).toEqual({ p_gateway_key: key, p_actor_email: 'accounts@example.test', p_action: 'get_sales_coverage', p_payload: {} });
  });

  it('keeps every read action registered as an allowed action', async () => {
    const readActions = [...source.matchAll(/readActions\.add\('([a-z_]+)'\)/g)].map(match => match[1]);
    expect(readActions.length).toBeGreaterThanOrEqual(20);
    for (const action of readActions) {
      const { send } = fixture();
      const response = await send(action, {});
      expect(response.status, `${action} should be routed`).toBe(200);
      expect(await response.text(), `${action} should not be rejected as invalid`).not.toBe('{"error":"Invalid request"}');
    }
  });
});
