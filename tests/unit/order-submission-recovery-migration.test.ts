import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260909181500_order_submission_recovery.sql', import.meta.url)), 'utf8').toLowerCase();
const edge = readFileSync(fileURLToPath(new URL('../../supabase/functions/stockflow-orders/index.ts', import.meta.url)), 'utf8');

describe('offline submission recovery gateway', () => {
  it('looks up only the signed-in creator request and returns no business payload', () => {
    expect(migration).toContain('created_by_email=v_email and idempotency_key=v_key');
    expect(migration).toContain('private.assert_stockflow_order_access');
    expect(migration).toContain("'status','accepted'");
    expect(migration).toContain("'status','not_found'");
    expect(migration).not.toMatch(/insert\s+into|update\s+private|delete\s+from/);
  });
  it('is server-only and routed explicitly', () => {
    expect(edge).toContain('"recover_order_submission"');
    expect(edge).toContain('"stockflow_submission_recovery_gateway"');
    expect(migration).toContain('revoke all on function public.stockflow_submission_recovery_gateway');
    expect(migration).toContain('to service_role');
  });
});
