import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260910120451_legacy_partial_order_transition.sql', import.meta.url)), 'utf8').toLowerCase();

describe('legacy partial order compatibility', () => {
  it('allows the combined pick-and-pack action without restoring reservation', () => {
    expect(migration).toContain("'partially_reserved', 'packed'");
    expect(migration).toContain("array['administrator','operations','warehouse']");
    expect(migration).not.toContain('stock_reserved');
    expect(migration).not.toMatch(/delete\s+from/);
  });
});
