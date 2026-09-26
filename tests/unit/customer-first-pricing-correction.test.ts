import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260921160000_customer_first_pricing_correction.sql', 'utf8');
const priceBook = readFileSync('components/customer-price-book.tsx', 'utf8');
const orders = readFileSync('components/order-workspace.tsx', 'utf8');
const pricingWorkspace = readFileSync('components/pricing-workspace.tsx', 'utf8');

describe('customer-first pricing correction', () => {
  it('surfaces the current evidence-bound price-book decision and a simple risk status', () => {
    expect(migration).toContain("'currentPrice',current_price");
    expect(migration).toContain("'currentPriceSource',current_source");
    expect(migration).toContain("'riskStatus',risk_status");
    expect(migration).toContain("d.evidence_hash=base->>'evidenceHash'");
    expect(priceBook).toContain('row.currentPrice');
    expect(priceBook).toContain('row.riskStatus');
  });

  it('atomically applies only fully governed pricing when an order is confirmed', () => {
    expect(migration).toContain('stockflow_auto_price_confirmed_order');
    expect(migration).toContain('lock table private.stockflow_tally_sales_prices');
    expect(migration).toContain('private.stockflow_is_governed_order_price');
    expect(migration).toContain("resolved->>'guardrail'='PRICE_REVIEW_REQUIRED'");
    expect(migration).toContain("new.pricing_state:='approved'");
    expect(migration).toContain('stockflow_billing_snapshots');
    expect(migration).toContain('stockflow_order_pricing_decisions');
    expect(migration).toContain('stockflow_pricing_events');
    expect(migration).toContain('stockflow_outbox');
  });

  it('keeps routine approval one click and reserves notes for exceptions', () => {
    expect(priceBook).toContain("'Approved safe bulk recommended prices'");
    expect(priceBook).not.toContain('Management reason<input');
    expect(pricingWorkspace).toContain("const decisionReason = action === 'approve_price_contract'");
    expect(pricingWorkspace).toContain('Optional approval note · required to reject');
  });

  it('shows governed prices during order entry only to commercial roles', () => {
    expect(orders).toContain("const canViewPrices = ['administrator', 'accounts', 'management'].includes(data.actor.role)");
    expect(orders).toContain('Governed price');
    expect(orders).toContain('Pricing is checked at confirmation');
    expect(orders).not.toContain('Use governed prices');
  });
});
