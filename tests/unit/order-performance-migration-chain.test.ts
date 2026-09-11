import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const directory = 'supabase/migrations';
const performanceMigrations = [
  '20260911183000_consolidate_billing_candidates.sql',
  '20260911190000_optimize_paginated_order_scope.sql',
  '20260911193000_consolidate_order_line_projection.sql',
  '20260911200000_bound_tally_invoice_payload.sql',
];

describe('order performance migration chain', () => {
  it('keeps dependent gateway patches in strict release order', () => {
    const available = readdirSync(directory).filter((file) => file.endsWith('.sql')).sort();
    expect(available.filter((file) => performanceMigrations.includes(file))).toEqual(performanceMigrations);

    const scope = readFileSync(`${directory}/${performanceMigrations[1]}`, 'utf8');
    const lines = readFileSync(`${directory}/${performanceMigrations[2]}`, 'utf8');
    expect(scope).toContain('private.stockflow_role_can_read_order');
    expect(lines).toContain(
      'private.stockflow_role_can_read_order(v_email,v_role,candidate.created_by_email)',
    );
  });

  it.each(performanceMigrations)('%s fails closed if its expected gateway shape is absent', (file) => {
    const sql = readFileSync(`${directory}/${file}`, 'utf8');
    expect(sql).toMatch(/if updated\s*=\s*f then\s+raise exception/i);
  });

  it.each(performanceMigrations)('%s restores the server-only gateway boundary', (file) => {
    const sql = readFileSync(`${directory}/${file}`, 'utf8');
    expect(sql).toContain(
      'revoke all on function public.stockflow_order_list_gateway(text,text,text,jsonb) from public, anon, authenticated',
    );
    expect(sql).toContain(
      'grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb) to service_role',
    );
  });
});
