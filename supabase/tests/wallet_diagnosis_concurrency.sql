-- Disposable replay database only: both sessions must see the same committed fixtures.
create extension if not exists dblink with schema public;
begin;
create table public.test_diagnosis_gateway_backup as select secret_sha256 from private.stockflow_gateway_config where name='orders';
insert into private.stockflow_gateway_config(name,secret_sha256) values('orders',encode(extensions.digest('diagnosis-race-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status) values('diagnosis-race-a@test.local','management','active'),('diagnosis-race-b@test.local','management','active');
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values('b2600000-0000-4000-8000-000000000001','Diagnosis race','diagnosis-race','test');
create function public.test_diagnosis_race(actor text,request text) returns text language plpgsql as $$
declare result_data jsonb;
begin
 result_data:=public.stockflow_opportunity_gateway('diagnosis-race-key',actor,'open_opportunity',jsonb_build_object(
  'requestId',request,'customerId','b2600000-0000-4000-8000-000000000001','kind','capture','reason','Race fixture'));
 if result_data->>'id' is null then raise exception 'Invalid success result: %',result_data;end if;
 return 'ok';
exception when sqlstate 'PT409' then return 'PT409';
end$$;
revoke all on function public.test_diagnosis_race(text,text) from public,anon,authenticated,service_role;
commit;

do $race$
declare first_result text; second_result text; second_pid integer; attempt integer;
begin
 perform public.dblink_connect('diagnosis_a','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 perform public.dblink_connect('diagnosis_b','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 select pid into second_pid from public.dblink('diagnosis_b','select pg_backend_pid()') as t(pid integer);
 perform public.dblink_exec('diagnosis_a','begin');
 select result into first_result from public.dblink('diagnosis_a',$q$select public.test_diagnosis_race('diagnosis-race-a@test.local','diagnosis-race-a')$q$) as t(result text);
 if first_result is distinct from 'ok' then raise exception 'First writer failed: %',first_result;end if;
 perform public.dblink_send_query('diagnosis_b',$q$select public.test_diagnosis_race('diagnosis-race-b@test.local','diagnosis-race-b')$q$);
 for attempt in 1..500 loop
  exit when exists(select 1 from pg_locks where pid=second_pid and not granted and locktype='advisory');
  perform pg_sleep(0.01);
 end loop;
 if not exists(select 1 from pg_locks where pid=second_pid and not granted and locktype='advisory') then raise exception 'Second opportunity writer did not wait for advisory lock';end if;
 perform public.dblink_exec('diagnosis_a','commit');
 select result into second_result from public.dblink_get_result('diagnosis_b') as t(result text);
 perform * from public.dblink_get_result('diagnosis_b') as t(result text);
 if second_result is distinct from 'PT409' then raise exception 'Second writer must conflict: %',second_result;end if;
 if (select count(*) from private.stockflow_commercial_opportunities where customer_id='b2600000-0000-4000-8000-000000000001' and kind='capture')<>1
  or (select count(*) from private.stockflow_command_results where actor_email in ('diagnosis-race-a@test.local','diagnosis-race-b@test.local'))<>1
  or (select count(*) from private.stockflow_economic_audit where actor in ('diagnosis-race-a@test.local','diagnosis-race-b@test.local'))<>1 then raise exception 'Race must commit exactly one opportunity, receipt and audit';end if;
 perform public.dblink_disconnect('diagnosis_a');perform public.dblink_disconnect('diagnosis_b');
 raise notice 'PASS D4 simultaneous open calls produce one success and one PT409';
end$race$;
begin;
update private.stockflow_gateway_config set secret_sha256=(select secret_sha256 from public.test_diagnosis_gateway_backup) where name='orders';
drop table public.test_diagnosis_gateway_backup;
drop function public.test_diagnosis_race(text,text);
commit;
