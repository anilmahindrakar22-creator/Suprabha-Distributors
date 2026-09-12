-- Run against a migrated non-production database. This test is self-contained and rolls back.
begin;

update private.stockflow_gateway_config
set secret_sha256=encode(extensions.digest('stockflow-create-confirm-test','sha256'),'hex')
where name='orders';

insert into public.stockflow_members(email,role,status,updated_at)
values('create-confirm-test@stockflow.local','administrator','active',now())
on conflict(email) do update set role='administrator',status='active',updated_at=now();

insert into public.stockflow_snapshots(id,company,fetched_at,payload)
values(
  'suprabha','SUPRABHA TEST',now()::text,
  jsonb_build_object('company','SUPRABHA TEST','fetchedAt',now()::text,'catalog',jsonb_build_array(jsonb_build_object(
    'tallyKey','CREATE-CONFIRM-ITEM',
    'item','Create Confirm Test Reagent',
    'group','Integration tests',
    'baseUnit','Nos',
    'closing',10,
    'active',true
  )))
)
on conflict(id) do update set
  company=excluded.company,
  fetched_at=excluded.fetched_at,
  payload=excluded.payload,
  updated_at=now();

do $test$
declare
  v_created jsonb;
  v_confirmed jsonb;
  v_order_id uuid;
  v_status text;
  v_version integer;
  v_event_status text;
begin
  v_created := public.stockflow_order_gateway(
    'stockflow-create-confirm-test','create-confirm-test@stockflow.local','create_order',
    jsonb_build_object(
      'idempotencyKey','create-confirm-order-0001',
      'customerName','Create Confirm Test Laboratory',
      'source','phone',
      'lines',jsonb_build_array(jsonb_build_object('tallyKey','CREATE-CONFIRM-ITEM','quantity',1))
    )
  );

  v_order_id := (v_created->>'orderId')::uuid;
  select status,version into v_status,v_version
  from private.stockflow_orders where id=v_order_id;

  if v_created->>'status'<>v_status or (v_created->>'version')::integer<>v_version then
    raise exception 'Create response does not match persisted order state';
  end if;

  select to_status into v_event_status
  from private.stockflow_order_events
  where order_id=v_order_id and event_type='order_created';
  if v_event_status<>v_status then
    raise exception 'Creation audit does not match persisted order state';
  end if;

  v_confirmed := public.stockflow_order_gateway(
    'stockflow-create-confirm-test','create-confirm-test@stockflow.local','transition_order',
    jsonb_build_object(
      'idempotencyKey','confirm-created-order-0001',
      'orderId',v_order_id,
      'expectedVersion',v_version,
      'toStatus','confirmed'
    )
  );
  if v_confirmed->>'status'<>'confirmed' or (v_confirmed->>'version')::integer<>v_version+1 then
    raise exception 'Creator administrator could not confirm the newly created order';
  end if;
end
$test$;

rollback;
