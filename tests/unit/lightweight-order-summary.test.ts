import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260911141000_lightweight_order_summary.sql', 'utf8');
const edge = readFileSync('supabase/functions/stockflow-orders/index.ts', 'utf8');
const route = readFileSync('app/api/orders/route.ts', 'utf8');
const dashboard = readFileSync('public/stockflow.html', 'utf8');

describe('lightweight order operations summary', () => {
  it('enforces the gateway secret, active membership and role-scoped order access', () => {
    expect(migration).toContain("where name='orders'");
    expect(migration).toContain("status='active'");
    expect(migration).toContain('private.stockflow_can_access_order(v_email,v_role,o.id)');
    expect(migration).toContain("now() at time zone 'Asia/Kolkata'");
    expect(migration).toContain("security definer\nset search_path = ''");
    expect(migration).toContain('revoke all on function public.stockflow_order_summary_gateway');
  });

  it('routes the summary through its narrow database and application boundary', () => {
    expect(edge).toContain('"get_order_summary"');
    expect(edge).toContain('"stockflow_order_summary_gateway"');
    expect(route).toContain("parameters.get('summary') === '1'");
    expect(route).toContain("'get_order_summary'");
  });

  it('avoids the full order bootstrap and suppresses focus refresh bursts', () => {
    expect(dashboard).toContain("fetch('/api/orders?summary=1'");
    expect(dashboard).not.toContain("fetch('/api/orders',{cache:'no-store'})");
    expect(dashboard).toContain('const BACKGROUND_REFRESH_FLOOR_MS=15*1000');
    expect(dashboard).toContain('Date.now()-lastRefreshStarted<BACKGROUND_REFRESH_FLOOR_MS');
    expect(dashboard).toContain("window.addEventListener('online',()=>void refreshData(true))");
  });

  it('renders current stock before waiting for operational counters', () => {
    const load = dashboard.slice(dashboard.indexOf('async function load()'), dashboard.indexOf('const focusCopy='));
    expect(load.indexOf("applyData(body,'Cloud snapshot current')")).toBeLessThan(load.indexOf('const orders=await orderRequest'));
    expect(load).toContain('data=body;renderOperations()');
  });
});
