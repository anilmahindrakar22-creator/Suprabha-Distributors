begin;
update private.stockflow_gateway_config
set secret_sha256=encode(extensions.digest('customer-bulk-test-key','sha256'),'hex')
where name='orders';
update private.stockflow_pricing_policies set active=false where active;
insert into private.stockflow_pricing_policies(
  policy_version,minimum_margin_percent,target_margin_percent,
  override_approval_percent,rounding_increment,rounding_rule_version,
  effective_from,created_by_email
) values ('customer-bulk-test',20,30,5,5,'ceil-five-v1','2026-01-01','test');
insert into public.stockflow_members(email,role,status) values
  ('bulk-admin@test.local','administrator','active'),
  ('bulk-accounts@test.local','accounts','active'),
  ('bulk-sales@test.local','sales','active');

do $test$
declare
  customer uuid;
  preview jsonb;
  payload jsonb;
  accepted jsonb;
  replay jsonb;
begin
  insert into private.stockflow_customers(name,tally_key,created_by_email)
  values ('Bulk customer','bulk-customer','test') returning id into customer;
  insert into private.stockflow_products(tally_item_key,name,base_unit) values
    ('BULK-A','A reagent','Nos'),('BULK-B','B reagent','Nos'),
    ('BULK-FIXED','Fixed reagent','Nos'),('BULK-NOCOST','Unknown cost','Nos');
  insert into private.stockflow_tally_sales_prices(
    customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version
  ) values
    (customer,'BULK-A',420,current_date-5,'A-420','bulk-a-sale','1'),
    (customer,'BULK-B',620,current_date-5,'B-620','bulk-b-sale','1'),
    (customer,'BULK-FIXED',700,current_date-5,'F-700','bulk-fixed-sale','1'),
    (customer,'BULK-NOCOST',900,current_date-5,'N-900','bulk-nocost-sale','1');
  insert into private.stockflow_tally_purchase_costs(
    tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version
  ) values
    ('BULK-A',250,'purchase_price',current_date-10,'A-COST','bulk-a-cost','1'),
    ('BULK-B',390,'purchase_price',current_date-10,'B-COST','bulk-b-cost','1'),
    ('BULK-FIXED',400,'purchase_price',current_date-10,'F-COST','bulk-fixed-cost','1');
  insert into private.stockflow_customer_product_prices(
    customer_id,tally_item_key,price_amount,valid_from,status,source_type,
    reason,approved_by_email,approved_at,created_by_email
  ) values (
    customer,'BULK-FIXED',700,current_date-30,'approved','tender',
    'Protected agreement','bulk-admin@test.local',now(),'bulk-admin@test.local'
  );

  begin
    perform public.stockflow_pricing_gateway('customer-bulk-test-key','bulk-sales@test.local',
      'get_customer_price_book',jsonb_build_object('customerId',customer));
    raise exception 'Sales read customer prices';
  exception when insufficient_privilege then null; end;
  preview:=public.stockflow_pricing_gateway('customer-bulk-test-key','bulk-accounts@test.local',
    'get_customer_price_book',jsonb_build_object('customerId',customer));
  if (preview->>'bulkTotalCount')::int<>4 or (preview->>'bulkEligibleCount')::int<>2
     or (preview->>'bulkExcludedCount')::int<>2 then
    raise exception 'Bulk preview did not protect fixed or missing-cost rows: %',preview;
  end if;
  payload:=jsonb_build_object('customerId',customer,
    'approvalPreviewHash',preview->>'approvalPreviewHash',
    'idempotencyKey','customer-bulk-test-request-01');
  begin
    perform public.stockflow_pricing_gateway('customer-bulk-test-key','bulk-accounts@test.local',
      'approve_customer_price_book',payload);
    raise exception 'Accounts approved customer book';
  exception when insufficient_privilege then null; end;
  accepted:=public.stockflow_pricing_gateway('customer-bulk-test-key','bulk-admin@test.local',
    'approve_customer_price_book',payload);
  replay:=public.stockflow_pricing_gateway('customer-bulk-test-key','bulk-admin@test.local',
    'approve_customer_price_book',payload);
  if accepted<>replay or (accepted->>'applied')::int<>2 or (accepted->>'excluded')::int<>2 then
    raise exception 'Atomic approval or idempotent replay failed: %',accepted;
  end if;
  if (select count(*) from private.stockflow_price_book_decisions
      where request_id='customer-bulk-test-request-01')<>2
    or (select count(*) from private.stockflow_pricing_events
      where request_id='customer-bulk-test-request-01')<>2
    or (select count(*) from private.stockflow_outbox
      where topic='pricing.book_approved')<>2 then
    raise exception 'Decisions, audit and outbox did not commit together';
  end if;
  begin
    perform public.stockflow_pricing_gateway('customer-bulk-test-key','bulk-admin@test.local',
      'approve_customer_price_book',payload||jsonb_build_object(
        'idempotencyKey','customer-bulk-test-request-02'));
    raise exception 'Stale preview was accepted';
  exception when serialization_failure then null; end;
  if exists (select 1 from private.stockflow_command_results
    where idempotency_key='customer-bulk-test-request-02') then
    raise exception 'Failed approval left a partial idempotency result';
  end if;
end $test$;
rollback;
