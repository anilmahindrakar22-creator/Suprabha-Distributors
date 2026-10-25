alter table private.stockflow_customer_product_prices
  add column approved_cost_amount numeric(18,2),
  add column approved_cost_kind text,
  add column origin_exception_id uuid unique references private.stockflow_price_exceptions(id) on delete restrict;
alter table private.stockflow_price_exceptions
  add column save_as_customer_price boolean not null default true;

create function private.stockflow_remember_order_prices(p_order_id uuid, p_actor_email text)
returns void language plpgsql
set search_path to 'pg_catalog', 'private', 'extensions'
as $function$
declare
  o private.stockflow_orders%rowtype;
  previous private.stockflow_customer_product_prices%rowtype;
  future_price uuid;
  remembered_id uuid;
  entry record;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  actor_role text;
  current_resolution jsonb;
begin
  select * into o from private.stockflow_orders where id=p_order_id for update;
  if o.pricing_state is distinct from 'approved'
     or exists(select 1 from private.stockflow_price_exceptions where order_id=o.id and state='pending')
     or not exists(select 1 from private.stockflow_billing_snapshots
       where id=o.pricing_snapshot_id and order_id=o.id and invalidated_at is null) then
    return;
  end if;
  select role into actor_role from public.stockflow_members where email=lower(btrim(p_actor_email));
  for entry in
    select e.id, e.requested_by_email, e.decided_by_email, e.decision_reason,
      d.approved_rate, d.cost_amount, c.cost_kind, l.tally_item_key,
      d.id as decision_id, l.id as line_id, d.evidence_hash,
      private.stockflow_resolve_pricing_line(l.id,today)->>'evidenceHash' as current_evidence_hash
    from private.stockflow_price_exceptions e
    join private.stockflow_order_pricing_decisions d on d.id=e.decision_id and d.state='approved'
    join private.stockflow_order_lines l on l.id=e.order_line_id and l.approved_pricing_decision_id=d.id
    left join private.stockflow_tally_purchase_costs c on c.id=d.cost_id
    where e.order_id=o.id and e.state='approved' and e.save_as_customer_price
      and not exists(select 1 from private.stockflow_customer_product_prices p where p.origin_exception_id=e.id)
      and not exists(select 1 from private.stockflow_pricing_events ev
        where ev.entity_type='price_exception' and ev.entity_id=e.id and ev.event_type='customer_price_not_remembered')
    order by l.tally_item_key, e.id
  loop
    select id into future_price from private.stockflow_customer_product_prices
    where customer_id=o.customer_id and tally_item_key=entry.tally_item_key
      and status='approved' and valid_from>today
    order by valid_from, id limit 1;
    if future_price is not null then
      insert into private.stockflow_pricing_events(entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata)
      values('price_exception',entry.id,'customer_price_not_remembered',lower(btrim(p_actor_email)),actor_role,entry.id::text,
        jsonb_build_object('orderId',o.id,'tallyKey',entry.tally_item_key,
          'reason','A future-dated customer price already exists','futurePriceId',future_price));
      continue;
    end if;
    select * into previous from private.stockflow_customer_product_prices
    where customer_id=o.customer_id and tally_item_key=entry.tally_item_key
      and status='approved' and valid_from<=today and (valid_to is null or valid_to>=today)
    for update;
    if previous.id is not null then
      if previous.valid_from<today then
        update private.stockflow_customer_product_prices
        set status='superseded',valid_to=today-1,version=version+1 where id=previous.id;
      else
        update private.stockflow_customer_product_prices
        set status='superseded',valid_to=today,version=version+1 where id=previous.id;
      end if;
    end if;
    insert into private.stockflow_customer_product_prices(
      customer_id,tally_item_key,price_amount,valid_from,status,source_type,source_reference,
      reason,created_by_email,approved_by_email,approved_at,version,supersedes_price_id,
      approved_cost_amount,approved_cost_kind,origin_exception_id
    ) values (
      o.customer_id,entry.tally_item_key,entry.approved_rate,today,'approved','manual_governed',o.order_number,
      left(btrim(entry.decision_reason),1000),entry.requested_by_email,entry.decided_by_email,now(),
      -- now() is shared by approvals in one transaction; the successor must also win that tie.
      coalesce(previous.version+2,1),previous.id,entry.cost_amount,entry.cost_kind,entry.id
    ) returning id into remembered_id;
    insert into private.stockflow_pricing_events(entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata)
    values('customer_price',remembered_id,'customer_price_remembered',lower(btrim(p_actor_email)),actor_role,entry.id::text,
      jsonb_build_object('orderId',o.id,'customerId',o.customer_id,'tallyKey',entry.tally_item_key,
        'price',entry.approved_rate,'approvedCost',entry.cost_amount));
    -- Rebase only evidence that was current before this save; retain the sealed snapshot.
    if entry.evidence_hash=entry.current_evidence_hash then
      current_resolution := private.stockflow_resolve_pricing_line(entry.line_id,today);
      if current_resolution->>'guardrail'='PRICE_OK'
         and (current_resolution->>'proposedRate')::numeric=entry.approved_rate then
        update private.stockflow_order_pricing_decisions
        set evidence_hash=current_resolution->>'evidenceHash' where id=entry.decision_id;
      end if;
    end if;
  end loop;
