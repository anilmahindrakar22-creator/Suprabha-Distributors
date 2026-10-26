begin;
-- Distinct creation times inside one rollback transaction exercise oldest-first
-- ordering without rewriting saved orders. Restore the production default below.
alter table private.stockflow_orders alter column created_at set default clock_timestamp();
update private.stockflow_pricing_policies set active=false where active;
insert into private.stockflow_pricing_policies(policy_version,minimum_margin_percent,target_margin_percent,
  override_approval_percent,rounding_increment,rounding_rule_version,effective_from,created_by_email)
values('decision-test',25,30,5,1,'decision-rounding',(now() at time zone 'Asia/Kolkata')::date-90,'test');

create function pg_temp.decision_reset_requests()
returns void language plpgsql as $$
begin
  -- test isolation: one transaction shares now(), so the per-minute limit would count every fixture command
  delete from private.stockflow_request_log
    where actor_email in ('decision@test.local','decision-admin@test.local','decision-billing@test.local');
end $$;

create function pg_temp.decision_transition(p_order uuid,p_status text,p_invoice text default null)
returns void language plpgsql as $$
declare result jsonb;
begin
  result:=public.stockflow_order_gateway('decision-key',
    case when p_status='billed_in_tally' then 'decision-billing@test.local' else 'decision-admin@test.local' end,
    'transition_order',
    jsonb_build_object('orderId',p_order,'expectedVersion',(select version from private.stockflow_orders where id=p_order),
      'toStatus',p_status,'tallyInvoiceNumber',p_invoice,'reason','Decision fixture isolation',
      'idempotencyKey','decision-transition-'||p_order||'-'||p_status));
  if result->>'status' is distinct from p_status
    or (select status from private.stockflow_orders where id=p_order) is distinct from p_status then
    raise exception 'Decision transition failed: %',result;
  end if;
end $$;

create function pg_temp.decision_create(p_customer uuid,p_name text,p_lines jsonb,p_priority text default 'normal')
returns uuid language plpgsql as $$
declare result jsonb; o uuid;
begin
  perform pg_temp.decision_reset_requests();
  result:=public.stockflow_order_gateway('decision-key','decision-admin@test.local','create_order',
    jsonb_build_object('customerId',p_customer,'customerName',p_name,'source','phone',
      'idempotencyKey','decision-create-'||p_name,'lines',p_lines));
  o:=(result->>'orderId')::uuid;
  if o is null or result->>'status' is distinct from 'awaiting_confirmation'
    or (select count(*) from private.stockflow_order_lines where order_id=o)<>jsonb_array_length(p_lines) then
    raise exception 'Decision create failed: %',result;
  end if;
  if p_priority<>'normal' then
    result:=public.stockflow_priority_gateway('decision-key','decision-admin@test.local','set_order_priority',
      jsonb_build_object('orderId',o,'expectedVersion',(select version from private.stockflow_orders where id=o),
        'priority',p_priority,'idempotencyKey','decision-priority-'||o));
    if result->>'priority' is distinct from p_priority then raise exception 'Decision priority failed: %',result; end if;
  end if;
  return o;
end $$;

