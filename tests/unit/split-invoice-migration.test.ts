import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260908190000_split_invoice_references.sql', import.meta.url)), 'utf8').toLowerCase();

describe('split invoice reference constraint', () => {
  it('bounds stored invoice references and their count', () => {
    expect(migration).toContain('stockflow_orders_tally_invoice_references_bounded');
    expect(migration).toContain('char_length(tally_invoice_number) between 1 and 160');
    expect(migration).toContain("replace(tally_invoice_number, ',', '')");
    expect(migration).toContain('create table private.stockflow_order_tally_invoices');
    expect(migration).toContain('voucher_reference text primary key');
    expect(migration).toContain('on delete restrict');
    expect(migration).toContain('prevent_business_delete');
    expect(migration).toContain("raise exception 'tally invoice is already linked to another order'");
    expect(migration).not.toMatch(/delete\s+from/);
  });
});
