-- Real pricing producers and order transitions; no hand-built or rewritten snapshots.
begin;
alter table public.stockflow_members drop constraint if exists stockflow_members_roles_pending_union;
update private.stockflow_gateway_config
set secret_sha256=encode(extensions.digest('billing-shapes-test-key','sha256'),'hex') where name='orders';
update private.stockflow_pricing_policies set active=false where active;
insert into private.stockflow_pricing_policies(policy_version,minimum_margin_percent,target_margin_percent,
  override_approval_percent,rounding_increment,rounding_rule_version,effective_from,created_by_email)
values('billing-shapes-test',25,30,5,1,'billing-shapes-rounding',(now() at time zone 'Asia/Kolkata')::date-90,'test');
insert into public.stockflow_members(email,role,status) values
  ('admin@billingshapes.test.local','administrator','active'),
  ('requester@billingshapes.test.local','accounts','active'),
  ('management@billingshapes.test.local','management','active'),
  ('billing@billingshapes.test.local','billing','active');
update public.stockflow_members set roles=array[role] where email like '%@billingshapes.test.local';

-- Seed saved orders like the existing pricing fixtures. All subsequent status and
-- pricing changes use gateways, including the exact Confirm transition used by the UI.
create function pg_temp.billing_shapes_order(p_customer uuid,p_item text,p_name text)
returns uuid language plpgsql as $$
declare o uuid;
begin
  insert into private.stockflow_orders(order_number,customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email)
  values(private.stockflow_next_order_number(now()),p_customer,'Billing shapes customer','phone','awaiting_confirmation',
    'billing-shapes-order-'||p_name,'requester@billingshapes.test.local','requester@billingshapes.test.local') returning id into o;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,base_unit,quantity)
  values(o,p_item,p_item,'Nos',2);
  return o;
end $$;

create function pg_temp.billing_shapes_transition(p_order uuid,p_status text,p_invoice text default null)
returns void language plpgsql as $$
declare result jsonb;
begin
  result := public.stockflow_order_gateway('billing-shapes-test-key',
    case when p_status='billed_in_tally' then 'billing@billingshapes.test.local' else 'admin@billingshapes.test.local' end,
    'transition_order',jsonb_build_object('orderId',p_order,
      'expectedVersion',(select version from private.stockflow_orders where id=p_order),
      'toStatus',p_status,'tallyInvoiceNumber',p_invoice,'idempotencyKey','billing-shapes-'||p_order||'-'||p_status));
  if result->>'status' is distinct from p_status
    or (select status from private.stockflow_orders where id=p_order) is distinct from p_status then
    raise exception 'Order transition failed: % %',p_status,result;
  end if;
end $$;

create function pg_temp.billing_shapes_assert_sheet(p_order uuid,p_shape text,p_rate numeric)
returns void language plpgsql as $$
declare snap jsonb; sheet jsonb; line_id uuid; decision_rate numeric;
begin
  select s.pricing_payload into strict snap from private.stockflow_orders o
  join private.stockflow_billing_snapshots s on s.id=o.pricing_snapshot_id and s.order_id=o.id
  where o.id=p_order and o.pricing_state='approved' and s.invalidated_at is null;
  if jsonb_array_length(snap) is distinct from 1 or (snap->0 ? p_shape) is distinct from true then
    raise exception 'Expected producer shape %, got %',p_shape,snap;
  end if;
  select l.id,d.approved_rate into strict line_id,decision_rate from private.stockflow_order_lines l
  join private.stockflow_order_pricing_decisions d on d.id=l.approved_pricing_decision_id
    and d.order_id=l.order_id and d.order_line_id=l.id and d.state='approved'
  where l.order_id=p_order;
  if decision_rate is distinct from p_rate then raise exception 'Unexpected approved decision rate: %',decision_rate; end if;
  sheet := public.stockflow_pricing_gateway('billing-shapes-test-key','billing@billingshapes.test.local',
    'get_order_pricing',jsonb_build_object('orderId',p_order,'view','billing'));
  if sheet->>'ready' is distinct from 'true' or sheet->>'status' is distinct from 'awaiting_tally_billing'
    or jsonb_array_length(sheet->'lines') is distinct from 1
    or sheet->'lines'->0->>'lineId' is distinct from line_id::text
    or (sheet->'lines'->0->>'approvedRate')::numeric is distinct from decision_rate
    or (sheet->'lines'->0->>'billQuantity')::numeric is distinct from 2::numeric
    or (sheet->'lines'->0->>'amount')::numeric is distinct from round(p_rate*2,2)
    or (sheet->>'total')::numeric is distinct from round(p_rate*2,2) then
    raise exception 'Billing sheet did not use the sealed approved rate: %',sheet;
  end if;
end $$;

do $scenarios$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  customer uuid; o uuid; governed_order uuid; line_id uuid; exception_id uuid; decision_id uuid;
  item text; scenario text; shape text; role_name text;
  rate numeric; governed_rate numeric; resolved jsonb; result jsonb; snap jsonb; sealed_snap jsonb;
