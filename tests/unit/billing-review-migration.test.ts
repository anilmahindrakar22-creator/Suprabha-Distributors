import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260908182500_billing_reconciliation_review.sql', import.meta.url)), 'utf8').toLowerCase();

describe('billing reconciliation review gateway', () => {
  it('enforces roles, billed state, optimistic locking, and retry safety', () => {
    expect(migration).toContain("v_role not in ('administrator','accounts','operations','management')");
    expect(migration).toContain("v_order.status not in ('billed_in_tally','ready_for_dispatch','dispatched','delivered')");
    expect(migration).toContain('for update');
    expect(migration).toContain('private.begin_stockflow_command');
    expect(migration).toContain('private.finish_stockflow_command');
  });
  it('records immutable activity through a server-only gateway', () => {
    expect(migration).toContain("'billing_reconciliation_reviewed'");
    expect(migration).toContain("'requestid',v_key");
    expect(migration).toContain('revoke all on function public.stockflow_billing_review_gateway');
    expect(migration).toContain('to service_role');
    expect(migration).not.toMatch(/delete\s+from/);
  });
});