end $function$;
revoke all on function private.stockflow_remember_order_prices(uuid,text) from public,anon,authenticated,service_role;

alter function public.stockflow_pricing_gateway(text,text,text,jsonb) rename to stockflow_pricing_gateway_before_remembered_price;
revoke all on function public.stockflow_pricing_gateway_before_remembered_price(text,text,text,jsonb) from public,anon,authenticated;

create function public.stockflow_pricing_gateway(p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path to 'pg_catalog', 'private', 'extensions'
as $function$
declare
  save_price boolean := true;
  ex private.stockflow_price_exceptions%rowtype;
  result jsonb;
  secret text;
begin
  if p_action is distinct from 'approve_price_exception' then
    return public.stockflow_pricing_gateway_before_remembered_price(p_gateway_key,p_actor_email,p_action,p_payload);
  end if;
  select secret_sha256 into secret from private.stockflow_gateway_config where name='orders';
  if secret is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>secret then
    raise exception 'Unauthorized gateway' using errcode='42501';
  end if;
  if p_payload ? 'saveAsCustomerPrice' then
    if jsonb_typeof(p_payload->'saveAsCustomerPrice') is distinct from 'boolean' then
      raise exception 'saveAsCustomerPrice must be true or false' using errcode='22023';
    end if;
    save_price := (p_payload->>'saveAsCustomerPrice')::boolean;
  end if;
  -- Preserve the delegated gateway's evidence-before-exception lock order.
  lock table private.stockflow_tally_sales_prices,private.stockflow_tally_purchase_costs,
    private.stockflow_pricing_policies,private.stockflow_customer_product_prices,
    private.stockflow_standard_item_prices,private.stockflow_price_book_decisions in share row exclusive mode;
  select * into ex from private.stockflow_price_exceptions where id=(p_payload->>'exceptionId')::uuid for update;
  if ex.state='pending' then
    update private.stockflow_price_exceptions set save_as_customer_price=save_price where id=ex.id;
  end if;
  result := public.stockflow_pricing_gateway_before_remembered_price(
    p_gateway_key,p_actor_email,p_action,p_payload-'saveAsCustomerPrice');
  if exists(select 1 from private.stockflow_orders o
    join private.stockflow_billing_snapshots s on s.id=o.pricing_snapshot_id and s.order_id=o.id and s.invalidated_at is null
    where o.id=ex.order_id and o.pricing_state='approved'
      and not exists(select 1 from private.stockflow_price_exceptions e where e.order_id=o.id and e.state='pending')) then
    perform private.stockflow_remember_order_prices(ex.order_id,p_actor_email);
  end if;
  return result;
end $function$;
revoke all on function public.stockflow_pricing_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_pricing_gateway(text,text,text,jsonb) to service_role;

-- These retained implementations are called by the current group-margin wrappers.
do $patch$
declare definition text; anchor text; replacement text;
begin
  definition := replace(pg_get_functiondef('private.stockflow_customer_price_before_customer_first(uuid,text,date)'::regprocedure),chr(13),'');
  anchor := $old$select * into agreement from private.stockflow_customer_product_prices where customer_id=p_customer and tally_item_key=p_item and status in ('approved','superseded') and valid_from<=p_date and (valid_to is null or valid_to>=p_date) order by valid_from desc limit 1;$old$;
  replacement := replace(anchor,'order by valid_from desc','order by valid_from desc, approved_at desc nulls last, version desc, id desc');
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'Remembered price agreement lookup anchor changed';
  end if;
  definition := replace(definition,anchor,replacement);
  anchor := $old$  return result||jsonb_build_object('evidenceHash',$old$;
  replacement := $new$  if agreement.approved_cost_amount is not null then
    result := result||jsonb_build_object('approvedCostAmount',agreement.approved_cost_amount,'approvedCostKind',agreement.approved_cost_kind);
  end if;
  return result||jsonb_build_object('evidenceHash',$new$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'Remembered price agreement evidence anchor changed';
  end if;
  execute replace(definition,anchor,replacement);

  definition := replace(pg_get_functiondef('private.stockflow_resolve_pricing_line_before_group_margin(uuid,date)'::regprocedure),chr(13),'');
  anchor := $old$  guardrail:=case
    when coalesce(nullif(resolved->>'costChange','')::numeric,0)>0$old$;
  replacement := $new$  guardrail:=case
    when resolved->'source'->>'type'='APPROVED_CONTRACT'
      and nullif(resolved->>'approvedCostAmount','')::numeric is not null then
      case when current_cost is null
        or (resolved->'cost'->>'kind') is distinct from (resolved->>'approvedCostKind')
        or current_cost > (resolved->>'approvedCostAmount')::numeric * 1.02
        then 'PRICE_REVIEW_REQUIRED' else 'PRICE_OK' end
    when coalesce(nullif(resolved->>'costChange','')::numeric,0)>0$new$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'Remembered price guardrail anchor changed';
  end if;
  execute replace(definition,anchor,replacement);

  definition := replace(pg_get_functiondef('private.stockflow_pricing_gateway_v1(text,text,text,jsonb)'::regprocedure),chr(13),'');
  anchor := $old$or ((v_resolved->'cost'->>'amount') is not null and (v_entered-(v_resolved->'cost'->>'amount')::numeric)/v_entered*100<(v_resolved->'policy'->>'minimumMarginPercent')::numeric)$old$;
  replacement := $new$or ((v_resolved->'cost'->>'amount') is not null and (v_entered-(v_resolved->'cost'->>'amount')::numeric)/v_entered*100<(v_resolved->'policy'->>'minimumMarginPercent')::numeric
          and not coalesce(v_resolved->'source'->>'type'='APPROVED_CONTRACT'
            and nullif(v_resolved->>'approvedCostAmount','')::numeric is not null
            and v_resolved->>'guardrail'='PRICE_OK' and v_difference=0,false))$new$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'Remembered price submission margin anchor changed';
  end if;
  execute replace(definition,anchor,replacement);
end $patch$;

do $sales_revisions$
declare definition text; anchor text; replacement text;
begin
  definition := replace(pg_get_functiondef('private.stockflow_customer_price_before_customer_first(uuid,text,date)'::regprocedure),chr(13),'');
  anchor := $old$select * into sale from private.stockflow_tally_sales_prices where customer_id=p_customer and tally_item_key=p_item and invoice_date<=p_date and not exceptional and exception_type is null and invoice_rate>0 order by invoice_date desc,imported_at desc,id limit 1;$old$;
  replacement := $new$select * into sale from (
    select distinct on (source_id) * from private.stockflow_tally_sales_prices
    where customer_id=p_customer and tally_item_key=p_item
    order by source_id, imported_at desc, id desc
  ) latest_sale_pick where customer_id=p_customer and tally_item_key=p_item and invoice_date<=p_date and not exceptional and exception_type is null and invoice_rate>0 order by invoice_date desc,imported_at desc,id limit 1;$new$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'Latest Tally sale anchor changed';
  end if;
  definition := replace(definition,anchor,replacement);
  anchor := $old$select count(distinct invoice_rate)>1 into ambiguous from private.stockflow_tally_sales_prices where customer_id=p_customer and tally_item_key=p_item and invoice_date=sale.invoice_date and not exceptional and exception_type is null and invoice_rate>0;$old$;
  replacement := $new$select count(distinct invoice_rate)>1 into ambiguous from (
      select distinct on (source_id) * from private.stockflow_tally_sales_prices
      where customer_id=p_customer and tally_item_key=p_item
      order by source_id, imported_at desc, id desc
    ) latest_sale_ambiguity where customer_id=p_customer and tally_item_key=p_item and invoice_date=sale.invoice_date and not exceptional and exception_type is null and invoice_rate>0;$new$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'Tally sale ambiguity anchor changed';
  end if;
  definition := replace(definition,anchor,replacement);
  anchor := $old$'recentRates',coalesce((select jsonb_agg(to_jsonb(r)) from (select invoice_rate as rate,invoice_date as "invoiceDate",invoice_reference as "invoiceReference",source_version as "sourceVersion" from private.stockflow_tally_sales_prices where customer_id=p_customer and tally_item_key=p_item and invoice_date<=p_date and not exceptional and exception_type is null and invoice_rate>0 order by invoice_date desc,imported_at desc,id limit 5) r),'[]'),$old$;
  replacement := $new$'recentRates',coalesce((select jsonb_agg(to_jsonb(r)) from (select invoice_rate as rate,invoice_date as "invoiceDate",invoice_reference as "invoiceReference",source_version as "sourceVersion" from (
      select distinct on (source_id) * from private.stockflow_tally_sales_prices
      where customer_id=p_customer and tally_item_key=p_item
      order by source_id, imported_at desc, id desc
    ) latest_recent_rates where customer_id=p_customer and tally_item_key=p_item and invoice_date<=p_date and not exceptional and exception_type is null and invoice_rate>0 order by invoice_date desc,imported_at desc,id limit 5) r),'[]'),$new$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'Recent Tally rates anchor changed';
  end if;
  execute replace(definition,anchor,replacement);

  definition := replace(pg_get_functiondef('private.stockflow_pricing_gateway_v1(text,text,text,jsonb)'::regprocedure),chr(13),'');
  anchor := $old$from private.stockflow_tally_sales_prices sp left join private.stockflow_products product on product.tally_item_key=sp.tally_item_key$old$;
  replacement := $new$from (
        select distinct on (source_id) * from private.stockflow_tally_sales_prices
        where customer_id=(p_payload->>'customerId')::uuid
        order by source_id, imported_at desc, id desc
      ) sp left join private.stockflow_products product on product.tally_item_key=sp.tally_item_key$new$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'Purchased items last rate anchor changed';
  end if;
  execute replace(definition,anchor,replacement);
end $sales_revisions$;

notify pgrst, 'reload schema';
