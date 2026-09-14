-- Run only against a fully migrated non-production database. Self-contained and rolled back.
begin;
-- Existing command scenarios include the required preview fingerprint.
create function pg_temp.pricing_gateway(k text,e text,a text,p jsonb) returns jsonb language plpgsql as $fn$
begin
  if a='submit_order_pricing' then
    p:=jsonb_set(p,'{lines}',(select jsonb_agg(line||jsonb_build_object('evidenceHash',private.stockflow_resolve_pricing_line((line->>'lineId')::uuid,coalesce((p->>'pricingDate')::date,current_date))->>'evidenceHash')) from jsonb_array_elements(p->'lines') line));
  end if;
  return public.stockflow_pricing_gateway(k,e,a,p);
end $fn$;

update private.stockflow_gateway_config
set secret_sha256=encode(extensions.digest('stockflow-pricing-test','sha256'),'hex')
where name='orders';

update private.stockflow_pricing_policies set active=false where active;
insert into private.stockflow_pricing_policies(
  policy_version,minimum_margin_percent,target_margin_percent,override_approval_percent,
  rounding_increment,rounding_rule_version,effective_from,created_by_email
) values ('integration-test-policy-v1',20,30,5,1,'integration-ceil-v1','2026-04-01','pricing-test');

insert into public.stockflow_members(email,role,status,updated_at) values
  ('pricing-accounts@stockflow.local','accounts','active',now()),
  ('pricing-admin@stockflow.local','administrator','active',now()),
  ('pricing-sales@stockflow.local','sales','active',now())
on conflict(email) do update set role=excluded.role,status='active',updated_at=now();

do $test$
declare
  v_customer_id uuid; v_order_id uuid; v_line_id uuid; v_cost_id uuid;
  workspace jsonb; approved jsonb; replay jsonb; snapshot_id uuid;
  decision_count integer; event_count integer; outbox_count integer;
