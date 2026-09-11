import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20260911190000_optimize_paginated_order_scope.sql"),
  "utf8",
);

describe("optimized paginated order scope migration", () => {
  it("keeps role scopes authoritative without re-reading an order by id", () => {
    expect(migration).toContain("from private.stockflow_role_order_scopes scope");
    expect(migration).toContain("scope.scope = 'global'");
    expect(migration).toContain("scope.scope = 'created_by'");
    expect(migration).toContain("lower(btrim(p_created_by_email)) = lower(btrim(p_actor_email))");
  });

  it("patches both count and page access checks to use the loaded creator", () => {
    expect(migration).toContain("private.stockflow_can_access_order(v_email,v_role,o.id)");
    expect(migration).toContain(
      "private.stockflow_role_can_read_order(v_email,v_role,o.created_by_email)",
    );
    expect(migration).toContain("Expected exactly two paginated order scope checks");
  });

  it("keeps internal scope helpers unavailable to browser roles", () => {
    expect(migration).toContain(
      "revoke all on function private.stockflow_role_can_read_order(text,text,text) from public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb) to service_role",
    );
  });
});
