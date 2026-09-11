import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260911132000_paginate_exact_customer_orders.sql', 'utf8');
const route = readFileSync('app/api/orders/route.ts', 'utf8');

describe('exact customer order pagination', () => {
  it('matches the normalized customer name at the database boundary', () => {
    expect(migration).toContain("like 'customer:%'");
    expect(migration).toContain("lower(btrim(p_order.customer_name))=lower(btrim(substr(p_query,10)))");
    expect(migration).toContain('private.stockflow_order_matches_filter_with_notes');
  });

  it('keeps the filter inside the paginated gateway instead of loading every order', () => {
    expect(route).not.toContain('const exactCustomerLookup');
    expect(route).not.toContain("exactCustomerLookup ? '' : listQuery.query");
  });
});