begin
  insert into private.stockflow_customers(name,tally_key,created_by_email)
  values('Billing shapes customer','billing-shapes-customer','test') returning id into customer;
  foreach item in array array['BILLING-SHAPES-GOV','BILLING-SHAPES-REM','BILLING-SHAPES-CHANGED'] loop
    insert into private.stockflow_products(tally_item_key,name,base_unit) values(item,item,'Nos');
    insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
    values(item,3465,'purchase_price',today-20,item||'-cost',item||'-cost','1');
    insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version)
    values(customer,item,6000,today-10,item||'-sale',item||'-sale','1');
  end loop;

  -- Both governed producers, both approval variants, and remembered repeat orders
  -- through Confirm AND explicit apply. One line per item in every order.
  foreach scenario in array array['confirm','apply','exception','changed','repeat_confirm','repeat_apply'] loop
    item := case when scenario in ('exception','repeat_confirm','repeat_apply') then 'BILLING-SHAPES-REM'
      when scenario='changed' then 'BILLING-SHAPES-CHANGED' else 'BILLING-SHAPES-GOV' end;
    rate := case when scenario in ('exception','repeat_confirm','repeat_apply') then 4450
      when scenario='changed' then 4510 else 6000 end;
    shape := case when scenario in ('exception','changed') then 'order_line_id' else 'lineId' end;
    o := pg_temp.billing_shapes_order(customer,item,scenario);
    select id into strict line_id from private.stockflow_order_lines where order_id=o;
    resolved := private.stockflow_resolve_pricing_line(line_id,today);
    if resolved->>'guardrail' is distinct from 'PRICE_OK' then
      raise exception 'Fixture must resolve PRICE_OK before pricing: % %',scenario,resolved;
    end if;
    if scenario in ('repeat_confirm','repeat_apply') and
      (resolved->'source'->>'type' is distinct from 'APPROVED_CONTRACT'
        or (resolved->>'proposedRate')::numeric is distinct from 4450::numeric) then
      raise exception 'Repeat did not resolve remembered customer rate: %',resolved;
    end if;

    if scenario in ('exception','changed') then
      result := public.stockflow_pricing_gateway('billing-shapes-test-key','requester@billingshapes.test.local',
        'submit_order_pricing',jsonb_build_object('orderId',o,
          'expectedVersion',(select version from private.stockflow_orders where id=o),
          'idempotencyKey','billing-shapes-submit-'||scenario,
          'lines',jsonb_build_array(jsonb_build_object('lineId',line_id,'enteredRate',4450,
            'reason','Requested customer discount','evidenceHash',resolved->>'evidenceHash'))));
      if result->>'pricingState' is distinct from 'approval_required' then
        raise exception 'Expected approval-required exception: %',result;
      end if;
      select id into strict exception_id from private.stockflow_price_exceptions where order_id=o and state='pending';
      -- Omit saveAsCustomerPrice: default approval must remember this rate.
      result := public.stockflow_pricing_gateway('billing-shapes-test-key','management@billingshapes.test.local',
        'approve_price_exception',jsonb_build_object('exceptionId',exception_id,'expectedVersion',1,
          'reason','Approved customer discount','idempotencyKey','billing-shapes-approve-'||scenario)
          ||case when scenario='changed' then jsonb_build_object('changedRate',4510) else '{}'::jsonb end);
      if result->>'pricingState' is distinct from 'approved' or not exists(
        select 1 from private.stockflow_customer_product_prices
        where origin_exception_id=exception_id and status='approved' and price_amount=rate) then
        raise exception 'Approval did not seal and remember the rate: %',result;
      end if;
    elsif scenario in ('apply','repeat_apply') then
      result := public.stockflow_pricing_gateway('billing-shapes-test-key','requester@billingshapes.test.local',
        'apply_governed_order_pricing',jsonb_build_object('orderId',o,
          'expectedVersion',(select version from private.stockflow_orders where id=o),
          'idempotencyKey','billing-shapes-apply-'||scenario));
      if result->>'pricingState' is distinct from 'approved' then raise exception 'Governed apply failed: %',result; end if;
    end if;

    perform pg_temp.billing_shapes_transition(o,'confirmed');
    select s.pricing_payload into strict snap from private.stockflow_orders ord
    join private.stockflow_billing_snapshots s on s.id=ord.pricing_snapshot_id where ord.id=o;
    if (snap->0 ? shape) is distinct from true then raise exception 'Wrong snapshot shape: % %',scenario,snap; end if;
    if shape='lineId' and ((snap->0->>'requiresApproval')::boolean is distinct from false
      or (snap->0->>'enteredRate')::numeric is distinct from rate
      or exists(select 1 from private.stockflow_price_exceptions where order_id=o)) then
      raise exception 'Governed producer did not approve directly: % %',scenario,snap;
    end if;
    if scenario in ('confirm','repeat_confirm') and not exists(
      select 1 from private.stockflow_pricing_events where event_type='governed_order_price_auto_approved'
        and metadata->>'orderId'=o::text) then
      raise exception 'Confirm did not exercise automatic pricing: %',scenario;
    end if;
    perform pg_temp.billing_shapes_transition(o,'packed');
    perform pg_temp.billing_shapes_transition(o,'awaiting_tally_billing');
    perform pg_temp.billing_shapes_assert_sheet(o,shape,rate);
    if scenario='confirm' then governed_order := o; governed_rate := rate; end if;
  end loop;

  -- Billing records the invoice through the same transition as the billing UI.
  perform pg_temp.billing_shapes_transition(governed_order,'billed_in_tally','SD/26-27/SHAPES');
  if (select tally_invoice_number from private.stockflow_orders where id=governed_order) is distinct from 'SD/26-27/SHAPES'
    or not exists(select 1 from private.stockflow_order_tally_invoices
      where order_id=governed_order and voucher_reference='SD/26-27/SHAPES') then
    raise exception 'Billing transition did not persist invoice linkage';
  end if;
  insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version,imported_at)
  values(customer,'BILLING-SHAPES-GOV',governed_rate,today,'SD/26-27/SHAPES','billing-shapes-invoice|1','1',now());
  result := public.stockflow_pricing_gateway('billing-shapes-test-key','requester@billingshapes.test.local',
    'get_order_pricing',jsonb_build_object('orderId',governed_order,'view','rate_check'));
  if result->>'state' is distinct from 'matches' or result->'lines'->0->>'state' is distinct from 'matches'
    or (result->'lines'->0->>'approvedRate')::numeric is distinct from governed_rate
    or (result->'lines'->0->>'difference')::numeric is distinct from 0::numeric then
    raise exception 'Governed invoice rate did not match: %',result;
  end if;
  -- Tally history is append-only; the later version of the same source wins.
  insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version,imported_at)
  values(customer,'BILLING-SHAPES-GOV',governed_rate-2,today,'SD/26-27/SHAPES','billing-shapes-invoice|1','2',now()+interval '1 second');
  result := public.stockflow_pricing_gateway('billing-shapes-test-key','requester@billingshapes.test.local',
    'get_order_pricing',jsonb_build_object('orderId',governed_order,'view','rate_check'));
  if result->>'state' is distinct from 'different' or result->'lines'->0->>'state' is distinct from 'different'
    or (result->'lines'->0->>'difference')::numeric is distinct from -2::numeric then
    raise exception 'Two-rupee invoice mismatch was not detected: %',result;
  end if;

  -- Corrupt only the referenced decision within this rollback transaction.
  -- The sealed payload stays unchanged, and neither reader may infer approval.
  select s.pricing_payload into strict sealed_snap from private.stockflow_orders ord
  join private.stockflow_billing_snapshots s on s.id=ord.pricing_snapshot_id where ord.id=governed_order;
  decision_id := (sealed_snap->0->>'decisionId')::uuid;
  foreach scenario in array array['unapproved','rate_mismatch'] loop
    update private.stockflow_order_pricing_decisions
    set state=case when scenario='unapproved' then 'pending_approval' else 'approved' end,
      approved_rate=case when scenario='rate_mismatch' then governed_rate+1 else governed_rate end
    where id=decision_id;
    if exists(select 1 from private.stockflow_snapshot_approved_rates(governed_order,sealed_snap)) then
      raise exception 'Unsafe governed decision contributed a rate: %',scenario;
    end if;
    result := public.stockflow_pricing_gateway('billing-shapes-test-key','billing@billingshapes.test.local',
      'get_order_pricing',jsonb_build_object('orderId',governed_order,'view','billing'));
    if result->>'ready' is distinct from 'false' or result->>'reason' is distinct from 'An item has no approved price' then
      raise exception 'Unsafe governed decision made sheet ready: % %',scenario,result;
    end if;
    result := public.stockflow_pricing_gateway('billing-shapes-test-key','requester@billingshapes.test.local',
      'get_order_pricing',jsonb_build_object('orderId',governed_order,'view','rate_check'));
    if result->'lines'->0->>'state' is distinct from 'no_approved_rate' then
      raise exception 'Rate check accepted unsafe governed decision: % %',scenario,result;
    end if;
  end loop;
  update private.stockflow_order_pricing_decisions set state='approved',approved_rate=governed_rate where id=decision_id;
  if sealed_snap is distinct from (select s.pricing_payload from private.stockflow_orders ord
      join private.stockflow_billing_snapshots s on s.id=ord.pricing_snapshot_id where ord.id=governed_order)
    or (select count(*) from private.stockflow_snapshot_approved_rates(governed_order,sealed_snap))<>1
    or exists(select 1 from private.stockflow_snapshot_approved_rates(o,sealed_snap)) then
    raise exception 'Snapshot changed, restored decision missing, or cross-order rate accepted';
  end if;

  foreach role_name in array array['anon','authenticated','service_role'] loop
    if has_function_privilege(role_name,'private.stockflow_snapshot_approved_rates(uuid,jsonb)','execute') then
      raise exception 'Snapshot helper exposed to %',role_name;
    end if;
  end loop;
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid='private.stockflow_snapshot_approved_rates(uuid,jsonb)'::regprocedure
      and a.grantee=0 and a.privilege_type='EXECUTE') then
    raise exception 'Snapshot helper exposed to PUBLIC';
  end if;
end $scenarios$;

rollback;
