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
