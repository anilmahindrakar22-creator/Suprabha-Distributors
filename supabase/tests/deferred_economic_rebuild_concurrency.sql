-- Disposable local replay database only. Independent sessions need committed fixtures.
create extension if not exists dblink with schema public;
create temp table deferred_race_state as
 select s.mode,s.updated_at,
  pg_get_functiondef('private.stockflow_rebuild_instrument_economics(text)'::regprocedure) original,
  array(select id from private.stockflow_economic_runs) original_runs,
  (select id from private.stockflow_economic_runs where active) original_active,
  null::text failure
 from private.stockflow_economic_rebuild_settings s;

do $setup$
declare definition text; anchor text:='return run;';
begin
 if exists(select 1 from private.stockflow_economic_rebuild_status where pending_since is not null or company_id='deferred-race-test') then
  raise exception 'Concurrency fixture requires an idle queue and unused company';
 end if;
 select original into definition from deferred_race_state;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Expected exactly one rebuild return anchor';end if;
 -- The controller holds this test-only gate just before the worker clears pending rows.
 execute replace(definition,anchor,$gate$perform pg_advisory_xact_lock(hashtextextended('deferred-test-publication-gate',0));
 return run;$gate$);
 update private.stockflow_economic_rebuild_settings set mode='deferred' where id;
 perform private.stockflow_request_economic_rebuild('deferred-race-test');
end $setup$;

do $test$
declare published integer; runs_before bigint; first_pid integer; second_pid integer; attempt integer;
 started_at timestamptz; first_pending timestamptz;
begin
 perform public.dblink_connect('deferred_a','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 perform public.dblink_connect('deferred_b','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 select pid into first_pid from public.dblink('deferred_a','select pg_backend_pid()') as t(pid integer);
 select pid into second_pid from public.dblink('deferred_b','select pg_backend_pid()') as t(pid integer);

 -- A held upload lock makes B's worker skip immediately instead of joining the lock queue.
 select count(*) into runs_before from private.stockflow_economic_runs;
 perform public.dblink_exec('deferred_a','begin');
 perform * from public.dblink('deferred_a',$sql$select pg_advisory_xact_lock(hashtextextended('instrument-economics-v1',0))$sql$) as t(locked text);
 perform public.dblink_exec('deferred_b',$sql$set statement_timeout='1s'$sql$);
 started_at:=clock_timestamp();
 select value into published from public.dblink('deferred_b','select private.stockflow_run_pending_economic_rebuild()') as t(value integer);
 if published<>0 or clock_timestamp()-started_at>=interval '1 second' then raise exception 'Busy worker did not skip immediately';end if;
 if (select count(*) from private.stockflow_economic_runs)<>runs_before then raise exception 'Busy worker published a run';end if;
 perform public.dblink_exec('deferred_a','commit');
 perform public.dblink_exec('deferred_b',$sql$set statement_timeout='15s'$sql$);

 -- Pause A after its rebuild writes, before pending cleanup. A direct request in B
 -- would be lost here without the helper's advisory lock, including its original pending age.
 select pending_since into first_pending from private.stockflow_economic_rebuild_status where company_id='deferred-race-test';
 perform pg_advisory_lock(hashtextextended('deferred-test-publication-gate',0));
 perform public.dblink_exec('deferred_a','begin');
 perform public.dblink_send_query('deferred_a','select private.stockflow_run_pending_economic_rebuild()');
 for attempt in 1..1000 loop
  exit when exists(select 1 from pg_locks where pid=first_pid and locktype='advisory' and not granted);
  perform pg_sleep(0.01);
 end loop;
 if not exists(select 1 from pg_locks where pid=first_pid and locktype='advisory' and not granted) then raise exception 'Worker did not reach publication gate';end if;
 perform public.dblink_send_query('deferred_b',$sql$select private.stockflow_request_economic_rebuild('deferred-race-test')$sql$);
 for attempt in 1..500 loop
  exit when exists(select 1 from pg_locks where pid=second_pid and locktype='advisory' and not granted);
  perform pg_sleep(0.01);
 end loop;
 if not exists(select 1 from pg_locks where pid=second_pid and locktype='advisory' and not granted) then raise exception 'Request bypassed uncommitted worker publication';end if;
 if (select count(*) from private.stockflow_economic_runs)<>runs_before then raise exception 'Uncommitted generation visible to reader';end if;
 perform pg_advisory_unlock(hashtextextended('deferred-test-publication-gate',0));
 select value into published from public.dblink_get_result('deferred_a') as t(value integer);
 perform * from public.dblink_get_result('deferred_a') as t(value integer);
 if published<>1 then raise exception 'Worker failed to publish';end if;
 if public.dblink_is_busy('deferred_b')<>1 then raise exception 'Request escaped worker transaction lock';end if;
 perform public.dblink_exec('deferred_a','commit');
 perform * from public.dblink_get_result('deferred_b') as t(requested text);
 perform * from public.dblink_get_result('deferred_b') as t(requested text);
 if (select count(*) from private.stockflow_economic_runs)<>runs_before+1 then raise exception 'Expected exactly one committed generation';end if;
 if not exists(select 1 from private.stockflow_economic_rebuild_status where company_id='deferred-race-test'
  and pending_since>first_pending and attempts=0) then raise exception 'Request during publication was lost';end if;
 perform public.dblink_disconnect('deferred_a');
 perform public.dblink_disconnect('deferred_b');
exception when others or query_canceled then
 -- Closing remote connections rolls back any outstanding transaction before cleanup.
 perform pg_advisory_unlock(hashtextextended('deferred-test-publication-gate',0));
 if 'deferred_a'=any(coalesce(public.dblink_get_connections(),array[]::text[])) then perform public.dblink_disconnect('deferred_a');end if;
 if 'deferred_b'=any(coalesce(public.dblink_get_connections(),array[]::text[])) then perform public.dblink_disconnect('deferred_b');end if;
 update deferred_race_state set failure=sqlstate||': '||sqlerrm;
end $test$;

-- Remove every committed fixture and generation, including derived rows, and restore
-- the pre-test active generation, settings and function. This suite has exclusive use of its replay DB.
begin;
set local session_replication_role=replica;
do $cleanup$
declare saved deferred_race_state%rowtype; generated uuid[];
begin
 select * into saved from deferred_race_state;
 execute saved.original;
 select coalesce(array_agg(id),array[]::uuid[]) into generated from private.stockflow_economic_runs where not (id=any(saved.original_runs));
 delete from private.stockflow_economic_events e where exists(select 1 from unnest(generated) run_id where e.request_id like run_id::text||':%');
 delete from private.stockflow_economic_auto_cost_links where run_id=any(generated);
 delete from private.stockflow_economic_results where run_id=any(generated);
 delete from private.stockflow_economic_runs where id=any(generated);
 update private.stockflow_economic_runs set active=true where id=saved.original_active;
 delete from private.stockflow_economic_rebuild_status where company_id='deferred-race-test';
 update private.stockflow_economic_rebuild_settings set mode=saved.mode,updated_at=saved.updated_at where id;
end $cleanup$;
commit;
do $result$
declare failure text;
begin
 select s.failure into failure from deferred_race_state s;
 if failure is not null then raise exception 'Deferred concurrency test failed after cleanup: %',failure;end if;
end $result$;
drop table deferred_race_state;
