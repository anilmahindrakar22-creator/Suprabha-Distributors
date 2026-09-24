-- Synthetic pricing acceptance; all business records roll back.
begin;
update private.stockflow_gateway_config
set secret_sha256=encode(extensions.digest('cost-exception-test-key','sha256'),'hex')
where name='orders';
update private.stockflow_pricing_policies set active=false where active;
insert into private.stockflow_pricing_policies(
  policy_version,minimum_margin_percent,target_margin_percent,
  override_approval_percent,rounding_increment,rounding_rule_version,
  effective_from,created_by_email
) values ('cost-exception-test',20,30,5,1,'ceil-one-v1',current_date-20,'test');
insert into public.stockflow_members(email,role,status)
values ('cost-exception-admin@test.local','administrator','active');

do $test$
declare
  customer uuid;
  stable_order uuid;
  rise_order uuid;
  fixed_order uuid;
  stable_line uuid;
  rise_line uuid;
  fixed_line uuid;
  resolved jsonb;
  preview jsonb;
  response jsonb;
  exception_id uuid;
begin
  insert into private.stockflow_customers(name,tally_key,created_by_email)
  values ('Cost exception customer','cost-exception-customer','test')
  returning id into customer;
  insert into private.stockflow_products(tally_item_key,name,base_unit)
  values ('COST-STABLE','Stable reagent','Nos'),
         ('COST-RISE','Rising-cost reagent','Nos'),
         ('COST-FIXED','Fixed agreement reagent','Nos');
  insert into private.stockflow_tally_purchase_costs(
    tally_item_key,cost_amount,cost_kind,effective_at,
    source_reference,source_id,source_version
  ) values
    ('COST-STABLE',50,'purchase_price',current_date-10,'OLD-50','stable-old','1'),
    ('COST-STABLE',50,'purchase_price',current_date-1,'NOW-50','stable-now','1'),
    ('COST-RISE',50,'purchase_price',current_date-10,'OLD-50','rise-old','1'),
    ('COST-RISE',60,'purchase_price',current_date-1,'NOW-60','rise-now','1'),
    ('COST-FIXED',50,'purchase_price',current_date-10,'OLD-50','fixed-old','1'),
    ('COST-FIXED',60,'purchase_price',current_date-1,'NOW-60','fixed-now','1');
  insert into private.stockflow_tally_sales_prices(
    customer_id,tally_item_key,invoice_rate,invoice_date,
    invoice_reference,source_id,source_version
  ) values
    (customer,'COST-STABLE',100,current_date-5,'STABLE-100','stable-sale','1'),
    (customer,'COST-RISE',100,current_date-5,'RISE-100','rise-sale','1'),
    (customer,'COST-FIXED',100,current_date-5,'FIXED-100','fixed-sale','1');
  insert into private.stockflow_customer_product_prices(
    customer_id,tally_item_key,price_amount,valid_from,status,source_type,
    reason,approved_by_email,approved_at,created_by_email
  ) values (
    customer,'COST-FIXED',100,current_date-20,'approved','customer_contract',
    'Synthetic fixed agreement','cost-exception-admin@test.local',now(),
    'cost-exception-admin@test.local'
  );

  insert into private.stockflow_orders(
    customer_id,customer_name,source,status,idempotency_key,
    created_by_email,updated_by_email
  ) values (customer,'Cost exception customer','phone','awaiting_confirmation',
    'stable-cost-order','cost-exception-admin@test.local',
    'cost-exception-admin@test.local') returning id into stable_order;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity)
  values (stable_order,'COST-STABLE','Stable reagent',1) returning id into stable_line;
  insert into private.stockflow_orders(
    customer_id,customer_name,source,status,idempotency_key,
    created_by_email,updated_by_email
  ) values (customer,'Cost exception customer','phone','awaiting_confirmation',
    'rising-cost-order','cost-exception-admin@test.local',
    'cost-exception-admin@test.local') returning id into rise_order;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity)
  values (rise_order,'COST-RISE','Rising-cost reagent',1) returning id into rise_line;
  insert into private.stockflow_orders(
    customer_id,customer_name,source,status,idempotency_key,
    created_by_email,updated_by_email
  ) values (customer,'Cost exception customer','phone','awaiting_confirmation',
    'fixed-cost-order','cost-exception-admin@test.local',
    'cost-exception-admin@test.local') returning id into fixed_order;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity)
  values (fixed_order,'COST-FIXED','Fixed agreement reagent',1)
  returning id into fixed_line;

  resolved:=private.stockflow_resolve_pricing_line(stable_line,current_date);
  if resolved->>'guardrail'<>'PRICE_OK'
     or (resolved->>'proposedRate')::numeric<>100
     or not private.stockflow_is_governed_order_price(
       customer,'COST-STABLE',current_date,resolved) then
    raise exception 'Unchanged cost did not preserve the last customer rate: %',resolved;
  end if;
  resolved:=private.stockflow_resolve_pricing_line(rise_line,current_date);
  if resolved->>'guardrail'<>'PRICE_REVIEW_REQUIRED'
     or (resolved->>'proposedRate')::numeric<>100
     or private.stockflow_is_governed_order_price(
       customer,'COST-RISE',current_date,resolved) then
    raise exception 'Cost increase did not enter review at the old rate: %',resolved;
  end if;
  resolved:=private.stockflow_resolve_pricing_line(fixed_line,current_date);
  if resolved->>'guardrail'<>'PRICE_REVIEW_REQUIRED'
     or private.stockflow_is_governed_order_price(
       customer,'COST-FIXED',current_date,resolved) then
    raise exception 'Fixed agreement cost increase bypassed review: %',resolved;
  end if;

  preview:=private.stockflow_customer_book_bulk_preview(customer,current_date);
  if (preview->>'bulkTotalCount')::integer<>3
     or (preview->>'bulkEligibleCount')::integer<>1 then
    raise exception 'Bulk approval included a cost increase: %',preview;
  end if;

  response:=public.stockflow_order_gateway(
    'cost-exception-test-key','cost-exception-admin@test.local','transition_order',
    jsonb_build_object('idempotencyKey','stable-confirm-command',
      'orderId',stable_order,'expectedVersion',1,'toStatus','confirmed')
  );
  if response->>'pricingState'<>'approved' or not exists (
    select 1 from private.stockflow_billing_snapshots where order_id=stable_order
  ) then raise exception 'Unchanged-cost order did not proceed: %',response; end if;

  response:=public.stockflow_order_gateway(
    'cost-exception-test-key','cost-exception-admin@test.local','transition_order',
    jsonb_build_object('idempotencyKey','rise-confirm-command',
      'orderId',rise_order,'expectedVersion',1,'toStatus','confirmed')
  );
  if response->>'pricingState'='approved' or exists (
    select 1 from private.stockflow_billing_snapshots where order_id=rise_order
  ) then raise exception 'Cost-increase order was auto-approved: %',response; end if;
  response:=public.stockflow_order_gateway(
    'cost-exception-test-key','cost-exception-admin@test.local','transition_order',
    jsonb_build_object('idempotencyKey','fixed-confirm-command',
      'orderId',fixed_order,'expectedVersion',1,'toStatus','confirmed')
  );
  if response->>'pricingState'='approved' or exists (
    select 1 from private.stockflow_billing_snapshots where order_id=fixed_order
  ) then raise exception 'Fixed cost-increase order was auto-approved: %',response; end if;

  resolved:=private.stockflow_resolve_pricing_line(rise_line,current_date);
  response:=public.stockflow_pricing_gateway(
    'cost-exception-test-key','cost-exception-admin@test.local','submit_order_pricing',
    jsonb_build_object('orderId',rise_order,'expectedVersion',2,
      'idempotencyKey','rise-review-request-command','lines',jsonb_build_array(
        jsonb_build_object('lineId',rise_line,'enteredRate',100,
          'reason','Reviewed synthetic purchase cost increase',
          'evidenceHash',resolved->>'evidenceHash')))
  );
  if response->>'pricingState'<>'approval_required' then
    raise exception 'Cost increase did not create an approval exception: %',response;
  end if;
  select id into exception_id from private.stockflow_price_exceptions
  where order_id=rise_order and state='pending';
  if exception_id is null then raise exception 'Approval exception missing'; end if;
  response:=public.stockflow_pricing_gateway(
    'cost-exception-test-key','cost-exception-admin@test.local',
    'approve_price_exception',jsonb_build_object(
      'exceptionId',exception_id,'expectedVersion',1,
      'reason','Administrator reviewed the cost increase',
      'idempotencyKey','rise-review-approval-command')
  );
  if response->>'pricingState'<>'approved' or not exists (
    select 1 from private.stockflow_billing_snapshots where order_id=rise_order
  ) then raise exception 'Administrator review did not complete pricing: %',response; end if;

  resolved:=private.stockflow_resolve_pricing_line(fixed_line,current_date);
  response:=public.stockflow_pricing_gateway(
    'cost-exception-test-key','cost-exception-admin@test.local',
    'submit_order_pricing',jsonb_build_object(
      'orderId',fixed_order,'expectedVersion',2,
      'idempotencyKey','fixed-review-request-command','lines',jsonb_build_array(
        jsonb_build_object('lineId',fixed_line,'enteredRate',100,
          'reason','Review cost increase under fixed agreement',
          'evidenceHash',resolved->>'evidenceHash')))
  );
  if response->>'pricingState'<>'approval_required' then
    raise exception 'Fixed agreement did not require administrator review: %',response;
  end if;
  select id into exception_id from private.stockflow_price_exceptions
  where order_id=fixed_order and state='pending';
  response:=public.stockflow_pricing_gateway(
    'cost-exception-test-key','cost-exception-admin@test.local',
    'approve_price_exception',jsonb_build_object(
      'exceptionId',exception_id,'expectedVersion',1,
      'reason','Administrator reviewed fixed agreement margin',
      'idempotencyKey','fixed-review-approval-command')
  );
  if response->>'pricingState'<>'approved' or not exists (
    select 1 from private.stockflow_billing_snapshots where order_id=fixed_order
  ) then raise exception 'Fixed agreement review did not complete pricing: %',response; end if;
end $test$;
rollback;
