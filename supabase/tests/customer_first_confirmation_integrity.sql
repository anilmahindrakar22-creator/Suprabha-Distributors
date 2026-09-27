-- Run only against a migrated test database. Everything is rolled back.
begin;

update private.stockflow_gateway_config
set secret_sha256=encode(extensions.digest('customer-first-confirm-test','sha256'),'hex')
where name='orders';

insert into public.stockflow_members(email,role,status)
values ('customer-first-admin@test.local','administrator','active'),
       ('customer-first-sales@test.local','sales','active');

update private.stockflow_pricing_policies set active=false where active;
insert into private.stockflow_pricing_policies(
  policy_version,minimum_margin_percent,target_margin_percent,
  override_approval_percent,rounding_increment,rounding_rule_version,
  effective_from,created_by_email
) values ('customer-first-confirm-v1',20,30,5,5,'ceil-five-v1',current_date-1,'test');

create function pg_temp.fail_auto_price_event() returns trigger
language plpgsql as $$
begin
  if current_setting('stockflow.test_fail_auto_confirm',true)='on'
     and new.event_type='governed_order_price_auto_approved' then
    raise exception 'Injected automatic pricing audit failure';
  end if;
  return new;
end $$;
create trigger customer_first_injected_failure
before insert on private.stockflow_pricing_events
for each row execute function pg_temp.fail_auto_price_event();

do $test$
declare
  customer uuid;
  governed_order uuid;
  review_order uuid;
  base_order uuid;
  rollback_order uuid;
  no_policy_order uuid;
  governed_line uuid;
  response jsonb;
  snapshot_id uuid;
  order_state text;
  line_state text;
  snapshot_count integer;
