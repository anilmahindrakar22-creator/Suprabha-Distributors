-- Customer-first pricing correction.
-- Keep authoritative evidence and accepted price-book decisions separate while
-- exposing the price that current order resolution will actually consume.
alter function private.stockflow_customer_price(uuid,text,date)
  rename to stockflow_customer_price_before_customer_first;

revoke all on function private.stockflow_customer_price_before_customer_first(uuid,text,date)
  from public,anon,authenticated,service_role;

create or replace function private.stockflow_customer_price(
  p_customer uuid,
  p_item text,
  p_date date
)
returns jsonb
language plpgsql
stable
set search_path=pg_catalog,private
as $$
declare
  base jsonb;
  decision private.stockflow_price_book_decisions%rowtype;
  current_price numeric;
  current_source text;
  risk_status text;
  current_margin numeric;
begin
  base:=private.stockflow_customer_price_before_customer_first(p_customer,p_item,p_date);

  if p_customer is not null and not coalesce((base->>'fixed')::boolean,false) then
    select d.* into decision
    from private.stockflow_price_book_decisions d
    where d.customer_id=p_customer
      and d.tally_item_key=p_item
      and d.evidence_hash=base->>'evidenceHash'
    order by d.created_at desc,d.id
    limit 1;
  end if;

  if decision.id is not null then
    current_price:=decision.price;
    current_source:='PRICE_BOOK_DECISION';
  elsif base->'source'->>'type'='APPROVED_CONTRACT' then
    current_price:=nullif(base->>'recommended','')::numeric;
    current_source:='APPROVED_CONTRACT';
  elsif base->'source'->>'type'='STANDARD_ITEM_PRICE' then
    current_price:=nullif(base->>'continuity','')::numeric;
    current_source:='STANDARD_ITEM_PRICE';
  elsif base->'source'->>'type'='LAST_TALLY_INVOICE' then
    current_price:=nullif(base->>'lastRate','')::numeric;
    current_source:='LAST_TALLY_INVOICE';
  else
    current_source:='NONE';
  end if;

  if current_price is not null and nullif(base->>'currentCost','') is not null then
    current_margin:=round((current_price-(base->>'currentCost')::numeric)/nullif(current_price,0)*100,2);
  end if;

  risk_status:=case
    when base->>'status'='REVIEW_REQUIRED'
      or current_price is null
      or nullif(base->>'currentCost','') is null
      or current_margin<(base->'policy'->>'minimumMarginPercent')::numeric then 'RED'
    when (nullif(base->>'target','') is not null and nullif(base->>'continuity','') is not null
          and (base->>'continuity')::numeric<(base->>'target')::numeric)
      or coalesce(nullif(base->>'costChange','')::numeric,0)>0 then 'AMBER'
    else 'GREEN'
  end;

  return base||jsonb_build_object(
    'currentDecisionId',decision.id,
    'currentDecisionChoice',decision.choice,
    'currentPrice',current_price,
    'currentPriceSource',current_source,
    'currentGP',case when current_price is null or nullif(base->>'currentCost','') is null then null else current_price-(base->>'currentCost')::numeric end,
    'currentMargin',current_margin,
    'riskStatus',risk_status
  );
end $$;

revoke all on function private.stockflow_customer_price(uuid,text,date)
  from public,anon,authenticated,service_role;

-- Record the real provenance used by order snapshots instead of folding base
-- and accepted price-book decisions into a generic manual source.
alter table private.stockflow_order_pricing_decisions
  drop constraint stockflow_order_pricing_decisions_resolution_type_check,
  add constraint stockflow_order_pricing_decisions_resolution_type_check
    check (resolution_type in ('approved_contract_price','standard_item_price','customer_price_book','last_tally_invoice_price','price_review_required','price_exception')),
  drop constraint stockflow_order_pricing_decisions_source_type_check,
  add constraint stockflow_order_pricing_decisions_source_type_check
    check (source_type in ('approved_contract','standard_item_price','customer_price_book','last_tally_invoice','manual_review'));

