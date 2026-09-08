import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260908173500_service_ticket_foundation.sql', import.meta.url)), 'utf8').toLowerCase();

describe('service ticket foundation migration', () => {
  it('constrains durable tickets and their activity history', () => {
    expect(migration).toContain('create table private.stockflow_service_tickets');
    expect(migration).toContain('create table private.stockflow_service_ticket_events');
    expect(migration).toContain('on delete restrict');
    expect(migration).toContain('stockflow_service_ticket_resolution');
    expect(migration).toContain('prevent_business_delete');
    expect(migration).not.toMatch(/delete\s+from\s+private\.stockflow_service/);
  });
  it('enforces server-side roles, locking, and retry safety', () => {
    expect(migration).toContain("v_role not in ('administrator','operations','sales','management')");
    expect(migration).toContain("v_role not in ('administrator','operations','management')");
    expect(migration).toContain('for update');
    expect(migration).toContain('private.begin_stockflow_command');
    expect(migration).toContain('private.finish_stockflow_command');
  });
  it('keeps tables private and exposes only the server gateway', () => {
    expect(migration).toContain('enable row level security');
    expect(migration).toContain('revoke all on private.stockflow_service_tickets');
    expect(migration).toContain('revoke all on function public.stockflow_service_gateway');
    expect(migration).toContain('to service_role');
  });
});
