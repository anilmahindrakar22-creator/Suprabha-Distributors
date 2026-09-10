import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260910142227_order_activity_notes.sql', import.meta.url)), 'utf8').toLowerCase();
const edge = readFileSync(fileURLToPath(new URL('../../supabase/functions/stockflow-orders/index.ts', import.meta.url)), 'utf8');

describe('immutable order activity notes', () => {
  it('uses an idempotent, version-checked, row-scoped database command', () => {
    expect(migration).toContain('begin_stockflow_command');
    expect(migration).toContain('finish_stockflow_command');
    expect(migration).toContain('for update');
    expect(migration).toContain('assert_stockflow_order_access');
    expect(migration).toContain("event_type,from_status,to_status,reason");
    expect(migration).toContain("'order_note_added'");
  });

  it('keeps viewer and browser roles from writing notes', () => {
    expect(migration).not.toContain("'viewer','management'");
    expect(migration).toContain('revoke all on function public.stockflow_order_note_gateway');
    expect(migration).toContain('grant execute on function public.stockflow_order_note_gateway(text,text,text,jsonb) to service_role');
    expect(migration).not.toMatch(/\b(delete|truncate)\b/);
  });

  it('routes the bounded command through its dedicated gateway', () => {
    expect(edge).toContain('"add_order_note"');
    expect(edge).toContain('"stockflow_order_note_gateway"');
  });
});
