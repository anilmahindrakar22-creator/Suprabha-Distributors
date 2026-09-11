import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260911170000_lazy_order_operational_history.sql', 'utf8');
const edge = readFileSync('supabase/functions/stockflow-orders/index.ts', 'utf8');
const route = readFileSync('app/api/orders/route.ts', 'utf8');
const workspace = readFileSync('components/order-workspace.tsx', 'utf8');

describe('lazy order operational history', () => {
  it('protects detail history with gateway authentication, active membership and order scope', () => {
    expect(migration).toContain("digest(coalesce(p_gateway_key,''),'sha256')");
    expect(migration).toContain("status='active'");
    expect(migration).toContain('private.assert_stockflow_order_access');
    expect(migration).toContain('archived_at is null');
    expect(migration).toContain('revoke all on function public.stockflow_order_detail_gateway');
  });

  it('keeps only active operational records in ordinary list payloads', () => {
    expect(migration).toContain("i.order_id=o.id and i.status='open'");
    expect(migration).toContain("i.order_id=o.id and i.status='scheduled'");
  });

  it('loads complete operational history only when order details are opened', () => {
    expect(edge).toContain('"get_order_details"');
    expect(edge).toContain('"stockflow_order_detail_gateway"');
    expect(route).toContain("parameters.get('detailsFor')");
    expect(workspace).toContain('void loadDetails()');
    expect(workspace).toContain('Loading operational history…');
  });
});
