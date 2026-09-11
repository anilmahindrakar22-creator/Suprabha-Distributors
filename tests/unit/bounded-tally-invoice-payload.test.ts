import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260911200000_bound_tally_invoice_payload.sql', 'utf8');

describe('bounded Tally invoice payload migration', () => {
  it('supports exact vouchers and numeric references only in the current financial year', () => {
    expect(migration).toContain("lower(voucher) = lower(reference)");
    expect(migration).toContain("reference !~ '^[0-9]+$'");
    expect(migration).toContain("'^SD/([0-9]{2}-[0-9]{2})/0*([0-9]+)$'");
    expect(migration).toContain('voucher_parts[1] = financial_year');
  });

  it('requires both the customer ledger and referenced invoice to match', () => {
    expect(migration).toContain("invoice->>'party'");
    expect(migration).toContain("listed->>'customerName'");
    expect(migration).toContain('private.stockflow_invoice_matches_order_reference(invoice,listed)');
  });

  it('keeps the matcher private and the gateway service-only', () => {
    expect(migration).toContain(
      'revoke all on function private.stockflow_invoice_matches_order_reference(jsonb,jsonb) from public, anon, authenticated',
    );
    expect(migration).toContain(
      'grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb) to service_role',
    );
  });
});