begin
  insert into private.stockflow_customers(tally_key,name,created_by_email)
  values('ledger:pricing-test','Pricing Test Laboratory','pricing-test') returning id into v_customer_id;
  insert into private.stockflow_orders(customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email)
  values(v_customer_id,'Pricing Test Laboratory','phone','packed','pricing-fixture-order','pricing-accounts@stockflow.local','pricing-accounts@stockflow.local') returning id into v_order_id;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,base_unit,quantity,snapshot_closing)
  values(v_order_id,'PRICING-ITEM-1','Pricing Test Reagent','Nos',2,10) returning id into v_line_id;

  insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version)
  values(v_customer_id,'PRICING-ITEM-1',485,'2026-08-18','SD/26-27/0485','sale:485','sale-version:485');
  insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
  values('PRICING-ITEM-1',310,'purchase_price','2026-08-01','PUR-310','cost:310','cost-version:310') returning id into v_cost_id;

  begin
    perform pg_temp.pricing_gateway('stockflow-pricing-test','pricing-sales@stockflow.local','get_order_pricing',jsonb_build_object('orderId',v_order_id));
    raise exception 'Sales role retrieved restricted pricing';
  exception when insufficient_privilege then null;
  end;

  workspace:=pg_temp.pricing_gateway('stockflow-pricing-test','pricing-accounts@stockflow.local','get_order_pricing',jsonb_build_object('orderId',v_order_id,'pricingDate','2026-09-12'));
  if workspace->'lines'->0->>'proposedRate'<>'485.00' or workspace->'lines'->0->'cost'->>'amount'<>'310.00' then raise exception 'Exact pricing resolution failed: %',workspace; end if;

  approved:=pg_temp.pricing_gateway('stockflow-pricing-test','pricing-accounts@stockflow.local','submit_order_pricing',jsonb_build_object(
    'orderId',v_order_id,'expectedVersion',1,'pricingDate','2026-09-12','idempotencyKey','pricing-approve-000001',
    'lines',jsonb_build_array(jsonb_build_object('lineId',v_line_id,'enteredRate',485))
  ));
  replay:=pg_temp.pricing_gateway('stockflow-pricing-test','pricing-accounts@stockflow.local','submit_order_pricing',jsonb_build_object(
    'orderId',v_order_id,'expectedVersion',1,'pricingDate','2026-09-12','idempotencyKey','pricing-approve-000001',
    'lines',jsonb_build_array(jsonb_build_object('lineId',v_line_id,'enteredRate',485))
  ));
  if replay<>approved or approved->>'pricingState'<>'approved' then raise exception 'Pricing approval replay failed'; end if;
  snapshot_id:=(approved->>'snapshotId')::uuid;
  select count(*) into decision_count from private.stockflow_order_pricing_decisions where order_id=v_order_id and state='approved';
  select count(*) into event_count from private.stockflow_order_events where order_id=v_order_id and event_type='order_pricing_approved';
  select count(*) into outbox_count from private.stockflow_outbox where aggregate_id=v_order_id and topic='order.pricing_approved';
  if decision_count<>1 or event_count<>1 or outbox_count<>1 then raise exception 'Atomic pricing side effects are incomplete'; end if;

  begin
    update private.stockflow_billing_snapshots set pricing_payload='{}'::jsonb where id=snapshot_id;
    raise exception 'Immutable billing snapshot was changed';
  exception when object_not_in_prerequisite_state then null;
  end;

  update private.stockflow_order_lines set quantity=3 where id=v_line_id;
  if (select pricing_state from private.stockflow_orders where id=v_order_id)<>'invalidated' then raise exception 'Order change did not invalidate pricing'; end if;
  if exists(select 1 from private.stockflow_billing_snapshots where id=snapshot_id and invalidated_at is null) then raise exception 'Old billing snapshot remained current'; end if;

  begin
    perform pg_temp.pricing_gateway('stockflow-pricing-test','pricing-accounts@stockflow.local','submit_order_pricing',jsonb_build_object(
      'orderId',v_order_id,'expectedVersion',1,'pricingDate','2026-09-12','idempotencyKey','pricing-stale-0000001',
      'lines',jsonb_build_array(jsonb_build_object('lineId',v_line_id,'enteredRate',485))
    ));
    raise exception 'Stale pricing writer unexpectedly succeeded';
  exception when serialization_failure then null;
  end;
  if exists(select 1 from private.stockflow_command_results where idempotency_key='pricing-stale-0000001') then raise exception 'Failed pricing command left an idempotency result'; end if;
end $test$;

do $contracts$
declare
  v_customer_id uuid; v_order_id uuid; v_line_id uuid;
  first_result jsonb; replacement_result jsonb; overlapping_result jsonb;
  first_id uuid; replacement_id uuid; historical jsonb; current_price jsonb;
