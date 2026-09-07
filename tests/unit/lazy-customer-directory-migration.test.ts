import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260907133000_lazy_customer_directory.sql', import.meta.url)), 'utf8');
const edge = readFileSync(fileURLToPath(new URL('../../supabase/functions/stockflow-orders/index.ts', import.meta.url)), 'utf8');
const api = readFileSync(fileURLToPath(new URL('../../app/api/orders/route.ts', import.meta.url)), 'utf8');

describe('lazy customer directory contract', () => {
  it('protects the full active directory behind the authenticated gateway', () => {
    expect(migration).toContain("p_action <> 'get_customers'");
    expect(migration).toContain("status = 'active'");
    expect(migration).toContain('from private.stockflow_customers where active order by name');
    expect(migration).not.toMatch(/where active order by name limit/i);
    expect(migration).toContain('revoke all on function public.stockflow_customer_gateway');
  });

  it('removes customers from bootstrap and exposes a versioned lazy read', () => {
    expect(migration).toContain("E'      \\'customers\\', \\'[]\\'::jsonb");
    expect(edge).toContain('"get_customers"');
    expect(edge).toContain('"stockflow_customer_gateway"');
    expect(api).toContain("parameters.get('customers') === '1'");
  });
});
