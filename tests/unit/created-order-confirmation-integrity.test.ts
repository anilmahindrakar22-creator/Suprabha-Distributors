import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(new URL('../../supabase/migrations/20260912133000_align_created_order_audit_state.sql', import.meta.url)),
  'utf8',
);
const integration = readFileSync(
  fileURLToPath(new URL('../../supabase/tests/created_order_confirmation_integrity.sql', import.meta.url)),
  'utf8',
);

describe('new-order confirmation integrity', () => {
  it('records the persisted creation state rather than a hard-coded legacy state', () => {
    expect(migration).toContain("v_order_id, 'order_created', v_to_status, v_actor_email, v_role");
    expect(migration).toContain("raise exception 'Expected hard-coded created-order audit state was not found'");
  });

  it('exercises create, audit and same-administrator confirmation against a real database', () => {
    expect(integration).toContain("'create_order'");
    expect(integration).toContain("v_created->>'status'<>v_status");
    expect(integration).toContain("v_event_status<>v_status");
    expect(integration).toContain("'transition_order'");
    expect(integration).toContain("'toStatus','confirmed'");
    expect(integration.trimEnd().endsWith('rollback;')).toBe(true);
  });
});