create or replace function private.stockflow_resolve_pricing_line(
  p_order_line_id uuid,
  p_pricing_date date
)
returns jsonb
language plpgsql
stable
set search_path=pg_catalog,private,extensions
as $$
declare
  line_row private.stockflow_order_lines%rowtype;
  customer uuid;
  resolution jsonb;
  rate numeric;
  decision_id uuid;
  guardrail text;
begin
  select * into line_row from private.stockflow_order_lines where id=p_order_line_id;
  if not found then raise exception 'Order line was not found' using errcode='22023'; end if;
  select customer_id into customer from private.stockflow_orders where id=line_row.order_id;
  resolution:=private.stockflow_customer_price(customer,line_row.tally_item_key,p_pricing_date);
  decision_id:=nullif(resolution->>'currentDecisionId','')::uuid;
  -- The customer-facing current rate is the last genuine invoice until a
  -- decision is accepted. An unaccepted recommendation remains the order
  -- proposal, and a changed evidence hash expires the old decision.
  rate:=case when decision_id is not null
      or resolution->'source'->>'type' in ('APPROVED_CONTRACT','STANDARD_ITEM_PRICE')
    then nullif(resolution->>'currentPrice','')::numeric
    else nullif(resolution->>'recommended','')::numeric end;

  guardrail:=case
    -- A valid fixed agreement is authoritative for the order. Margin warnings
    -- stay visible in the customer price book but do not silently reprice it.
    when resolution->'source'->>'type'='APPROVED_CONTRACT' and rate is not null then 'PRICE_OK'
    when rate is null or nullif(resolution->>'currentCost','') is null then 'PRICE_REVIEW_REQUIRED'
    when (rate-(resolution->>'currentCost')::numeric)/nullif(rate,0)*100
      <(resolution->'policy'->>'minimumMarginPercent')::numeric then 'PRICE_REVIEW_REQUIRED'
    when coalesce(nullif(resolution->>'costChange','')::numeric,0)>0 then 'COST_INCREASE'
    else 'PRICE_OK'
  end;

  return resolution||jsonb_build_object(
    'evidenceHash',encode(extensions.digest((resolution->>'evidenceHash')||coalesce(decision_id::text,''),'sha256'),'hex'),
    'lineId',line_row.id,
    'itemName',line_row.item_name,
    'quantity',line_row.quantity,
    'proposedRate',rate,
    'resolution',case
      when rate is null then 'PRICE_REVIEW_REQUIRED'
      when resolution->'source'->>'type'='APPROVED_CONTRACT' then 'APPROVED_CONTRACT_PRICE'
      when resolution->'source'->>'type'='STANDARD_ITEM_PRICE' then 'STANDARD_ITEM_PRICE'
      when decision_id is not null then 'CUSTOMER_PRICE_BOOK_PRICE'
      else 'LAST_TALLY_INVOICE_PRICE'
    end,
    'guardrail',guardrail,
    'margin',jsonb_build_object(
      'grossProfitAmount',case when rate is null or nullif(resolution->>'currentCost','') is null then null else rate-(resolution->>'currentCost')::numeric end,
      'grossMarginPercent',case when rate is null or nullif(resolution->>'currentCost','') is null then null else round((rate-(resolution->>'currentCost')::numeric)/nullif(rate,0)*100,2) end,
      'previousGrossMarginPercent',case when nullif(resolution->>'lastRate','') is null or nullif(resolution->>'historicCost','') is null then null else round(((resolution->>'lastRate')::numeric-(resolution->>'historicCost')::numeric)/nullif((resolution->>'lastRate')::numeric,0)*100,2) end,
      'erosionPercentagePoints',null
    )
  );
end $$;

revoke all on function private.stockflow_resolve_pricing_line(uuid,date)
  from public,anon,authenticated,service_role;

