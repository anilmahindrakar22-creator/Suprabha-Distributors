-- Approve one customer's eligible purchased-item recommendations as one
-- evidence-bound transaction. Existing fixed and accepted prices are protected.
create or replace function private.stockflow_customer_book_bulk_preview(
  p_customer uuid,
  p_date date
)
returns jsonb
language plpgsql
stable
set search_path=pg_catalog,private,extensions
as $$
declare
  rows jsonb;
  result jsonb;
begin
  if not exists (
    select 1 from private.stockflow_customers c
    where c.id=p_customer and c.active
  ) then raise exception 'Customer was not found' using errcode='22023'; end if;

  with candidates as (
    select distinct s.tally_item_key
    from private.stockflow_tally_sales_prices s
    where s.customer_id=p_customer and s.invoice_date<=p_date
      and not s.exceptional and s.exception_type is null and s.invoice_rate>0
    order by s.tally_item_key
    limit 1001
  ), resolved as (
    select c.tally_item_key,
      private.stockflow_customer_price(p_customer,c.tally_item_key,p_date) as price,
      coalesce(p.active,false) as active_product
    from candidates c
    left join private.stockflow_products p on p.tally_item_key=c.tally_item_key
  ), classified as (
    select tally_item_key,
      price||jsonb_build_object(
        'bulkEligible',coalesce((active_product
          and not coalesce((price->>'fixed')::boolean,false)
          and nullif(price->>'currentDecisionId','') is null
          and price->>'status'<>'REVIEW_REQUIRED'
          and nullif(price->>'currentCost','') is not null
          and coalesce(nullif(price->>'recommended','')::numeric,0)>0
          and (nullif(price->>'recommended','')::numeric
            -nullif(price->>'currentCost','')::numeric)
            /nullif((price->>'recommended')::numeric,0)*100
              >=(price->'policy'->>'minimumMarginPercent')::numeric),false)
      ) as row
    from resolved
  )
  select coalesce(jsonb_agg(row order by tally_item_key),'[]'::jsonb)
  into rows from classified;

  if jsonb_array_length(rows)>1000 then
    raise exception 'Customer price book exceeds 1000 purchased items; review a smaller scope'
      using errcode='54000';
  end if;
  result:=jsonb_build_object('customerId',p_customer,'pricingDate',p_date,'rows',rows);
  return jsonb_build_object(
    'approvalPreviewHash',encode(extensions.digest(result::text,'sha256'),'hex'),
    'bulkTotalCount',jsonb_array_length(rows),
    'bulkEligibleCount',(select count(*) from jsonb_array_elements(rows) r
      where (r->>'bulkEligible')::boolean),
    'bulkExcludedCount',(select count(*) from jsonb_array_elements(rows) r
      where not (r->>'bulkEligible')::boolean),
    'rows',rows
  );
end $$;

revoke all on function private.stockflow_customer_book_bulk_preview(uuid,date)
  from public,anon,authenticated,service_role;

alter function public.stockflow_pricing_gateway(text,text,text,jsonb)
  rename to stockflow_pricing_gateway_before_customer_bulk;

revoke all on function public.stockflow_pricing_gateway_before_customer_bulk(text,text,text,jsonb)
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
  result jsonb;
  preview jsonb;
  replay jsonb;
  row_data jsonb;
  current_page jsonb;
  actor_email text:=lower(btrim(p_actor_email));
  actor_role text;
  expected_hash text;
  customer uuid;
  pricing_date date:=(now() at time zone 'Asia/Kolkata')::date;
  decision_id uuid;
  first_decision_id uuid;
  applied integer:=0;
