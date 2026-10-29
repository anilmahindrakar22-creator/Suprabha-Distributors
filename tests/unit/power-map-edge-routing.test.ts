import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { RequestGate, readBoundedJson, isApprovedGatewayKey } from '../../supabase/functions/stockflow-orders/request-gate';
const source = readFileSync(new URL('../../supabase/functions/stockflow-orders/index.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const key = 'power-map-edge-test-key-0000000000000000';
function fixture() {
  let handler!: (request: Request) => Promise<Response>;
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
  const begin = vi.fn().mockResolvedValue({ allowed: true, key: 'admitted', token: 1 });
  const finish = vi.fn();
  class Gate extends RequestGate { override begin = begin; override finish = finish; }
  const values: Record<string, string> = { SUPABASE_URL: 'https://database.example.test', SUPABASE_SECRET_KEYS: '{"stockflowedge":"test-secret"}', STOCKFLOW_ORDER_GATEWAY_SHA256: createHash('sha256').update(key).digest('hex') };
  const deno = { serve: (callback: typeof handler) => { handler = callback; }, env: { get: (name: string) => values[name] } };
  new Function('Deno', 'fetch', 'RequestGate', 'readBoundedJson', 'isApprovedGatewayKey', javascript)(deno, fetcher, Gate, readBoundedJson, isApprovedGatewayKey);
  const payload = { customerId: '11111111-1111-4111-8111-111111111111' };
  const send = (action: string, credential = key) => handler(new Request('https://edge.test', { method: 'POST', headers: { 'content-type': 'application/json', 'x-order-gateway-key': credential }, body: JSON.stringify({ actorEmail: 'manager@example.test', action, payload }) }));
  return { send, fetcher, begin, finish, payload };
}
describe('power map Edge routing', () => {
  it.each(['get_power_map', 'set_influence', 'end_influence'])('routes %s to power map RPC with unchanged arguments', async action => {
    const { send, fetcher, payload, begin, finish } = fixture();
    expect((await send(action)).status).toBe(200);
    expect(fetcher.mock.calls[0][0]).toBe('https://database.example.test/rest/v1/rpc/stockflow_power_map_gateway');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ p_gateway_key: key, p_actor_email: 'manager@example.test', p_action: action, p_payload: payload });
    expect(begin).toHaveBeenCalledTimes(action === 'get_power_map' ? 0 : 1);
    expect(finish).toHaveBeenCalledTimes(action === 'get_power_map' ? 0 : 1);
  });
  it('preserves conflict messages and finishes write admission', async () => { const { send, fetcher, finish } = fixture(); fetcher.mockResolvedValue(Response.json({ code: 'PT409', message: 'Already ended' }, { status: 400 })); const response = await send('end_influence'); expect(response.status).toBe(409); expect(await response.json()).toEqual({ code: 'PT409', message: 'Already ended' }); expect(finish).toHaveBeenCalledWith(expect.anything(), true); });
  it('requires an approved gateway credential', async () => { const { send, fetcher } = fixture(); expect((await send('get_power_map', 'invalid-key-00000000000000000000000000')).status).toBe(403); expect(fetcher).not.toHaveBeenCalled(); });
});
