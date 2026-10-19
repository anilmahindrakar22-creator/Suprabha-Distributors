-- Disposable DB only. Fixtures must be committed for the independent sessions.
create extension if not exists dblink with schema public;
insert into public.stockflow_members(email,role,roles,status) values('visit-race-sales@test.local','sales',array['sales'],'active');
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('visit-race-key','sha256'),'hex') where name='orders';
create function public.test_visit_customer_create(p_key text) returns text language plpgsql as $$
begin
 return public.stockflow_accounts_gateway('visit-race-key','visit-race-sales@test.local','create_customer',jsonb_build_object('name','Visit concurrent fixture customer','idempotencyKey',p_key))->>'customerId';
exception when others then return sqlstate;end $$;
set statement_timeout='12s';
do $race$
declare v_connect text:=format('dbname=%L user=%L',current_database(),current_user);v_id text;v_other text;v_pid int;v_deadline timestamptz;v_waiting boolean:=false;
begin
 perform public.dblink_connect('visit_create_a',v_connect);perform public.dblink_connect('visit_create_b',v_connect);
 select pid into v_pid from public.dblink('visit_create_b','select pg_backend_pid()') as t(pid int);
 perform public.dblink_exec('visit_create_a','begin');
 select result into v_id from public.dblink('visit_create_a',$q$select public.test_visit_customer_create('visit-race-command-0001')$q$) as t(result text);
 if v_id !~ '^[0-9a-f-]{36}$' then raise exception 'First concurrent create failed: %',v_id;end if;
 perform public.dblink_send_query('visit_create_b',$q$select public.test_visit_customer_create('visit-race-command-0002')$q$);
 v_deadline:=clock_timestamp()+interval '4 seconds';
 while clock_timestamp()<v_deadline loop
  perform pg_stat_clear_snapshot();select exists(select 1 from pg_stat_activity where pid=v_pid and wait_event='advisory') into v_waiting;
  exit when v_waiting;perform pg_sleep(0.02);
 end loop;
 if not v_waiting then raise exception 'Concurrent duplicate did not wait for the shared directory lock';end if;
 perform public.dblink_exec('visit_create_a','commit');
 select result into v_other from public.dblink_get_result('visit_create_b') as t(result text);
 if v_other is distinct from 'PT409' then raise exception 'Concurrent duplicate expected PT409, got %',v_other;end if;
 perform result from public.dblink_get_result('visit_create_b') as t(result text);
 select result into v_other from public.dblink('visit_create_b',$q$select public.test_visit_customer_create('visit-race-command-0001')$q$) as t(result text);
 if v_id is distinct from v_other or (select count(*) from private.stockflow_customers where name='Visit concurrent fixture customer')<>1
  or (select count(*) from private.stockflow_customer_creation_events where customer_id=v_id::uuid)<>1 then raise exception 'Concurrent create/replay duplicated customer or audit';end if;
 perform public.dblink_disconnect('visit_create_a');perform public.dblink_disconnect('visit_create_b');
exception when others or query_canceled then
 if 'visit_create_a'=any(coalesce(public.dblink_get_connections(),array[]::text[])) then perform public.dblink_disconnect('visit_create_a');end if;
 if 'visit_create_b'=any(coalesce(public.dblink_get_connections(),array[]::text[])) then perform public.dblink_disconnect('visit_create_b');end if;
 raise;
end $race$;
reset statement_timeout;
drop function public.test_visit_customer_create(text);