do $test$
declare
  result jsonb; first_page jsonb; second_page jsonb; alert jsonb; catalog jsonb;
  row_data jsonb; previous_rank integer := -1; state_rank integer;
  events_before bigint; outbox_before bigint; lines_before bigint;
  urgent_id uuid; oldest_id uuid; normal_id uuid; excluded_id uuid; customer uuid;
  seed_item text; fixture_lines jsonb;
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  -- Setup isolation only: there is no archive gateway. Rolls back with the test.
  update private.stockflow_orders set archived_at=now() where archived_at is null;
  insert into public.stockflow_members(email,role,roles,status) values
    ('decision@test.local','warehouse',array['warehouse'],'active'),
    ('decision-admin@test.local','administrator',array['administrator'],'active'),
    ('decision-billing@test.local','billing',array['billing'],'active');
  update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('decision-key','sha256'),'hex') where name='orders';
  insert into private.stockflow_customers(name,tally_key,created_by_email)
    values('Decision customer','decision-customer','test') returning id into customer;
  for seed_item in select 'DECISION-'||lpad(n::text,2,'0') from generate_series(1,32) n
    union all select 'DECISION-X' union all select 'DECISION-FULFILLED' loop
    insert into private.stockflow_products(tally_item_key,name,base_unit) values(seed_item,seed_item,'Nos');
    insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
      values(seed_item,3465,'purchase_price',today-20,seed_item||'-cost',seed_item||'-cost','1');
    insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version)
      values(customer,seed_item,6000,today-10,seed_item||'-sale',seed_item||'-sale','1');
  end loop;
  insert into public.stockflow_snapshots(id,company,fetched_at,payload)
    values('suprabha','DECISION TEST',now()::text,jsonb_build_object('catalog',(
      select jsonb_agg(jsonb_build_object('tallyKey',tally_item_key,'item',name,'baseUnit',base_unit,
        'group','Decision tests','closing',0,'active',true)) from private.stockflow_products where tally_item_key like 'DECISION-%')))
    on conflict(id) do update set payload=excluded.payload;

  select jsonb_agg(jsonb_build_object('tallyKey','DECISION-'||lpad(n::text,2,'0'),'quantity',5))
    into fixture_lines from generate_series(1,29) n;
  oldest_id:=pg_temp.decision_create(customer,'Decision oldest',
    fixture_lines||jsonb_build_array(jsonb_build_object('tallyKey','DECISION-X','quantity',3)));
  perform pg_temp.decision_transition(oldest_id,'confirmed');
  normal_id:=pg_temp.decision_create(customer,'Decision normal',
    '[{"tallyKey":"DECISION-X","quantity":5},{"tallyKey":"DECISION-FULFILLED","quantity":9}]');
  perform pg_temp.decision_transition(normal_id,'confirmed');
  -- Covered items have urgent priority, to prove state takes precedence.
  select jsonb_agg(jsonb_build_object('tallyKey','DECISION-'||lpad(n::text,2,'0'),'quantity',5))
    into fixture_lines from generate_series(30,32) n;
  urgent_id:=pg_temp.decision_create(customer,'Decision urgent',
    fixture_lines||jsonb_build_array(jsonb_build_object('tallyKey','DECISION-X','quantity',4)),'urgent');
  perform pg_temp.decision_transition(urgent_id,'confirmed');
  if not ((select created_at from private.stockflow_orders where id=oldest_id)
    < (select created_at from private.stockflow_orders where id=normal_id)) then raise exception 'Oldest-first fixture has tied clocks'; end if;
  result:=public.stockflow_fulfilment_gateway('decision-key','decision-admin@test.local','save_fulfilment',
    jsonb_build_object('orderId',normal_id,'expectedVersion',(select version from private.stockflow_orders where id=normal_id),
      'idempotencyKey','decision-fulfil-normal','deliveryAddress','Decision test address',
      'lines','[{"tallyKey":"DECISION-X","fulfilledQuantity":1},{"tallyKey":"DECISION-FULFILLED","fulfilledQuantity":9}]'::jsonb));
  if result->>'ok' is distinct from 'true' then raise exception 'Decision fulfilment failed: %',result; end if;
  result:=public.stockflow_fulfilment_gateway('decision-key','decision-admin@test.local','save_fulfilment',
    jsonb_build_object('orderId',urgent_id,'expectedVersion',(select version from private.stockflow_orders where id=urgent_id),
      'idempotencyKey','decision-fulfil-urgent','deliveryAddress','Decision test address',
      'lines','[{"tallyKey":"DECISION-X","fulfilledQuantity":1}]'::jsonb));
  if result->>'ok' is distinct from 'true' then raise exception 'Decision fulfilment failed: %',result; end if;
  excluded_id:=pg_temp.decision_create(customer,'Excluded awaiting','[{"tallyKey":"DECISION-X","quantity":100}]','urgent');
  -- Both closed statuses must be excluded despite positive remaining demand.
  excluded_id:=pg_temp.decision_create(customer,'Excluded cancelled','[{"tallyKey":"DECISION-X","quantity":100}]','urgent');
  perform pg_temp.decision_transition(excluded_id,'cancelled');
  excluded_id:=pg_temp.decision_create(customer,'Excluded delivered','[{"tallyKey":"DECISION-X","quantity":100}]','urgent');
  perform pg_temp.decision_transition(excluded_id,'confirmed');
  perform pg_temp.decision_transition(excluded_id,'packed');
  perform pg_temp.decision_transition(excluded_id,'awaiting_tally_billing');
  perform pg_temp.decision_transition(excluded_id,'billed_in_tally','SD/DECISION/DELIVERED');
  perform pg_temp.decision_transition(excluded_id,'ready_for_dispatch');
  result:=public.stockflow_delivery_gateway('decision-key','decision-admin@test.local','save_dispatch',
    jsonb_build_object('orderId',excluded_id,'expectedVersion',(select version from private.stockflow_orders where id=excluded_id),
      'idempotencyKey','decision-dispatch-delivered','dispatchDate',today-1,
      'courierName','Local delivery','trackingNumber','Hand delivery'));
  if result->>'ok' is distinct from 'true' or result->>'status' is distinct from 'dispatched'
    or (select status from private.stockflow_orders where id=excluded_id) is distinct from 'dispatched' then
    raise exception 'Decision dispatch failed: %',result;
  end if;
  result:=public.stockflow_delivery_gateway('decision-key','decision-admin@test.local','confirm_delivery',
    jsonb_build_object('orderId',excluded_id,'expectedVersion',(select version from private.stockflow_orders where id=excluded_id),
      'idempotencyKey','decision-confirm-delivered','deliveredAt',now(),'receivedBy','Decision receiver'));
  if result->>'ok' is distinct from 'true' or result->>'status' is distinct from 'delivered'
    or (select status from private.stockflow_orders where id=excluded_id) is distinct from 'delivered' then
    raise exception 'Decision delivery failed: %',result;
  end if;
  alter table private.stockflow_orders alter column created_at set default now();

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