begin
  insert into private.stockflow_customers(name,tally_key,created_by_email)
  values ('Customer First Confirmation','customer-first-confirm','test') returning id into customer;
  insert into private.stockflow_products(tally_item_key,name,base_unit)
  values ('FIRST-CONFIRM-GOVERNED','Governed reagent','Nos'),
         ('FIRST-CONFIRM-UNPRICED','Unpriced reagent','Nos');
  insert into private.stockflow_tally_purchase_costs(
    tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version
  ) values ('FIRST-CONFIRM-GOVERNED',50,'purchase_price',current_date-1,'C50','first-cost','1');
  insert into private.stockflow_customer_product_prices(
    customer_id,tally_item_key,price_amount,valid_from,status,source_type,
    reason,approved_by_email,approved_at,created_by_email
  ) values (
    customer,'FIRST-CONFIRM-GOVERNED',100,current_date-1,'approved','customer_contract',
    'Confirmed agreement','customer-first-admin@test.local',now(),'customer-first-admin@test.local'
  );
  response:=public.stockflow_pricing_gateway(
    'customer-first-confirm-test','customer-first-admin@test.local',
    'preview_customer_prices',jsonb_build_object('customerId',customer,
      'tallyKeys',jsonb_build_array('FIRST-CONFIRM-GOVERNED'))
  );
  if (response->'prices'->0->>'currentPrice')::numeric<>100 then
    raise exception 'Authorized entry preview did not show governed price';
  end if;
  begin
    perform public.stockflow_pricing_gateway(
      'customer-first-confirm-test','customer-first-sales@test.local',
      'preview_customer_prices',jsonb_build_object('customerId',customer,
        'tallyKeys',jsonb_build_array('FIRST-CONFIRM-GOVERNED'))
    );
    raise exception 'Sales role accessed restricted price preview';
  exception when insufficient_privilege then null; end;

  insert into private.stockflow_orders(
    customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email
  ) values (
    customer,'Customer First Confirmation','phone','awaiting_confirmation',
    'customer-first-governed-order','customer-first-admin@test.local','customer-first-admin@test.local'
  ) returning id into governed_order;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity)
  values (governed_order,'FIRST-CONFIRM-GOVERNED','Governed reagent',2)
  returning id into governed_line;

  response:=public.stockflow_order_gateway(
    'customer-first-confirm-test','customer-first-admin@test.local','transition_order',
    jsonb_build_object('idempotencyKey','customer-first-confirm-command',
      'orderId',governed_order,'expectedVersion',1,'toStatus','confirmed')
  );
  select pricing_state,pricing_snapshot_id into order_state,snapshot_id
  from private.stockflow_orders where id=governed_order;
  select pricing_state into line_state from private.stockflow_order_lines where id=governed_line;
  if response->>'pricingState'<>'approved' or order_state<>'approved'
     or line_state<>'approved' or snapshot_id is null then
    raise exception 'Confirmation did not atomically approve governed pricing: %',response;
  end if;
  if not exists (
    select 1 from private.stockflow_order_pricing_decisions
    where order_id=governed_order and order_line_id=governed_line
      and state='approved' and approved_rate=100 and source_type='approved_contract'
  ) then raise exception 'Governed decision/provenance missing'; end if;
  if not exists (
    select 1 from private.stockflow_billing_snapshots
    where id=snapshot_id and order_id=governed_order and invalidated_at is null
  ) then raise exception 'Immutable billing snapshot missing'; end if;
  if not exists (
    select 1 from private.stockflow_pricing_events
    where entity_type='billing_snapshot' and entity_id=snapshot_id
  ) or not exists (
    select 1 from private.stockflow_outbox
    where topic='order.pricing_approved' and aggregate_id=governed_order
  ) then raise exception 'Pricing audit or outbox missing'; end if;
  select count(*) into snapshot_count from private.stockflow_billing_snapshots
  where order_id=governed_order;
  response:=public.stockflow_order_gateway(
    'customer-first-confirm-test','customer-first-admin@test.local','transition_order',
    jsonb_build_object('idempotencyKey','customer-first-confirm-command',
      'orderId',governed_order,'expectedVersion',1,'toStatus','confirmed')
  );
  if (select count(*) from private.stockflow_billing_snapshots
      where order_id=governed_order)<>snapshot_count then
    raise exception 'Idempotent confirmation duplicated the snapshot';
  end if;

  insert into private.stockflow_orders(
    customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email
  ) values (
    customer,'Customer First Confirmation','phone','awaiting_confirmation',
    'customer-first-review-order','customer-first-admin@test.local','customer-first-admin@test.local'
  ) returning id into review_order;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity)
  values (review_order,'FIRST-CONFIRM-UNPRICED','Unpriced reagent',1);
  response:=public.stockflow_order_gateway(
    'customer-first-confirm-test','customer-first-admin@test.local','transition_order',
    jsonb_build_object('idempotencyKey','customer-first-review-command',
      'orderId',review_order,'expectedVersion',1,'toStatus','confirmed')
  );
  if response->>'pricingState'='approved' or exists (
    select 1 from private.stockflow_billing_snapshots where order_id=review_order
  ) then raise exception 'Missing evidence was silently approved'; end if;

  insert into private.stockflow_products(tally_item_key,name,base_unit)
  values ('FIRST-CONFIRM-BASE','Base-priced reagent','Nos');
  insert into private.stockflow_tally_purchase_costs(
    tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version
  ) values ('FIRST-CONFIRM-BASE',80,'purchase_price',current_date-1,'C80','base-cost','1');
  insert into private.stockflow_standard_item_prices(
    tally_item_key,price_amount,valid_from,status,reason,approved_by_email
  ) values ('FIRST-CONFIRM-BASE',100,current_date-1,'approved','Approved base price',
    'customer-first-admin@test.local');
  if (private.stockflow_customer_price(customer,'FIRST-CONFIRM-BASE',current_date)->>'currentPrice')::numeric<>100
     or (private.stockflow_customer_price(customer,'FIRST-CONFIRM-BASE',current_date)->>'recommended')::numeric<=100 then
    raise exception 'Base recommendation was mistaken for approved current price';
  end if;
  insert into private.stockflow_orders(
    customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email
  ) values (
    customer,'Customer First Confirmation','phone','awaiting_confirmation',
    'customer-first-base-order','customer-first-admin@test.local','customer-first-admin@test.local'
  ) returning id into base_order;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity)
  values (base_order,'FIRST-CONFIRM-BASE','Base-priced reagent',1);
  response:=public.stockflow_order_gateway(
    'customer-first-confirm-test','customer-first-admin@test.local','transition_order',
    jsonb_build_object('idempotencyKey','customer-first-base-command',
      'orderId',base_order,'expectedVersion',1,'toStatus','confirmed')
  );
  if response->>'pricingState'<>'approved' or not exists (
    select 1 from private.stockflow_order_pricing_decisions
    where order_id=base_order and approved_rate=100 and source_type='standard_item_price'
  ) then raise exception 'Approved base price was not applied at confirmation'; end if;

  insert into private.stockflow_orders(
    customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email
  ) values (
    customer,'Customer First Confirmation','phone','awaiting_confirmation',
    'customer-first-rollback-order','customer-first-admin@test.local','customer-first-admin@test.local'
  ) returning id into rollback_order;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity)
  values (rollback_order,'FIRST-CONFIRM-GOVERNED','Governed reagent',1);
  perform set_config('stockflow.test_fail_auto_confirm','on',true);
  begin
    perform public.stockflow_order_gateway(
      'customer-first-confirm-test','customer-first-admin@test.local','transition_order',
      jsonb_build_object('idempotencyKey','customer-first-rollback-command',
        'orderId',rollback_order,'expectedVersion',1,'toStatus','confirmed')
    );
    raise exception 'Injected audit failure did not roll back confirmation';
  exception when raise_exception then
    if sqlerrm<>'Injected automatic pricing audit failure' then raise; end if;
  end;
  perform set_config('stockflow.test_fail_auto_confirm','off',true);
  if exists (
    select 1 from private.stockflow_orders
    where id=rollback_order and (status<>'awaiting_confirmation' or pricing_state='approved')
  ) or exists (
    select 1 from private.stockflow_order_pricing_decisions where order_id=rollback_order
  ) or exists (
    select 1 from private.stockflow_billing_snapshots where order_id=rollback_order
  ) or exists (
    select 1 from private.stockflow_command_results
    where idempotency_key='customer-first-rollback-command'
  ) then raise exception 'Failed confirmation left partial state'; end if;

  update private.stockflow_pricing_policies set active=false where active;
  insert into private.stockflow_orders(
    customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email
  ) values (
    customer,'Customer First Confirmation','phone','awaiting_confirmation',
    'customer-first-no-policy-order','customer-first-admin@test.local','customer-first-admin@test.local'
  ) returning id into no_policy_order;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity)
  values (no_policy_order,'FIRST-CONFIRM-GOVERNED','Governed reagent',1);
  response:=public.stockflow_order_gateway(
    'customer-first-confirm-test','customer-first-admin@test.local','transition_order',
    jsonb_build_object('idempotencyKey','customer-first-no-policy-command',
      'orderId',no_policy_order,'expectedVersion',1,'toStatus','confirmed')
  );
  if response->>'status'<>'confirmed' or response->>'pricingState'='approved' then
    raise exception 'Missing policy either blocked operations or guessed a price';
  end if;
end $test$;

rollback;
