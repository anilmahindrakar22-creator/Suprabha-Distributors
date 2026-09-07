import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260907170000_database_order_pagination.sql', import.meta.url)), 'utf8');
const edge = readFileSync(fileURLToPath(new URL('../../supabase/functions/stockflow-orders/index.ts', import.meta.url)), 'utf8');
const api = readFileSync(fileURLToPath(new URL('../../app/api/orders/route.ts', import.meta.url)), 'utf8');

describe('database-native order pagination contract', () => {
  it('enforces membership, row scope, archives and bounded database pages', () => {
    expect(migration).toContain("p_action <> 'list_orders'");
    expect(migration).toContain("status='active'");
    expect(migration).toContain('private.stockflow_can_access_order(v_email,v_role,o.id)');
    expect(migration).toContain('o.archived_at is null');
    expect(migration).toContain('v_page_size > 200');
    expect(migration).toContain('offset (v_page-1)*v_page_size limit v_page_size');
    expect(migration).toContain("security definer\nset search_path = ''");
    expect(migration).toContain('revoke all on function public.stockflow_order_list_gateway');
    expect(migration).toContain("set search_path = ''");
  });

  it('routes list reads through the dedicated gateway with a rollout fallback', () => {
    expect(edge).toContain('"list_orders"');
    expect(edge).toContain('"stockflow_order_list_gateway"');
    expect(api).toContain("callOrderGateway<OrderBootstrap>(user.email, 'list_orders'");
    expect(api).toContain('Compatibility path while the database migration and edge function roll out.');
  });

  it('keeps activity lazy and exports every database page in bounded batches', () => {
    expect(migration).toContain("'events','[]'::jsonb");
    expect(migration).toContain("jsonb_array_elements(v_orders) listed");
    expect(api).toContain('const pageSize = exporting ? 200 : 20');
    expect(api).toContain('for (let page = 2; page <= pageCount; page += 1)');
  });
});
