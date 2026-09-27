begin;
update private.stockflow_gateway_config
set secret_sha256=encode(extensions.digest('group-margin-test-key','sha256'),'hex')
where name='orders';
update private.stockflow_pricing_policies set active=false where active;
insert into private.stockflow_pricing_policies(
  policy_version,minimum_margin_percent,target_margin_percent,
  override_approval_percent,rounding_increment,rounding_rule_version,
  effective_from,created_by_email
) values ('group-margin-test',99.99,null,0,5,'ceil-five-v1',current_date-30,'test');
insert into public.stockflow_members(email,role,status) values
  ('group-admin@test.local','administrator','active'),
  ('group-management@test.local','management','active'),
  ('group-accounts@test.local','accounts','active'),
  ('group-sales@test.local','sales','active');

create function private.test_group_margin_fail_second_item()
returns trigger language plpgsql as $$
begin
  if new.tally_item_key='GM-B' then
    raise exception 'Synthetic second item failure' using errcode='ZZ001';
  end if;
  return new;
end $$;

do $test$
declare
  customer uuid;
  preview jsonb;
  payload jsonb;
  accepted jsonb;
  resolved jsonb;
  group_order_id uuid;
  line_id uuid;
begin
  insert into private.stockflow_customers(name,tally_key,created_by_email)
  values ('Group margin customer','group-margin-customer','test') returning id into customer;
  insert into private.stockflow_products(tally_item_key,name,item_group,base_unit) values
    ('GM-A','A reagent','Diasys','Nos'),
    ('GM-B','B reagent','Diasys','Nos'),
    ('GM-FIXED','Fixed reagent','Diasys','Nos'),
    ('GM-NOCOST','Unknown cost','Diasys','Nos'),
    ('GM-OTHER','Other reagent','Sysmex','Nos');
  insert into private.stockflow_tally_purchase_costs(
    tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version
  ) values
    ('GM-A',60,'purchase_price',current_date-10,'A-60','gm-a-cost','1'),
    ('GM-B',100,'purchase_price',current_date-10,'B-100','gm-b-cost','1'),
    ('GM-FIXED',70,'purchase_price',current_date-10,'F-70','gm-fixed-cost','1'),
    ('GM-OTHER',50,'purchase_price',current_date-10,'O-50','gm-other-cost','1');
  insert into private.stockflow_tally_sales_prices(
    customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version
  ) values
    (customer,'GM-A',70,current_date-5,'A-70','gm-a-sale','1'),
    (customer,'GM-B',160,current_date-5,'B-160','gm-b-sale','1'),
    (customer,'GM-FIXED',100,current_date-5,'F-100','gm-fixed-sale','1'),
    (customer,'GM-NOCOST',90,current_date-5,'N-90','gm-nocost-sale','1'),
    (customer,'GM-OTHER',90,current_date-5,'O-90','gm-other-sale','1');
  insert into private.stockflow_customer_product_prices(
    customer_id,tally_item_key,price_amount,valid_from,status,source_type,
    reason,approved_by_email,approved_at,created_by_email
  ) values (customer,'GM-FIXED',100,current_date-20,'approved','tender',
    'Protected fixed contract','group-admin@test.local',now(),'group-admin@test.local');

  begin
    perform public.stockflow_pricing_gateway('group-margin-test-key',
      'group-accounts@test.local','preview_customer_group_margin',
      jsonb_build_object('customerId',customer,'itemGroup','Diasys','grossMarginPercent',40));
    raise exception 'Accounts saw group commercial prices';
  exception when insufficient_privilege then null; end;
  begin
    perform public.stockflow_pricing_gateway('group-margin-test-key',
      'group-sales@test.local','preview_customer_group_margin',
      jsonb_build_object('customerId',customer,'itemGroup','Diasys','grossMarginPercent',40));
    raise exception 'Sales saw group commercial prices';
  exception when insufficient_privilege then null; end;
  preview:=public.stockflow_pricing_gateway('group-margin-test-key',
    'group-admin@test.local','preview_customer_group_margin',
    jsonb_build_object('customerId',customer,'itemGroup','Diasys','grossMarginPercent',40));
  if (preview->>'eligibleCount')::integer<>2 or (preview->>'excludedCount')::integer<>2
     or (select (r->>'proposedRate')::numeric from jsonb_array_elements(preview->'rows') r
       where r->>'tallyKey'='GM-A')<>100
     or (select (r->>'proposedRate')::numeric from jsonb_array_elements(preview->'rows') r
       where r->>'tallyKey'='GM-B')<>170 then
    raise exception 'Gross-margin math, mixed costs, or fixed protection failed: %',preview;
  end if;
  payload:=jsonb_build_object('customerId',customer,'itemGroup','Diasys',
    'grossMarginPercent',40,'previewHash',preview->>'previewHash',
    'idempotencyKey','group-margin-request-0001');
  begin
    perform public.stockflow_pricing_gateway('group-margin-test-key',
      'group-accounts@test.local','approve_customer_group_margin',payload);
    raise exception 'Accounts approved group margin';
  exception when insufficient_privilege then null; end;
  begin
    perform public.stockflow_pricing_gateway('group-margin-test-key',
      'group-admin@test.local','approve_customer_group_margin',
      payload||jsonb_build_object('previewHash',repeat('a',64),
        'idempotencyKey','group-margin-stale-0001'));
    raise exception 'Stale preview was accepted';
  exception when serialization_failure then null; end;
  if exists(select 1 from private.stockflow_command_results
    where idempotency_key='group-margin-stale-0001') then
    raise exception 'Stale preview left a receipt';
  end if;
  create trigger test_group_margin_fail_second_item before insert
    on private.stockflow_group_margin_item_decisions for each row
    execute function private.test_group_margin_fail_second_item();
  begin
    perform public.stockflow_pricing_gateway('group-margin-test-key',
      'group-management@test.local','approve_customer_group_margin',payload);
    raise exception 'Injected second-item failure did not abort approval';
  exception when sqlstate 'ZZ001' then null; end;
  drop trigger test_group_margin_fail_second_item
    on private.stockflow_group_margin_item_decisions;
  if exists(select 1 from private.stockflow_group_margin_item_decisions
      where request_id='group-margin-request-0001')
     or exists(select 1 from private.stockflow_command_results
      where idempotency_key='group-margin-request-0001') then
    raise exception 'Partial group approval survived a later item failure';
  end if;
  accepted:=public.stockflow_pricing_gateway('group-margin-test-key',
    'group-management@test.local','approve_customer_group_margin',payload);
  if accepted<>public.stockflow_pricing_gateway('group-margin-test-key',
      'group-management@test.local','approve_customer_group_margin',payload)
     or (accepted->>'applied')::integer<>2 then
    raise exception 'Atomic approval or replay failed: %',accepted;
  end if;
  if public.stockflow_submission_recovery_gateway('group-margin-test-key',
      'group-management@test.local','recover_order_submission',
      jsonb_build_object('pricingAction','approve_customer_group_margin',
        'idempotencyKey','group-margin-request-0001'))->>'status'<>'accepted' then
    raise exception 'Accepted group approval was not recoverable';
  end if;
  if public.stockflow_submission_recovery_gateway('group-margin-test-key',
      'group-management@test.local','recover_order_submission',
      jsonb_build_object('pricingAction','approve_customer_group_margin',
        'idempotencyKey','group-margin-closed-0001','closeUnresolved',true))
      ->>'status'<>'not_saved' then
    raise exception 'Unresolved group approval could not be closed safely';
  end if;
  begin
    perform public.stockflow_pricing_gateway('group-margin-test-key',
      'group-management@test.local','approve_customer_group_margin',
      payload||jsonb_build_object('idempotencyKey','group-margin-closed-0001'));
    raise exception 'A late closed approval was accepted';
  exception when sqlstate '22023' then null; end;
  if (select count(*) from private.stockflow_group_margin_item_decisions
      where request_id='group-margin-request-0001')<>2
     or (select count(*) from private.stockflow_pricing_events
      where request_id='group-margin-request-0001')<>2 then
    raise exception 'Individual decisions or audit missing';
  end if;
  if not exists(select 1 from private.stockflow_group_margin_item_decisions
      where tally_item_key='GM-A' and price=100 and gross_margin_percent=40)
     or not exists(select 1 from private.stockflow_group_margin_item_decisions
      where tally_item_key='GM-B' and price=170 and gross_margin_percent=40) then
    raise exception 'Item rates were collapsed into a group rate';
  end if;
  if private.stockflow_customer_price(customer,'GM-A',current_date-1)
      ? 'groupMarginDecisionId' then
    raise exception 'A new group decision was applied to an earlier pricing date';
  end if;

  -- A later genuine sale is evidence for the next preview, but does not reprice approval.
  insert into private.stockflow_tally_sales_prices(
    customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version
  ) values (customer,'GM-A',75,current_date,'A-75','gm-a-later-sale','1');
  resolved:=private.stockflow_customer_price(customer,'GM-A',current_date);
  if (resolved->>'currentPrice')::numeric<>100
     or resolved->>'status'<>'GROUP_MARGIN_APPROVED' then
    raise exception 'Later sale expired a stable group rate: %',resolved;
  end if;
  insert into private.stockflow_orders(
    customer_id,customer_name,source,status,idempotency_key,
    created_by_email,updated_by_email
  ) values (customer,'Group margin customer','phone','awaiting_confirmation',
    'group-margin-order','group-admin@test.local','group-admin@test.local')
  returning id into group_order_id;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity)
  values(group_order_id,'GM-A','A reagent',1) returning id into line_id;
  resolved:=private.stockflow_resolve_pricing_line(line_id,current_date);
  if resolved->>'guardrail'<>'PRICE_OK' or (resolved->>'proposedRate')::numeric<>100
     or not private.stockflow_is_governed_order_price(customer,'GM-A',current_date,resolved) then
    raise exception 'Stable approved group rate was not governed: %',resolved;
  end if;

  insert into private.stockflow_tally_purchase_costs(
    tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version
  ) values ('GM-A',50,'purchase_price',current_date,'A-50','gm-a-cost-decrease','1');
  resolved:=private.stockflow_resolve_pricing_line(line_id,current_date);
  if resolved->>'guardrail'<>'PRICE_REVIEW_REQUIRED'
     or (resolved->>'proposedRate')::numeric<>100
     or (resolved->>'recommended')::numeric<>100
     or private.stockflow_is_governed_order_price(customer,'GM-A',current_date,resolved) then
    raise exception 'Changed cost did not require review with new recommendation: %',resolved;
  end if;
  if (select count(*) from private.stockflow_group_margin_item_decisions
    where customer_id=customer and tally_item_key='GM-A')<>1 then
    raise exception 'Cost change mutated approved decision';
  end if;
  accepted:=public.stockflow_order_gateway('group-margin-test-key',
    'group-admin@test.local','transition_order',
    jsonb_build_object('idempotencyKey','group-margin-confirm-0001',
      'orderId',group_order_id,'expectedVersion',1,'toStatus','confirmed'));
  if accepted->>'pricingState'='approved' or exists (
    select 1 from private.stockflow_billing_snapshots where order_id=group_order_id
  ) then raise exception 'Changed cost reached billing automatically: %',accepted; end if;

  -- The other approved rate also needs review if the cost kind changes alone.
  insert into private.stockflow_tally_purchase_costs(
    tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version
  ) values ('GM-B',100,'landed_cost',current_date,'B-LANDED',
    'gm-b-cost-kind','1');
  resolved:=private.stockflow_customer_price(customer,'GM-B',current_date);
  if resolved->>'status'<>'REVIEW_REQUIRED'
     or (resolved->>'currentPrice')::numeric<>170
     or (resolved->>'recommended')::numeric<>170 then
    raise exception 'Cost-kind change did not reopen item review: %',resolved;
  end if;
  insert into private.stockflow_tally_purchase_costs(
    tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version
  ) values ('GM-A',120,'purchase_price',current_date,'A-120',
    'gm-a-cost-increase','1');
  resolved:=private.stockflow_customer_price(customer,'GM-A',current_date);
  if resolved->>'status'<>'REVIEW_REQUIRED'
     or (resolved->>'currentPrice')::numeric<>100
     or (resolved->>'recommended')::numeric<>200 then
    raise exception 'Cost increase did not require review at target gross margin: %',resolved;
  end if;
end $test$;
rollback;
