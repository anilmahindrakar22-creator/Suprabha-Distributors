import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260908190000_split_invoice_references.sql', import.meta.url)), 'utf8').toLowerCase();

describe('split invoice reference constraint', () => {
  it('bounds stored invoice references and their count', () => {
    expect(migration).toContain('stockflow_orders_tally_invoice_references_bounded');
    expect(migration).toContain('char_length(tally_invoice_number) between 1 and 160');
    expect(migration).toContain("replace(tally_invoice_number, ',', '')");
    expect(migration).not.toMatch(/delete\s+from/);
  });
});
