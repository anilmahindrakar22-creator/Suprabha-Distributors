import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(new URL('../../supabase/migrations/20260903103000_dispatch_delivery_confirmation.sql', import.meta.url)),
  'utf8',
).toLowerCase();

describe('dispatch and delivery confirmation migration', () => {
  it('records dispatch and proof-of-delivery evidence with database constraints', () => {
    for (const field of ['dispatch_date', 'vehicle_number', 'delivered_at', 'received_by', 'pod_reference']) {
      expect(migration).toContain(`add column ${field}`);
    }
    expect(migration).toContain('stockflow_delivery_after_dispatch');
    expect(migration).toContain('stockflow_orders_delivery_evidence');
  });

  it('enforces role, state, optimistic locking, and idempotency on the server', () => {
    expect(migration).toContain("v_role not in ('administrator','operations')");
    expect(migration).toContain("v_order.status <> 'ready_for_dispatch'");
    expect(migration).toContain("v_order.status <> 'dispatched'");
    expect(migration).toContain('for update');
    expect(migration).toContain('private.begin_stockflow_command');
    expect(migration).toContain('private.finish_stockflow_command');
  });

  it('keeps a complete audit trail and the gateway server-only', () => {
    expect(migration).toContain("'order_dispatched'");
    expect(migration).toContain("'delivery_confirmed'");
    expect(migration).toContain("'order.dispatched'");
    expect(migration).toContain("'order.delivered'");
    expect(migration).toContain('revoke all on function public.stockflow_delivery_gateway');
    expect(migration).toContain('grant execute on function public.stockflow_delivery_gateway(text,text,text,jsonb) to service_role');
    expect(migration).not.toMatch(/delete\s+from\s+private\.stockflow_orders/);
  });
});
