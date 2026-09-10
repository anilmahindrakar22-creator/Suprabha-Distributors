import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260910052036_order_assignment.sql', import.meta.url)), 'utf8').toLowerCase();
const edge = readFileSync(fileURLToPath(new URL('../../supabase/functions/stockflow-orders/index.ts', import.meta.url)), 'utf8');

describe('order assignment gateway', () => {
  it('protects assignment changes with active membership, row scope, locking and idempotency', () => {
    expect(migration).toContain("v_role not in ('administrator','operations','management')");
    expect(migration).toContain("status='active'");
    expect(migration).toContain('private.assert_stockflow_order_access');
    expect(migration).toContain('for update');
    expect(migration).toContain('private.begin_stockflow_command');
    expect(migration).toContain('private.finish_stockflow_command');
    expect(migration).toContain("'order_assignment_changed'");
    expect(migration).not.toMatch(/delete\s+from/);
  });

  it('routes assignment through the server-only gateway and projects it in order reads', () => {
    expect(edge).toContain('"set_order_assignee"');
    expect(edge).toContain('"stockflow_assignment_gateway"');
    expect(migration).toContain('revoke all on function public.stockflow_assignment_gateway');
    expect(migration).toContain('assignedtoemail');
    expect(migration).toContain("q like 'assignee:%'");
  });
});
