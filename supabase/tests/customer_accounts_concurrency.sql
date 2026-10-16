-- Committed fixtures in the disposable replay DB only; never run on hosted DBs.
create extension if not exists dblink with schema public;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('account-race-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,roles,status) values
 ('account-race-a@test.local','management',array['management'],'active'),
 ('account-race-b@test.local','management',array['management'],'active');
insert into private.stockflow_customers(id,name,created_by_email)
 values('bbbbbbbb-aaaa-4bbb-8bbb-bbbbbbbbbbbb','Account concurrency fixture','account-race-a@test.local');
insert into private.stockflow_territories(id,name,created_by)
 values('bbbbbbbb-cccc-4bbb-8bbb-bbbbbbbbbbbb','Account race territory','account-race-a@test.local');
create function public.test_account_call(actor text,v_action text,payload jsonb) returns jsonb language plpgsql as $$
begin return public.stockflow_accounts_gateway('account-race-key',actor,v_action,payload);
exception when others then return jsonb_build_object('errorCode',sqlstate); end $$;
do $test$
declare first_result jsonb; second_result jsonb; second_pid integer; attempt integer; v_action text; payload jsonb;
begin
 perform public.dblink_connect('account_a','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 perform public.dblink_connect('account_b','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 select pid into second_pid from public.dblink('account_b','select pg_backend_pid()') as t(pid integer);
 foreach v_action in array array['assign_account','set_location'] loop
  payload:=jsonb_build_object('customerId','bbbbbbbb-aaaa-4bbb-8bbb-bbbbbbbbbbbb','expectedVersion',null,
    'idempotencyKey','account-race-first-'||v_action);
  if v_action='assign_account' then
   payload:=payload||jsonb_build_object('ownerEmail','account-race-a@test.local','territoryId','bbbbbbbb-cccc-4bbb-8bbb-bbbbbbbbbbbb');
  else
   payload:=payload||jsonb_build_object('precision','town','town','Pune','source','town');
  end if;
  perform public.dblink_exec('account_a','begin');
  select value into first_result from public.dblink('account_a',format('select public.test_account_call(%L,%L,%L::jsonb)',
    'account-race-a@test.local',v_action,payload::text)) as t(value jsonb);
  if first_result ? 'errorCode' then raise exception 'First account command failed: %',first_result; end if;
  perform public.dblink_send_query('account_b',format('select public.test_account_call(%L,%L,%L::jsonb)',
    'account-race-b@test.local',v_action,(payload||jsonb_build_object('idempotencyKey','account-race-second-'||v_action))::text));
  for attempt in 1..500 loop
   exit when exists(select 1 from pg_locks where pid=second_pid and not granted);
   perform pg_sleep(0.01);
  end loop;
  if not exists(select 1 from pg_locks where pid=second_pid and not granted) then raise exception 'Second account command did not contend: %',v_action; end if;
  perform public.dblink_exec('account_a','commit');
  select value into second_result from public.dblink_get_result('account_b') as t(value jsonb);
  perform * from public.dblink_get_result('account_b') as t(value jsonb);
  if second_result->>'errorCode' is distinct from 'PT409' then raise exception 'Concurrent stale account command accepted: %, %',v_action,second_result; end if;
  select value into second_result from public.dblink('account_b',format('select public.test_account_call(%L,%L,%L::jsonb)',
    'account-race-a@test.local',v_action,payload::text)) as t(value jsonb);
  if second_result is distinct from first_result then raise exception 'Cross-session account replay differs: %',v_action; end if;
 if (select count(*) from private.stockflow_command_results r where r.actor_email='account-race-a@test.local' and r.action=v_action)<>1
    or exists(select 1 from private.stockflow_command_results r where r.actor_email='account-race-b@test.local' and r.action=v_action) then
   raise exception 'Losing command receipt persisted or replay duplicated: %',v_action;
  end if;
 end loop;
 if (select count(*) from private.stockflow_customer_assignments where customer_id='bbbbbbbb-aaaa-4bbb-8bbb-bbbbbbbbbbbb')<>1
   or not exists(select 1 from private.stockflow_customer_assignments where customer_id='bbbbbbbb-aaaa-4bbb-8bbb-bbbbbbbbbbbb'
     and owner_email='account-race-a@test.local' and version=1 and effective_to is null) then raise exception 'Concurrent assignment history differs'; end if;
 if (select count(*) from private.stockflow_customer_location_events where customer_id='bbbbbbbb-aaaa-4bbb-8bbb-bbbbbbbbbbbb')<>1
   or not exists(select 1 from private.stockflow_customer_locations where customer_id='bbbbbbbb-aaaa-4bbb-8bbb-bbbbbbbbbbbb'
     and town='Pune' and version=1 and verified_by='account-race-a@test.local') then raise exception 'Concurrent location audit differs'; end if;
 perform public.dblink_disconnect('account_a'); perform public.dblink_disconnect('account_b');
end $test$;
