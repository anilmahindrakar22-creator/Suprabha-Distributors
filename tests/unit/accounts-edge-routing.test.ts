import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { RequestGate, readBoundedJson, isApprovedGatewayKey } from '../../supabase/functions/stockflow-orders/request-gate';

// Execute the released handler with real request admission/body/key validation,
// substituting only Deno's hosting API and the remote database transport.
const source = readFileSync(new URL('../../supabase/functions/stockflow-orders/index.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const key = 'account-routing-fixture-key-00000000000000000000';
function fixture() {
  let handler!: (request: Request) => Promise<Response>;
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
  const values: Record<string, string> = { SUPABASE_URL: 'https://database.example.test', SUPABASE_SECRET_KEYS: '{"stockflowedge":"test-only-secret"}', STOCKFLOW_ORDER_GATEWAY_SHA256: createHash('sha256').update(key).digest('hex') };
  const deno = { serve: (callback: typeof handler) => { handler = callback; }, env: { get: (name: string) => values[name] } };
  new Function('Deno', 'fetch', 'RequestGate', 'readBoundedJson', 'isApprovedGatewayKey', javascript)(deno, fetcher, RequestGate, readBoundedJson, isApprovedGatewayKey);
  const send = (action: string, gatewayKey = key) => handler(new Request('https://edge.example.test', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-order-gateway-key': gatewayKey },
    body: JSON.stringify({ actorEmail: 'sales@example.test', action, payload: { idempotencyKey: 'routing-command-key-001' } }),
  }));
  return { send, fetcher };
}
describe('Accounts Edge routing and existing admission boundary', () => {
  it.each(['get_accounts', 'create_territory', 'assign_account', 'set_location', 'log_visit'])('routes %s to Accounts with server credentials only', async action => {
    const { send, fetcher } = fixture();
    expect((await send(action)).status).toBe(200);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://database.example.test/rest/v1/rpc/stockflow_accounts_gateway');
    expect(JSON.parse(options.body)).toEqual({ p_gateway_key: key, p_actor_email: 'sales@example.test', p_action: action, p_payload: { idempotencyKey: 'routing-command-key-001' } });
    expect(options.headers).toEqual({ apikey: 'test-only-secret', 'content-type': 'application/json' });
  });
  it('denies an unapproved gateway before contacting the database', async () => {
    const { send, fetcher } = fixture();
    expect((await send('get_accounts', 'wrong-fixture-key-000000000000000000000')).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preserves existing order summary routing', async () => {
    const { send, fetcher } = fixture();
    expect((await send('get_order_summary')).status).toBe(200);
    expect(fetcher.mock.calls[0][0]).toBe('https://database.example.test/rest/v1/rpc/stockflow_order_summary_gateway');
  });
  it('passes database role denial and conflict through and cools down a stale command', async () => {
    const { send, fetcher } = fixture();
    fetcher.mockResolvedValueOnce(Response.json({ code: '42501', message: 'Accounts access required' }, { status: 400 }));
    expect((await send('get_accounts')).status).toBe(403);
    fetcher.mockResolvedValueOnce(Response.json({ code: 'PT409', message: 'Owner changed' }, { status: 400 }));
    expect((await send('assign_account')).status).toBe(409);
    expect((await send('assign_account')).status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
