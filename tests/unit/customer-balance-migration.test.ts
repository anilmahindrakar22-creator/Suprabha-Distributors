import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260908193000_customer_tally_balance.sql', import.meta.url)), 'utf8').toLowerCase();

describe('read-only Tally customer balance projection', () => {
  it('stores a timestamped balance from the existing trusted snapshot', () => {
    expect(migration).toContain('add column tally_balance');
    expect(migration).toContain('add column balance_as_of');
    expect(migration).toContain("v_customer->>'tallybalance'");
  });
  it('reveals financial balances only to finance-capable roles', () => {
    expect(migration).toContain("v_role in ('administrator','accounts','management')");
    expect(migration).toContain('case when v_role');
    expect(migration).toContain('revoke all on function public.stockflow_customer_gateway');
  });
  it('does not introduce any Tally or business-record write path', () => {
    expect(migration).not.toMatch(/delete\s+from/);
    expect(migration).not.toContain('stockflow_inventory');
  });
});
