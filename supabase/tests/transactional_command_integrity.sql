-- Run against a migrated non-production database. This test is self-contained and rolls back.
begin;

update private.stockflow_gateway_config
set secret_sha256=encode(extensions.digest('stockflow-integration-test','sha256'),'hex')
where name='orders';

insert into public.stockflow_members(email,role,status,updated_at)
values('integration-test@stockflow.local','administrator','active',now())
on conflict(email) do update set role='administrator',status='active',updated_at=now();

do $test$
declare
  v_customer_id uuid;
  v_order_id uuid;
  v_first jsonb;
  v_replay jsonb;
  v_event_count bigint;
  v_metadata jsonb;
begin
  insert into private.stockflow_customers(name,created_by_email)
  values('Transactional Test Laboratory','integration-test@stockflow.local')
  returning id into v_customer_id;

  insert into private.stockflow_orders(
    customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email
  ) values(
    v_customer_id,'Transactional Test Laboratory','phone','awaiting_confirmation',
    'fixture-order-123456','integration-test@stockflow.local','integration-test@stockflow.local'
  ) returning id into v_order_id;

  insert into private.stockflow_order_lines(
    order_id,tally_item_key,item_name,base_unit,quantity,snapshot_closing
  ) values(v_order_id,'TEST-ITEM-1','Integration Test Reagent','Nos',3,10);

  v_first := public.stockflow_edit_gateway(
    'stockflow-integration-test','integration-test@stockflow.local','edit_order',
    jsonb_build_object(
      'idempotencyKey','edit-command-123456', 'orderId',v_order_id,
      'expectedVersion',1, 'customerName','Transactional Test Laboratory Updated',
      'reason','Deterministic conflict test',
      'lines',jsonb_build_array(jsonb_build_object('tallyKey','TEST-ITEM-1','quantity',3))
    )
  );
  v_replay := public.stockflow_edit_gateway(
    'stockflow-integration-test','integration-test@stockflow.local','edit_order',
    jsonb_build_object(
      'idempotencyKey','edit-command-123456', 'orderId',v_order_id,
      'expectedVersion',1, 'customerName','Transactional Test Laboratory Updated',
      'reason','Deterministic conflict test',
      'lines',jsonb_build_array(jsonb_build_object('tallyKey','TEST-ITEM-1','quantity',3))
    )
  );
  if v_replay <> v_first then raise exception 'Duplicate command did not replay the original result'; end if;
  select count(*) into v_event_count from private.stockflow_order_events
  where order_id=v_order_id and event_type='order_edited';
  if v_event_count<>1 then raise exception 'Duplicate edit created % audit events',v_event_count; end if;

  begin
    perform public.stockflow_edit_gateway(
      'stockflow-integration-test','integration-test@stockflow.local','edit_order',
      jsonb_build_object(
        'idempotencyKey','stale-command-12345', 'orderId',v_order_id,
        'expectedVersion',1, 'customerName','Stale Writer Must Lose',
        'reason','Stale conflict test',
        'lines',jsonb_build_array(jsonb_build_object('tallyKey','TEST-ITEM-1','quantity',3))
      )
    );
    raise exception 'Stale writer unexpectedly overwrote the order';
  exception when serialization_failure then null;
  end;
  if exists(select 1 from private.stockflow_command_results
    where actor_email='integration-test@stockflow.local' and idempotency_key='stale-command-12345') then
    raise exception 'Failed stale command left a completed command record';
  end if;

  perform public.stockflow_fulfilment_gateway(
    'stockflow-integration-test','integration-test@stockflow.local','save_fulfilment',
    jsonb_build_object(
      'idempotencyKey','fulfil-command-1234', 'orderId',v_order_id, 'expectedVersion',2,
      'deliveryAddress','Test Delivery Address', 'expectedDeliveryDate','2026-09-30',
      'courierName','Test Courier', 'trackingNumber','TEST-TRACK-1',
      'lines',jsonb_build_array(jsonb_build_object(
        'tallyKey','TEST-ITEM-1','fulfilledQuantity',2,'batchNumber','LOT-TEST-1','expiryDate','2027-12-31'
      ))
    )
  );

  select metadata into v_metadata from private.stockflow_order_events
  where order_id=v_order_id and event_type='fulfilment_updated'
  order by id desc limit 1;
  if v_metadata->'before'->>'deliveryAddress' is not null
     or v_metadata->'after'->>'deliveryAddress'<>'Test Delivery Address'
     or v_metadata->'after'->'lines'->0->>'batchNumber'<>'LOT-TEST-1'
     or v_metadata->>'requestId'<>'fulfil-command-1234' then
    raise exception 'Fulfilment audit before/after evidence is incomplete';
  end if;
end
$test$;

rollback;
