begin;

alter table private.stockflow_economic_runs
 add column results_pruned_at timestamptz,
 add column results_pruned_rows integer;

create function private.stockflow_prune_economic_results() returns integer language plpgsql
set search_path=pg_catalog,private,public as $$
declare old_run record; deleted_rows integer; total_deleted integer:=0;
begin
 for old_run in
  select id from private.stockflow_economic_runs
  where not active and results_pruned_at is null
   and id not in (select id from private.stockflow_economic_runs where not active order by created_at desc,id desc limit 3)
  order by created_at,id
 loop
  delete from private.stockflow_economic_results r where r.run_id=old_run.id
   and not exists(select 1 from private.stockflow_economic_events e where e.source_result_id=r.id);
  get diagnostics deleted_rows = row_count;
  update private.stockflow_economic_runs set results_pruned_at=now(),results_pruned_rows=deleted_rows where id=old_run.id;
  total_deleted:=total_deleted+deleted_rows;
 end loop;
 return total_deleted;
end$$;
revoke all on function private.stockflow_prune_economic_results() from public,anon,authenticated,service_role;

-- Patch only the live rebuild, retaining its transaction and advisory lock.
do $patch$
declare definition text; anchor text:='update private.stockflow_economic_runs set active=true where id=run;';
begin
 definition:=replace(pg_get_functiondef('private.stockflow_rebuild_instrument_economics(text)'::regprocedure),chr(13),'');
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'Unexpected economics activation seam';
 end if;
 definition:=replace(definition,anchor,anchor||E'\n perform private.stockflow_prune_economic_results();');
 execute definition;
end$patch$;
revoke all on function private.stockflow_rebuild_instrument_economics(text) from public,anon,authenticated;

select private.stockflow_prune_economic_results();
commit;
