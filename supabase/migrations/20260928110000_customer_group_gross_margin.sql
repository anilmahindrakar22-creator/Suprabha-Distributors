-- One customer/group approval creates immutable, individual item rates.
-- Its validity follows comparable purchase cost, rather than later sales.
create table private.stockflow_group_margin_item_decisions (
  id uuid primary key default extensions.gen_random_uuid(),
  batch_id uuid not null,
  customer_id uuid not null references private.stockflow_customers(id),
  tally_item_key text not null,
  item_group text not null,
  gross_margin_percent numeric(7,2) not null check (gross_margin_percent>0 and gross_margin_percent<100),
  price numeric(18,2) not null check (price>0),
  cost_amount numeric(18,2) not null check (cost_amount>0),
  cost_kind text not null,
  cost_id uuid not null,
  policy_id uuid not null,
  rounding_rule_version text not null,
  actor_email text not null,
  request_id text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(customer_id,tally_item_key,request_id)
);
create index stockflow_group_margin_item_latest
  on private.stockflow_group_margin_item_decisions(customer_id,tally_item_key,created_at desc,id desc);
alter table private.stockflow_group_margin_item_decisions enable row level security;
create trigger stockflow_group_margin_item_immutable before update
  on private.stockflow_group_margin_item_decisions for each row
  execute function private.prevent_immutable_pricing_update();
create trigger stockflow_group_margin_item_no_delete before delete
  on private.stockflow_group_margin_item_decisions for each row
  execute function private.prevent_business_delete();

alter function private.stockflow_customer_price(uuid,text,date)
  rename to stockflow_customer_price_before_group_margin;
revoke all on function private.stockflow_customer_price_before_group_margin(uuid,text,date)
  from public,anon,authenticated,service_role;

create or replace function private.stockflow_customer_price(
  p_customer uuid,p_item text,p_date date
) returns jsonb language plpgsql stable
set search_path=pg_catalog,private,extensions as $$
declare
  result jsonb;
  chosen private.stockflow_group_margin_item_decisions%rowtype;
  comparable boolean;
  new_cost numeric;
  new_kind text;
  new_recommendation numeric;
  policy_increment numeric;
begin
  result:=private.stockflow_customer_price_before_group_margin(p_customer,p_item,p_date);
  if p_customer is null or coalesce((result->>'fixed')::boolean,false)
     or nullif(result->>'currentDecisionId','') is not null then
    return result;
  end if;
  select d.* into chosen from private.stockflow_group_margin_item_decisions d
  join private.stockflow_products p on p.tally_item_key=d.tally_item_key
  where d.customer_id=p_customer and d.tally_item_key=p_item
    and p.active and p.item_group=d.item_group
    and (d.created_at at time zone 'Asia/Kolkata')::date<=p_date
  order by d.created_at desc,d.id desc limit 1;
  if chosen.id is null then return result; end if;
  new_cost:=nullif(result->'cost'->>'amount','')::numeric;
  new_kind:=result->'cost'->>'kind';
  comparable:=new_cost=chosen.cost_amount and new_kind=chosen.cost_kind
    and not (coalesce(result->'warnings','[]'::jsonb) ? 'AMBIGUOUS_PURCHASE_COST');
  select p.rounding_increment into policy_increment
  from private.stockflow_pricing_policies p
  where p.id=(result->'policy'->>'id')::uuid;
  if new_cost>0 and policy_increment>0 then
    new_recommendation:=greatest(chosen.price,private.stockflow_round_price_up(
      new_cost/(1-chosen.gross_margin_percent/100),policy_increment));
  end if;
  return result||jsonb_build_object(
    'groupMarginDecisionId',chosen.id,
    'groupGrossMarginPercent',chosen.gross_margin_percent,
    'currentDecisionId',chosen.id,
    'currentDecisionChoice','group_gross_margin',
    'currentPrice',chosen.price,
    'currentPriceSource','GROUP_GROSS_MARGIN',
    'currentGP',case when new_cost is null then null else chosen.price-new_cost end,
    'currentMargin',case when new_cost is null then null
      else round((chosen.price-new_cost)/chosen.price*100,2) end,
    'recommended',case when comparable then chosen.price else new_recommendation end,
    'recommendedPrice',case when comparable then chosen.price else new_recommendation end,
    'target',new_recommendation,
    'targetMarginPrice',new_recommendation,
    'status',case when comparable then 'GROUP_MARGIN_APPROVED' else 'REVIEW_REQUIRED' end,
    'riskStatus',case when comparable then 'GREEN' else 'RED' end,
    'recommendationReason',case when comparable then
      'Approved customer group gross-margin rate is stable while purchase cost is unchanged.'
      else 'Purchase cost amount or kind changed; administrator review is required.' end,
    'groupCostChanged',not coalesce(comparable,false)
  );
