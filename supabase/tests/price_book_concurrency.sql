-- Disposable-database test: committed fixtures are needed by independent sessions.
create extension if not exists dblink with schema public;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('concurrency-key','sha256'),'hex') where name='orders';
update private.stockflow_pricing_policies set active=false where active;
insert into private.stockflow_pricing_policies(policy_version,minimum_margin_percent,target_margin_percent,override_approval_percent,rounding_increment,rounding_rule_version,effective_from,created_by_email)
values('concurrency-v1',20,30,5,5,'ceil-five-v1','2026-01-01','test');
insert into public.stockflow_members(email,role,status) values('concurrent-a@test.local','administrator','active'),('concurrent-b@test.local','management','active');
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Concurrent A','concurrent-a','test'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Concurrent B','concurrent-b','test');
insert into private.stockflow_products(tally_item_key,name,base_unit) select 'CONCURRENT-'||n,'Concurrent reagent '||n,'Nos' from generate_series(1,4) n;
insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
select 'CONCURRENT-'||n,50,'purchase_price','2026-08-01','C50','concurrent-cost-'||n,'1' from generate_series(1,4) n;
insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version)
select c.id,'CONCURRENT-'||n,100,'2026-08-18','S100',c.id::text||'-'||n,'1'
from private.stockflow_customers c cross join generate_series(1,4) n where c.tally_key in ('concurrent-a','concurrent-b');
create function public.test_pricing_call(actor text,action_name text,payload jsonb) returns jsonb language plpgsql as $$
begin return public.stockflow_pricing_gateway('concurrency-key',actor,action_name,payload);
exception when others then return jsonb_build_object('errorCode',sqlstate); end $$;

do $concurrent$
declare scenario integer; action_name text; first_payload jsonb; second_payload jsonb; r jsonb; first_result jsonb;
  actor text; second_pid integer; attempt integer; item text; count_before integer; expected_rows integer;
begin
  perform public.dblink_connect('pricing_a',format('host=127.0.0.1 port=%s dbname=%s user=%s',current_setting('port'),current_database(),current_user));
  perform public.dblink_connect('pricing_b',format('host=127.0.0.1 port=%s dbname=%s user=%s',current_setting('port'),current_database(),current_user));
  perform public.dblink_exec('pricing_b','set statement_timeout=''15s''');
  select pid into second_pid from public.dblink('pricing_b','select pg_backend_pid()') as t(pid integer);
  for scenario in 1..3 loop
    item:='CONCURRENT-'||scenario;
    action_name:=case when scenario=1 then 'apply_price_book' else 'apply_product_price_impact' end;
    first_payload:=jsonb_build_object('tallyKey',item,'choice','recommended','pricingDate','2026-09-14','reason','Concurrent approval','idempotencyKey','concurrent-first-key-'||scenario);
    if scenario=1 then
      r:=private.stockflow_customer_price('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',item,'2026-09-14');
      first_payload:=first_payload||jsonb_build_object('customerId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','expectedDecisionId',r->>'currentDecisionId','evidenceHash',r->>'evidenceHash');
    else
      first_payload:=first_payload||jsonb_build_object('previewHash',private.stockflow_product_price_impact(item,'2026-09-14')->>'previewHash');
    end if;
    second_payload:=case when scenario=3 then first_payload else first_payload||jsonb_build_object('idempotencyKey','concurrent-second-key-'||scenario) end;
    actor:=case when scenario=3 then 'concurrent-a@test.local' else 'concurrent-b@test.local' end;
    select count(*) into count_before from private.stockflow_price_book_decisions;
    perform public.dblink_exec('pricing_a','begin');
    select value into first_result from public.dblink('pricing_a',format('select public.test_pricing_call(%L,%L,%L::jsonb)','concurrent-a@test.local',action_name,first_payload::text)) as t(value jsonb);
    if first_result ? 'errorCode' then raise exception 'First approval failed: %',first_result; end if;
    perform public.dblink_send_query('pricing_b',format('select public.test_pricing_call(%L,%L,%L::jsonb)',actor,action_name,second_payload::text));
    for attempt in 1..500 loop
      exit when exists(select 1 from pg_locks where pid=second_pid and not granted);
      perform pg_sleep(0.01);
    end loop;
    if not exists(select 1 from pg_locks where pid=second_pid and not granted) then raise exception 'Second approval did not contend on a real lock'; end if;
    perform public.dblink_exec('pricing_a','commit');
    select value into r from public.dblink_get_result('pricing_b') as t(value jsonb);
    perform * from public.dblink_get_result('pricing_b') as t(value jsonb);
    if scenario<3 and r->>'errorCode' is distinct from '40001' then raise exception 'Stale approval not rejected: %',r; end if;
    if scenario=3 and r is distinct from first_result then raise exception 'Duplicate response differs'; end if;
    expected_rows:=case when scenario=1 then 1 else 2 end;
    if (select count(*) from private.stockflow_price_book_decisions) <> count_before+expected_rows then raise exception 'Concurrent request left extra decisions'; end if;
    if exists(select 1 from private.stockflow_command_results where idempotency_key='concurrent-second-key-'||scenario) then raise exception 'Rejected request stored result'; end if;
  end loop;
  perform public.dblink_disconnect('pricing_a'); perform public.dblink_disconnect('pricing_b');
