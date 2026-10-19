begin;
do $test$
declare
  result jsonb; first_page jsonb; second_page jsonb; alert jsonb; catalog jsonb;
  row_data jsonb; previous_rank integer := -1; state_rank integer;
  events_before bigint; outbox_before bigint; lines_before bigint;
  urgent_id uuid := '31000000-0000-4000-8000-000000000001';
  oldest_id uuid := '31000000-0000-4000-8000-000000000002';
  normal_id uuid := '31000000-0000-4000-8000-000000000003';
begin
  -- Isolate demand from any harness seed; every fixture change rolls back.
  update private.stockflow_orders set archived_at=now() where archived_at is null;
  insert into public.stockflow_members(email,role,status) values('decision@test.local','warehouse','active');
  update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('decision-key','sha256'),'hex') where name='orders';
  insert into private.stockflow_orders(id,customer_name,status,priority,created_at,created_by_email,updated_by_email,idempotency_key)
  values
    (urgent_id,'Decision urgent','confirmed','urgent',now(),'test','test','decision-urgent'),
    (oldest_id,'Decision oldest','confirmed','normal',now()-interval '3 days','test','test','decision-oldest'),
    (normal_id,'Decision normal','confirmed','normal',now()-interval '1 day','test','test','decision-normal');
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity,fulfilled_quantity)
  values (urgent_id,'DECISION-X','Coverage X',4,1),
    (oldest_id,'DECISION-X','Coverage X',3,0),
    (normal_id,'DECISION-X','Coverage X',5,1),
    (normal_id,'DECISION-FULFILLED','Fulfilled X',9,9);
  -- Covered items have urgent priority, to prove state takes precedence.
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity)
    select case when n>=30 then urgent_id else oldest_id end,'DECISION-'||lpad(n::text,2,'0'),'Decision item '||n,5
    from generate_series(1,32) n;
  insert into private.stockflow_orders(id,customer_name,status,priority,created_by_email,updated_by_email,idempotency_key)
  values ('31000000-0000-4000-8000-000000000004','Excluded awaiting','awaiting_confirmation','urgent','test','test','decision-draft'),
    ('31000000-0000-4000-8000-000000000005','Excluded delivered','delivered','urgent','test','test','decision-delivered');
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity)
    select id,'DECISION-X','Excluded X',100 from private.stockflow_orders
    where id in ('31000000-0000-4000-8000-000000000004','31000000-0000-4000-8000-000000000005');

  select jsonb_agg(jsonb_build_object('tallyKey','DECISION-'||lpad(n::text,2,'0'),'closing',
    case when n>=30 then '5' when n in (28,29) then 'bad' else '0' end)) into catalog from generate_series(1,32) n;
  catalog:=catalog||jsonb_build_array(jsonb_build_object('tallyKey','DECISION-X','closing','0'));
  insert into public.stockflow_snapshots(id,company,fetched_at,payload)
    values('suprabha','DECISION TEST',now()::text,jsonb_build_object('catalogVersion','2026-10-01T01:00:00Z','catalog',catalog))
    on conflict(id) do update set company=excluded.company,payload=excluded.payload;
  -- Generate real notices through the existing snapshot trigger.
  select jsonb_agg(case item->>'tallyKey'
    when 'DECISION-X' then item||'{"closing":"7"}'::jsonb
    when 'DECISION-27' then item||'{"closing":"2"}'::jsonb else item end)
    into catalog from jsonb_array_elements(catalog) item;
  update public.stockflow_snapshots set payload=jsonb_build_object('catalogVersion','2026-10-01T02:00:00Z','catalog',catalog) where id='suprabha';
  -- Latest stock differs from the reported increase, without a new notice.
  select jsonb_agg(case when item->>'tallyKey'='DECISION-27' then item||'{"closing":"bad"}'::jsonb else item end)
    into catalog from jsonb_array_elements(catalog) item;
  update public.stockflow_snapshots set payload=payload||jsonb_build_object('catalog',catalog) where id='suprabha';
  select count(*) into events_before from private.stockflow_order_events;
  select count(*) into outbox_before from private.stockflow_outbox;
  select count(*) into lines_before from private.stockflow_order_lines;

  first_page:=public.stockflow_requirements_gateway('decision-key','decision@test.local','get_requirements','{"page":1}');
  second_page:=public.stockflow_requirements_gateway('decision-key','decision@test.local','get_requirements','{"page":2}');
  if first_page->'counts' is distinct from '{"shortageItems":27,"unknownItems":3,"coveredItems":3}'::jsonb
    or second_page->'counts' is distinct from first_page->'counts' then raise exception 'Counts were page-local or incorrect: %, %',first_page,second_page; end if;
  if jsonb_array_length(first_page->'rows')<>25 or jsonb_array_length(second_page->'rows')<>8
    or (second_page->'pagination'->>'total')::integer<>33 or (second_page->'pagination'->>'pageCount')::integer<>2 then raise exception 'Wrong requirement pagination'; end if;
  if first_page->'rows'->0->>'tallyKey'<>'DECISION-X' then raise exception 'Existing priority ordering lost'; end if;
  if exists (select 1 from jsonb_array_elements((first_page->'rows')||(second_page->'rows')) r where r->>'tallyKey'='DECISION-FULFILLED') then raise exception 'Fully fulfilled line created a requirement'; end if;
  if (select count(distinct r->>'tallyKey') from jsonb_array_elements((first_page->'rows')||(second_page->'rows')) r)<>33 then raise exception 'Paging duplicated or omitted items'; end if;
  for row_data in select value from jsonb_array_elements((first_page->'rows')||(second_page->'rows')) loop
    state_rank:=case row_data->>'state' when 'shortage' then 0 when 'unknown' then 1 when 'covered' then 2 else -1 end;
    if state_rank<previous_rank or state_rank<0 then raise exception 'State ordering failed across pages: %',row_data; end if;
    previous_rank:=state_rank;
  end loop;
  result:=public.stockflow_stock_alert_gateway('decision-key','decision@test.local','get_stock_alerts');
  if result->>'windowDays'<>'7' or result->'pagination'->>'total'<>'2' then raise exception 'Wrong alert window or total: %',result; end if;
  select value into alert from jsonb_array_elements(result->'alerts') where value->>'tallyKey'='DECISION-X';
  if alert is null or (alert->>'currentStock')::numeric is distinct from 7::numeric
    or (alert->>'coveredOrders')::integer is distinct from 2 or (alert->>'waitingOrders')::integer is distinct from 3
    or (alert->>'waitingQuantity')::numeric is distinct from 10::numeric then raise exception 'Priority prefix coverage incorrect: %',alert; end if;
  select value into alert from jsonb_array_elements(result->'alerts') where value->>'tallyKey'='DECISION-27';
  if alert is null or alert->'currentStock' is distinct from 'null'::jsonb or alert->'coveredOrders' is distinct from 'null'::jsonb then raise exception 'Non-numeric stock fabricated coverage: %',alert; end if;

  -- At six units, ignoring priority or oldest-first ordering covers only one.
  -- This distinguishes the intended 3,3,4 prefix from either 3,4,3 order.
  select jsonb_agg(case when item->>'tallyKey'='DECISION-X' then item||'{"closing":"6"}'::jsonb else item end)
    into catalog from jsonb_array_elements(catalog) item;
  update public.stockflow_snapshots set payload=payload||jsonb_build_object('catalog',catalog) where id='suprabha';
  result:=public.stockflow_stock_alert_gateway('decision-key','decision@test.local','get_stock_alerts');
  select value into alert from jsonb_array_elements(result->'alerts') where value->>'tallyKey'='DECISION-X';
  if (alert->>'currentStock')::numeric is distinct from 6::numeric or (alert->>'coveredOrders')::integer is distinct from 2
    or (alert->>'stockAfter')::numeric is distinct from 7::numeric then raise exception 'Coverage used reported stock or wrong waiting order: %',alert; end if;

  if events_before<>(select count(*) from private.stockflow_order_events)
    or outbox_before<>(select count(*) from private.stockflow_outbox)
    or lines_before<>(select count(*) from private.stockflow_order_lines) then raise exception 'Reporting reads had side effects'; end if;
  -- Duplicate numeric entries are ambiguous even when they agree.
  select jsonb_agg(case when item->>'tallyKey'='DECISION-27' then item||'{"closing":"9"}'::jsonb else item end)
    into catalog from jsonb_array_elements(catalog) item;
  catalog:=catalog||'[{"tallyKey":"DECISION-27","closing":"9"}]'::jsonb;
  update public.stockflow_snapshots set payload=payload||jsonb_build_object('catalog',catalog) where id='suprabha';
  result:=public.stockflow_stock_alert_gateway('decision-key','decision@test.local','get_stock_alerts');
  select value into alert from jsonb_array_elements(result->'alerts') where value->>'tallyKey'='DECISION-27';
  if alert->'currentStock' is distinct from 'null'::jsonb or alert->'coveredOrders' is distinct from 'null'::jsonb then raise exception 'Ambiguous stock fabricated coverage'; end if;
  if events_before<>(select count(*) from private.stockflow_order_events)
    or outbox_before<>(select count(*) from private.stockflow_outbox)
    or lines_before<>(select count(*) from private.stockflow_order_lines) then raise exception 'Reporting changed fixture counts'; end if;
  begin
    perform public.stockflow_requirements_gateway('wrong','decision@test.local','get_requirements'); raise exception 'Bad requirements key permitted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.stockflow_stock_alert_gateway('wrong','decision@test.local','get_stock_alerts'); raise exception 'Bad alerts key permitted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.stockflow_requirements_gateway('decision-key','non-member@test.local','get_requirements'); raise exception 'Non-member requirements permitted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.stockflow_stock_alert_gateway('decision-key','non-member@test.local','get_stock_alerts'); raise exception 'Non-member alerts permitted';
  exception when insufficient_privilege then null; end;
  if has_function_privilege('authenticated','public.stockflow_requirements_gateway(text,text,text,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.stockflow_stock_alert_gateway(text,text,text,jsonb)','EXECUTE') then raise exception 'Browser RPC grant'; end if;
end $test$;
rollback;