-- Confirmation consumes an existing governed customer price automatically.
-- The first pass is read-only; nothing is persisted unless every line is both
-- current and governed. All writes then share the surrounding status-change
-- transaction, so any failure rolls the confirmation back.
create or replace function private.stockflow_auto_price_confirmed_order()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,private,extensions
as $$
declare
  pricing_date date:=(now() at time zone 'Asia/Kolkata')::date;
  resolved jsonb;
  resolved_lines jsonb:='[]'::jsonb;
  snapshot_lines jsonb:='[]'::jsonb;
  decision_id uuid;
  snapshot_id uuid;
  decision_version integer;
  snapshot_version integer;
  actor_role text;
  request_id text:='auto-confirm:'||new.id::text||':'||new.version::text;
  rate numeric;
begin
  if new.status<>'confirmed' or old.status='confirmed' or new.pricing_state='approved'
     or new.pricing_state='approval_required' or new.customer_id is null then
    return new;
  end if;

  select role into actor_role from public.stockflow_members
  where email=lower(btrim(new.updated_by_email)) and status='active';
  if actor_role is null then
    raise exception 'StockFlow membership is not active' using errcode='42501';
  end if;

  lock table private.stockflow_tally_sales_prices,
    private.stockflow_tally_purchase_costs,
    private.stockflow_pricing_policies,
    private.stockflow_customer_product_prices,
    private.stockflow_standard_item_prices,
    private.stockflow_price_book_decisions in share row exclusive mode;

  -- An unconfigured commercial policy must never invent a rate or prevent
  -- the operational order from reaching confirmation.
  if not exists (
    select 1 from private.stockflow_pricing_policies p
    where p.active and p.effective_from<=pricing_date
      and (p.effective_to is null or p.effective_to>=pricing_date)
  ) then return new; end if;

  for resolved in
    select private.stockflow_resolve_pricing_line(line.id,pricing_date)
    from private.stockflow_order_lines line
    where line.order_id=new.id
    order by line.item_name,line.id
  loop
    if not private.stockflow_is_governed_order_price(new.customer_id,resolved->>'tallyKey',pricing_date,resolved)
       or resolved->>'guardrail'='PRICE_REVIEW_REQUIRED'
       or coalesce(nullif(resolved->>'proposedRate','')::numeric,0)<=0 then
      return new;
    end if;
    resolved_lines:=resolved_lines||jsonb_build_array(resolved);
  end loop;

  if jsonb_array_length(resolved_lines)=0 then return new; end if;

  select coalesce(max(d.decision_version),0)+1 into decision_version
  from private.stockflow_order_pricing_decisions d where d.order_id=new.id;

  for resolved in select value from jsonb_array_elements(resolved_lines) loop
    rate:=(resolved->>'proposedRate')::numeric;
    insert into private.stockflow_order_pricing_decisions(
      order_id,order_line_id,decision_version,order_version,state,resolution_type,
      proposed_rate,approved_rate,source_type,source_reference,source_date,source_version,
      contract_price_id,cost_id,cost_amount,cost_source_version,gross_profit_amount,
      gross_margin_percent,previous_gross_margin_percent,margin_erosion_points,
      guardrail_state,suggestion_amount,suggestion_unrounded,pricing_policy_id,
      pricing_policy_version,rounding_rule_version,exception_reason,requested_by_email,
      approved_by_email,approved_at,request_id,evidence_hash
    ) values (
      new.id,(resolved->>'lineId')::uuid,decision_version,new.version,'approved',
      case
        when resolved->'source'->>'type'='APPROVED_CONTRACT' then 'approved_contract_price'
        when resolved->'source'->>'type'='STANDARD_ITEM_PRICE' then 'standard_item_price'
        when nullif(resolved->>'currentDecisionId','') is not null then 'customer_price_book'
        else 'last_tally_invoice_price'
      end,
      rate,rate,
      case
        when resolved->'source'->>'type'='APPROVED_CONTRACT' then 'approved_contract'
        when resolved->'source'->>'type'='STANDARD_ITEM_PRICE' then 'standard_item_price'
        when nullif(resolved->>'currentDecisionId','') is not null then 'customer_price_book'
        else 'last_tally_invoice'
      end,
      case when nullif(resolved->>'currentDecisionId','') is not null
        then resolved->>'currentDecisionId' else resolved->'source'->>'reference' end,
      nullif(resolved->'source'->>'date','')::date,
      resolved->'source'->>'version',nullif(resolved->'source'->>'contractId','')::uuid,
      nullif(resolved->'cost'->>'id','')::uuid,nullif(resolved->'cost'->>'amount','')::numeric,
      resolved->'cost'->>'sourceVersion',nullif(resolved->'margin'->>'grossProfitAmount','')::numeric,
      nullif(resolved->'margin'->>'grossMarginPercent','')::numeric,
      nullif(resolved->'margin'->>'previousGrossMarginPercent','')::numeric,null,
      lower(resolved->>'guardrail'),nullif(resolved->'suggestion'->>'amount','')::numeric,
      nullif(resolved->'suggestion'->>'unroundedAmount','')::numeric,
      (resolved->'policy'->>'id')::uuid,resolved->'policy'->>'version',
      resolved->'policy'->>'roundingRuleVersion',null,new.updated_by_email,
      new.updated_by_email,now(),request_id,resolved->>'evidenceHash'
    ) returning id into decision_id;

    update private.stockflow_order_lines
    set pricing_state='approved',approved_pricing_decision_id=decision_id
    where id=(resolved->>'lineId')::uuid;

    insert into private.stockflow_pricing_events(
      entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata
    ) values (
      'order_pricing',decision_id,'governed_order_price_auto_approved',
      new.updated_by_email,actor_role,request_id,
      jsonb_build_object('orderId',new.id,'lineId',resolved->>'lineId','source',resolved->'source','riskStatus',resolved->>'riskStatus')
    );

    snapshot_lines:=snapshot_lines||jsonb_build_array(jsonb_build_object(
      'decisionId',decision_id,'lineId',resolved->>'lineId','enteredRate',rate,
      'requiresApproval',false,'exceptionId',null,'resolution',resolved
    ));
  end loop;

  select coalesce(max(s.snapshot_version),0)+1 into snapshot_version
  from private.stockflow_billing_snapshots s where s.order_id=new.id;
  insert into private.stockflow_billing_snapshots(
    order_id,snapshot_version,order_version,pricing_payload,snapshot_hash,created_by_email
  ) values (
    new.id,snapshot_version,new.version,snapshot_lines,
    encode(extensions.digest(snapshot_lines::text,'sha256'),'hex'),new.updated_by_email
  ) returning id into snapshot_id;

  new.pricing_state:='approved';
  new.pricing_snapshot_id:=snapshot_id;

  insert into private.stockflow_order_events(
    order_id,event_type,from_status,to_status,actor_email,actor_role,metadata
  ) values (
    new.id,'governed_order_pricing_applied',old.status,new.status,
    new.updated_by_email,actor_role,
    jsonb_build_object('snapshotId',snapshot_id,'snapshotVersion',snapshot_version,'requestId',request_id)
  );
  insert into private.stockflow_pricing_events(
    entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata
  ) values (
    'billing_snapshot',snapshot_id,'billing_snapshot_created',new.updated_by_email,
    actor_role,request_id,jsonb_build_object('orderId',new.id,'snapshotVersion',snapshot_version,'automatic',true)
  );
  insert into private.stockflow_outbox(topic,aggregate_id,payload)
  values ('order.pricing_approved',new.id,jsonb_build_object(
    'snapshotId',snapshot_id,'snapshotVersion',snapshot_version,'requestId',request_id,'automatic',true
  ));
  return new;
