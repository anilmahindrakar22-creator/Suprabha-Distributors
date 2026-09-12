import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260912193000_customer_pricing_engine.sql', import.meta.url)), 'utf8');

describe('customer pricing engine migration', () => {
  it('stores effective-dated contract history and prevents approved overlaps', () => {
    expect(migration).toContain('stockflow_customer_product_prices');
    expect(migration).toContain('stockflow_customer_price_no_approved_overlap');
    expect(migration).toContain("where (status = 'approved')");
    expect(migration).toContain('supersedes_price_id');
    expect(migration).toContain("status in ('approved','superseded')");
    expect(migration).toContain('valid_to=contract.valid_from-1');
  });

  it('fails closed until management configures commercial policy', () => {
    expect(migration).toContain("'bootstrap-review-only-v1',99.99,null,0");
    expect(migration).toContain("'no-suggestion-v1'");
  });

  it('keeps Tally evidence and commercial decisions append-only', () => {
    expect(migration).toContain('stockflow_tally_sales_prices');
    expect(migration).toContain('stockflow_tally_purchase_costs');
    expect(migration).toContain('stockflow_tally_sales_price_immutable');
    expect(migration).toContain('stockflow_tally_purchase_cost_immutable');
    expect(migration.match(/prevent_business_delete/g)?.length).toBeGreaterThanOrEqual(7);
  });

  it('imports only bounded, exact, versioned read-only Tally pricing evidence', () => {
    expect(migration).toContain('stockflow_import_tally_pricing_evidence');
    expect(migration).toContain("jsonb_array_length(new.payload->'pricingHistory'->'sales')>5000");
    expect(migration).toContain('where active and tally_key=nullif');
    expect(migration).toContain('on conflict(source_id,source_version) do nothing');
    expect(migration).toContain("new.payload:=new.payload-'pricingHistory'");
    expect(migration).toContain('before insert or update of payload on public.stockflow_snapshots');
  });

  it('enforces pricing authorization in the database gateway', () => {
    expect(migration).toContain("p_role not in ('administrator','management','accounts')");
    expect(migration).toContain("raise exception 'Pricing access is restricted' using errcode='42501'");
    expect(migration).toContain('grant execute on function public.stockflow_pricing_gateway(text,text,text,jsonb) to service_role');
    expect(migration).toContain('revoke all on function public.stockflow_pricing_gateway(text,text,text,jsonb) from public,anon,authenticated');
  });

  it('atomically couples approval, snapshot, audit, outbox, and idempotency', () => {
    expect(migration).toContain('private.begin_stockflow_command');
    expect(migration).toContain('private.finish_stockflow_command');
    expect(migration).toContain('stockflow_billing_snapshots');
    expect(migration).toContain("'order_pricing_approved'");
    expect(migration).toContain("'order.pricing_approved'");
    expect(migration).toContain('for update');
  });

  it('blocks billing without a current immutable price and rechecks changed cost', () => {
    expect(migration).toContain('stockflow_require_current_pricing_before_billing');
    expect(migration).toContain("Pricing approval is required before billing");
    expect(migration).toContain("Authoritative purchase cost changed; pricing reapproval is required");
  });

  it('invalidates old approval after an order-line change', () => {
    expect(migration).toContain('stockflow_invalidate_pricing_after_line_change');
    expect(migration).toContain("invalidation_reason='Order line changed after pricing'");
    expect(migration).toContain("pricing_state='invalidated'");
  });

  it('exposes only the safe pricing workflow state through ordinary order payloads', () => {
    expect(migration).toContain("'pricingState', o.pricing_state");
    expect(migration).toContain('x.pricing_state as "pricingState"');
    expect(migration).not.toContain("'approvedRate', o.");
  });
});