end $$;
revoke all on function private.stockflow_customer_price(uuid,text,date)
  from public,anon,authenticated,service_role;

alter function private.stockflow_resolve_pricing_line(uuid,date)
  rename to stockflow_resolve_pricing_line_before_group_margin;
revoke all on function private.stockflow_resolve_pricing_line_before_group_margin(uuid,date)
  from public,anon,authenticated,service_role;
create or replace function private.stockflow_resolve_pricing_line(
  p_order_line_id uuid,p_pricing_date date
) returns jsonb language plpgsql stable
set search_path=pg_catalog,private,extensions as $$
declare
  result jsonb;
  rate numeric;
  cost numeric;
  approved boolean;
begin
  result:=private.stockflow_resolve_pricing_line_before_group_margin(p_order_line_id,p_pricing_date);
  if nullif(result->>'groupMarginDecisionId','') is null then return result; end if;
  approved:=result->>'status'='GROUP_MARGIN_APPROVED';
  rate:=nullif(result->>'currentPrice','')::numeric;
  cost:=nullif(result->>'currentCost','')::numeric;
  return result||jsonb_build_object(
    'proposedRate',rate,
    'resolution',case when approved then 'CUSTOMER_PRICE_BOOK_PRICE' else 'PRICE_REVIEW_REQUIRED' end,
    'guardrail',case when approved then 'PRICE_OK' else 'PRICE_REVIEW_REQUIRED' end,
    'margin',coalesce(result->'margin','{}'::jsonb)||jsonb_build_object(
      'grossProfitAmount',case when cost is null then null else rate-cost end,
      'grossMarginPercent',case when cost is null then null else round((rate-cost)/rate*100,2) end)
  );
end $$;
revoke all on function private.stockflow_resolve_pricing_line(uuid,date)
  from public,anon,authenticated,service_role;

alter function private.stockflow_is_governed_order_price(uuid,text,date,jsonb)
  rename to stockflow_is_governed_order_price_before_group_margin;
revoke all on function private.stockflow_is_governed_order_price_before_group_margin(uuid,text,date,jsonb)
  from public,anon,authenticated,service_role;
create or replace function private.stockflow_is_governed_order_price(
  p_customer uuid,p_item text,p_pricing_date date,p_resolution jsonb
) returns boolean language plpgsql stable
set search_path=pg_catalog,private as $$
declare current_row jsonb;
begin
  if nullif(p_resolution->>'groupMarginDecisionId','') is null then
    return private.stockflow_is_governed_order_price_before_group_margin(
      p_customer,p_item,p_pricing_date,p_resolution);
  end if;
  current_row:=private.stockflow_customer_price(p_customer,p_item,p_pricing_date);
  return p_resolution->>'guardrail'='PRICE_OK'
    and current_row->>'status'='GROUP_MARGIN_APPROVED'
    and current_row->>'groupMarginDecisionId'=p_resolution->>'groupMarginDecisionId'
    and (current_row->>'currentPrice')::numeric=(p_resolution->>'proposedRate')::numeric;
end $$;
revoke all on function private.stockflow_is_governed_order_price(uuid,text,date,jsonb)
  from public,anon,authenticated,service_role;

create or replace function private.stockflow_customer_group_margin_preview(
  p_customer uuid,p_item_group text,p_margin numeric,p_date date
) returns jsonb language plpgsql stable
set search_path=pg_catalog,private,extensions as $$
declare
  item_row record;
  evidence jsonb;
  rows jsonb:='[]'::jsonb;
  reason text;
  proposed numeric;
  increment numeric;
  eligible_count integer:=0;
  result jsonb;
