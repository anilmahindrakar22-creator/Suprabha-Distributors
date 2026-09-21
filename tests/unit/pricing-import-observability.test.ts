import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260921110000_observable_pricing_evidence_import.sql', import.meta.url)), 'utf8');
const recovery = readFileSync(fileURLToPath(new URL('../../desktop-connector/recovery.ps1', import.meta.url)), 'utf8');

describe('observable pricing evidence import', () => {
  it('records accepted, duplicate, unmatched and rejected evidence without commercial values', () => {
    expect(migration).toContain('stockflow_pricing_import_runs');
    expect(migration).toContain('sales_unmatched_customers');
    expect(migration).toContain('purchase_duplicates');
    expect(migration).toContain('get diagnostics affected=row_count');
    expect(migration).toContain("jsonb_build_object('invalid_sales',sales_rejected,'unmatched_customer',sales_unmatched,'invalid_purchase_cost',purchase_rejected)");
    expect(migration).not.toContain("'rate',");
    expect(migration).not.toContain("'amount',");
  });

  it('does not infer tender, scheme or special pricing from unreliable Tally free text', () => {
    expect(recovery).not.toContain('function Get-PricingSalesExceptionType');
    expect(recovery).toContain("$exceptionType = if ($rate -le 0) { 'foc' } else { $null }");
    expect(recovery).toContain('Do not infer commercial intent from free text.');
    expect(recovery).toContain('exceptional = $null -ne $exceptionType');
  });
});
