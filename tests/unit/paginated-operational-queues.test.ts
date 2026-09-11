import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260911154500_paginate_operational_order_queues.sql', 'utf8');
const route = readFileSync('app/api/orders/route.ts', 'utf8');

describe('database-paginated operational order queues', () => {
  it('implements operational queue semantics at the secured database boundary', () => {
    for (const status of ['delivery_due_today', 'delivery_due_soon', 'back_ordered', 'delivery_exception', 'priority_high', 'priority_urgent']) {
      expect(migration).toContain(`when '${status}'`);
    }
    expect(migration).toContain("now() at time zone 'Asia/Kolkata'");
    expect(migration).toContain('archived_at is null');
    expect(migration).toContain('private.stockflow_can_access_order');
  });

  it('does not bulk-load active orders for queues that the database can paginate', () => {
    expect(route).not.toContain("listQuery.captureDateTo || ['delivery_due_today'");
    expect(route).not.toContain("? 'open' : listQuery.status");
    expect(route).toContain("dateTo: listQuery.captureDateTo || ''");
  });

  it('removes the duplicate delayed-delivery count from every list response', () => {
    expect(migration).toContain('Expected duplicate delayed-delivery summary was not found');
    expect(migration).toContain('private.stockflow_operations_summary(v_email,v_role)');
  });
});
