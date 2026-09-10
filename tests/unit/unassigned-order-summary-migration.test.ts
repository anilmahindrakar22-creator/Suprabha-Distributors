import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260910120855_unassigned_order_summary.sql', import.meta.url)), 'utf8').toLowerCase();

describe('unassigned order summary', () => {
  it('counts only authorised, active and unassigned orders', () => {
    expect(migration).toContain("'unassignedopen'");
    expect(migration).toContain('stockflow_can_access_order');
    expect(migration).toContain('assigned_to_email is null');
    expect(migration).toContain('archived_at is null');
    expect(migration).toContain("status not in ('delivered','cancelled')");
    expect(migration).not.toMatch(/delete\s+from/);
  });
});
