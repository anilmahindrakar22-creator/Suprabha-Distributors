begin;
insert into public.stockflow_members(email,role,roles,status) values
  ('requirements@test.local','sales',array['sales'],'active'),
  ('requirements-admin@test.local','administrator',array['administrator'],'active'),
  ('requirements-billing@test.local','billing',array['billing'],'active');
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('requirements-key','sha256'),'hex') where name='orders';
update private.stockflow_pricing_policies set active=false where active;
insert into private.stockflow_pricing_policies(policy_version,minimum_margin_percent,target_margin_percent,
  override_approval_percent,rounding_increment,rounding_rule_version,effective_from,created_by_email)
values('requirements-test',25,30,5,1,'requirements-rounding',(now() at time zone 'Asia/Kolkata')::date-90,'test');

create function pg_temp.demand_reset_requests()
returns void language plpgsql as $$
begin
  -- test isolation: one transaction shares now(), so the per-minute limit would count every fixture command
  delete from private.stockflow_request_log
    where actor_email in ('requirements@test.local','requirements-admin@test.local','requirements-billing@test.local');
end $$;

create function pg_temp.demand_create(p_customer uuid,p_name text,p_lines jsonb,
  p_status text default 'confirmed',p_priority text default 'normal')
returns uuid language plpgsql as $$
declare result jsonb; o uuid;
begin
  perform pg_temp.demand_reset_requests();
  result:=public.stockflow_order_gateway('requirements-key','requirements-admin@test.local','create_order',
    jsonb_build_object('customerId',p_customer,'customerName','Demand test','source','phone',
      'idempotencyKey','requirements-create-'||p_name,'lines',p_lines));
  o:=(result->>'orderId')::uuid;
  if o is null or result->>'status' is distinct from 'awaiting_confirmation'
    or (select count(*) from private.stockflow_order_lines where order_id=o)<>jsonb_array_length(p_lines) then
    raise exception 'Demand create failed: %',result;
  end if;
  if p_priority<>'normal' then
    result:=public.stockflow_priority_gateway('requirements-key','requirements-admin@test.local','set_order_priority',
      jsonb_build_object('orderId',o,'expectedVersion',(select version from private.stockflow_orders where id=o),
        'priority',p_priority,'idempotencyKey','requirements-priority-'||o));
    if result->>'priority' is distinct from p_priority then raise exception 'Demand priority failed: %',result; end if;
  end if;
  if p_status<>'awaiting_confirmation' then
    result:=public.stockflow_order_gateway('requirements-key','requirements-admin@test.local','transition_order',
      jsonb_build_object('orderId',o,'expectedVersion',(select version from private.stockflow_orders where id=o),
        'toStatus',p_status,'reason','Demand fixture cancellation','idempotencyKey','requirements-transition-'||o||'-'||p_status));
    if result->>'status' is distinct from p_status
      or (select status from private.stockflow_orders where id=o) is distinct from p_status then
      raise exception 'Demand transition failed: %',result;
    end if;
  end if;
  return o;
end $$;

create function pg_temp.demand_deliver(p_order uuid)
returns void language plpgsql as $$
declare result jsonb; next_status text;
begin
  -- demand_create has already confirmed this order through the real gateway.
  foreach next_status in array array['packed','awaiting_tally_billing','billed_in_tally','ready_for_dispatch'] loop
    result:=public.stockflow_order_gateway('requirements-key',
      case when next_status='billed_in_tally' then 'requirements-billing@test.local' else 'requirements-admin@test.local' end,
      'transition_order',jsonb_build_object('orderId',p_order,
        'expectedVersion',(select version from private.stockflow_orders where id=p_order),
        'toStatus',next_status,'tallyInvoiceNumber',case when next_status='billed_in_tally' then 'SD/DEMAND/DELIVERED' else null end,
        'idempotencyKey','requirements-transition-'||p_order||'-'||next_status));
    if result->>'status' is distinct from next_status
      or (select status from private.stockflow_orders where id=p_order) is distinct from next_status then
      raise exception 'Demand delivery transition failed: %',result;
    end if;
  end loop;
  result:=public.stockflow_delivery_gateway('requirements-key','requirements-admin@test.local','save_dispatch',
    jsonb_build_object('orderId',p_order,'expectedVersion',(select version from private.stockflow_orders where id=p_order),
      'idempotencyKey','requirements-dispatch-delivered','dispatchDate',(now() at time zone 'Asia/Kolkata')::date-1,
      'courierName','Local delivery','trackingNumber','Hand delivery'));
  if result->>'ok' is distinct from 'true' or result->>'status' is distinct from 'dispatched'
    or (select status from private.stockflow_orders where id=p_order) is distinct from 'dispatched' then
    raise exception 'Demand dispatch failed: %',result;
  end if;
  result:=public.stockflow_delivery_gateway('requirements-key','requirements-admin@test.local','confirm_delivery',
    jsonb_build_object('orderId',p_order,'expectedVersion',(select version from private.stockflow_orders where id=p_order),
      'idempotencyKey','requirements-confirm-delivered','deliveredAt',now(),'receivedBy','Demand receiver'));
  if result->>'ok' is distinct from 'true' or result->>'status' is distinct from 'delivered'
    or (select status from private.stockflow_orders where id=p_order) is distinct from 'delivered' then
    raise exception 'Demand delivery failed: %',result;
  end if;
