import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { RequestGate, readBoundedJson, isApprovedGatewayKey } from '../../supabase/functions/stockflow-orders/request-gate';

const source = readFileSync(new URL('../../supabase/functions/stockflow-orders/index.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const key = 'growth-edge-test-key-000000000000000';
function fixture() {
  let handler!: (request: Request) => Promise<Response>;
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
  const values: Record<string, string> = {
    SUPABASE_URL: 'https://database.example.test', SUPABASE_SECRET_KEYS: '{"stockflowedge":"test-secret"}',
    STOCKFLOW_ORDER_GATEWAY_SHA256: createHash('sha256').update(key).digest('hex'),
  };
  const deno = { serve: (callback: typeof handler) => { handler = callback; }, env: { get: (name: string) => values[name] } };
  // oxlint-disable-next-line typescript/no-implied-eval
  new Function('Deno', 'fetch', 'RequestGate', 'readBoundedJson', 'isApprovedGatewayKey', javascript)(deno, fetcher, RequestGate, readBoundedJson, isApprovedGatewayKey);
  const send = (action: string, payload: Record<string, unknown>) => handler(new Request('https://edge.test', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-order-gateway-key': key },
    body: JSON.stringify({ actorEmail: 'staff@example.test', action, payload }),
  }));
  return { send, fetcher };
}

describe('Growth Edge routing', () => {
  it.each(['get_growth', 'get_growth_labs'])('routes %s read-only to its RPC', async action => {
    const admission = vi.spyOn(RequestGate.prototype, 'begin');
    try {
      const { send, fetcher } = fixture();
      const payload = action === 'get_growth_labs' ? { list: 'month_skipped', month: '2026-10', page: 1 } : {};
      expect((await send(action, payload)).status).toBe(200);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher.mock.calls[0][0]).toBe('https://database.example.test/rest/v1/rpc/stockflow_growth_gateway');
      expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ p_gateway_key: key, p_actor_email: 'staff@example.test', p_action: action, p_payload: payload });
      expect(admission).not.toHaveBeenCalled();
    } finally { admission.mockRestore(); }
  });
  it('preserves the database management-only rejection', async () => {
    const { send, fetcher } = fixture();
    fetcher.mockResolvedValue(Response.json({ message: 'Management required', code: '42501' }, { status: 403 }));
    expect((await send('get_growth', {})).status).toBe(403);
  });
});