end $concurrent$;

do $exception_approval_race$
declare
  v_order uuid; v_line uuid; v_exception uuid; v_evidence text;
  v_first_payload jsonb; v_second_payload jsonb; v_first_result jsonb; v_second_result jsonb;
  v_second_pid integer; v_attempt integer; v_events integer; v_outbox integer; v_snapshots integer;
begin
  insert into private.stockflow_orders(customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email)
  values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Concurrent A','phone','packed','concurrent-exception-order','concurrent-a@test.local','concurrent-a@test.local')
  returning id into v_order;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity)
  values(v_order,'CONCURRENT-4','Concurrent reagent 4',1) returning id into v_line;
  v_evidence:=private.stockflow_resolve_pricing_line(v_line,'2026-09-14')->>'evidenceHash';
  perform public.stockflow_pricing_gateway('concurrency-key','concurrent-a@test.local','submit_order_pricing',jsonb_build_object(
    'orderId',v_order,'expectedVersion',1,'pricingDate','2026-09-14','idempotencyKey','concurrent-exception-submit',
    'lines',jsonb_build_array(jsonb_build_object('lineId',v_line,'enteredRate',60,'reason','Concurrent commercial review','evidenceHash',v_evidence))
  ));
  select id into v_exception from private.stockflow_price_exceptions where order_id=v_order and state='pending';
  if v_exception is null then raise exception 'Concurrent exception fixture was not created'; end if;
  v_first_payload:=jsonb_build_object('exceptionId',v_exception,'expectedVersion',1,'pricingDate','2026-09-14','reason','First management approval','idempotencyKey','concurrent-exception-first');
  v_second_payload:=jsonb_build_object('exceptionId',v_exception,'expectedVersion',1,'pricingDate','2026-09-14','reason','Second management approval','idempotencyKey','concurrent-exception-second');
  select count(*) into v_events from private.stockflow_pricing_events;
  select count(*) into v_outbox from private.stockflow_outbox;
  select count(*) into v_snapshots from private.stockflow_billing_snapshots;

  perform public.dblink_connect('exception_a',format('host=127.0.0.1 port=%s dbname=%s user=%s',current_setting('port'),current_database(),current_user));
  perform public.dblink_connect('exception_b',format('host=127.0.0.1 port=%s dbname=%s user=%s',current_setting('port'),current_database(),current_user));
  perform public.dblink_exec('exception_b','set statement_timeout=''15s''');
  select pid into v_second_pid from public.dblink('exception_b','select pg_backend_pid()') as t(pid integer);
  perform public.dblink_exec('exception_a','begin');
  select value into v_first_result from public.dblink('exception_a',format(
    'select public.test_pricing_call(%L,%L,%L::jsonb)','concurrent-a@test.local','approve_price_exception',v_first_payload::text
  )) as t(value jsonb);
  if v_first_result ? 'errorCode' then raise exception 'First exception approval failed: %',v_first_result; end if;
  perform public.dblink_send_query('exception_b',format(
    'select public.test_pricing_call(%L,%L,%L::jsonb)','concurrent-b@test.local','approve_price_exception',v_second_payload::text
  ));
  for v_attempt in 1..500 loop
    exit when exists(select 1 from pg_locks where pid=v_second_pid and not granted);
    perform pg_sleep(0.01);
  end loop;
  if not exists(select 1 from pg_locks where pid=v_second_pid and not granted) then raise exception 'Second exception approval did not contend on the exception lock'; end if;
  perform public.dblink_exec('exception_a','commit');
  select value into v_second_result from public.dblink_get_result('exception_b') as t(value jsonb);
  perform * from public.dblink_get_result('exception_b') as t(value jsonb);
  perform public.dblink_disconnect('exception_a'); perform public.dblink_disconnect('exception_b');

  if v_second_result->>'errorCode' is distinct from '40001' then raise exception 'Stale concurrent exception approval was not rejected: %',v_second_result; end if;
  if public.test_pricing_call('concurrent-a@test.local','approve_price_exception',v_first_payload) is distinct from v_first_result then raise exception 'Winning exception approval replay changed'; end if;
  if not exists(select 1 from private.stockflow_price_exceptions where id=v_exception and state='approved' and version=2 and decided_by_email='concurrent-a@test.local')
    or not exists(select 1 from private.stockflow_order_pricing_decisions where order_line_id=v_line and state='approved' and approved_by_email='concurrent-a@test.local')
    or not exists(select 1 from private.stockflow_orders where id=v_order and pricing_state='approved' and pricing_snapshot_id is not null)
  then raise exception 'Winning exception approval did not persist its complete state'; end if;
  if (select count(*) from private.stockflow_pricing_events)<>v_events+1
    or (select count(*) from private.stockflow_outbox)<>v_outbox+1
    or (select count(*) from private.stockflow_billing_snapshots)<>v_snapshots+1
    or exists(select 1 from private.stockflow_command_results where idempotency_key='concurrent-exception-second')
  then raise exception 'Concurrent exception approval left duplicate or partial state'; end if;
