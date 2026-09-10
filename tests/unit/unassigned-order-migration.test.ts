import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260910054318_unassigned_order_queue.sql', import.meta.url)), 'utf8').toLowerCase();

describe('unassigned order queue', () => {
  it('uses the central database filter and null ownership without broad reads', () => {
    expect(migration).toContain("assignee='unassigned'");
    expect(migration).toContain('assigned_to_email is null');
    expect(migration).toContain('stockflow_order_matches_filter');
    expect(migration).not.toMatch(/delete\s+from/);
  });
});
