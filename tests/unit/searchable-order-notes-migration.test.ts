import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260910143035_searchable_order_activity_notes.sql', import.meta.url)), 'utf8').toLowerCase();

describe('searchable order activity notes', () => {
  it('adds note matching without bypassing stage or date filters', () => {
    expect(migration).toContain('stockflow_order_matches_filter(p_order,p_status,p_query,p_capture_date)');
    expect(migration).toContain("stockflow_order_matches_filter(p_order,p_status,'',p_capture_date)");
    expect(migration).toContain('private.stockflow_order_events event');
    expect(migration).toContain("strpos(lower(coalesce(event.reason,'')),lower(btrim(p_query))) > 0");
  });

  it('preserves exact assignee and customer query semantics', () => {
    expect(migration).toContain("not like 'assignee:%'");
    expect(migration).toContain("not like 'customer:%'");
  });

  it('keeps search helpers private and the list gateway service-only', () => {
    expect(migration).toContain('revoke all on function private.stockflow_order_matches_filter_with_notes');
    expect(migration).toContain('revoke all on function public.stockflow_order_list_gateway');
    expect(migration).toContain('grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb) to service_role');
    expect(migration).not.toMatch(/\b(delete|truncate)\b/);
  });
});
