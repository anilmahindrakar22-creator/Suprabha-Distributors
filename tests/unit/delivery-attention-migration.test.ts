import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260910124441_delivery_attention_queue.sql', import.meta.url)), 'utf8').toLowerCase();

describe('delivery attention database queue', () => {
  it('filters and counts only authorised active orders needing delivery attention', () => {
    expect(migration).toContain("when 'delivery_attention'");
    expect(migration).toContain("'deliveryattention'");
    expect(migration).toContain('stockflow_can_access_order');
    expect(migration).toContain('expected_delivery_date <= current_date');
    expect(migration).toContain("issue.category in ('delayed','failed_delivery')");
    expect(migration).toContain('archived_at is null');
    expect(migration).not.toMatch(/delete\s+from/);
  });
});
