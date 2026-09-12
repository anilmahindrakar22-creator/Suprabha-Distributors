import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(new URL('../../supabase/migrations/20260912120000_return_created_order_state.sql', import.meta.url)),
  'utf8',
);

describe('created order response contract', () => {
  it('returns the status and version written by the database', () => {
    expect(migration).toContain(
      'returning id, order_seq, status, version into v_order_id, v_order_seq, v_to_status, v_expected_version',
    );
    expect(migration).toContain("'status', v_to_status, 'version', v_expected_version");
  });

  it('fails closed if the existing gateway no longer has the expected shape', () => {
    expect(migration).toContain("raise exception 'Expected create-order insert return values were not found'");
    expect(migration).toContain("raise exception 'Expected hard-coded create-order response was not found'");
  });
});
