create or replace function private.stockflow_product_price_impact(p_item text,p_date date)
returns jsonb language plpgsql stable set search_path=pg_catalog,private,extensions as $$
declare rows jsonb; result jsonb;
begin
  select coalesce(jsonb_agg(r order by abs(coalesce((r->>'differenceToCustomer')::numeric,0)) desc,r->>'customerId'),'[]') into rows
  from (select private.stockflow_customer_price(customer_id,p_item,p_date) r from (
    select distinct customer_id from private.stockflow_tally_sales_prices where tally_item_key=p_item and not exceptional and exception_type is null and invoice_rate>0 and invoice_date<=p_date
  ) buyers) prices;
  result:=jsonb_build_object('baseEvidence',private.stockflow_customer_price(null,p_item,p_date),'tallyKey',p_item,'pricingDate',p_date,'rows',rows,'customerCount',jsonb_array_length(rows),
    'protectedCount',(select count(*) from jsonb_array_elements(rows) r where (r->>'fixed')::boolean),
    'reviewCount',(select count(*) from jsonb_array_elements(rows) r where r->>'status'='REVIEW_REQUIRED'),
    'continuityCount',(select count(*) from jsonb_array_elements(rows) r where not (r->>'fixed')::boolean and r->>'continuity' is not null),
    'belowMinimumCount',(select count(*) from jsonb_array_elements(rows) r where r->'warnings' ? 'BELOW_MINIMUM_MARGIN'),
    'targetAboveContinuityCount',(select count(*) from jsonb_array_elements(rows) r where (r->>'target')::numeric>(r->>'continuity')::numeric),
    'materialIncreaseCount',(select count(*) from jsonb_array_elements(rows) r where abs((r->>'differenceToCustomer')::numeric)/nullif((r->>'lastRate')::numeric,0)*100>(r->'policy'->>'overrideApprovalPercent')::numeric),
    'monthlyGPImpact',null,'currentMonthlyGP',null,'continuityMonthlyGP',null,'recommendedMonthlyGP',null,'volumeStatus','NO_RELIABLE_VOLUME_EVIDENCE','ranking','Absolute per-unit impact; monthly buying volume unavailable');
  return result||jsonb_build_object('previewHash',encode(extensions.digest(result::text,'sha256'),'hex'));
end $$;
revoke all on function private.stockflow_product_price_impact(text,date) from public,anon,authenticated;

alter table private.stockflow_order_pricing_decisions add column evidence_hash text;
alter table private.stockflow_pricing_events drop constraint stockflow_pricing_events_entity_type_check;
alter table private.stockflow_pricing_events add constraint stockflow_pricing_events_entity_type_check check (entity_type in ('pricing_policy','customer_price','order_pricing','price_exception','billing_snapshot','standard_item_price','price_book'));

create or replace function public.stockflow_pricing_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,extensions as $$
declare email text:=lower(btrim(p_actor_email)); role text; secret text; result jsonb; replay jsonb; r jsonb; entry jsonb;
  pricing_date date:=coalesce(nullif(p_payload->>'pricingDate','')::date,(now() at time zone 'Asia/Kolkata')::date);
  item text:=btrim(p_payload->>'tallyKey'); customer uuid; offset_rows integer:=coalesce((p_payload->>'offset')::integer,0);
  rows jsonb; impact jsonb; rate numeric; decision_id uuid; applied integer:=0; skipped integer:=0;
  ex private.stockflow_price_exceptions%rowtype; decision private.stockflow_order_pricing_decisions%rowtype;
