import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { RequestGate, readBoundedJson, isApprovedGatewayKey } from '../../supabase/functions/stockflow-orders/request-gate';

const source = readFileSync(new URL('../../supabase/functions/stockflow-orders/index.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const key = 'today-edge-test-key-00000000000000000000';
// oxlint-disable-next-line typescript/no-implied-eval
function fixture() {
  let handler!: (request: Request) => Promise<Response>;
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
  const values: Record<string, string> = {
    SUPABASE_URL: 'https://database.example.test',
    SUPABASE_SECRET_KEYS: '{"stockflowedge":"test-secret"}',
    STOCKFLOW_ORDER_GATEWAY_SHA256: createHash('sha256').update(key).digest('hex'),
  };
  const deno = { serve: (callback: typeof handler) => { handler = callback; }, env: { get: (name: string) => values[name] } };
  // oxlint-disable-next-line typescript/no-implied-eval
  new Function('Deno', 'fetch', 'RequestGate', 'readBoundedJson', 'isApprovedGatewayKey', javascript)(deno, fetcher, RequestGate, readBoundedJson, isApprovedGatewayKey);
  const send = () => handler(new Request('https://edge.test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-order-gateway-key': key },
    body: JSON.stringify({ actorEmail: 'manager@example.test', action: 'get_today', payload: {} }),
  }));
  return { send, fetcher };
}

describe('Today Edge routing', () => {
  it('routes get_today to stockflow_today_gateway with the empty payload', async () => {
    const { send, fetcher } = fixture();
    expect((await send()).status).toBe(200);
    expect(fetcher.mock.calls[0][0]).toBe('https://database.example.test/rest/v1/rpc/stockflow_today_gateway');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ p_action: 'get_today', p_payload: {} });
  });

  it('bypasses write admission for get_today', async () => {
    const admission = vi.spyOn(RequestGate.prototype, 'begin');
    try {
      const { send } = fixture();
      expect((await send()).status).toBe(200);
      expect(admission).not.toHaveBeenCalled();
    } finally {
      admission.mockRestore();
    }
  });
});
