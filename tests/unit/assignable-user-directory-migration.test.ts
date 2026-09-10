import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').toLowerCase();
const migration = read('../../supabase/migrations/20260910054622_assignable_user_directory.sql');
const edge = read('../../supabase/functions/stockflow-orders/index.ts');
const route = read('../../app/api/users/route.ts');

describe('assignable user directory', () => {
  it('exposes only active members to roles that can assign orders', () => {
    expect(migration).toContain("p_action = 'list_assignable_users'");
    expect(migration).toContain("v_actor_role not in ('administrator','operations','management')");
    expect(migration).toContain("where status='active' and role <> 'viewer'");
    expect(migration).toContain('stockflow_assignment_gateway');
    expect(migration).not.toContain("'id', id");
    expect(migration).not.toMatch(/delete\s+from/);
  });

  it('routes the bounded directory read through the existing server gateway', () => {
    expect(edge).toContain('"list_assignable_users"');
    expect(route).toContain("scope') === 'assignable'");
    expect(route).toContain("'list_assignable_users'");
  });
});
