import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260910125415_operations_attention_summary.sql', import.meta.url)), 'utf8').toLowerCase();

describe('operations attention summary migration', () => {
  it('counts the governed attention filter across the authorised active dataset', () => {
    expect(migration).toContain("'needsattention'");
    expect(migration).toContain("stockflow_order_matches_filter(o,'attention','',null)");
    expect(migration).toContain('o.archived_at is null');
    expect(migration).toContain('stockflow_can_access_order(p_actor_email,p_role,o.id)');
  });

  it('keeps the private summary unavailable to browser roles', () => {
    expect(migration).toContain('revoke all on function private.stockflow_operations_summary(text,text) from public, anon, authenticated');
    expect(migration).not.toMatch(/\b(delete|truncate)\b/);
  });
});
