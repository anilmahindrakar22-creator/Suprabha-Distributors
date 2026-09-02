import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL('../../supabase/migrations/20260902091533_centralize_order_policy.sql', import.meta.url),
);
const migration = readFileSync(migrationPath, 'utf8');

describe('central order policy migration', () => {
  it('defines one constrained source for roles, states, and transitions', () => {
    expect(migration).toContain('create table private.stockflow_role_permissions');
    expect(migration).toContain('create table private.stockflow_order_states');
    expect(migration).toContain('create table private.stockflow_order_transition_rules');
    expect(migration.match(/^  \('[^']+','[^']+',array\[/gm)).toHaveLength(28);
    expect(migration).toContain("('dispatched','delivered',array['administrator','operations']");
  });

  it('keeps cancellation admin-only and enforces operational evidence', () => {
    expect(migration).toContain("('phone_order_received','cancelled',array['administrator'],true,false)");
    expect(migration).toContain("('awaiting_tally_billing','billed_in_tally',array['administrator','operations','accounts'],false,true)");
    expect(migration).toContain('Cancellation reason is required');
    expect(migration).toContain('Tally invoice number is required');
  });

  it('routes the existing gateway through the central policy functions', () => {
    expect(migration).toContain("perform private.assert_stockflow_permission(v_role, 'orders.create')");
    expect(migration).toContain('perform private.assert_stockflow_order_transition(');
    expect(migration).toContain("grant execute on function public.stockflow_order_gateway(text,text,text,jsonb) to service_role");
  });
});
