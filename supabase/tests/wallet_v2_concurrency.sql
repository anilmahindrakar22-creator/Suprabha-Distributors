-- Disposable replay database only: committed fixtures are visible to both sessions.
create extension if not exists dblink with schema public;
begin;
create table public.test_wallet_gateway_backup as
 select secret_sha256 from private.stockflow_gateway_config where name='orders';
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('wallet-race-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status) values
 ('wallet-race-a@test.local','management','active'),('wallet-race-b@test.local','management','active');
insert into private.stockflow_customers(id,name,tally_key,created_by_email)
values('b2400000-0000-4000-8000-000000000001','Wallet race','wallet-race','test');
create function public.test_wallet_race(actor text,request text) returns text language plpgsql as $$
declare result jsonb;
begin
 result:=public.stockflow_wallet_gateway('wallet-race-key',actor,'record_wallet_snapshot',jsonb_build_object(
  'requestId',request,'customerId','b2400000-0000-4000-8000-000000000001','monthlyWalletPaise',1000,
  'method','manager_estimate','source','Race fixture','confidence','medium',
  'asOf',(now() at time zone 'Asia/Kolkata')::date,'note','Race fixture','loweredReason',null,
  'divisions','[]'::jsonb,'expectedCurrentSnapshotId',null));
 if result->>'ok'<>'true' or result->>'snapshotId' is null then raise exception 'Invalid success result: %',result;end if;
 return 'ok';
exception when sqlstate 'PT409' then return sqlstate;
end$$;
revoke all on function public.test_wallet_race(text,text) from public,anon,authenticated,service_role;
commit;

do $race$
declare first_result text; second_result text; second_pid integer; attempt integer;
begin
 perform public.dblink_connect('wallet_a','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 perform public.dblink_connect('wallet_b','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 select pid into second_pid from public.dblink('wallet_b','select pg_backend_pid()') as t(pid integer);
 perform public.dblink_exec('wallet_a','begin');
 select result into first_result from public.dblink('wallet_a',
  $q$select public.test_wallet_race('wallet-race-a@test.local','wallet-race-request-a')$q$) as t(result text);
 if first_result is distinct from 'ok' then raise exception 'First writer failed: %',first_result;end if;
 perform public.dblink_send_query('wallet_b',
  $q$select public.test_wallet_race('wallet-race-b@test.local','wallet-race-request-b')$q$);
 for attempt in 1..500 loop
  exit when exists(select 1 from pg_locks where pid=second_pid and not granted and locktype='advisory');
  perform pg_sleep(0.01);
 end loop;
 if not exists(select 1 from pg_locks where pid=second_pid and not granted and locktype='advisory') then
  raise exception 'Second snapshot writer did not wait for customer lock';end if;
 perform public.dblink_exec('wallet_a','commit');
 select result into second_result from public.dblink_get_result('wallet_b') as t(result text);
 perform * from public.dblink_get_result('wallet_b') as t(result text);
 if second_result is distinct from 'PT409' then raise exception 'Second writer must conflict: %',second_result;end if;
 if (select count(*) from private.stockflow_wallet_snapshots where customer_id='b2400000-0000-4000-8000-000000000001')<>1
  or (select count(*) from private.stockflow_command_results where actor_email in ('wallet-race-a@test.local','wallet-race-b@test.local'))<>1
  or (select count(*) from private.stockflow_economic_audit where actor in ('wallet-race-a@test.local','wallet-race-b@test.local'))<>1
  then raise exception 'Race must commit exactly one snapshot, receipt and audit';end if;
 perform public.dblink_disconnect('wallet_a');perform public.dblink_disconnect('wallet_b');
 raise notice 'PASS W4 two snapshot writers with the same expected id give one success and one PT409';
end$race$;
begin;
update private.stockflow_gateway_config set secret_sha256=(select secret_sha256 from public.test_wallet_gateway_backup) where name='orders';
drop table public.test_wallet_gateway_backup;
drop function public.test_wallet_race(text,text);
commit;
