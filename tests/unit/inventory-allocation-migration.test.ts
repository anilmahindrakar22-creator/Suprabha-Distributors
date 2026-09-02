import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260902214500_fefo_order_allocation.sql', import.meta.url)), 'utf8');

describe('FEFO order allocation migration', () => {
  it('allocates eligible batches in FEFO order under deterministic locks', () => {
    expect(migration).toContain('order by ib.expiry_date asc nulls last, ib.lot_number, ib.location_id');
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain("'reservation',v_allocate");
  });

  it('moves the order and ledger atomically and records attributable evidence', () => {
    expect(migration).toContain("v_target_status:=case when v_full_lines=v_total_lines then 'fully_reserved' else 'partially_reserved' end");
    expect(migration).toContain("'inventory_allocated'");
    expect(migration).toContain("'before',v_before,'after',v_after,'requestId',v_request_id");
  });

  it('releases active allocations automatically when an order is cancelled', () => {
    expect(migration).toContain('create trigger stockflow_release_inventory_on_cancel');
    expect(migration).toContain("new.status='cancelled'");
    expect(migration).toContain("'reservation_release'");
  });

  it('exposes allocation commands only through the service role', () => {
    expect(migration).toContain('revoke all on function public.stockflow_allocation_gateway');
    expect(migration).toContain('grant execute on function public.stockflow_allocation_gateway(text,text,text,jsonb) to service_role');
  });
});
