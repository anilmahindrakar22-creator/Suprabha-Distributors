-- Disposable local replay only. All fixtures and pruning are rolled back.
begin;
create extension if not exists dblink with schema public;

insert into private.stockflow_customers(id,name,tally_key,created_by_email)
 values('cb000000-0000-4000-8000-000000000001','Pruning customer','prune-customer','prune-test');
insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
 values('prune-test','placed','cb000000-0000-4000-8000-000000000001','prune-test');
insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,created_by_email,updated_by_email,idempotency_key)
 values('cb000000-0000-4000-8000-000000000002','PRUNE-TEST','cb000000-0000-4000-8000-000000000001','Pruning customer','phone','delivered','prune-test','prune-test','prune-fixture');
insert into private.stockflow_equipment_installations(id,order_id,tally_key,item_name,status,scheduled_date,serial_number,created_by_email,completed_at)
 values('cb000000-0000-4000-8000-000000000003','cb000000-0000-4000-8000-000000000002','prune-instrument','Pruning instrument','completed',
 private.stockflow_economic_business_date()-90,'PRUNE-1','prune-test',now()-interval '90 days');
insert into private.stockflow_economic_targets(id,kind,name,company_id,customer_id,customer_source_id,site_id,model_id,installation_id,effective_from,approval,created_by)
 values('cb000000-0000-4000-8000-000000000004','placement','Pruning placement','prune-test','cb000000-0000-4000-8000-000000000001',
 'placed','site','prune-model','cb000000-0000-4000-8000-000000000003',private.stockflow_economic_business_date()-90,'approved','prune-test');
insert into private.stockflow_economic_mappings(company_id,model_id,product_id,target_id,effect,effective_from,reason,verified_by)
 values('prune-test','prune-model','reagent','cb000000-0000-4000-8000-000000000004','include',private.stockflow_economic_business_date()-90,'Pruning reagent','prune-test');
with voucher as (
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,site_id,kind,evidence)
 values('prune-test','sales',1,private.stockflow_economic_business_date()-1,'placed','site','sale','{}') returning id
)
insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 select v.id,n::text,case when n=1 then 'reagent' else 'unmapped-'||n end,1,'pack',100,'{}'
 from voucher v cross join generate_series(1,4) n;