begin
  if not exists(select 1 from private.stockflow_customers
    where id=p_customer and active) then
    raise exception 'Customer was not found' using errcode='22023';
  end if;
  if p_item_group is null or p_item_group<>btrim(p_item_group)
     or p_item_group='' or p_margin is null or p_margin<=0 or p_margin>=100
     or scale(p_margin)>2 then
    raise exception 'Exact item group and gross margin percent are required'
      using errcode='22023';
  end if;
  select p.rounding_increment into increment
  from private.stockflow_pricing_policies p
  where p.active and p.effective_from<=p_date
    and (p.effective_to is null or p.effective_to>=p_date)
  order by p.effective_from desc limit 1;
  if increment is null then raise exception 'Pricing policy is not configured' using errcode='55000'; end if;
  for item_row in
    select p.tally_item_key,p.name from private.stockflow_products p
    where p.active and p.item_group=p_item_group
      and exists(select 1 from private.stockflow_tally_sales_prices s
        where s.customer_id=p_customer and s.tally_item_key=p.tally_item_key
          and s.invoice_date<=p_date and not s.exceptional
          and s.exception_type is null and s.invoice_rate>0)
    order by p.tally_item_key limit 1001
  loop
    if jsonb_array_length(rows)>=1000 then
      raise exception 'Group exceeds 1000 purchased items; narrow the scope'
        using errcode='54000';
    end if;
    evidence:=private.stockflow_customer_price(p_customer,item_row.tally_item_key,p_date);
    reason:=case
      when coalesce((evidence->>'fixed')::boolean,false) then 'FIXED_CONTRACT'
      when nullif(evidence->>'currentDecisionId','') is not null
        and nullif(evidence->>'groupMarginDecisionId','') is null then 'SINGLE_ITEM_DECISION'
      when evidence->'source'->>'type'<>'LAST_TALLY_INVOICE' then 'NO_GENUINE_SALE'
      when evidence->'warnings' ? 'AMBIGUOUS_SALES_HISTORY' then 'AMBIGUOUS_SALE'
      when evidence->'warnings' ? 'AMBIGUOUS_PURCHASE_COST' then 'AMBIGUOUS_COST'
      when nullif(evidence->>'lastRate','')::numeric is null then 'MISSING_SALE_RATE'
      when nullif(evidence->>'currentCost','')::numeric is null then 'MISSING_COST'
      when nullif(evidence->>'costChange','')::numeric is null then 'INCOMPARABLE_COST'
      else null end;
    proposed:=null;
    if reason is null then
      proposed:=greatest((evidence->>'lastRate')::numeric,
        coalesce((evidence->>'currentPrice')::numeric,0),
        private.stockflow_round_price_up(
          (evidence->>'currentCost')::numeric/(1-p_margin/100),increment));
    end if;
    if reason is null then eligible_count:=eligible_count+1; end if;
    rows:=rows||jsonb_build_array(jsonb_build_object(
      'tallyKey',item_row.tally_item_key,'itemName',item_row.name,
      'lastRate',evidence->'lastRate','currentCost',evidence->'currentCost',
      'proposedRate',proposed,'grossMarginPercent',p_margin,
      'eligible',reason is null,'exclusionReason',reason,
      'costChange',evidence->'costChange',
      'costId',evidence->'cost'->'id','costKind',evidence->'cost'->'kind',
      'policyId',evidence->'policy'->'id',
      'roundingRuleVersion',evidence->'policy'->'roundingRuleVersion',
      'evidenceHash',evidence->'evidenceHash'));
  end loop;
  result:=jsonb_build_object('customerId',p_customer,'itemGroup',p_item_group,
    'grossMarginPercent',p_margin,'pricingDate',p_date,'rows',rows);
  return result||jsonb_build_object(
    'previewHash',encode(extensions.digest(result::text,'sha256'),'hex'),
    'eligibleCount',eligible_count,
    'excludedCount',jsonb_array_length(rows)-eligible_count);
end $$;
revoke all on function private.stockflow_customer_group_margin_preview(uuid,text,numeric,date)
  from public,anon,authenticated,service_role;

