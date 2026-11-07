begin;

alter table private.stockflow_economic_runs
 add column results_pruned_at timestamptz,
 add column results_pruned_rows integer;

create index stockflow_economic_events_source_result on private.stockflow_economic_events(source_result_id) where source_result_id is not null;

create function private.prevent_economic_result_delete() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if current_setting('stockflow.economic_result_prune',true)='on'
  and exists(select 1 from private.stockflow_economic_runs where id=old.run_id and active=false)
  and old.run_id not in (select id from private.stockflow_economic_runs where not active order by created_at desc,id desc limit 3)
 then return old;end if;
 raise exception 'Business history cannot be hard-deleted; cancel, release, supersede, or deactivate it instead' using errcode='42501';
end$$;
revoke all on function private.prevent_economic_result_delete() from public,anon,authenticated,service_role;

drop trigger no_delete on private.stockflow_economic_results;
create trigger no_delete before delete on private.stockflow_economic_results for each row execute function private.prevent_economic_result_delete();

-- Keep active, recent inactive and event-cited results. Audit each completed run.
create function private.stockflow_prune_economic_results(max_runs integer default 10) returns integer
language plpgsql security definer set search_path=pg_catalog,private,public as $$
declare item record; deleted integer; total integer:=0;
begin
 if max_runs is null or max_runs<1 then raise exception 'max_runs must be positive' using errcode='22023';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('instrument-economics-v1',0)) then return 0;end if;
 perform set_config('stockflow.economic_result_prune','on',true);
 for item in
  select id from private.stockflow_economic_runs
  where not active and results_pruned_at is null
   and id not in (select id from private.stockflow_economic_runs where not active order by created_at desc,id desc limit 3)
  order by created_at,id limit max_runs
 loop
  delete from private.stockflow_economic_results r where r.run_id=item.id
   and not exists(select 1 from private.stockflow_economic_events e where e.source_result_id=r.id);
  get diagnostics deleted=row_count;
  update private.stockflow_economic_runs set results_pruned_at=now(),results_pruned_rows=deleted where id=item.id;
  total:=total+deleted;
 end loop;
 perform set_config('stockflow.economic_result_prune','off',true);
 return total;
end$$;
revoke all on function private.stockflow_prune_economic_results(integer) from public,anon,authenticated,service_role;

do $cron$
begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('stockflow-economic-result-prune','40 20 * * *',$job$select private.stockflow_prune_economic_results(10)$job$);
 end if;
end $cron$;

commit;
