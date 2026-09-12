import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260831130500_start_orders_at_confirmation.sql', import.meta.url)), 'utf8');

describe('direct office confirmation handoff', () => {
  it('places new orders into confirmation without removing legacy workflow compatibility', () => {
    expect(migration).toContain("alter column status set default 'awaiting_confirmation'");
    expect(migration).not.toContain('drop');
    expect(migration).not.toContain('delete');
  });
});
