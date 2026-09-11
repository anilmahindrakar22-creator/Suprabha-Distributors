import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260911162000_paginate_order_date_ranges.sql', 'utf8');
const route = readFileSync('app/api/orders/route.ts', 'utf8');

describe('database-paginated order date ranges', () => {
  it('uses inclusive India-time capture dates and validates the range', () => {
    expect(migration).toContain("p_order.created_at at time zone 'Asia/Kolkata'");
    expect(migration).toContain('>= p_from');
    expect(migration).toContain('<= p_to');
    expect(migration).toContain('v_date_to < v_date');
    expect(migration).toContain("raise exception 'Invalid order date range'");
  });

  it('applies the date range inside both database count and page queries', () => {
    expect(migration).toContain('private.stockflow_order_in_capture_range(o,v_date,v_date_to)');
    expect(migration).toContain('private.stockflow_order_matches_filter_optimized(o,v_status,v_query,null)');
  });

  it('passes dateTo through the narrow gateway instead of bulk-loading pages', () => {
    expect(route).toContain("dateTo: listQuery.captureDateTo || ''");
    expect(route).not.toContain('if (listQuery.captureDateTo)');
    expect(route).not.toContain('queryOrderList(orders, listQuery)');
  });
});
