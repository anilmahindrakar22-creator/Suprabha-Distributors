import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260911183000_consolidate_billing_candidates.sql', 'utf8');
const route = readFileSync('app/api/orders/route.ts', 'utf8');
const optimizedFilter = readFileSync('supabase/migrations/20260911132000_paginate_exact_customer_orders.sql', 'utf8');
const searchableFilter = readFileSync('supabase/migrations/20260911121500_search_operational_order_details.sql', 'utf8');

describe('consolidated billing-attention candidates', () => {
  it('defines one internal candidate queue across every invoiced order stage', () => {
    expect(migration).toContain("when 'billing_candidates'");
    for (const status of ['billed_in_tally', 'ready_for_dispatch', 'dispatched', 'delivered', 'cancelled']) {
      expect(migration).toContain(`'${status}'`);
    }
    expect(migration).toContain("'billing_candidates','delivery_attention'");
  });

  it('patches the authoritative status filter used by both optimized wrapper paths', () => {
    expect(migration).toContain(
      "'private.stockflow_order_matches_filter(private.stockflow_orders,text,text,date)'::regprocedure",
    );
    expect(optimizedFilter).toContain(
      "private.stockflow_order_matches_filter(p_order,p_status,'',p_capture_date)",
    );
    expect(optimizedFilter).toContain(
      'private.stockflow_order_matches_filter_with_notes(p_order,p_status,p_query,p_capture_date)',
    );
    expect(searchableFilter).toContain(
      'private.stockflow_order_matches_filter(p_order,p_status,p_query,p_capture_date)',
    );
  });

  it('uses one paginated stream without the broad bootstrap request', () => {
    const helper = route.slice(route.indexOf('async function billingAttentionOrders'), route.indexOf('export async function GET'));
    expect(helper).toContain("status: 'billing_candidates'");
    expect(helper).toContain("pages.push(await callOrderGateway<OrderBootstrap>");
    expect(helper).not.toContain("action: 'bootstrap'");
    expect(helper).not.toContain('Promise.all(invoicedStatuses.map');
  });

  it('deduplicates the page-scoped invoice records before reconciliation', () => {
    expect(route).toContain('new Map(pages.flatMap');
    expect(route).toContain("invoice.masterId || ''");
  });
});
