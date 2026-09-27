import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260921143000_apply_governed_order_prices.sql', 'utf8');
const orders = readFileSync('components/order-workspace.tsx', 'utf8');
const edge = readFileSync('supabase/functions/stockflow-orders/index.ts', 'utf8');

describe('governed order pricing', () => {
  it('accepts only approved contracts, base prices or evidence-bound price-book decisions', () => {
    expect(migration).toContain("p_resolution->'source'->>'type'='APPROVED_CONTRACT'");
    expect(migration).toContain("p_resolution->'source'->>'type'='STANDARD_ITEM_PRICE'");
    expect(migration.match(/p\.price_amount=\(p_resolution->>'proposedRate'\)::numeric/g)?.length).toBe(2);
    expect(migration).toContain('d.evidence_hash=base_resolution->>\'evidenceHash\'');
    expect(migration).toContain("x->>'guardrail'='PRICE_REVIEW_REQUIRED'");
    expect(migration).toContain('Every order line requires a current governed price');
  });

  it('delegates atomically to the existing idempotent snapshot workflow', () => {
    expect(migration).toContain("p_gateway_key,p_actor_email,'submit_order_pricing'");
    expect(migration).toContain("'idempotencyKey',p_payload->>'idempotencyKey'");
    expect(migration).toContain('for update');
    expect(migration).toContain('revoke all on function public.stockflow_pricing_gateway_v3');
  });

  it('automates routine pricing while retaining an explicit exception path', () => {
    expect(orders).toContain("action: 'apply_governed_order_pricing'");
    expect(orders).not.toContain('Use governed prices');
    expect(orders).toContain('Review price exception');
    expect(orders).toContain('Governed price:');
    expect(orders).toContain('governedRequest.current = request');
    expect(edge.match(/apply_governed_order_pricing/g)?.length).toBe(2);
  });
});