begin
  select secret_sha256 into secret from private.stockflow_gateway_config where name='orders';
  if secret is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>secret then raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  select m.role into role from public.stockflow_members m where m.email=lower(btrim(p_actor_email)) and status='active';
  perform private.stockflow_assert_pricing_role(role);
  if offset_rows<0 or offset_rows>100000 then raise exception 'Invalid page offset' using errcode='22023'; end if;

  if p_action='get_customer_price_book' then
    customer:=(p_payload->>'customerId')::uuid;
    if not exists(select 1 from private.stockflow_customers where id=customer and active) then raise exception 'Customer was not found' using errcode='22023'; end if;
    select coalesce(jsonb_agg(data.r order by data.r->>'tallyKey'),'[]') into rows from (
      select private.stockflow_customer_price(customer,k,pricing_date) r from (
        select k from (
          select distinct tally_item_key k from private.stockflow_tally_sales_prices where customer_id=customer and invoice_date<=pricing_date and not exceptional and exception_type is null and invoice_rate>0 and coalesce(p_payload->>'tab','purchased')='purchased'
          union select tally_item_key from private.stockflow_customer_product_prices where customer_id=customer and coalesce(p_payload->>'tab','purchased')='exceptions'
          union select tally_item_key from private.stockflow_products where active and coalesce(p_payload->>'tab','purchased')='all'
        ) keys where nullif(p_payload->>'search','') is null or strpos(lower(k||' '||coalesce((select name from private.stockflow_products where tally_item_key=k),'')),lower(p_payload->>'search'))>0
        order by k limit 51 offset offset_rows
      ) page
    ) data;
    return jsonb_build_object('rows',coalesce((select jsonb_agg(value) from jsonb_array_elements(rows) with ordinality x(value,n) where n<=50),'[]'),'hasMore',jsonb_array_length(rows)>50,'offset',offset_rows);
  end if;
  if p_action='get_product_price_impact' then
    impact:=private.stockflow_product_price_impact(item,pricing_date);
    return (impact-'rows')||jsonb_build_object('rows',coalesce((select jsonb_agg(value) from jsonb_array_elements(impact->'rows') with ordinality x(value,n) where n>offset_rows and n<=offset_rows+50),'[]'),'hasMore',jsonb_array_length(impact->'rows')>offset_rows+50,'offset',offset_rows);
  end if;

  if p_action in ('apply_price_book','apply_product_price_impact','set_standard_item_price','submit_order_pricing','approve_price_exception','create_price_contract','approve_price_contract','create_pricing_policy') then
    -- Short pricing mutations share a lock order with evidence tables. Reads remain nonblocking.
    lock table private.stockflow_tally_sales_prices,private.stockflow_tally_purchase_costs,private.stockflow_pricing_policies,private.stockflow_customer_product_prices,private.stockflow_standard_item_prices,private.stockflow_price_book_decisions in share row exclusive mode;
  end if;
  if p_action in ('apply_price_book','apply_product_price_impact') then
    if role not in ('administrator','management') then raise exception 'Commercial approval is restricted to management' using errcode='42501'; end if;
    replay:=private.begin_stockflow_command(email,p_action,p_payload->>'idempotencyKey',p_payload);
    if replay is not null then return replay; end if;
    if length(btrim(coalesce(p_payload->>'reason','')))<3 then raise exception 'A commercial decision reason is required' using errcode='22023'; end if;
    if p_payload->>'choice' not in ('continuity','recommended','custom') then raise exception 'Invalid price choice' using errcode='22023'; end if;
    if p_action='apply_product_price_impact' then
      if p_payload->>'choice'='custom' then raise exception 'Bulk custom prices are not supported' using errcode='22023'; end if;
      impact:=private.stockflow_product_price_impact(item,pricing_date);
      if impact->>'previewHash' is distinct from p_payload->>'previewHash' then raise exception 'Pricing evidence changed; refresh and review' using errcode='40001'; end if;
      rows:=impact->'rows';
      if jsonb_array_length(rows)>1000 then raise exception 'Cost review exceeds 1000 customers; narrow the review before approval' using errcode='54000'; end if;
    else
      r:=private.stockflow_customer_price((p_payload->>'customerId')::uuid,item,pricing_date);
      if r->>'evidenceHash' is distinct from p_payload->>'evidenceHash' or r->>'currentDecisionId' is distinct from p_payload->>'expectedDecisionId' then raise exception 'Pricing evidence or decision changed; refresh and review' using errcode='40001'; end if;
      rows:=jsonb_build_array(r);
    end if;
    for r in select value from jsonb_array_elements(rows) loop
      if (r->>'fixed')::boolean then skipped:=skipped+1; continue; end if;
      rate:=case p_payload->>'choice' when 'continuity' then (r->>'continuity')::numeric when 'recommended' then (r->>'recommended')::numeric else (p_payload->>'price')::numeric end;
      if rate is null or rate<=0 or r->>'currentCost' is null then
        if p_action='apply_price_book' then raise exception 'Reliable price and cost evidence are required' using errcode='22023'; end if;
        skipped:=skipped+1; continue;
      end if;
      insert into private.stockflow_price_book_decisions(customer_id,tally_item_key,pricing_date,evidence_hash,choice,price,reason,actor_email,request_id)
      values((r->>'customerId')::uuid,item,pricing_date,r->>'evidenceHash',p_payload->>'choice',rate,p_payload->>'reason',email,p_payload->>'idempotencyKey') returning id into decision_id;
      insert into private.stockflow_pricing_events(entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata)
      values('price_book',decision_id,'price_book_approved',email,role,p_payload->>'idempotencyKey',jsonb_build_object('evidence',r,'choice',p_payload->>'choice','price',rate,'reason',p_payload->>'reason'));
      insert into private.stockflow_outbox(topic,aggregate_id,payload) values('pricing.book_approved',decision_id,jsonb_build_object('decisionId',decision_id));
      applied:=applied+1;
    end loop;
    result:=jsonb_build_object('ok',true,'applied',applied,'skipped',skipped);
    perform private.finish_stockflow_command(email,p_action,p_payload->>'idempotencyKey',p_payload,coalesce(decision_id,extensions.gen_random_uuid()),result);
    return result;
  end if;
  if p_action='set_standard_item_price' then
    replay:=private.begin_stockflow_command(email,p_action,p_payload->>'idempotencyKey',p_payload);
    if replay is not null then return replay; end if;
    if not exists(select 1 from private.stockflow_products where tally_item_key=item and active) then raise exception 'Select an active Tally product' using errcode='22023'; end if;
    impact:=private.stockflow_product_price_impact(item,pricing_date);
    if impact->>'previewHash' is distinct from p_payload->>'previewHash' then raise exception 'Base price or evidence changed; refresh and review' using errcode='40001'; end if;
  end if;
  if p_action='submit_order_pricing' then
    replay:=private.begin_stockflow_command(email,p_action,p_payload->>'idempotencyKey',p_payload);
    if replay is not null then return replay; end if;
    for entry in select value from jsonb_array_elements(p_payload->'lines') loop
      r:=private.stockflow_resolve_pricing_line((entry->>'lineId')::uuid,pricing_date);
      if entry->>'evidenceHash' is distinct from r->>'evidenceHash' then raise exception 'Pricing evidence changed; refresh and review' using errcode='40001'; end if;
    end loop;
  end if;
  if p_action='approve_price_exception' then
    select * into ex from private.stockflow_price_exceptions where id=(p_payload->>'exceptionId')::uuid;
    if ex.state='pending' then
      -- The final exception seals a snapshot of the entire decision batch.
      -- Recheck both pending and approved siblings while evidence writers are locked.
      for decision in
        select d.* from private.stockflow_order_pricing_decisions d
        where d.order_id=ex.order_id
          and d.decision_version=(select original.decision_version from private.stockflow_order_pricing_decisions original where original.id=ex.decision_id)
          and d.state in ('pending_approval','approved')
        order by d.order_line_id
      loop
        r:=private.stockflow_resolve_pricing_line(decision.order_line_id,pricing_date);
        if decision.evidence_hash is distinct from r->>'evidenceHash' then raise exception 'Pricing evidence changed; reject stale batch and review again' using errcode='40001'; end if;
      end loop;
    end if;
  end if;
  result:=private.stockflow_pricing_gateway_v1(p_gateway_key,p_actor_email,p_action,p_payload);
  if p_action='submit_order_pricing' then
    for entry in select value from jsonb_array_elements(p_payload->'lines') loop
      update private.stockflow_order_pricing_decisions set evidence_hash=entry->>'evidenceHash' where request_id=p_payload->>'idempotencyKey' and order_line_id=(entry->>'lineId')::uuid;
    end loop;
  end if;
  return result;
end $$;
revoke all on function public.stockflow_pricing_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_pricing_gateway(text,text,text,jsonb) to service_role;
revoke all on function private.stockflow_pricing_gateway_v1(text,text,text,jsonb) from public,anon,authenticated,service_role;
