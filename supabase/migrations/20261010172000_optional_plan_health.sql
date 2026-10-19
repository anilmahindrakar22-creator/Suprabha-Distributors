begin;

-- Planning targets are optional. Keep data_incomplete for missing or stale
-- evidence, missing costs and unresolved attribution, but do not use the
-- absence of an expected-economics row as an evidence failure.
do $migration$
declare
  definition text;
  old_condition constant text := ' or expectation_id is null or ';
  occurrences integer;
begin
  select pg_get_functiondef('private.stockflow_economic_workspace(text[])'::regprocedure)
  into definition;

  occurrences := (length(definition) - length(replace(definition, old_condition, ''))) / length(old_condition);
  if occurrences <> 1 then
    raise exception 'Expected one optional-plan health condition, found %', occurrences;
  end if;

  execute replace(definition, old_condition, ' or ');
end
$migration$;

revoke all on function private.stockflow_economic_workspace(text[]) from public,anon,authenticated;

commit;
