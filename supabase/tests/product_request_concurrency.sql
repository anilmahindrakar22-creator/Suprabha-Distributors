-- Committed fixtures in the disposable replay DB, never production.
create extension if not exists dblink with schema public;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('product-race-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status) values('product-race-a@test.local','administrator','active'),('product-race-b@test.local','operations','active');
insert into private.stockflow_product_requests(id,product_name,created_by_email) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Product concurrency fixture','product-race-a@test.local');
create function public.test_product_request_call(actor text,payload jsonb) returns jsonb language plpgsql as $$
begin return public.stockflow_product_request_gateway('product-race-key',actor,'review_product_request',payload);
exception when others then return jsonb_build_object('errorCode',sqlstate); end $$;
do $test$
declare first_result jsonb; second_result jsonb; second_pid integer; attempt integer;
  payload jsonb:='{"requestId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","expectedVersion":1,"status":"rejected","resolution":"Concurrent review fixture","idempotencyKey":"product-race-first-001"}';
begin
  perform public.dblink_connect('product_a','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
  perform public.dblink_connect('product_b','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
  select pid into second_pid from public.dblink('product_b','select pg_backend_pid()') as t(pid integer);
  perform public.dblink_exec('product_a','begin');
  select value into first_result from public.dblink('product_a',format('select public.test_product_request_call(%L,%L::jsonb)','product-race-a@test.local',payload::text)) as t(value jsonb);
  if first_result ? 'errorCode' then raise exception 'First review failed: %',first_result; end if;
  perform public.dblink_send_query('product_b',format('select public.test_product_request_call(%L,%L::jsonb)','product-race-b@test.local',(payload||'{"idempotencyKey":"product-race-second-001"}')::text));
  for attempt in 1..500 loop
    exit when exists(select 1 from pg_locks where pid=second_pid and not granted);
    perform pg_sleep(0.01);
  end loop;
  if not exists(select 1 from pg_locks where pid=second_pid and not granted) then raise exception 'Second review did not contend on row lock'; end if;
  perform public.dblink_exec('product_a','commit');
  select value into second_result from public.dblink_get_result('product_b') as t(value jsonb);
  perform * from public.dblink_get_result('product_b') as t(value jsonb);
  if second_result->>'errorCode' is distinct from 'PT409' then raise exception 'Stale concurrent review not rejected: %',second_result; end if;
  select value into second_result from public.dblink('product_b',format('select public.test_product_request_call(%L,%L::jsonb)','product-race-a@test.local',payload::text)) as t(value jsonb);
  if second_result is distinct from first_result then raise exception 'Cross-session replay differs'; end if;
  if (select count(*) from private.stockflow_product_request_events where request_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc')<>1 then raise exception 'Duplicate concurrent event'; end if;
  perform public.dblink_disconnect('product_a'); perform public.dblink_disconnect('product_b');
end $test$;