end $exception_approval_race$;

create function public.test_fail_second_price_audit() returns trigger language plpgsql as $$
begin
  if new.request_id='bulk-rollback-key-123' and exists(select 1 from private.stockflow_pricing_events where request_id=new.request_id) then raise exception 'Injected second-row audit failure'; end if;
  return new;
end $$;
create trigger test_fail_second_price_audit before insert on private.stockflow_pricing_events for each row execute function public.test_fail_second_price_audit();
do $rollback$
declare payload jsonb; result jsonb; decisions integer; events integer; outbox integer;
begin
  payload:=jsonb_build_object('tallyKey','CONCURRENT-4','choice','recommended','pricingDate','2026-09-14','reason','Atomic bulk approval','idempotencyKey','bulk-rollback-key-123','previewHash',private.stockflow_product_price_impact('CONCURRENT-4','2026-09-14')->>'previewHash');
  select count(*) into decisions from private.stockflow_price_book_decisions;
  select count(*) into events from private.stockflow_pricing_events;
  select count(*) into outbox from private.stockflow_outbox;
  result:=public.test_pricing_call('concurrent-a@test.local','apply_product_price_impact',payload);
  if result->>'errorCode' is distinct from 'P0001' then raise exception 'Failure injection did not execute'; end if;
  if (select count(*) from private.stockflow_price_book_decisions)<>decisions or (select count(*) from private.stockflow_pricing_events)<>events or (select count(*) from private.stockflow_outbox)<>outbox
    or exists(select 1 from private.stockflow_command_results where idempotency_key='bulk-rollback-key-123') then raise exception 'Bulk approval partially persisted'; end if;
end $rollback$;
drop trigger test_fail_second_price_audit on private.stockflow_pricing_events;
drop function public.test_fail_second_price_audit();
drop function public.test_pricing_call(text,text,jsonb);
