import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20260911193000_consolidate_order_line_projection.sql"),
  "utf8",
);

describe("consolidated order-line projection", () => {
  it("pages secured orders before aggregating their lines", () => {
    expect(migration).toContain("select candidate.*");
    expect(migration).toContain(
      "private.stockflow_role_can_read_order(v_email,v_role,candidate.created_by_email)",
    );
    expect(migration).toContain("offset (v_page-1)*v_page_size limit v_page_size");
    expect(migration).toContain("cross join lateral");
  });

  it("derives all card line fields in one aggregate", () => {
    expect(migration).toContain("count(*) as line_count");
    expect(migration).toContain("coalesce(sum(l.quantity),0) as total_quantity");
    expect(migration).toContain("coalesce(sum(l.reserved_quantity),0) as reserved_quantity");
    expect(migration).toContain("jsonb_agg(");
    expect(migration).toContain("'lines',line_summary.lines");
  });

  it("fails closed if the expected gateway shape has changed", () => {
    expect(migration).toContain("Expected repeated order-line projections were not found");
    expect(migration).toContain("Expected paginated order source was not found");
    expect(migration).toContain(
      "grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb) to service_role",
    );
  });
});
