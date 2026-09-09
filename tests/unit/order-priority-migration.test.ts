import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260909174500_order_priority.sql', import.meta.url)), 'utf8').toLowerCase();
const edge = readFileSync(fileURLToPath(new URL('../../supabase/functions/stockflow-orders/index.ts', import.meta.url)), 'utf8');

describe('order priority gateway', () => {
  it('constrains priority and protects updates with roles, row scope, locks and idempotency', () => {
    expect(migration).toContain("check (priority in ('normal','high','urgent'))");
    expect(migration).toContain("v_role not in ('administrator','sales','operations','management')");
    expect(migration).toContain('private.assert_stockflow_order_access');
    expect(migration).toContain('for update');
    expect(migration).toContain('private.begin_stockflow_command');
    expect(migration).toContain('private.finish_stockflow_command');
    expect(migration).toContain("'order_priority_changed'");
    expect(migration).not.toMatch(/delete\s+from/);
  });

  it('routes priority changes only through the server gateway', () => {
    expect(edge).toContain('"set_order_priority"');
    expect(edge).toContain('"stockflow_priority_gateway"');
    expect(migration).toContain('revoke all on function public.stockflow_priority_gateway');
    expect(migration).toContain('to service_role');
  });
});
