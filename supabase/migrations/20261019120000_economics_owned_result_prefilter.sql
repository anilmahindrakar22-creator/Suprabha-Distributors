-- Economics opens slowly: the workspace read calls stockflow_economic_result_owned()
-- once per result row of the active run (5,526 rows on 19 Oct 2026) for every target,
-- in five subqueries. That function can only be true when the row has a target
-- (r.target_id = target, or r.target_id is a placement of the group), so a row with
-- no target is never owned. Checking that first is exactly equivalent and lets the
-- (run_id, target_id) index skip those rows: measured read-only on production data,
-- summary read 1,850 ms -> 188 ms with an identical result checksum.

do $$
declare
  f text;
  per_target constant text := 'private.stockflow_economic_result_owned(r.id,t.id)';
  per_enriched constant text := 'private.stockflow_economic_result_owned(r.id,enriched.id)';
begin
  select pg_get_functiondef('private.stockflow_economic_workspace_read(text[],boolean)'::regprocedure) into f;
  if (length(f) - length(replace(f, per_target, ''))) / length(per_target) <> 4 then
    raise exception 'Expected four per-target ownership checks in the economics workspace read';
  end if;
  if (length(f) - length(replace(f, per_enriched, ''))) / length(per_enriched) <> 1 then
    raise exception 'Expected one item-breakdown ownership check in the economics workspace read';
  end if;
  if position('r.target_id is not null and private.stockflow_economic_result_owned' in f) > 0 then
    raise exception 'Ownership prefilter already present';
  end if;
  f := replace(f, per_target, 'r.target_id is not null and ' || per_target);
  f := replace(f, per_enriched, 'r.target_id is not null and ' || per_enriched);
  execute f;
end $$;