set local statement_timeout='5s';
-- Seed deletable results before rebuilds acquire this transaction's advisory lock.
do $lock$
declare results_before jsonb; runs_before jsonb; oldest_created_at timestamptz; fixture_line uuid;
begin
 select least(now(),coalesce(min(created_at),now())) into oldest_created_at from private.stockflow_economic_runs;
 select l.id into strict fixture_line from private.stockflow_economic_source_lines l
  join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
  where v.company_id='prune-test' and v.source_id='sales' and l.line_key='2';
 with runs as (
  insert into private.stockflow_economic_runs(active,actor,created_at)
   select false,'prune-lock-test',oldest_created_at-n*interval '1 second' from generate_series(1,4) n returning id
 )
 insert into private.stockflow_economic_results(run_id,source_line_id,status,reason,share_bps,quantity,revenue_paise)
  select id,fixture_line,'unresolved','P7 lock fixture',10000,1,100 from runs;
 if not exists(
  select 1 from private.stockflow_economic_runs r where not r.active and r.results_pruned_at is null
   and r.id not in (select id from private.stockflow_economic_runs where not active order by created_at desc,id desc limit 3)
   and exists(select 1 from private.stockflow_economic_results result where result.run_id=r.id
    and not exists(select 1 from private.stockflow_economic_events e where e.source_result_id=result.id))
 ) then raise exception 'P7 precondition: no eligible run with deletable results';end if;
 select jsonb_agg(to_jsonb(r) order by r.id) into results_before from private.stockflow_economic_results r;
 select jsonb_agg(to_jsonb(r) order by r.id) into runs_before from private.stockflow_economic_runs r;
 perform set_config('stockflow.economic_result_prune','',true);
 perform public.dblink_connect('prune_lock','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 perform public.dblink_exec('prune_lock','begin');
 perform * from public.dblink('prune_lock',$sql$select pg_advisory_xact_lock(hashtextextended('instrument-economics-v1',0))$sql$) as t(locked text);
 if private.stockflow_prune_economic_results(10) is distinct from 0 then raise exception 'P7 busy prune did not return zero';end if;
 if results_before is distinct from (select jsonb_agg(to_jsonb(r) order by r.id) from private.stockflow_economic_results r)
  or runs_before is distinct from (select jsonb_agg(to_jsonb(r) order by r.id) from private.stockflow_economic_runs r)
  or current_setting('stockflow.economic_result_prune',true) is distinct from ''
 then raise exception 'P7 busy prune changed rows or the prune setting';end if;
 perform public.dblink_exec('prune_lock','commit');
 perform public.dblink_disconnect('prune_lock');
exception when others or query_canceled then
 if 'prune_lock'=any(coalesce(public.dblink_get_connections(),array[]::text[])) then perform public.dblink_disconnect('prune_lock');end if;
 raise;
end $lock$;
set local statement_timeout=default;

create temp table prune_runs(ordinal integer primary key,id uuid not null,before_count integer not null) on commit drop;

do $test$
declare run uuid; referenced_result uuid; guarded_result uuid; i integer; item record; kept integer; deleted integer;
 summary_before text; full_before text; audit_before jsonb; results_before jsonb; events_before jsonb; denied_role text;
 oldest uuid; expected_deleted integer;
begin
 for i in 1..1000 loop
  deleted:=private.stockflow_prune_economic_results(10);
  exit when deleted=0;
  if i=1000 then raise exception 'P0 backlog drain reached 1000 iterations';end if;
 end loop;
 if exists(select 1 from private.stockflow_economic_runs where not active and results_pruned_at is null
  and id not in (select id from private.stockflow_economic_runs where not active order by created_at desc,id desc limit 3))
 then raise exception 'P0 drained backlog still has eligible runs';end if;

 for i in 1..6 loop
  run:=private.stockflow_rebuild_instrument_economics('prune-test');
  -- now() is constant in this transaction; give fixture runs deterministic ages.
  update private.stockflow_economic_runs set created_at=now()+i*interval '1 second' where id=run;
  insert into prune_runs select i,run,count(*) from private.stockflow_economic_results where run_id=run;
  if (select before_count from prune_runs where ordinal=i)<>4 then raise exception 'P0 expected four fixture results';end if;
  if i=1 then
   select r.id into strict referenced_result from private.stockflow_economic_results r
   join private.stockflow_economic_source_lines l on l.id=r.source_line_id where r.run_id=run and l.line_key='1';
   insert into private.stockflow_economic_events(target_id,kind,amount_paise,effective_date,source_result_id,request_id,actor,reason)
   values('cb000000-0000-4000-8000-000000000004','capital',0,private.stockflow_economic_business_date()-1,
    referenced_result,'prune-reference','prune-test','Pruning evidence retention');
  end if;
 end loop;

 perform set_config('stockflow.economic_result_prune','',true);
 for item in select id from prune_runs where ordinal in (1,6) loop
  select r.id into strict guarded_result from private.stockflow_economic_results r
   join private.stockflow_economic_source_lines l on l.id=r.source_line_id where r.run_id=item.id and l.line_key='2';
  begin
   delete from private.stockflow_economic_results where id=guarded_result;
   raise exception 'P5 direct delete without the setting was allowed';
  exception when sqlstate '42501' then
   if sqlerrm<>'Business history cannot be hard-deleted; cancel, release, supersede, or deactivate it instead' then raise;end if;
  end;
 end loop;
 perform set_config('stockflow.economic_result_prune','on',true);
 for item in select id from prune_runs where ordinal>=3 loop
  select r.id into strict guarded_result from private.stockflow_economic_results r
   join private.stockflow_economic_source_lines l on l.id=r.source_line_id where r.run_id=item.id and l.line_key='2';
  begin
   delete from private.stockflow_economic_results where id=guarded_result;
   raise exception 'P5 active or recent inactive result delete was allowed';
  exception when sqlstate '42501' then
   if sqlerrm<>'Business history cannot be hard-deleted; cancel, release, supersede, or deactivate it instead' then raise;end if;
  end;
 end loop;
 begin
  delete from private.stockflow_economic_runs where id=(select id from prune_runs where ordinal=1);
  raise exception 'P6 run delete was allowed with the prune setting';
 exception when sqlstate '42501' then null;
 end;
 begin
  delete from private.stockflow_economic_events where request_id='prune-reference';
  raise exception 'P6 event delete was allowed with the prune setting';
 exception when sqlstate '42501' then null;
 end;
 perform set_config('stockflow.economic_result_prune','off',true);

 create temp table prune_results_before on commit drop as select * from private.stockflow_economic_results;
 create temp table prune_audit_before on commit drop as select * from private.stockflow_economic_runs;
 if (select count(*) from private.stockflow_economic_runs where not active and results_pruned_at is null
  and id not in (select id from private.stockflow_economic_runs where not active order by created_at desc,id desc limit 3))>10
 then raise exception 'P0 fixture backlog exceeds the first prune bound';end if;
 summary_before:=private.stockflow_economic_workspace_read(array['management'],true)::text;
 full_before:=private.stockflow_economic_workspace_read(array['management'],false)::text;
 select jsonb_agg(to_jsonb(e) order by e.id) into events_before from private.stockflow_economic_events e;
 deleted:=private.stockflow_prune_economic_results(10);
 if deleted is distinct from (select count(*) from prune_results_before)-(select count(*) from private.stockflow_economic_results)
  or deleted<7 then raise exception 'P4 total deleted count mismatch';end if;
 if current_setting('stockflow.economic_result_prune',true) is distinct from 'off' then raise exception 'P4 prune setting was not reset';end if;
 if summary_before is distinct from private.stockflow_economic_workspace_read(array['management'],true)::text then raise exception 'P3 summary read changed after pruning';end if;
 if full_before is distinct from private.stockflow_economic_workspace_read(array['management'],false)::text then raise exception 'P3 full read changed after pruning';end if;

 for item in select f.*,r.active,r.results_pruned_at,r.results_pruned_rows from prune_runs f
  join private.stockflow_economic_runs r on r.id=f.id order by f.ordinal loop
  select count(*) into kept from private.stockflow_economic_results where run_id=item.id;
  if item.ordinal>=3 then
   if kept<>item.before_count or item.results_pruned_at is not null or item.results_pruned_rows is not null then raise exception 'P1 active/recent inactive results changed: %',item.ordinal;end if;
  else
   if kept<>(case when item.ordinal=1 then 1 else 0 end) then raise exception 'P1 old run retained other than event evidence: %',item.ordinal;end if;
   if item.results_pruned_at is null or item.results_pruned_rows is distinct from item.before_count-kept then raise exception 'P4 prune audit count mismatch: %',item.ordinal;end if;
  end if;
  if item.active is distinct from (item.ordinal=6) then raise exception 'P1 unexpected active run: %',item.ordinal;end if;
 end loop;
 for item in select r.id,r.results_pruned_rows from private.stockflow_economic_runs r
  join prune_audit_before b on b.id=r.id where b.results_pruned_at is null and r.results_pruned_at is not null loop
  if item.results_pruned_rows is distinct from (select count(*) from prune_results_before where run_id=item.id)
   -(select count(*) from private.stockflow_economic_results where run_id=item.id)
  then raise exception 'P4 recorded deletions differ from actual deletions for %',item.id;end if;
 end loop;
 if not exists(select 1 from private.stockflow_economic_results where id=referenced_result)
  or exists(select 1 from private.stockflow_economic_events e where e.source_result_id is not null
   and not exists(select 1 from private.stockflow_economic_results r where r.id=e.source_result_id))
  or events_before is distinct from (select jsonb_agg(to_jsonb(e) order by e.id) from private.stockflow_economic_events e)
 then raise exception 'P2 ledger evidence was not retained';end if;

 select jsonb_agg(to_jsonb(r) order by r.id) into audit_before from private.stockflow_economic_runs r;
 select jsonb_agg(to_jsonb(r) order by r.id) into results_before from private.stockflow_economic_results r;
 if private.stockflow_prune_economic_results(10) is distinct from 0 then raise exception 'P4 repeated prune deleted rows';end if;
 if audit_before is distinct from (select jsonb_agg(to_jsonb(r) order by r.id) from private.stockflow_economic_runs r)
  or results_before is distinct from (select jsonb_agg(to_jsonb(r) order by r.id) from private.stockflow_economic_results r)
  or events_before is distinct from (select jsonb_agg(to_jsonb(e) order by e.id) from private.stockflow_economic_events e)
 then raise exception 'P4 repeated prune changed rows';end if;

 foreach denied_role in array array['anon','authenticated','service_role'] loop
  if has_function_privilege(denied_role,'private.stockflow_prune_economic_results(integer)','execute')
   or has_function_privilege(denied_role,'private.prevent_economic_result_delete()','execute')
  then raise exception 'P8 prune or trigger function exposed to %',denied_role;end if;
 end loop;
 begin
  perform private.stockflow_prune_economic_results(0);
  raise exception 'P10 zero bound was accepted';
 exception when sqlstate '22023' then null;
 end;
 begin
  perform private.stockflow_prune_economic_results(null);
  raise exception 'P10 null bound was accepted';
 exception when sqlstate '22023' then null;
 end;

 for i in 7..8 loop
  run:=private.stockflow_rebuild_instrument_economics('prune-test');
  update private.stockflow_economic_runs set created_at=now()+i*interval '1 second' where id=run;
  insert into prune_runs select i,run,count(*) from private.stockflow_economic_results where run_id=run;
 end loop;
 if (select count(*) from private.stockflow_economic_runs where not active and results_pruned_at is null
  and id not in (select id from private.stockflow_economic_runs where not active order by created_at desc,id desc limit 3))<>2
 then raise exception 'P9 expected two fresh eligible runs';end if;
 select id into strict oldest from private.stockflow_economic_runs where not active and results_pruned_at is null
  and id not in (select id from private.stockflow_economic_runs where not active order by created_at desc,id desc limit 3)
  order by created_at,id limit 1;
 select count(*) into expected_deleted from private.stockflow_economic_results r where r.run_id=oldest
  and not exists(select 1 from private.stockflow_economic_events e where e.source_result_id=r.id);
 if expected_deleted=0 then raise exception 'P9 oldest eligible run has no deletable results';end if;
 select jsonb_agg(to_jsonb(r) order by r.id) into audit_before from private.stockflow_economic_runs r where id<>oldest;
 select jsonb_agg(to_jsonb(r) order by r.id) into results_before from private.stockflow_economic_results r where run_id<>oldest;
 select jsonb_agg(to_jsonb(e) order by e.id) into events_before from private.stockflow_economic_events e;
 if private.stockflow_prune_economic_results(1) is distinct from expected_deleted then raise exception 'P9 bounded prune count mismatch';end if;
 if not exists(select 1 from private.stockflow_economic_runs where id=oldest and results_pruned_at is not null and results_pruned_rows=expected_deleted)
  or exists(select 1 from private.stockflow_economic_results r where r.run_id=oldest
   and not exists(select 1 from private.stockflow_economic_events e where e.source_result_id=r.id))
  or audit_before is distinct from (select jsonb_agg(to_jsonb(r) order by r.id) from private.stockflow_economic_runs r where id<>oldest)
  or results_before is distinct from (select jsonb_agg(to_jsonb(r) order by r.id) from private.stockflow_economic_results r where run_id<>oldest)
 then raise exception 'P9 bound did not prune exactly the oldest eligible run';end if;
 if events_before is distinct from (select jsonb_agg(to_jsonb(e) order by e.id) from private.stockflow_economic_events e)
  or exists(select 1 from private.stockflow_economic_events e where e.source_result_id is not null
   and not exists(select 1 from private.stockflow_economic_results r where r.id=e.source_result_id))
 then raise exception 'P2 bounded prune removed ledger evidence';end if;
 raise notice 'PASS economic result pruning P1-P10';
end $test$;
rollback;
