-- Run only against a fully migrated non-production database. Self-contained and rolled back.
begin;

update private.stockflow_gateway_config
set secret_sha256=encode(extensions.digest('stockflow-pricing-test','sha256'),'hex')
where name='orders';

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
    perform public.stockflow_pricing_gateway('stockflow-pricing-test','pricing-sales@stockflow.local','get_order_pricing',jsonb_build_object('orderId',v_order_id));
    raise exception 'Sales role retrieved restricted pricing';
  exception when insufficient_privilege then null;
  end;

  workspace:=public.stockflow_pricing_gateway('stockflow-pricing-test','pricing-accounts@stockflow.local','get_order_pricing',jsonb_build_object('orderId',v_order_id,'pricingDate','2026-09-12'));
  if workspace->'lines'->0->>'proposedRate'<>'485.00' or workspace->'lines'->0->'cost'->>'amount'<>'310.00' then raise exception 'Exact pricing resolution failed: %',workspace; end if;

  approved:=public.stockflow_pricing_gateway('stockflow-pricing-test','pricing-accounts@stockflow.local','submit_order_pricing',jsonb_build_object(
    'orderId',v_order_id,'expectedVersion',1,'pricingDate','2026-09-12','idempotencyKey','pricing-approve-000001',
    'lines',jsonb_build_array(jsonb_build_object('lineId',v_line_id,'enteredRate',485))
  ));
  replay:=public.stockflow_pricing_gateway('stockflow-pricing-test','pricing-accounts@stockflow.local','submit_order_pricing',jsonb_build_object(
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
    perform public.stockflow_pricing_gateway('stockflow-pricing-test','pricing-accounts@stockflow.local','submit_order_pricing',jsonb_build_object(
      'orderId',v_order_id,'expectedVersion',1,'pricingDate','2026-09-12','idempotencyKey','pricing-stale-0000001',
      'lines',jsonb_build_array(jsonb_build_object('lineId',v_line_id,'enteredRate',485))
    ));
    raise exception 'Stale pricing writer unexpectedly succeeded';
  exception when serialization_failure then null;
  end;
  if exists(select 1 from private.stockflow_command_results where idempotency_key='pricing-stale-0000001') then raise exception 'Failed pricing command left an idempotency result'; end if;
end $test$;

rollback;