end $$;

revoke all on function private.stockflow_auto_price_confirmed_order()
  from public,anon,authenticated,service_role;

create trigger stockflow_auto_price_confirmed_order
before update of status on private.stockflow_orders
for each row execute function private.stockflow_auto_price_confirmed_order();

-- Return the final version and pricing state after the trigger has completed,
-- without exposing commercial values to operational roles.
alter function public.stockflow_order_gateway(text,text,text,jsonb)
  rename to stockflow_order_gateway_before_auto_pricing;

revoke all on function public.stockflow_order_gateway_before_auto_pricing(text,text,text,jsonb)
  from public,anon,authenticated,service_role;

create or replace function public.stockflow_order_gateway(
  p_gateway_key text,
  p_actor_email text,
  p_action text,
  p_payload jsonb default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,private
as $$
declare
  result jsonb;
  order_row private.stockflow_orders%rowtype;
  expected_hash text;
begin
  if p_action='transition_order' and p_payload->>'toStatus'='confirmed' then
    -- Price approvals acquire evidence locks before the order row. Keep the
    -- same lock order for confirmation to avoid cross-workflow deadlocks.
    select secret_sha256 into expected_hash
    from private.stockflow_gateway_config where name='orders';
    if expected_hash is null
       or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>expected_hash then
      raise exception 'Unauthorized gateway' using errcode='42501';
    end if;
    lock table private.stockflow_tally_sales_prices,
      private.stockflow_tally_purchase_costs,
      private.stockflow_pricing_policies,
      private.stockflow_customer_product_prices,
      private.stockflow_standard_item_prices,
      private.stockflow_price_book_decisions in share row exclusive mode;
  end if;
  result:=public.stockflow_order_gateway_before_auto_pricing(
    p_gateway_key,p_actor_email,p_action,p_payload
  );
  if p_action='transition_order' and p_payload->>'toStatus'='confirmed' then
    select * into order_row from private.stockflow_orders
    where id=(p_payload->>'orderId')::uuid;
    result:=result||jsonb_build_object(
      'version',order_row.version,
      'pricingState',order_row.pricing_state
    );
  end if;
  return result;
end $$;

revoke all on function public.stockflow_order_gateway(text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.stockflow_order_gateway(text,text,text,jsonb)
  to service_role;

-- One bounded server call supplies order-entry previews for authorized
-- commercial roles. Operational roles never receive the monetary payload.
alter function public.stockflow_pricing_gateway(text,text,text,jsonb)
  rename to stockflow_pricing_gateway_before_order_preview;

revoke all on function public.stockflow_pricing_gateway_before_order_preview(text,text,text,jsonb)
  from public,anon,authenticated,service_role;

create or replace function public.stockflow_pricing_gateway(
  p_gateway_key text,
  p_actor_email text,
  p_action text,
  p_payload jsonb default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,private,extensions
as $$
declare
  expected_hash text;
  actor_role text;
  customer uuid;
begin
  if p_action<>'preview_customer_prices' then
    return public.stockflow_pricing_gateway_before_order_preview(
      p_gateway_key,p_actor_email,p_action,p_payload
    );
  end if;

  select secret_sha256 into expected_hash
  from private.stockflow_gateway_config where name='orders';
  if expected_hash is null
     or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>expected_hash then
    raise exception 'Unauthorized gateway' using errcode='42501';
  end if;
  select m.role into actor_role from public.stockflow_members m
  where m.email=lower(btrim(p_actor_email)) and m.status='active';
  perform private.stockflow_assert_pricing_role(actor_role);

  customer:=(p_payload->>'customerId')::uuid;
  if not exists(select 1 from private.stockflow_customers c where c.id=customer and c.active) then
    raise exception 'Customer was not found' using errcode='22023';
  end if;
  if jsonb_typeof(p_payload->'tallyKeys')<>'array'
     or jsonb_array_length(p_payload->'tallyKeys')<1
     or jsonb_array_length(p_payload->'tallyKeys')>50 then
    raise exception 'Between 1 and 50 products are required' using errcode='22023';
  end if;

  return jsonb_build_object('prices',coalesce((
    select jsonb_agg(private.stockflow_customer_price(
      customer,requested.tally_key,(now() at time zone 'Asia/Kolkata')::date
    ) order by requested.tally_key)
    from (
      select distinct btrim(value) as tally_key
      from jsonb_array_elements_text(p_payload->'tallyKeys')
      where char_length(btrim(value)) between 1 and 240
    ) requested
    join private.stockflow_products product
      on product.tally_item_key=requested.tally_key and product.active
  ),'[]'::jsonb));
end $$;

revoke all on function public.stockflow_pricing_gateway(text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.stockflow_pricing_gateway(text,text,text,jsonb)
  to service_role;
