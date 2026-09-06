import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260906161000_lazy_order_activity.sql', import.meta.url)), 'utf8');
const edge = readFileSync(fileURLToPath(new URL('../../supabase/functions/stockflow-orders/index.ts', import.meta.url)), 'utf8');
const api = readFileSync(fileURLToPath(new URL('../../app/api/orders/route.ts', import.meta.url)), 'utf8');

describe('lazy order activity contract', () => {
  it('keeps the audit read behind gateway authentication, membership, and order scope', () => {
    expect(migration).toContain("digest(coalesce(p_gateway_key, ''), 'sha256')");
    expect(migration).toContain("status = 'active'");
    expect(migration).toContain('assert_stockflow_order_access(v_email, v_role, v_order_id)');
    expect(migration).toContain('archived_at is null');
    expect(migration).toContain('revoke all on function public.stockflow_order_activity_gateway');
    expect(migration).toContain('to service_role');
  });

  it('removes eager events from bootstrap and exposes only the read action', () => {
    expect(migration).toContain("'[]'::jsonb as events");
    expect(migration).toContain("p_action <> 'get_order_events'");
    expect(edge).toContain('"get_order_events"');
    expect(edge).toContain('"stockflow_order_activity_gateway"');
    expect(api).toContain("parameters.get('eventsFor')");
    expect(api).toContain("'get_order_events'");
  });
});