begin
  insert into private.stockflow_customers(tally_key,name,created_by_email)
  values('ledger:contract-test','Contract Test Laboratory','pricing-test') returning id into v_customer_id;

  begin
    perform pg_temp.pricing_gateway('stockflow-pricing-test','pricing-sales@stockflow.local','create_price_contract',jsonb_build_object(
      'customerId',v_customer_id,'tallyKey','CONTRACT-ITEM-1','price',700,'validFrom','2026-04-01',
      'source','customer_contract','reason','Annual agreement','idempotencyKey','contract-sales-denied-01'
    ));
    raise exception 'Sales role created a restricted customer price';
  exception when insufficient_privilege then null;
  end;

  first_result:=pg_temp.pricing_gateway('stockflow-pricing-test','pricing-accounts@stockflow.local','create_price_contract',jsonb_build_object(
    'customerId',v_customer_id,'tallyKey','CONTRACT-ITEM-1','price',700,'validFrom','2026-04-01',
    'source','customer_contract','reason','Annual agreement','idempotencyKey','contract-create-000001'
  ));
  first_id:=(first_result->>'contractId')::uuid;
  perform pg_temp.pricing_gateway('stockflow-pricing-test','pricing-admin@stockflow.local','approve_price_contract',jsonb_build_object(
    'contractId',first_id,'expectedVersion',1,'reason','Agreement verified','idempotencyKey','contract-approve-00001'
  ));

  replacement_result:=pg_temp.pricing_gateway('stockflow-pricing-test','pricing-accounts@stockflow.local','create_price_contract',jsonb_build_object(
    'customerId',v_customer_id,'tallyKey','CONTRACT-ITEM-1','price',720,'validFrom','2026-10-01',
    'source','customer_contract','reason','New approved period','supersedesPriceId',first_id,
    'idempotencyKey','contract-create-000002'
  ));
  replacement_id:=(replacement_result->>'contractId')::uuid;
  perform pg_temp.pricing_gateway('stockflow-pricing-test','pricing-admin@stockflow.local','approve_price_contract',jsonb_build_object(
    'contractId',replacement_id,'expectedVersion',1,'reason','New period verified','idempotencyKey','contract-approve-00002'
  ));
  if not exists(select 1 from private.stockflow_customer_product_prices where id=first_id and status='superseded' and valid_to='2026-09-30') then
    raise exception 'Superseded customer price history was not closed and retained';
  end if;

  insert into private.stockflow_orders(customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email)
  values(v_customer_id,'Contract Test Laboratory','phone','packed','contract-fixture-order','pricing-accounts@stockflow.local','pricing-accounts@stockflow.local') returning id into v_order_id;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,base_unit,quantity,snapshot_closing)
  values(v_order_id,'CONTRACT-ITEM-1','Contract Test Reagent','Nos',1,10) returning id into v_line_id;
  historical:=private.stockflow_resolve_pricing_line(v_line_id,'2026-09-12');
  current_price:=private.stockflow_resolve_pricing_line(v_line_id,'2026-10-02');
  if historical->>'proposedRate'<>'700.00' or current_price->>'proposedRate'<>'720.00' then
    raise exception 'Effective-dated contract resolution failed: %, %',historical,current_price;
  end if;

  overlapping_result:=pg_temp.pricing_gateway('stockflow-pricing-test','pricing-accounts@stockflow.local','create_price_contract',jsonb_build_object(
    'customerId',v_customer_id,'tallyKey','CONTRACT-ITEM-1','price',710,'validFrom','2026-11-01',
    'source','manual_governed','reason','Intentional overlap test','idempotencyKey','contract-overlap-0001'
  ));
  begin
    perform pg_temp.pricing_gateway('stockflow-pricing-test','pricing-admin@stockflow.local','approve_price_contract',jsonb_build_object(
      'contractId',(overlapping_result->>'contractId')::uuid,'expectedVersion',1,'reason','Overlap must fail','idempotencyKey','contract-overlap-approve'
    ));
    raise exception 'Overlapping approved price unexpectedly succeeded';
  exception when exclusion_violation then null;
  end;
end $contracts$;

do $policies$
declare created jsonb; replay jsonb; policy_id uuid;
begin
  begin
    perform pg_temp.pricing_gateway('stockflow-pricing-test','pricing-accounts@stockflow.local','create_pricing_policy',jsonb_build_object(
      'policyVersion','integration-future-v1','minimumMarginPercent',22,'targetMarginPercent',32,
      'overrideApprovalPercent',4,'roundingIncrement',5,'roundingRuleVersion','ceil-five-v1',
      'effectiveFrom','2027-04-01','reason','Annual management policy','idempotencyKey','policy-accounts-denied'
    ));
    raise exception 'Accounts role created commercial policy';
  exception when insufficient_privilege then null;
  end;
  created:=pg_temp.pricing_gateway('stockflow-pricing-test','pricing-admin@stockflow.local','create_pricing_policy',jsonb_build_object(
    'policyVersion','integration-future-v1','minimumMarginPercent',22,'targetMarginPercent',32,
    'overrideApprovalPercent',4,'roundingIncrement',5,'roundingRuleVersion','ceil-five-v1',
    'effectiveFrom','2027-04-01','reason','Annual management policy','idempotencyKey','policy-create-000001'
  ));
  replay:=pg_temp.pricing_gateway('stockflow-pricing-test','pricing-admin@stockflow.local','create_pricing_policy',jsonb_build_object(
    'policyVersion','integration-future-v1','minimumMarginPercent',22,'targetMarginPercent',32,
    'overrideApprovalPercent',4,'roundingIncrement',5,'roundingRuleVersion','ceil-five-v1',
    'effectiveFrom','2027-04-01','reason','Annual management policy','idempotencyKey','policy-create-000001'
  ));
  policy_id:=(created->>'policyId')::uuid;
  if replay<>created then raise exception 'Pricing policy idempotent replay failed'; end if;
  if not exists(select 1 from private.stockflow_pricing_policies where id=policy_id and policy_version='integration-future-v1' and effective_from='2027-04-01') then raise exception 'New pricing policy was not stored'; end if;
  if not exists(select 1 from private.stockflow_pricing_policies where policy_version='integration-test-policy-v1' and effective_to='2027-03-31') then raise exception 'Previous pricing policy was not closed historically'; end if;
  if not exists(select 1 from private.stockflow_pricing_events where entity_type='pricing_policy' and entity_id=policy_id and event_type='pricing_policy_created') then raise exception 'Pricing policy audit event is missing'; end if;
