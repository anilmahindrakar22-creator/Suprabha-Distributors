import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(new URL('../../supabase/migrations/20260902211000_inventory_ledger_foundation.sql', import.meta.url)),
  'utf8',
);

describe('inventory ledger foundation migration', () => {
  it('creates canonical products, locations, batches, and an append-only movement ledger', () => {
    for (const table of ['stockflow_products', 'stockflow_warehouses', 'stockflow_locations', 'stockflow_batches', 'stockflow_inventory_movements']) {
      expect(migration).toContain(`create table private.${table}`);
    }
    expect(migration).toContain('stockflow_inventory_movements_immutable');
    expect(migration).toContain('before update or delete');
  });

  it('derives balances and excludes expired batches from availability', () => {
    expect(migration).toContain('create view private.stockflow_inventory_balances');
    expect(migration).toContain('when expiry_date is not null and expiry_date < current_date then 0');
    expect(migration).toContain('on_hand - reserved - quarantined - damaged');
  });

  it('provides idempotent receipt and adjustment commands with negative-stock protection', () => {
    expect(migration).toContain("p_action not in ('bootstrap_inventory','receive_stock','adjust_stock')");
    expect(migration).toContain('private.begin_stockflow_command');
    expect(migration).toContain('private.finish_stockflow_command');
    expect(migration).toContain("raise exception 'Inventory adjustment would make physical stock negative'");
    expect(migration).toContain('pg_advisory_xact_lock');
  });

  it('keeps the inventory gateway server-only', () => {
    expect(migration).toContain('revoke all on function public.stockflow_inventory_gateway');
    expect(migration).toContain('grant execute on function public.stockflow_inventory_gateway(text,text,text,jsonb) to service_role');
  });
});