end $$;

do $test$
declare result jsonb; row_a jsonb; row_b jsonb; row_c jsonb; before_orders jsonb; initial_total integer;
  customer uuid; high_id uuid; urgent_id uuid; fixture_order uuid; item text; n integer; fixture_lines jsonb; entry_catalog jsonb;
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  insert into private.stockflow_customers(name,tally_key,created_by_email)
    values('Demand test','requirements-customer','test') returning id into customer;
  for item in select 'DEMAND-PAGE-'||i from generate_series(1,30) i
    union all select unnest(array['DEMAND-A','DEMAND-B','DEMAND-C','DEMAND-FULL']) loop
    insert into private.stockflow_products(tally_item_key,name,base_unit) values(item,item,'Nos');
    insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
      values(item,3465,'purchase_price',today-20,item||'-cost',item||'-cost','1');
    insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version)
      values(customer,item,6000,today-10,item||'-sale',item||'-sale','1');
  end loop;
  select jsonb_agg(jsonb_build_object('tallyKey',tally_item_key,'item',name,'baseUnit',base_unit,
    'group','Demand tests','closing',0,'active',true)) into entry_catalog
    from private.stockflow_products where tally_item_key like 'DEMAND-%';
  insert into public.stockflow_snapshots(id,company,fetched_at,payload)
    values('suprabha','TEST',now()::text,jsonb_build_object('catalog',entry_catalog))
    on conflict(id) do update set payload=excluded.payload;
  high_id:=pg_temp.demand_create(customer,'high','[{"tallyKey":"DEMAND-A","quantity":10}]','confirmed','high');
  fixture_order:=pg_temp.demand_create(customer,'normal','[{"tallyKey":"DEMAND-A","quantity":5}]');
  fixture_order:=pg_temp.demand_create(customer,'awaiting','[{"tallyKey":"DEMAND-A","quantity":100}]','awaiting_confirmation');
  fixture_order:=pg_temp.demand_create(customer,'cancelled','[{"tallyKey":"DEMAND-A","quantity":100}]','cancelled');
  -- Both closed statuses must be excluded despite positive remaining demand.
  fixture_order:=pg_temp.demand_create(customer,'delivered','[{"tallyKey":"DEMAND-A","quantity":100}]');
  perform pg_temp.demand_deliver(fixture_order);
  urgent_id:=pg_temp.demand_create(customer,'urgent',
    '[{"tallyKey":"DEMAND-B","quantity":3},{"tallyKey":"DEMAND-C","quantity":2},{"tallyKey":"DEMAND-FULL","quantity":1}]',
    'confirmed','urgent');
  result:=public.stockflow_fulfilment_gateway('requirements-key','requirements-admin@test.local','save_fulfilment',
    jsonb_build_object('orderId',high_id,'expectedVersion',(select version from private.stockflow_orders where id=high_id),
      'idempotencyKey','requirements-fulfil-high','deliveryAddress','Demand test address',
      'lines','[{"tallyKey":"DEMAND-A","fulfilledQuantity":2}]'::jsonb));
  if result->>'ok' is distinct from 'true' then raise exception 'Demand fulfilment failed: %',result; end if;
  result:=public.stockflow_fulfilment_gateway('requirements-key','requirements-admin@test.local','save_fulfilment',
    jsonb_build_object('orderId',urgent_id,'expectedVersion',(select version from private.stockflow_orders where id=urgent_id),
      'idempotencyKey','requirements-fulfil-full','deliveryAddress','Demand test address',
      'lines','[{"tallyKey":"DEMAND-FULL","fulfilledQuantity":1}]'::jsonb));
  if result->>'ok' is distinct from 'true' then raise exception 'Demand fulfilment failed: %',result; end if;
  -- Reporting evidence deliberately omits B and has negative C stock. The
  -- entry catalog above is external input, not fabricated order state.
  update public.stockflow_snapshots set payload='{"catalog":[{"tallyKey":"DEMAND-A","item":"Demand A","closing":4},{"tallyKey":"DEMAND-C","item":"Demand C","closing":-4}],"rows":[],"groups":[],"fetchedAt":"2026-10-01T00:00:00Z"}'::jsonb where id='suprabha';
  select jsonb_agg(to_jsonb(o) order by id) into before_orders from private.stockflow_orders o;
  result:=public.stockflow_requirements_gateway('requirements-key','requirements@test.local','get_requirements','{"page":1}');
  initial_total:=(result->'pagination'->>'total')::integer;
  select value into row_a from jsonb_array_elements(result->'rows') where value->>'tallyKey'='DEMAND-A';
  select value into row_b from jsonb_array_elements(result->'rows') where value->>'tallyKey'='DEMAND-B';
  select value into row_c from jsonb_array_elements(result->'rows') where value->>'tallyKey'='DEMAND-C';
  if row_a->>'openDemand' is distinct from '13.000' or (row_a->>'shortage')::numeric<>9 or (row_a->>'affectedOrders')::integer<>2 or row_a->>'priority'<>'high' then raise exception 'Demand aggregation wrong: %',row_a; end if;
  if row_b is null or row_b->'currentStock'<>'null'::jsonb or row_b->'shortage'<>'null'::jsonb then raise exception 'Unknown stock fabricated: %',row_b; end if;
  if (row_c->>'shortage')::numeric<>2 then raise exception 'Negative stock must not imply availability'; end if;
  if exists(select 1 from jsonb_array_elements(result->'rows') where value->>'tallyKey'='DEMAND-FULL') then raise exception 'Fulfilled demand included'; end if;
  if before_orders is distinct from (select jsonb_agg(to_jsonb(o) order by id) from private.stockflow_orders o) then raise exception 'Projection mutated orders'; end if;
  if has_function_privilege('authenticated','public.stockflow_requirements_gateway(text,text,text,jsonb)','EXECUTE') then raise exception 'Direct browser execution granted'; end if;
  update public.stockflow_snapshots set payload=payload||jsonb_build_object('catalog',entry_catalog) where id='suprabha';
  select jsonb_agg(jsonb_build_object('tallyKey','DEMAND-PAGE-'||i,'quantity',1))
    into fixture_lines from generate_series(1,30) i;
  fixture_order:=pg_temp.demand_create(customer,'requirement-page',fixture_lines,'confirmed','high');
  update public.stockflow_snapshots set payload=payload||'{"catalog":[{"tallyKey":"DEMAND-A","closing":4},{"tallyKey":"DEMAND-C","closing":-4}]}'::jsonb where id='suprabha';
  result:=public.stockflow_requirements_gateway('requirements-key','requirements@test.local','get_requirements','{"page":2}');
  if (result->'pagination'->>'total')::integer<>initial_total+30 or (result->'pagination'->>'pageCount')::integer<>2 or jsonb_array_length(result->'rows')<>initial_total+30-25 then raise exception 'Whole-demand pagination incorrect: %',result->'pagination'; end if;
  begin
    perform public.stockflow_requirements_gateway('requirements-key','not-member@test.local','get_requirements'); raise exception 'Nonmember allowed';
  exception when insufficient_privilege then null; end;
  update public.stockflow_snapshots set payload=payload||'{"catalog":[{"tallyKey":"DEMAND-A","closing":20}]}'::jsonb where id='suprabha';
  result:=public.stockflow_requirements_gateway('requirements-key','requirements@test.local','get_requirements');
  select value into row_a from jsonb_array_elements(result->'rows') where value->>'tallyKey'='DEMAND-A';
  if (row_a->>'shortage')::numeric<>0 then raise exception 'Stock arrival did not rebuild shortage'; end if;
  update public.stockflow_snapshots set payload=payload||'{"sourceFetchedAtIso":{"stock":"2026-10-01T12:00:00Z","catalog":"2026-10-01T08:00:00Z"}}'::jsonb where id='suprabha';
  result:=public.stockflow_requirements_gateway('requirements-key','requirements@test.local','get_requirements');
  if result->>'fetchedAt'<>'2026-10-01T08:00:00Z' then raise exception 'Upload date hid older catalog stock'; end if;
  update public.stockflow_snapshots set payload=payload||'{"catalog":[{"tallyKey":"DEMAND-A","closing":20},{"tallyKey":"DEMAND-A","closing":30},{"tallyKey":"DEMAND-B","closing":"invalid"}]}'::jsonb where id='suprabha';
  result:=public.stockflow_requirements_gateway('requirements-key','requirements@test.local','get_requirements');
  select value into row_a from jsonb_array_elements(result->'rows') where value->>'tallyKey'='DEMAND-A';
  select value into row_b from jsonb_array_elements(result->'rows') where value->>'tallyKey'='DEMAND-B';
  if row_a->'currentStock' is distinct from 'null'::jsonb or row_a->'shortage' is distinct from 'null'::jsonb then raise exception 'Duplicate stock evidence fabricated availability'; end if;
  if row_b->'currentStock' is distinct from 'null'::jsonb or row_b->'shortage' is distinct from 'null'::jsonb then raise exception 'Malformed stock evidence fabricated availability'; end if;
  result:=public.stockflow_requirement_orders_gateway('requirements-key','requirements@test.local','get_requirement_orders','{"itemKey":"DEMAND-A"}');
  if (result->'pagination'->>'total')::integer<>2 or jsonb_array_length(result->'orders')<>2 then raise exception 'Waiting orders include unconfirmed/closed demand'; end if;
  if result->'orders'->0->>'orderId' is distinct from high_id::text or (result->'orders'->0->>'remainingQuantity')::numeric<>8 then raise exception 'Waiting quantities/priority wrong'; end if;
  if exists(select 1 from jsonb_array_elements(result->'orders') r, jsonb_object_keys(r) k where k not in ('orderId','orderNumber','customerName','status','remainingQuantity','priority','createdAt')) then raise exception 'Waiting order response leaked extra fields'; end if;
  if has_function_privilege('authenticated','public.stockflow_requirement_orders_gateway(text,text,text,jsonb)','EXECUTE') then raise exception 'Waiting order direct browser execution granted'; end if;
  begin
    perform public.stockflow_requirement_orders_gateway('wrong-key','requirements@test.local','get_requirement_orders','{"itemKey":"DEMAND-A"}'); raise exception 'Wrong key allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.stockflow_requirement_orders_gateway('requirements-key','not-member@test.local','get_requirement_orders','{"itemKey":"DEMAND-A"}'); raise exception 'Nonmember waiting read allowed';
  exception when insufficient_privilege then null; end;
  -- Creation needs valid numeric entry evidence; restore malformed reporting
  -- evidence afterwards so the subsequent reader assertions keep their inputs.
  row_a:=(select payload from public.stockflow_snapshots where id='suprabha');
  update public.stockflow_snapshots set payload=payload||jsonb_build_object('catalog',entry_catalog) where id='suprabha';
  for n in 1..21 loop
    fixture_order:=pg_temp.demand_create(customer,'waiting-page-'||n,'[{"tallyKey":"DEMAND-A","quantity":1}]');
  end loop;
  update public.stockflow_snapshots set payload=row_a where id='suprabha';
  result:=public.stockflow_requirement_orders_gateway('requirements-key','requirements@test.local','get_requirement_orders','{"itemKey":"DEMAND-A","page":2}');
  if (result->'pagination'->>'total')::integer<>23 or (result->'pagination'->>'pageCount')::integer<>2 or jsonb_array_length(result->'orders')<>3 then raise exception 'Waiting pagination incorrect'; end if;
  result:=public.stockflow_requirement_orders_gateway('requirements-key','requirements@test.local','get_requirement_orders','{"itemKey":"DEMAND"}');
  if (result->'pagination'->>'total')::integer<>0 then raise exception 'Item key is not exact'; end if;
  update public.stockflow_members set status='suspended' where email='requirements@test.local';
  begin
    perform public.stockflow_requirement_orders_gateway('requirements-key','requirements@test.local','get_requirement_orders','{"itemKey":"DEMAND-A"}'); raise exception 'Suspended waiting read allowed';
  exception when insufficient_privilege then null; end;
end $test$;
rollback;
