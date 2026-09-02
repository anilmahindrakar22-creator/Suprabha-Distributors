import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(new URL('../../supabase/migrations/20260902145535_enforce_order_scope_and_state_constraints.sql', import.meta.url)),
  'utf8',
);

describe('order scope and state constraints migration', () => {
  it('defines one fail-closed order access policy', () => {
    expect(migration).toContain('create table private.stockflow_role_order_scopes');
    expect(migration).toContain("scope in ('global','created_by')");
    expect(migration).toContain('else false');
    expect(migration).toContain("raise exception 'Role cannot access this order'");
  });

  it('enforces the access policy in reads, metrics, and every order mutation gateway', () => {
    expect(migration).toContain('private.stockflow_operations_summary(v_actor_email,v_role)');
    expect(migration).toContain('where private.stockflow_can_access_order(v_actor_email,v_role,x.id)');
    expect(migration).toContain("'public.stockflow_fulfilment_gateway(text,text,text,jsonb)'::regprocedure");
    expect(migration).toContain("'public.stockflow_installation_gateway(text,text,text,jsonb)'::regprocedure");
    expect(migration).toContain('v_actor_email,v_role');
    expect(migration).toContain('v_email,v_role');
  });

  it('adds validated state foreign keys and a transition guard trigger', () => {
    expect(migration).toContain('stockflow_orders_status_fk');
    expect(migration).toContain('stockflow_order_events_from_status_fk');
    expect(migration).toContain('stockflow_order_events_to_status_fk');
    expect(migration).toContain('create trigger stockflow_orders_valid_transition');
  });
});
