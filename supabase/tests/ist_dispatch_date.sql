-- Real gateway regression; all fixtures and commands roll back.
begin;
set local timezone = 'Pacific/Pago_Pago';

update private.stockflow_gateway_config
set secret_sha256=encode(extensions.digest('ist-dispatch-test-key','sha256'),'hex')
where name='orders';
insert into public.stockflow_members(email,role,status)
values('ist-dispatch@test.local','operations','active');
update public.stockflow_members set roles=array['operations'] where email='ist-dispatch@test.local';

do $test$
declare
  definition text;
  india_today date := (now() at time zone 'Asia/Kolkata')::date;
  customer_id uuid;
  order_id uuid;
  payload jsonb;
  result jsonb;
  rejection record;
begin
  definition := pg_get_functiondef('public.stockflow_delivery_gateway(text,text,text,jsonb)'::regprocedure);
  if position('Asia/Kolkata' in definition)=0
     or position('v_dispatch_date > current_date' in definition)>0 then
    raise exception 'Delivery gateway must validate dispatch dates in India time';
  end if;
  -- UTC-11 lags India by 16.5 hours. The dates can coincide during part of
  -- the day; the body assertion above guards the regression at every run time.
  if current_setting('TimeZone')<>'Pacific/Pago_Pago' or current_date>india_today then
    raise exception 'Unexpected dispatch test timezone';
  end if;

  -- Fixture shape follows transactional_command_integrity.sql.
  insert into private.stockflow_customers(name,created_by_email)
  values('IST Dispatch Laboratory','ist-dispatch@test.local') returning id into customer_id;
  insert into private.stockflow_orders(
    customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email
  ) values(
    customer_id,'IST Dispatch Laboratory','phone','ready_for_dispatch',
    'ist-dispatch-fixture','ist-dispatch@test.local','ist-dispatch@test.local'
  ) returning id into order_id;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,base_unit,quantity,snapshot_closing)
  values(order_id,'IST-DISPATCH-ITEM','IST Dispatch Reagent','Nos',1,10);

  payload := jsonb_build_object('orderId',order_id,'expectedVersion',1,
    'idempotencyKey','ist-dispatch-command','dispatchDate',india_today,
    'courierName','Local delivery','trackingNumber','Hand delivery');
  for rejection in
    select * from (values
      (jsonb_build_object('dispatchDate',india_today+1), 'Dispatch date must be today or earlier (India date)'),
      (jsonb_build_object('dispatchDate',null), 'Dispatch date must be today or earlier (India date)'),
      (jsonb_build_object('dispatchDate',india_today+1,'courierName','','trackingNumber',''), 'Dispatch date must be today or earlier (India date)'),
      (jsonb_build_object('courierName','','trackingNumber',''), 'Choose a transporter or Local delivery'),
      (jsonb_build_object('courierName','x'), 'Choose a transporter or Local delivery'),
      (jsonb_build_object('courierName',repeat('x',161)), 'Choose a transporter or Local delivery'),
      (jsonb_build_object('trackingNumber',''), 'Enter a tracking or LR number'),
      (jsonb_build_object('trackingNumber','x'), 'Enter a tracking or LR number'),
      (jsonb_build_object('trackingNumber',repeat('x',161)), 'Enter a tracking or LR number')
    ) as cases(overrides,expected_message)
  loop
    begin
      perform public.stockflow_delivery_gateway('ist-dispatch-test-key','ist-dispatch@test.local',
        'save_dispatch',payload||rejection.overrides);
      raise exception 'Invalid dispatch unexpectedly succeeded: %',rejection.overrides;
    exception when sqlstate '22023' then
      if sqlerrm is distinct from rejection.expected_message then
        raise exception 'Wrong dispatch validation message: % (expected %)',sqlerrm,rejection.expected_message;
      end if;
    end;
  end loop;

  result := public.stockflow_delivery_gateway('ist-dispatch-test-key','ist-dispatch@test.local',
    'save_dispatch',payload);
  if result->>'ok' is distinct from 'true' or result->>'status' is distinct from 'dispatched'
     or result->>'version' is distinct from '2' then
    raise exception 'India-today local dispatch failed: %',result;
  end if;
  if not exists(select 1 from private.stockflow_orders o where o.id=order_id
    and o.status='dispatched' and o.version=2 and o.dispatch_date=india_today
    and o.courier_name='Local delivery' and o.tracking_number='Hand delivery') then
    raise exception 'India-today dispatch was not persisted correctly';
  end if;
end $test$;
rollback;
