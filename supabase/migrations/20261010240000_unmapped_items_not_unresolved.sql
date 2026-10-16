begin;

-- Owner decision (10 Oct 2026): a customer's purchase of an item that is not
-- mapped to any instrument (for example reagents for their other analysers)
-- belongs elsewhere; it must not keep this instrument at Data incomplete.
-- Sales that could belong to more than one instrument, invalid adjustments and
-- missing costs still count as unresolved.
do $migration$
declare
  definition text;
  occurrences integer;
  old_fragment constant text := $q$r.status not in ('verified','excluded','instrument_billing') and v.company_id=f.company_id and v.customer_source_id=f.customer_source_id) has_unattributed$q$;
  new_fragment constant text := $q$r.status not in ('verified','excluded','instrument_billing') and r.reason<>'no_verified_compatible_placement' and v.company_id=f.company_id and v.customer_source_id=f.customer_source_id) has_unattributed$q$;
begin
  select pg_get_functiondef('private.stockflow_economic_workspace(text[])'::regprocedure) into definition;
  occurrences := (length(definition) - length(replace(definition, old_fragment, ''))) / length(old_fragment);
  if occurrences <> 1 then raise exception 'Expected one unresolved-attribution rule, found %', occurrences; end if;
  execute replace(definition, old_fragment, new_fragment);
end
$migration$;

revoke all on function private.stockflow_economic_workspace(text[]) from public,anon,authenticated;

commit;