alter function public.stockflow_pricing_gateway(text,text,text,jsonb)
  rename to stockflow_pricing_gateway_before_group_margin;
revoke all on function public.stockflow_pricing_gateway_before_group_margin(text,text,text,jsonb)
  from public,anon,authenticated,service_role;
create or replace function public.stockflow_pricing_gateway(
  p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,private,extensions as $$
declare
  actor_email text:=lower(btrim(coalesce(p_actor_email,'')));
  actor_role text;
  secret text;
  customer uuid;
  item_group text:=p_payload->>'itemGroup';
  margin numeric;
  pricing_date date:=(now() at time zone 'Asia/Kolkata')::date;
  preview jsonb;
  row_data jsonb;
  replay jsonb;
  result jsonb;
  decision_id uuid;
  first_id uuid;
  batch_id uuid;
  applied integer:=0;
begin
  if p_action not in ('preview_customer_group_margin','approve_customer_group_margin') then
    return public.stockflow_pricing_gateway_before_group_margin(
      p_gateway_key,p_actor_email,p_action,p_payload);
  end if;
  select secret_sha256 into secret from private.stockflow_gateway_config where name='orders';
  if secret is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>secret then
    raise exception 'Unauthorized gateway' using errcode='42501';
  end if;
  select m.role into actor_role from public.stockflow_members m
  where m.email=actor_email and m.status='active';
  if actor_role not in ('administrator','management') or actor_role is null then
    raise exception 'Group margin pricing is restricted to management' using errcode='42501';
  end if;
  customer:=(p_payload->>'customerId')::uuid;
  margin:=(p_payload->>'grossMarginPercent')::numeric;
  if p_action='preview_customer_group_margin' then
    return private.stockflow_customer_group_margin_preview(customer,item_group,margin,pricing_date);
  end if;
  if coalesce(p_payload->>'previewHash','') !~ '^[a-f0-9]{64}$' then
    raise exception 'A valid group margin preview is required' using errcode='22023';
  end if;
  lock table private.stockflow_products,private.stockflow_tally_sales_prices,
    private.stockflow_tally_purchase_costs,private.stockflow_pricing_policies,
    private.stockflow_customer_product_prices,private.stockflow_standard_item_prices,
    private.stockflow_price_book_decisions,
    private.stockflow_group_margin_item_decisions in share row exclusive mode;
  replay:=private.begin_stockflow_command(
    actor_email,p_action,p_payload->>'idempotencyKey',p_payload);
  if replay is not null then return replay; end if;
  preview:=private.stockflow_customer_group_margin_preview(customer,item_group,margin,pricing_date);
  if preview->>'previewHash' is distinct from p_payload->>'previewHash' then
    raise exception 'Group margin evidence changed; refresh and review'
      using errcode='PT409';
  end if;
  if (preview->>'eligibleCount')::integer=0 then
    raise exception 'No eligible purchased items remain for group margin approval'
      using errcode='22023';
  end if;
  batch_id:=extensions.gen_random_uuid();
  for row_data in select value from jsonb_array_elements(preview->'rows') loop
    if not (row_data->>'eligible')::boolean then continue; end if;
    insert into private.stockflow_group_margin_item_decisions(
      batch_id,customer_id,tally_item_key,item_group,gross_margin_percent,
      price,cost_amount,cost_kind,cost_id,policy_id,rounding_rule_version,
      actor_email,request_id
    ) values (
      batch_id,customer,row_data->>'tallyKey',item_group,margin,
      (row_data->>'proposedRate')::numeric,(row_data->>'currentCost')::numeric,
      row_data->>'costKind',(row_data->>'costId')::uuid,
      (row_data->>'policyId')::uuid,row_data->>'roundingRuleVersion',
      actor_email,p_payload->>'idempotencyKey'
    ) returning id into decision_id;
    first_id:=coalesce(first_id,decision_id);
    insert into private.stockflow_pricing_events(
      entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata
    ) values ('price_book',decision_id,'group_margin_item_approved',
      actor_email,actor_role,p_payload->>'idempotencyKey',
      jsonb_build_object('batchId',batch_id,'customerId',customer,
        'itemGroup',item_group,'tallyKey',row_data->>'tallyKey',
        'grossMarginPercent',margin,'price',(row_data->>'proposedRate')::numeric,
        'costAmount',(row_data->>'currentCost')::numeric,
        'costKind',row_data->>'costKind','previewHash',preview->>'previewHash'));
    insert into private.stockflow_outbox(topic,aggregate_id,payload)
    values ('pricing.book_approved',decision_id,
      jsonb_build_object('decisionId',decision_id,'batchId',batch_id));
    applied:=applied+1;
  end loop;
  result:=jsonb_build_object('ok',true,'customerId',customer,
    'itemGroup',item_group,'grossMarginPercent',margin,'applied',applied,
    'excluded',(preview->>'excludedCount')::integer,'batchId',batch_id);
  perform private.finish_stockflow_command(actor_email,p_action,
    p_payload->>'idempotencyKey',p_payload,first_id,result);
  return result;
end $$;
revoke all on function public.stockflow_pricing_gateway(text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.stockflow_pricing_gateway(text,text,text,jsonb)
  to service_role;

-- A lost approval response must be recoverable without exposing commercial data.
alter function public.stockflow_submission_recovery_gateway(text,text,text,jsonb)
  rename to stockflow_submission_recovery_gateway_before_group_margin;
revoke all on function public.stockflow_submission_recovery_gateway_before_group_margin(text,text,text,jsonb)
  from public,anon,authenticated,service_role;
create or replace function public.stockflow_submission_recovery_gateway(
  p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,extensions as $$
declare
  v_actor_email text:=lower(btrim(coalesce(p_actor_email,'')));
  actor_role text;
  expected_hash text;
  request_key text:=btrim(coalesce(p_payload->>'idempotencyKey',''));
  stored_hash text;
  receipt_id uuid;
begin
  if p_action<>'recover_order_submission'
     or p_payload->>'pricingAction'<>'approve_customer_group_margin' then
    return public.stockflow_submission_recovery_gateway_before_group_margin(
      p_gateway_key,p_actor_email,p_action,p_payload);
  end if;
  select secret_sha256 into expected_hash
  from private.stockflow_gateway_config where name='orders';
  if expected_hash is null
     or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>expected_hash then
    raise exception 'Unauthorized gateway' using errcode='42501';
  end if;
  select role into actor_role from public.stockflow_members
  where email=v_actor_email and status='active';
  if actor_role not in ('administrator','management') or actor_role is null then
    raise exception 'Group margin pricing is restricted to management' using errcode='42501';
  end if;
  if char_length(request_key) not between 16 and 200 then
    raise exception 'Valid submission key is required' using errcode='22023';
  end if;
  if coalesce((p_payload->>'closeUnresolved')::boolean,false) then
    if not pg_try_advisory_xact_lock(hashtextextended(
      v_actor_email||':approve_customer_group_margin:'||request_key,0
    )) then return jsonb_build_object('status','unresolved'); end if;
  end if;
  select request_hash into stored_hash from private.stockflow_command_results
  where actor_email=v_actor_email and action='approve_customer_group_margin'
    and idempotency_key=request_key;
  if found then
    if stored_hash='closed-before-save' then return jsonb_build_object('status','not_saved'); end if;
    return jsonb_build_object('status','accepted');
  end if;
  if coalesce((p_payload->>'closeUnresolved')::boolean,false) then
    receipt_id:=extensions.gen_random_uuid();
    insert into private.stockflow_command_results(
      actor_email,action,idempotency_key,request_hash,aggregate_id,result
    ) values (
      v_actor_email,'approve_customer_group_margin',request_key,'closed-before-save',
      receipt_id,'{"status":"not_saved"}'
    );
    insert into private.stockflow_pricing_events(
      entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata
    ) values (
      'price_book',receipt_id,'pricing.request_closed_before_save',v_actor_email,
      actor_role,request_key,jsonb_build_object('action','approve_customer_group_margin')
    );
    return jsonb_build_object('status','not_saved');
  end if;
  return jsonb_build_object('status','unresolved');
end $$;
revoke all on function public.stockflow_submission_recovery_gateway(text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.stockflow_submission_recovery_gateway(text,text,text,jsonb)
  to service_role;
