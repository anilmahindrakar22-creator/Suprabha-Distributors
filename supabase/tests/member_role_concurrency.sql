-- Committed fixtures in the disposable replay DB only; NEVER run on a hosted DB.
create extension if not exists dblink with schema public;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('member-race-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status) values
 ('member-race-a@test.local','administrator','active'),
 ('member-race-b@test.local','administrator','active'),
 ('member-race-target@test.local','sales','active');
create function public.test_member_role_call(actor text,payload jsonb) returns jsonb language plpgsql as $$
begin return public.stockflow_user_gateway('member-race-key',actor,'upsert_user',payload);
exception when others then return jsonb_build_object('errorCode',sqlstate); end $$;
do $test$
declare first_result jsonb; second_result jsonb; second_pid integer; attempt integer; payload jsonb;
begin
 select jsonb_build_object('email',email,'role',role,'roles',jsonb_build_array('sales','warehouse'),
   'status','active','expectedUpdatedAt',updated_at,'idempotencyKey','member-race-first-001')
 into payload from public.stockflow_members where email='member-race-target@test.local';
 perform public.dblink_connect('member_a','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 perform public.dblink_connect('member_b','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 select pid into second_pid from public.dblink('member_b','select pg_backend_pid()') as t(pid integer);
 perform public.dblink_exec('member_a','begin');
 select value into first_result from public.dblink('member_a',format('select public.test_member_role_call(%L,%L::jsonb)',
   'member-race-a@test.local',payload::text)) as t(value jsonb);
 if first_result ? 'errorCode' then raise exception 'First role update failed: %',first_result; end if;
 perform public.dblink_send_query('member_b',format('select public.test_member_role_call(%L,%L::jsonb)',
   'member-race-b@test.local',(payload||'{"roles":["sales","accounts"],"idempotencyKey":"member-race-second-001"}'::jsonb)::text));
 for attempt in 1..500 loop
   exit when exists(select 1 from pg_locks where pid=second_pid and not granted);
   perform pg_sleep(0.01);
 end loop;
 if not exists(select 1 from pg_locks where pid=second_pid and not granted) then
   raise exception 'Second role update did not contend on transaction lock'; end if;
 perform public.dblink_exec('member_a','commit');
 select value into second_result from public.dblink_get_result('member_b') as t(value jsonb);
 perform * from public.dblink_get_result('member_b') as t(value jsonb);
 if second_result->>'errorCode' is distinct from 'PT409' then
   raise exception 'Stale concurrent role update not rejected: %',second_result; end if;
 select value into second_result from public.dblink('member_b',format('select public.test_member_role_call(%L,%L::jsonb)',
   'member-race-a@test.local',payload::text)) as t(value jsonb);
 if second_result is distinct from first_result then raise exception 'Cross-session role replay differs'; end if;
 if (select roles from public.stockflow_members where email='member-race-target@test.local')
   is distinct from array['sales','warehouse'] then raise exception 'Losing update overwrote roles'; end if;
 if (select count(*) from private.stockflow_member_events where member_email='member-race-target@test.local')<>1 then
   raise exception 'Concurrent role audit missing or duplicated'; end if;
 if not exists(select 1 from private.stockflow_member_events where member_email='member-race-target@test.local'
   and previous_roles=array['sales'] and new_roles=array['sales','warehouse'] and request_id='member-race-first-001') then
   raise exception 'Concurrent role audit provenance differs'; end if;
 perform public.dblink_disconnect('member_a'); perform public.dblink_disconnect('member_b');
end $test$;