begin
  if p_action not in ('get_customer_price_book','approve_customer_price_book') then
    return public.stockflow_pricing_gateway_before_customer_bulk(
      p_gateway_key,p_actor_email,p_action,p_payload
    );
  end if;

  if p_action='get_customer_price_book' then
    current_page:=public.stockflow_pricing_gateway_before_customer_bulk(
      p_gateway_key,p_actor_email,p_action,p_payload
    );
    customer:=(p_payload->>'customerId')::uuid;
    if coalesce(p_payload->>'tab','purchased')<>'purchased' then return current_page; end if;
    preview:=private.stockflow_customer_book_bulk_preview(customer,pricing_date);
    return current_page||jsonb_build_object(
      'approvalPreviewHash',preview->>'approvalPreviewHash',
      'bulkTotalCount',preview->'bulkTotalCount',
      'bulkEligibleCount',preview->'bulkEligibleCount',
      'bulkExcludedCount',preview->'bulkExcludedCount',
      'bulkEligibleKeys',coalesce((
        select jsonb_agg(r->>'tallyKey') from jsonb_array_elements(preview->'rows') r
        where (r->>'bulkEligible')::boolean
      ),'[]'::jsonb)
    );
  end if;

  select secret_sha256 into expected_hash
  from private.stockflow_gateway_config where name='orders';
  if expected_hash is null
     or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>expected_hash then
    raise exception 'Unauthorized gateway' using errcode='42501';
  end if;
  select m.role into actor_role from public.stockflow_members m
  where m.email=actor_email and m.status='active';
  if actor_role not in ('administrator','management') then
    raise exception 'Commercial approval is restricted to management' using errcode='42501';
  end if;
  customer:=(p_payload->>'customerId')::uuid;
  if coalesce(p_payload->>'approvalPreviewHash','') !~ '^[a-f0-9]{64}$' then
    raise exception 'A valid price-book preview is required' using errcode='22023';
  end if;

  -- Keep the established evidence-lock order before idempotency and approval.
  lock table private.stockflow_tally_sales_prices,
    private.stockflow_tally_purchase_costs,
    private.stockflow_pricing_policies,
    private.stockflow_customer_product_prices,
    private.stockflow_standard_item_prices,
    private.stockflow_price_book_decisions in share row exclusive mode;
  replay:=private.begin_stockflow_command(
    actor_email,p_action,p_payload->>'idempotencyKey',p_payload
  );
  if replay is not null then return replay; end if;

  preview:=private.stockflow_customer_book_bulk_preview(customer,pricing_date);
  if preview->>'approvalPreviewHash' is distinct from p_payload->>'approvalPreviewHash' then
    raise exception 'Customer prices changed; refresh and review before approval'
      using errcode='40001';
  end if;
  if (preview->>'bulkEligibleCount')::integer=0 then
    raise exception 'No eligible customer recommendations remain to approve'
      using errcode='22023';
  end if;

  for row_data in select value from jsonb_array_elements(preview->'rows') loop
    if not (row_data->>'bulkEligible')::boolean then continue; end if;
    insert into private.stockflow_price_book_decisions(
      customer_id,tally_item_key,pricing_date,evidence_hash,choice,price,
      reason,actor_email,request_id
    ) values (
      customer,row_data->>'tallyKey',pricing_date,row_data->>'evidenceHash',
      'recommended',(row_data->>'recommended')::numeric,
      'Approved eligible customer recommendations',actor_email,
      p_payload->>'idempotencyKey'
    ) returning id into decision_id;
    first_decision_id:=coalesce(first_decision_id,decision_id);
    insert into private.stockflow_pricing_events(
      entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata
    ) values (
      'price_book',decision_id,'price_book_approved',actor_email,actor_role,
      p_payload->>'idempotencyKey',
      jsonb_build_object('evidence',row_data,'choice','recommended',
        'price',(row_data->>'recommended')::numeric,
        'reason','Approved eligible customer recommendations')
    );
    insert into private.stockflow_outbox(topic,aggregate_id,payload)
    values ('pricing.book_approved',decision_id,jsonb_build_object('decisionId',decision_id));
    applied:=applied+1;
  end loop;

  result:=jsonb_build_object('ok',true,'applied',applied,
    'excluded',(preview->>'bulkExcludedCount')::integer,
    'customerId',customer);
  perform private.finish_stockflow_command(
    actor_email,p_action,p_payload->>'idempotencyKey',p_payload,first_decision_id,result
  );
  return result;
end $$;

revoke all on function public.stockflow_pricing_gateway(text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.stockflow_pricing_gateway(text,text,text,jsonb)
  to service_role;

-- Lost-response recovery remains actor-scoped and never returns price data.
alter function public.stockflow_submission_recovery_gateway(text,text,text,jsonb)
  rename to stockflow_submission_recovery_gateway_before_customer_bulk;

revoke all on function public.stockflow_submission_recovery_gateway_before_customer_bulk(text,text,text,jsonb)
  from public,anon,authenticated,service_role;

create or replace function public.stockflow_submission_recovery_gateway(
  p_gateway_key text,
  p_actor_email text,
  p_action text,
  p_payload jsonb default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,private,extensions
as $$
declare
  v_actor_email text:=lower(btrim(coalesce(p_actor_email,'')));
  actor_role text;
  expected_hash text;
  request_key text:=btrim(coalesce(p_payload->>'idempotencyKey',''));
  stored_hash text;
  receipt_id uuid;
begin
  if p_action<>'recover_order_submission'
     or p_payload->>'pricingAction'<>'approve_customer_price_book' then
    return public.stockflow_submission_recovery_gateway_before_customer_bulk(
      p_gateway_key,p_actor_email,p_action,p_payload
    );
  end if;
  select secret_sha256 into expected_hash
  from private.stockflow_gateway_config where name='orders';
  if expected_hash is null
     or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>expected_hash then
    raise exception 'Unauthorized gateway' using errcode='42501';
  end if;
  select role into actor_role from public.stockflow_members
  where email=v_actor_email and status='active';
  perform private.stockflow_assert_pricing_role(actor_role);
  if char_length(request_key) not between 16 and 200 then
    raise exception 'Valid submission key is required' using errcode='22023';
  end if;
  if coalesce((p_payload->>'closeUnresolved')::boolean,false) then
    if not pg_try_advisory_xact_lock(hashtextextended(
      v_actor_email||':approve_customer_price_book:'||request_key,0
    )) then return jsonb_build_object('status','unresolved'); end if;
  end if;
  select request_hash into stored_hash from private.stockflow_command_results
  where actor_email=v_actor_email and action='approve_customer_price_book'
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
      v_actor_email,'approve_customer_price_book',request_key,'closed-before-save',
      receipt_id,'{"status":"not_saved"}'
    );
    insert into private.stockflow_pricing_events(
      entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata
    ) values (
      'price_book',receipt_id,'pricing.request_closed_before_save',v_actor_email,
      actor_role,request_key,jsonb_build_object('action','approve_customer_price_book')
    );
    return jsonb_build_object('status','not_saved');
  end if;
  return jsonb_build_object('status','unresolved');
end $$;

revoke all on function public.stockflow_submission_recovery_gateway(text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.stockflow_submission_recovery_gateway(text,text,text,jsonb)
  to service_role;
