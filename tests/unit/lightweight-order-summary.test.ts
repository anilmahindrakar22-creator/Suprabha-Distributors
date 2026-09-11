import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260911141000_lightweight_order_summary.sql', 'utf8');
const consolidated = readFileSync('supabase/migrations/20260911150000_consolidate_operations_summary.sql', 'utf8');
const edge = readFileSync('supabase/functions/stockflow-orders/index.ts', 'utf8');
const route = readFileSync('app/api/orders/route.ts', 'utf8');
const dashboard = readFileSync('public/stockflow.html', 'utf8');

describe('lightweight order operations summary', () => {
  it('enforces the gateway secret, active membership and role-scoped order access', () => {
    expect(migration).toContain("where name='orders'");
    expect(migration).toContain("status='active'");
    expect(consolidated).toContain('from private.stockflow_role_order_scopes');
    expect(consolidated).toContain("scope.can_read_created and o.created_by_email=lower(btrim(p_actor_email))");
    expect(migration).toContain("now() at time zone 'Asia/Kolkata'");
    expect(migration).toContain("security definer\nset search_path = ''");
    expect(migration).toContain('revoke all on function public.stockflow_order_summary_gateway');
  });

  it('computes daily counters from one materialized accessible-order set', () => {
    expect(consolidated).toContain('accessible as materialized');
    expect(consolidated).toContain('count(*) filter');
    [
      'phoneOrdersToday',
      'awaitingConfirmation',
      'awaitingApproval',
      'awaitingStock',
      'readyForPicking',
      'packed',
      'awaitingTallyBilling',
      'billedNotDispatched',
      'dispatchedToday',
      'urgentExceptions',
      'unassignedOpen',
      'deliveryAttention',
      'needsAttention',
      'delayedFailedDeliveries',
    ].forEach((counter) => expect(consolidated).toContain(`'${counter}'`));
    expect(migration).toContain("'operations', private.stockflow_operations_summary(v_email,v_role)");
    expect(migration).not.toContain("'operations', private.stockflow_operations_summary(v_email,v_role) ||");
  });

  it('keeps archived history outside active-work indexes', () => {
    expect(consolidated).toContain('stockflow_orders_active_status_created_idx');
    expect(consolidated).toContain('stockflow_orders_active_creator_status_created_idx');
    expect(consolidated).toContain('stockflow_orders_active_delivery_idx');
    expect(consolidated.match(/where archived_at is null/g)?.length).toBeGreaterThanOrEqual(3);
    expect(consolidated).toContain("where to_status='dispatched'");
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
