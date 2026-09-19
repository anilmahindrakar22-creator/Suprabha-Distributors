-- Approved customer price book: additive migration; existing pricing history remains intact.
create table private.stockflow_standard_item_prices (
  id uuid primary key default extensions.gen_random_uuid(),
  tally_item_key text not null check (char_length(btrim(tally_item_key)) between 1 and 240),
  price_amount numeric(18,2) not null check (price_amount > 0),
  currency text not null default 'INR' check (currency='INR'),
  valid_from date not null,
  valid_to date,
  status text not null check (status in ('approved','superseded')),
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  version integer not null default 1 check (version>0),
  supersedes_price_id uuid references private.stockflow_standard_item_prices(id) on delete restrict,
  approved_by_email text not null,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to>=valid_from)
);
alter table private.stockflow_standard_item_prices add constraint stockflow_standard_item_price_no_overlap
  exclude using gist (tally_item_key with =,daterange(valid_from,coalesce(valid_to,'infinity'::date),'[]') with &&)
  where (status='approved');
create index stockflow_standard_item_price_lookup_idx on private.stockflow_standard_item_prices(tally_item_key,valid_from desc) where status='approved';


alter table private.stockflow_standard_item_prices enable row level security;
create trigger stockflow_standard_item_price_no_delete before delete on private.stockflow_standard_item_prices for each row execute function private.prevent_business_delete();
create trigger stockflow_standard_item_price_values_immutable before update of tally_item_key,price_amount,valid_from,reason,approved_by_email,approved_at on private.stockflow_standard_item_prices for each row execute function private.prevent_immutable_pricing_update();
alter table private.stockflow_order_pricing_decisions drop constraint stockflow_order_pricing_decisions_resolution_type_check;
alter table private.stockflow_order_pricing_decisions add constraint stockflow_order_pricing_decisions_resolution_type_check check (resolution_type in ('approved_contract_price','standard_item_price','last_tally_invoice_price','price_review_required','price_exception'));
alter table private.stockflow_order_pricing_decisions drop constraint stockflow_order_pricing_decisions_source_type_check;
alter table private.stockflow_order_pricing_decisions add constraint stockflow_order_pricing_decisions_source_type_check check (source_type in ('approved_contract','standard_item_price','last_tally_invoice','manual_review'));
create or replace function private.stockflow_pricing_gateway_v1(
  p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
set search_path=pg_catalog as $$
declare
  v_email text:=lower(btrim(coalesce(p_actor_email,''))); v_role text; v_hash text;
  v_order private.stockflow_orders%rowtype; v_key text; v_replay jsonb; v_result jsonb;
  v_pricing_date date; v_line jsonb; v_resolved jsonb; v_entered numeric; v_difference numeric; v_difference_percent numeric;
  v_reason text; v_decision_id uuid; v_exception_id uuid; v_snapshot_id uuid; v_snapshot_version integer; v_decision_version integer;
  v_policy private.stockflow_pricing_policies%rowtype;
  v_previous_policy_id uuid;
  v_requires_approval boolean:=false; v_payload_lines jsonb:='[]'::jsonb; v_exception private.stockflow_price_exceptions%rowtype;
  v_contract private.stockflow_customer_product_prices%rowtype;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  select role into v_role from public.stockflow_members where email=v_email and status='active';
  perform private.stockflow_assert_pricing_role(v_role);
  begin v_pricing_date:=coalesce(nullif(p_payload->>'pricingDate','')::date,(now() at time zone 'Asia/Kolkata')::date);
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Valid pricing date is required' using errcode='22023'; end;

  if p_action='get_order_pricing' then
    select * into v_order from private.stockflow_orders where id=(p_payload->>'orderId')::uuid and archived_at is null;
    if not found then raise exception 'Order was not found' using errcode='22023'; end if;
    perform private.assert_stockflow_order_access(v_email,v_role,v_order.id);
    return private.stockflow_order_pricing_payload(v_order.id,v_pricing_date);
  end if;

  if p_action='list_price_contracts' then
    return jsonb_build_object('contracts',coalesce((select jsonb_agg(to_jsonb(contract_row) order by contract_row."validFrom" desc,contract_row."createdAt" desc) from (
      select p.id,p.customer_id as "customerId",c.name as "customerName",p.tally_item_key as "tallyKey",p.price_amount as price,p.currency,p.valid_from as "validFrom",p.valid_to as "validTo",p.status,p.source_type as source,p.source_reference as "sourceReference",p.reason,p.approved_by_email as "approvedBy",p.approved_at as "approvedAt",p.version,p.supersedes_price_id as "supersedesPriceId",p.created_by_email as "createdBy",p.created_at as "createdAt"
      from private.stockflow_customer_product_prices p join private.stockflow_customers c on c.id=p.customer_id
      where (nullif(p_payload->>'customerId','') is null or p.customer_id=(p_payload->>'customerId')::uuid)
        and (nullif(btrim(p_payload->>'tallyKey'),'') is null or p.tally_item_key=btrim(p_payload->>'tallyKey'))
      order by p.valid_from desc,p.created_at desc limit 200
    ) contract_row),'[]'::jsonb));
  end if;

  if p_action='list_customer_purchased_items' then
    return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(item_row) order by item_row."lastInvoiceDate" desc,item_row."itemName") from (
      select distinct on (sp.tally_item_key) sp.tally_item_key as "tallyKey",coalesce(product.name,sp.tally_item_key) as "itemName",sp.invoice_rate as "lastRate",sp.invoice_date as "lastInvoiceDate",sp.invoice_reference as "lastInvoiceReference"
      from private.stockflow_tally_sales_prices sp left join private.stockflow_products product on product.tally_item_key=sp.tally_item_key
      where sp.customer_id=(p_payload->>'customerId')::uuid and not sp.exceptional and sp.invoice_rate>0
      order by sp.tally_item_key,sp.invoice_date desc,sp.imported_at desc limit 500
    ) item_row),'[]'::jsonb));
  end if;

  if p_action='list_standard_item_prices' then
    return jsonb_build_object('prices',coalesce((select jsonb_agg(to_jsonb(price_row) order by price_row."validFrom" desc) from (
      select p.id,p.tally_item_key as "tallyKey",coalesce(product.name,p.tally_item_key) as "itemName",p.price_amount as price,p.valid_from as "validFrom",p.valid_to as "validTo",p.status,p.reason,p.version,p.approved_by_email as "approvedBy",p.approved_at as "approvedAt"
      from private.stockflow_standard_item_prices p left join private.stockflow_products product on product.tally_item_key=p.tally_item_key order by p.valid_from desc limit 500
    ) price_row),'[]'::jsonb));
  end if;

  if p_action='list_pricing_policies' then
    return jsonb_build_object('policies',coalesce((select jsonb_agg(to_jsonb(policy_row) order by policy_row."effectiveFrom" desc) from (
      select p.id,p.policy_version as "policyVersion",p.minimum_margin_percent as "minimumMarginPercent",p.target_margin_percent as "targetMarginPercent",p.override_approval_percent as "overrideApprovalPercent",p.rounding_increment as "roundingIncrement",p.rounding_rule_version as "roundingRuleVersion",p.effective_from as "effectiveFrom",p.effective_to as "effectiveTo",p.active,p.created_by_email as "createdBy",p.created_at as "createdAt"
      from private.stockflow_pricing_policies p order by p.effective_from desc limit 100
    ) policy_row),'[]'::jsonb));
  end if;

  v_key:=p_payload->>'idempotencyKey';
  v_replay:=private.begin_stockflow_command(v_email,p_action,v_key,p_payload);
  if v_replay is not null then return v_replay; end if;

  if p_action='create_pricing_policy' then
    if v_role not in ('administrator','management') then raise exception 'Pricing policy administration is restricted' using errcode='42501'; end if;
    v_reason:=nullif(btrim(coalesce(p_payload->>'reason','')),'');
    if v_reason is null then raise exception 'A pricing policy reason is required' using errcode='22023'; end if;
    begin
      v_pricing_date:=(p_payload->>'effectiveFrom')::date;
      perform (p_payload->>'minimumMarginPercent')::numeric,(p_payload->>'overrideApprovalPercent')::numeric,(p_payload->>'roundingIncrement')::numeric;
      if nullif(p_payload->>'targetMarginPercent','') is not null then perform (p_payload->>'targetMarginPercent')::numeric; end if;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'Valid pricing policy values are required' using errcode='22023'; end;
    perform 1 from private.stockflow_pricing_policies where active for update;
    select * into v_policy from private.stockflow_pricing_policies where active order by effective_from desc limit 1;
    if found and v_pricing_date<=v_policy.effective_from then raise exception 'New policy must start after the latest policy' using errcode='22023'; end if;
    if found then v_previous_policy_id:=v_policy.id; update private.stockflow_pricing_policies set effective_to=v_pricing_date-1 where id=v_policy.id; end if;
    insert into private.stockflow_pricing_policies(policy_version,minimum_margin_percent,target_margin_percent,override_approval_percent,rounding_increment,rounding_rule_version,effective_from,created_by_email)
    values(btrim(p_payload->>'policyVersion'),(p_payload->>'minimumMarginPercent')::numeric,nullif(p_payload->>'targetMarginPercent','')::numeric,(p_payload->>'overrideApprovalPercent')::numeric,(p_payload->>'roundingIncrement')::numeric,btrim(p_payload->>'roundingRuleVersion'),v_pricing_date,v_email)
    returning * into v_policy;
    insert into private.stockflow_pricing_events(entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata)
    values('pricing_policy',v_policy.id,'pricing_policy_created',v_email,v_role,v_key,jsonb_build_object('reason',v_reason,'policyVersion',v_policy.policy_version,'effectiveFrom',v_policy.effective_from,'previousPolicyId',v_previous_policy_id));
    v_result:=jsonb_build_object('ok',true,'policyId',v_policy.id,'policyVersion',v_policy.policy_version,'effectiveFrom',v_policy.effective_from);
    perform private.finish_stockflow_command(v_email,p_action,v_key,p_payload,v_policy.id,v_result);
    return v_result;
  end if;

  if p_action='set_standard_item_price' then
    if v_role not in ('administrator','management') then raise exception 'Standard item price administration is restricted' using errcode='42501'; end if;
    v_reason:=nullif(btrim(coalesce(p_payload->>'reason','')),'');
    if v_reason is null then raise exception 'A standard item price reason is required' using errcode='22023'; end if;
    begin v_pricing_date:=(p_payload->>'validFrom')::date; v_entered:=(p_payload->>'price')::numeric;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'Valid standard item price values are required' using errcode='22023'; end;
    if v_entered<=0 then raise exception 'Standard item price must be positive' using errcode='22023'; end if;
    select id into v_previous_policy_id from private.stockflow_standard_item_prices where tally_item_key=btrim(p_payload->>'tallyKey') and status='approved' order by valid_from desc limit 1 for update;
    if v_previous_policy_id is not null then
      if v_pricing_date<=(select valid_from from private.stockflow_standard_item_prices where id=v_previous_policy_id) then raise exception 'New standard price must start after the current price' using errcode='22023'; end if;
      update private.stockflow_standard_item_prices set status='superseded',valid_to=v_pricing_date-1,version=version+1 where id=v_previous_policy_id;
    end if;
    insert into private.stockflow_standard_item_prices(tally_item_key,price_amount,valid_from,status,reason,supersedes_price_id,approved_by_email)
    values(btrim(p_payload->>'tallyKey'),v_entered,v_pricing_date,'approved',v_reason,v_previous_policy_id,v_email) returning id into v_decision_id;
    insert into private.stockflow_pricing_events(entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata)
    values('standard_item_price',v_decision_id,'standard_item_price_set',v_email,v_role,v_key,jsonb_build_object('reason',v_reason,'tallyKey',p_payload->>'tallyKey','validFrom',v_pricing_date,'supersedesPriceId',v_previous_policy_id));
    v_result:=jsonb_build_object('ok',true,'priceId',v_decision_id,'status','approved');
    perform private.finish_stockflow_command(v_email,p_action,v_key,p_payload,v_decision_id,v_result); return v_result;
  end if;

  if p_action='create_price_contract' then
    if jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid customer price request' using errcode='22023'; end if;
    begin
      insert into private.stockflow_customer_product_prices(customer_id,tally_item_key,price_amount,valid_from,valid_to,status,source_type,source_reference,reason,supersedes_price_id,created_by_email)
      values((p_payload->>'customerId')::uuid,btrim(p_payload->>'tallyKey'),(p_payload->>'price')::numeric,(p_payload->>'validFrom')::date,nullif(p_payload->>'validTo','')::date,'pending_approval',p_payload->>'source',nullif(btrim(p_payload->>'sourceReference'),''),btrim(p_payload->>'reason'),nullif(p_payload->>'supersedesPriceId','')::uuid,v_email)
      returning id into v_decision_id;
    exception when foreign_key_violation then raise exception 'Customer or superseded price was not found' using errcode='22023'; end;
    insert into private.stockflow_pricing_events(entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata)
    values('customer_price',v_decision_id,'customer_price_requested',v_email,v_role,v_key,jsonb_build_object('source',p_payload->>'source','validFrom',p_payload->>'validFrom','validTo',p_payload->>'validTo'));
    v_result:=jsonb_build_object('ok',true,'contractId',v_decision_id,'status','pending_approval','version',1);
    perform private.finish_stockflow_command(v_email,p_action,v_key,p_payload,v_decision_id,v_result);
    return v_result;
  end if;

  if p_action in ('approve_price_contract','reject_price_contract') then
    if v_role not in ('administrator','management') then raise exception 'Customer price approval is restricted' using errcode='42501'; end if;
    select * into v_contract from private.stockflow_customer_product_prices where id=(p_payload->>'contractId')::uuid for update;
    if not found then raise exception 'Customer price was not found' using errcode='22023'; end if;
    if v_contract.version<>(p_payload->>'expectedVersion')::integer then raise exception 'Customer price has changed; refresh before trying again' using errcode='40001'; end if;
    if v_contract.status<>'pending_approval' then raise exception 'Customer price is already decided' using errcode='22023'; end if;
    v_reason:=nullif(btrim(coalesce(p_payload->>'reason','')),'');
    if v_reason is null then raise exception 'A decision reason is required' using errcode='22023'; end if;
    if p_action='approve_price_contract' and v_contract.supersedes_price_id is not null then
      if not exists(select 1 from private.stockflow_customer_product_prices old where old.id=v_contract.supersedes_price_id and old.status='approved' and old.customer_id=v_contract.customer_id and old.tally_item_key=v_contract.tally_item_key and old.valid_from<v_contract.valid_from) then
        raise exception 'Superseded customer price must be an earlier approved price for the same customer and item' using errcode='22023';
      end if;
      update private.stockflow_customer_product_prices set status='superseded',valid_to=v_contract.valid_from-1,version=version+1 where id=v_contract.supersedes_price_id;
    end if;
    update private.stockflow_customer_product_prices set status=case when p_action='approve_price_contract' then 'approved' else 'rejected' end,approved_by_email=case when p_action='approve_price_contract' then v_email end,approved_at=case when p_action='approve_price_contract' then now() end,version=version+1 where id=v_contract.id;
    insert into private.stockflow_pricing_events(entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata)
    values('customer_price',v_contract.id,case when p_action='approve_price_contract' then 'customer_price_approved' else 'customer_price_rejected' end,v_email,v_role,v_key,jsonb_build_object('reason',v_reason,'previousStatus',v_contract.status));
    v_result:=jsonb_build_object('ok',true,'contractId',v_contract.id,'status',case when p_action='approve_price_contract' then 'approved' else 'rejected' end,'version',v_contract.version+1);
    perform private.finish_stockflow_command(v_email,p_action,v_key,p_payload,v_contract.id,v_result);
    return v_result;
  end if;

  if p_action='submit_order_pricing' then
    select * into v_order from private.stockflow_orders where id=(p_payload->>'orderId')::uuid and archived_at is null for update;
    if not found then raise exception 'Order was not found' using errcode='22023'; end if;
    perform private.assert_stockflow_order_access(v_email,v_role,v_order.id);
    if v_order.version<>(p_payload->>'expectedVersion')::integer then raise exception 'Order has changed; refresh before trying again' using errcode='40001'; end if;
    if v_order.customer_id is null then raise exception 'A canonical Tally customer is required for pricing' using errcode='22023'; end if;
    if exists(select 1 from private.stockflow_price_exceptions where order_id=v_order.id and state='pending') then
      raise exception 'Pricing approval is already pending; decide it before submitting new pricing' using errcode='40001';
    end if;
    if jsonb_typeof(p_payload->'lines')<>'array' or jsonb_array_length(p_payload->'lines')<>(select count(*) from private.stockflow_order_lines where order_id=v_order.id) then raise exception 'Every order line requires a pricing decision' using errcode='22023'; end if;
    select coalesce(max(decision_version),0)+1 into v_decision_version from private.stockflow_order_pricing_decisions where order_id=v_order.id;
    for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
      v_exception_id:=null;
      v_resolved:=private.stockflow_resolve_pricing_line((v_line->>'lineId')::uuid,v_pricing_date);
      if (v_resolved->>'lineId')::uuid not in (select id from private.stockflow_order_lines where order_id=v_order.id) then raise exception 'Pricing line does not belong to order' using errcode='22023'; end if;
      begin v_entered:=(v_line->>'enteredRate')::numeric; exception when others then raise exception 'Every line requires a valid selling rate' using errcode='22023'; end;
      if v_entered<=0 then raise exception 'Every line requires a positive selling rate' using errcode='22023'; end if;
      v_reason:=nullif(btrim(coalesce(v_line->>'reason','')),'');
      v_difference:=case when (v_resolved->>'proposedRate') is null then null else v_entered-(v_resolved->>'proposedRate')::numeric end;
      v_difference_percent:=case when coalesce((v_resolved->>'proposedRate')::numeric,0)>0 then v_difference/(v_resolved->>'proposedRate')::numeric*100 end;
      v_requires_approval:=(v_resolved->>'guardrail')='PRICE_REVIEW_REQUIRED'
        or ((v_resolved->'cost'->>'amount') is not null and (v_entered-(v_resolved->'cost'->>'amount')::numeric)/v_entered*100<(v_resolved->'policy'->>'minimumMarginPercent')::numeric)
        or (v_resolved->'source'->>'type'='APPROVED_CONTRACT' and v_difference is distinct from 0)
        or (v_difference_percent is not null and abs(v_difference_percent)>((v_resolved->'policy'->>'overrideApprovalPercent')::numeric));
      if (v_requires_approval or v_difference is distinct from 0) and v_reason is null then raise exception 'A pricing exception reason is required' using errcode='22023'; end if;
      insert into private.stockflow_order_pricing_decisions(
        order_id,order_line_id,decision_version,order_version,state,resolution_type,proposed_rate,approved_rate,source_type,source_reference,source_date,source_version,contract_price_id,cost_id,cost_amount,cost_source_version,gross_profit_amount,gross_margin_percent,previous_gross_margin_percent,margin_erosion_points,guardrail_state,suggestion_amount,suggestion_unrounded,pricing_policy_id,pricing_policy_version,rounding_rule_version,exception_reason,requested_by_email,approved_by_email,approved_at,request_id
      ) values (
        v_order.id,(v_resolved->>'lineId')::uuid,v_decision_version,v_order.version,case when v_requires_approval then 'pending_approval' else 'approved' end,
        case when v_requires_approval then 'price_exception' when v_resolved->'source'->>'type'='APPROVED_CONTRACT' then 'approved_contract_price' when v_resolved->'source'->>'type'='STANDARD_ITEM_PRICE' then 'standard_item_price' when v_resolved->'source'->>'type'='LAST_TALLY_INVOICE' then 'last_tally_invoice_price' else 'price_review_required' end,
        (v_resolved->>'proposedRate')::numeric,v_entered,case when v_resolved->'source'->>'type'='APPROVED_CONTRACT' then 'approved_contract' when v_resolved->'source'->>'type'='STANDARD_ITEM_PRICE' then 'standard_item_price' when v_resolved->'source'->>'type'='LAST_TALLY_INVOICE' then 'last_tally_invoice' else 'manual_review' end,
        v_resolved->'source'->>'reference',nullif(v_resolved->'source'->>'date','')::date,v_resolved->'source'->>'version',nullif(v_resolved->'source'->>'contractId','')::uuid,nullif(v_resolved->'cost'->>'id','')::uuid,nullif(v_resolved->'cost'->>'amount','')::numeric,v_resolved->'cost'->>'sourceVersion',
        v_entered-coalesce((v_resolved->'cost'->>'amount')::numeric,0),case when v_entered>0 and v_resolved->'cost' is not null then (v_entered-(v_resolved->'cost'->>'amount')::numeric)/v_entered*100 end,
        nullif(v_resolved->'margin'->>'previousGrossMarginPercent','')::numeric,nullif(v_resolved->'margin'->>'erosionPercentagePoints','')::numeric,lower(v_resolved->>'guardrail'),
        nullif(v_resolved->'suggestion'->>'amount','')::numeric,nullif(v_resolved->'suggestion'->>'unroundedAmount','')::numeric,(v_resolved->'policy'->>'id')::uuid,v_resolved->'policy'->>'version',v_resolved->'policy'->>'roundingRuleVersion',v_reason,v_email,case when v_requires_approval then null else v_email end,case when v_requires_approval then null else now() end,v_key
      ) returning id into v_decision_id;
      if v_requires_approval then
      insert into private.stockflow_price_exceptions(decision_id,order_id,order_line_id,reference_rate,entered_rate,difference_amount,difference_percent,reason,state,requested_by_email)
        values(v_decision_id,v_order.id,(v_resolved->>'lineId')::uuid,(v_resolved->>'proposedRate')::numeric,v_entered,v_difference,v_difference_percent,v_reason,'pending',v_email)
        returning id into v_exception_id;
      end if;
      insert into private.stockflow_pricing_events(entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata)
      values('order_pricing',v_decision_id,case when v_requires_approval then 'price_exception_requested' else 'order_line_price_approved' end,v_email,v_role,v_key,jsonb_build_object('orderId',v_order.id,'lineId',v_resolved->>'lineId','guardrail',v_resolved->>'guardrail','source',v_resolved->'source'));
      v_payload_lines:=v_payload_lines||jsonb_build_array(jsonb_build_object('decisionId',v_decision_id,'lineId',v_resolved->>'lineId','enteredRate',v_entered,'requiresApproval',v_requires_approval,'exceptionId',v_exception_id,'resolution',v_resolved));
    end loop;
    if exists(select 1 from private.stockflow_order_pricing_decisions where order_id=v_order.id and decision_version=v_decision_version and state='pending_approval') then
      update private.stockflow_orders set pricing_state='approval_required',pricing_snapshot_id=null,version=version+1,updated_by_email=v_email,updated_at=now() where id=v_order.id;
      update private.stockflow_order_lines set pricing_state='approval_required',approved_pricing_decision_id=null where order_id=v_order.id;
      v_result:=jsonb_build_object('ok',true,'orderId',v_order.id,'pricingState','approval_required','version',v_order.version+1,'lines',v_payload_lines);
    else
      select coalesce(max(snapshot_version),0)+1 into v_snapshot_version from private.stockflow_billing_snapshots where order_id=v_order.id;
      insert into private.stockflow_billing_snapshots(order_id,snapshot_version,order_version,pricing_payload,snapshot_hash,created_by_email)
      values(v_order.id,v_snapshot_version,v_order.version,v_payload_lines,encode(extensions.digest(v_payload_lines::text,'sha256'),'hex'),v_email) returning id into v_snapshot_id;
      update private.stockflow_order_lines l set pricing_state='approved',approved_pricing_decision_id=d.id from private.stockflow_order_pricing_decisions d where l.order_id=v_order.id and d.order_line_id=l.id and d.decision_version=v_decision_version;
      update private.stockflow_orders set pricing_state='approved',pricing_snapshot_id=v_snapshot_id,version=version+1,updated_by_email=v_email,updated_at=now() where id=v_order.id;
      insert into private.stockflow_order_events(order_id,event_type,from_status,to_status,actor_email,actor_role,metadata) values(v_order.id,'order_pricing_approved',v_order.status,v_order.status,v_email,v_role,jsonb_build_object('snapshotId',v_snapshot_id,'snapshotVersion',v_snapshot_version,'requestId',v_key));
      insert into private.stockflow_outbox(topic,aggregate_id,payload) values('order.pricing_approved',v_order.id,jsonb_build_object('snapshotId',v_snapshot_id,'snapshotVersion',v_snapshot_version,'requestId',v_key));
      insert into private.stockflow_pricing_events(entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata) values('billing_snapshot',v_snapshot_id,'billing_snapshot_created',v_email,v_role,v_key,jsonb_build_object('orderId',v_order.id,'snapshotVersion',v_snapshot_version));
      v_result:=jsonb_build_object('ok',true,'orderId',v_order.id,'pricingState','approved','snapshotId',v_snapshot_id,'snapshotVersion',v_snapshot_version,'version',v_order.version+1);
    end if;
    perform private.finish_stockflow_command(v_email,p_action,v_key,p_payload,v_order.id,v_result);
    return v_result;
  end if;

  if p_action in ('approve_price_exception','reject_price_exception') then
    select * into v_exception from private.stockflow_price_exceptions where id=(p_payload->>'exceptionId')::uuid for update;
    if not found then raise exception 'Pricing exception was not found' using errcode='22023'; end if;
    if v_role not in ('administrator','management') then raise exception 'Pricing exception approval is restricted' using errcode='42501'; end if;
    if v_exception.version<>(p_payload->>'expectedVersion')::integer then raise exception 'Pricing exception has changed; refresh before trying again' using errcode='40001'; end if;
    if v_exception.state<>'pending' then raise exception 'Pricing exception is already decided' using errcode='22023'; end if;
    v_reason:=nullif(btrim(coalesce(p_payload->>'reason','')),'');
    if v_reason is null then raise exception 'A decision reason is required' using errcode='22023'; end if;
    update private.stockflow_price_exceptions set state=case when p_action='approve_price_exception' then 'approved' else 'rejected' end,decided_by_email=v_email,decided_at=now(),decision_reason=v_reason,version=version+1 where id=v_exception.id;
    update private.stockflow_order_pricing_decisions set state=case when p_action='approve_price_exception' then 'approved' else 'rejected' end,approved_by_email=case when p_action='approve_price_exception' then v_email end,approved_at=case when p_action='approve_price_exception' then now() end where id=v_exception.decision_id;
    insert into private.stockflow_pricing_events(entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata) values('price_exception',v_exception.id,case when p_action='approve_price_exception' then 'price_exception_approved' else 'price_exception_rejected' end,v_email,v_role,v_key,jsonb_build_object('reason',v_reason,'orderId',v_exception.order_id));
    select * into v_order from private.stockflow_orders where id=v_exception.order_id for update;
    if p_action='reject_price_exception' then
      with rejected_siblings as (
        update private.stockflow_price_exceptions
          set state='rejected',decided_by_email=v_email,decided_at=now(),decision_reason='Pricing batch rejected after a related exception was declined',version=version+1
          where order_id=v_order.id and state='pending'
          returning id
      )
      insert into private.stockflow_pricing_events(entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata)
        select 'price_exception',id,'price_exception_batch_rejected',v_email,v_role,v_key,jsonb_build_object('reason',v_reason,'triggerExceptionId',v_exception.id)
        from rejected_siblings;
      update private.stockflow_order_pricing_decisions
        set state='rejected'
        where order_id=v_order.id and decision_version=(select decision_version from private.stockflow_order_pricing_decisions where id=v_exception.decision_id)
          and state in ('pending_approval','approved');
      update private.stockflow_orders set pricing_state='review_required',version=version+1,updated_by_email=v_email,updated_at=now() where id=v_order.id;
      update private.stockflow_order_lines set pricing_state='review_required',approved_pricing_decision_id=null where order_id=v_order.id;
      insert into private.stockflow_pricing_events(entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata)
        values('order_pricing',v_order.id,'pricing_batch_rejected',v_email,v_role,v_key,jsonb_build_object('reason',v_reason,'exceptionId',v_exception.id));
    elsif not exists(select 1 from private.stockflow_price_exceptions where order_id=v_order.id and state='pending') then
      select max(decision_version) into v_decision_version from private.stockflow_order_pricing_decisions where order_id=v_order.id;
      select coalesce(max(snapshot_version),0)+1 into v_snapshot_version from private.stockflow_billing_snapshots where order_id=v_order.id;
      select coalesce(jsonb_agg(to_jsonb(d) order by d.order_line_id),'[]'::jsonb) into v_payload_lines from private.stockflow_order_pricing_decisions d where d.order_id=v_order.id and d.decision_version=v_decision_version and d.state='approved';
      if jsonb_array_length(v_payload_lines)<>(select count(*) from private.stockflow_order_lines where order_id=v_order.id) then raise exception 'Not every pricing decision is approved' using errcode='55000'; end if;
      insert into private.stockflow_billing_snapshots(order_id,snapshot_version,order_version,pricing_payload,snapshot_hash,created_by_email) values(v_order.id,v_snapshot_version,v_order.version,v_payload_lines,encode(extensions.digest(v_payload_lines::text,'sha256'),'hex'),v_email) returning id into v_snapshot_id;
      update private.stockflow_order_lines l set pricing_state='approved',approved_pricing_decision_id=d.id from private.stockflow_order_pricing_decisions d where l.order_id=v_order.id and d.order_line_id=l.id and d.decision_version=v_decision_version;
      update private.stockflow_orders set pricing_state='approved',pricing_snapshot_id=v_snapshot_id,version=version+1,updated_by_email=v_email,updated_at=now() where id=v_order.id;
      insert into private.stockflow_order_events(order_id,event_type,from_status,to_status,reason,actor_email,actor_role,metadata) values(v_order.id,'price_exception_approved',v_order.status,v_order.status,v_reason,v_email,v_role,jsonb_build_object('exceptionId',v_exception.id,'snapshotId',v_snapshot_id,'requestId',v_key));
      insert into private.stockflow_outbox(topic,aggregate_id,payload) values('order.pricing_approved',v_order.id,jsonb_build_object('snapshotId',v_snapshot_id,'requestId',v_key));
    end if;
    v_result:=jsonb_build_object('ok',true,'orderId',v_order.id,'exceptionId',v_exception.id,'decision',case when p_action='approve_price_exception' then 'approved' else 'rejected' end,'pricingState',(select pricing_state from private.stockflow_orders where id=v_order.id),'version',(select version from private.stockflow_orders where id=v_order.id));
    perform private.finish_stockflow_command(v_email,p_action,v_key,p_payload,v_order.id,v_result);
    return v_result;
  end if;
  raise exception 'Unsupported pricing action' using errcode='22023';
end $$;

revoke all on function private.stockflow_pricing_gateway_v1(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function private.stockflow_pricing_gateway_v1(text,text,text,jsonb) to service_role;
