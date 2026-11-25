import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { RequestGate, readBoundedJson, isApprovedGatewayKey } from '../../supabase/functions/stockflow-orders/request-gate';

const source = readFileSync(new URL('../../supabase/functions/stockflow-orders/index.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const key = 'purchase-routing-fixture-key-0000000000000000000';
function fixture() {
  let handler!: (request: Request) => Promise<Response>;
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ ok: true })));
  const values: Record<string, string> = { SUPABASE_URL: 'https://database.example.test', SUPABASE_SECRET_KEYS: '{"stockflowedge":"test-only-secret"}', STOCKFLOW_ORDER_GATEWAY_SHA256: createHash('sha256').update(key).digest('hex') };
  const deno = { serve: (callback: typeof handler) => { handler = callback; }, env: { get: (name: string) => values[name] } };
  new Function('Deno', 'fetch', 'RequestGate', 'readBoundedJson', 'isApprovedGatewayKey', javascript)(deno, fetcher, RequestGate, readBoundedJson, isApprovedGatewayKey);
  const send = (action: string) => handler(new Request('https://edge.example.test', { method: 'POST', headers: { 'content-type': 'application/json', 'x-order-gateway-key': key }, body: JSON.stringify({ actorEmail: 'sales@example.test', action, payload: { idempotencyKey: 'routing-command-key-001' } }) }));
  return { send, fetcher };
}

describe('purchase order Edge routing', () => {
  it.each(['request_po_quantity_correction', 'decide_po_quantity_correction', 'confirm_purchase_order_supplier', 'list_po_corrections'])('routes %s through the PO revision gateway', async action => {
    const { send, fetcher } = fixture();
    expect((await send(action)).status).toBe(200);
    expect(fetcher.mock.calls[0][0]).toBe('https://database.example.test/rest/v1/rpc/stockflow_po_revision_gateway');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ p_action: action, p_actor_email: 'sales@example.test' });
  });
  it.each(['get_letterhead_extras', 'set_letterhead_extras'])('routes %s through the extras gateway with the correct admission', async action => {
    const begin = vi.spyOn(RequestGate.prototype, 'begin');
    const finish = vi.spyOn(RequestGate.prototype, 'finish');
    try {
      const { send, fetcher } = fixture();
      expect((await send(action)).status).toBe(200);
      expect(fetcher.mock.calls[0][0]).toBe('https://database.example.test/rest/v1/rpc/stockflow_letterhead_extras_gateway');
      expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ p_action: action, p_actor_email: 'sales@example.test' });
      if (action === 'get_letterhead_extras') {
        expect((await send(action)).status).toBe(200);
        expect(begin).not.toHaveBeenCalled();
        expect(finish).not.toHaveBeenCalled();
      } else {
        expect(begin).toHaveBeenCalledOnce();
        expect(finish).toHaveBeenCalledOnce();
      }
    } finally { begin.mockRestore(); finish.mockRestore(); }
  });
  it('routes get_growth_stopped_items through its gateway as a read', async () => {
    const begin = vi.spyOn(RequestGate.prototype, 'begin');
    const finish = vi.spyOn(RequestGate.prototype, 'finish');
    try {
      const { send, fetcher } = fixture();
      expect((await send('get_growth_stopped_items')).status).toBe(200);
      expect((await send('get_growth_stopped_items')).status).toBe(200);
      expect(fetcher.mock.calls[0][0]).toBe('https://database.example.test/rest/v1/rpc/stockflow_growth_stopped_items_gateway');
      expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ p_action: 'get_growth_stopped_items', p_actor_email: 'sales@example.test' });
      expect(begin).not.toHaveBeenCalled();
      expect(finish).not.toHaveBeenCalled();
    } finally { begin.mockRestore(); finish.mockRestore(); }
  });
  it.each(['get_letterhead', 'set_letterhead'])('routes %s through the letterhead gateway', async action => {
    const { send, fetcher } = fixture();
    expect((await send(action)).status).toBe(200);
    expect(fetcher.mock.calls[0][0]).toBe('https://database.example.test/rest/v1/rpc/stockflow_letterhead_gateway');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ p_action: action, p_actor_email: 'sales@example.test' });
  });
  it('admits letterhead writes as commands', async () => {
    const begin = vi.spyOn(RequestGate.prototype, 'begin');
    const finish = vi.spyOn(RequestGate.prototype, 'finish');
    try {
      const { send } = fixture();
      expect((await send('set_letterhead')).status).toBe(200);
      expect(begin).toHaveBeenCalledOnce();
      expect(finish).toHaveBeenCalledOnce();
    } finally { begin.mockRestore(); finish.mockRestore(); }
  });
  it.each(['supplier_options', 'create_purchase_orders', 'list_purchase_orders', 'mark_purchase_order_shared', 'receive_purchase_order', 'cancel_purchase_order'])('routes %s through the purchase gateway', async action => {
    const { send, fetcher } = fixture();
    expect((await send(action)).status).toBe(200);
    expect(fetcher.mock.calls[0][0]).toBe('https://database.example.test/rest/v1/rpc/stockflow_purchase_gateway');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ p_action: action, p_actor_email: 'sales@example.test' });
  });
  it.each(['get_tally_receipts', 'get_tally_receipt_counts', 'receive_from_tally'])('routes %s through the PO receipt gateway', async action => {
    const { send, fetcher } = fixture();
    expect((await send(action)).status).toBe(200);
    expect(fetcher.mock.calls[0][0]).toBe('https://database.example.test/rest/v1/rpc/stockflow_po_receipt_gateway');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ p_action: action, p_actor_email: 'sales@example.test' });
  });
  it('routes get_unlinked_receipts through the unlinked PO gateway', async () => {
    const { send, fetcher } = fixture();
    expect((await send('get_unlinked_receipts')).status).toBe(200);
    expect(fetcher.mock.calls[0][0]).toBe('https://database.example.test/rest/v1/rpc/stockflow_po_unlinked_gateway');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ p_action: 'get_unlinked_receipts', p_actor_email: 'sales@example.test' });
  });
  it.each(['send_on_challan', 'bill_challan'])('routes %s through the default order gateway', async action => {
    const { send, fetcher } = fixture();
    expect((await send(action)).status).toBe(200);
    expect(fetcher.mock.calls[0][0]).toBe('https://database.example.test/rest/v1/rpc/stockflow_order_gateway');
  });
  it('lets repeated purchase reads bypass command admission throttling', async () => {
    const begin = vi.spyOn(RequestGate.prototype, 'begin');
    const finish = vi.spyOn(RequestGate.prototype, 'finish');
    try {
      const { send } = fixture();
      for (const action of ['supplier_options', 'list_purchase_orders', 'get_tally_receipts', 'get_tally_receipt_counts', 'get_unlinked_receipts', 'get_letterhead', 'list_po_corrections']) {
        expect((await send(action)).status).toBe(200);
        expect((await send(action)).status).toBe(200);
      }
      expect(begin).not.toHaveBeenCalled();
      expect(finish).not.toHaveBeenCalled();
    } finally { begin.mockRestore(); finish.mockRestore(); }
  });
});