end $policies$;

do $exception_batch$
declare v_customer_id uuid; v_order_id uuid; v_line_one uuid; v_line_two uuid; submitted jsonb; exception_id uuid;
begin
  insert into private.stockflow_customers(tally_key,name,created_by_email)
  values('ledger:exception-batch','Exception Batch Laboratory','pricing-test') returning id into v_customer_id;
  insert into private.stockflow_orders(customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email)
  values(v_customer_id,'Exception Batch Laboratory','phone','packed','exception-batch-order','pricing-accounts@stockflow.local','pricing-accounts@stockflow.local') returning id into v_order_id;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity) values(v_order_id,'ITEM-1','Pricing Item One',1) returning id into v_line_one;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity) values(v_order_id,'ITEM-2','Pricing Item Two',1) returning id into v_line_two;
  submitted:=pg_temp.pricing_gateway('stockflow-pricing-test','pricing-accounts@stockflow.local','submit_order_pricing',jsonb_build_object(
    'orderId',v_order_id,'expectedVersion',1,'pricingDate','2026-09-12','idempotencyKey','exception-batch-submit-1',
    'lines',jsonb_build_array(jsonb_build_object('lineId',v_line_one,'enteredRate',600,'reason','Manual review'),jsonb_build_object('lineId',v_line_two,'enteredRate',700,'reason','Manual review'))
  ));
  if submitted->>'pricingState'<>'approval_required' then raise exception 'Exception batch was not held for approval'; end if;
  begin
    perform pg_temp.pricing_gateway('stockflow-pricing-test','pricing-accounts@stockflow.local','submit_order_pricing',jsonb_build_object(
      'orderId',v_order_id,'expectedVersion',2,'pricingDate','2026-09-12','idempotencyKey','exception-batch-submit-2',
      'lines',jsonb_build_array(jsonb_build_object('lineId',v_line_one,'enteredRate',600,'reason','Duplicate review'),jsonb_build_object('lineId',v_line_two,'enteredRate',700,'reason','Duplicate review'))
    ));
    raise exception 'A second pending pricing batch was accepted';
  exception when serialization_failure then null;
  end;
  select id into exception_id from private.stockflow_price_exceptions where order_id=v_order_id and state='pending' order by requested_at limit 1;
  perform pg_temp.pricing_gateway('stockflow-pricing-test','pricing-admin@stockflow.local','reject_price_exception',jsonb_build_object(
    'exceptionId',exception_id,'expectedVersion',1,'reason','Commercial review declined','idempotencyKey','exception-batch-reject-1'
  ));
  if exists(select 1 from private.stockflow_price_exceptions where order_id=v_order_id and state='pending') then raise exception 'Sibling price exception remained pending'; end if;
  if exists(select 1 from private.stockflow_order_pricing_decisions where order_id=v_order_id and state in ('pending_approval','approved')) then raise exception 'Rejected pricing batch left active decisions'; end if;
  if (select pricing_state from private.stockflow_orders where id=v_order_id)<>'review_required' then raise exception 'Rejected pricing batch did not return order to review'; end if;
end $exception_batch$;

rollback;
