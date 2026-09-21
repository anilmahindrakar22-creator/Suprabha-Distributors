create or replace function private.stockflow_is_governed_order_price(
  p_customer uuid,
  p_item text,
  p_pricing_date date,
  p_resolution jsonb
)
returns boolean
language plpgsql
stable
set search_path=pg_catalog,private
as $$
declare
  base_resolution jsonb;
begin
  if p_resolution->'source'->>'type'='APPROVED_CONTRACT' then
    return exists(
      select 1 from private.stockflow_customer_product_prices p
      where p.id=(p_resolution->'source'->>'reference')::uuid
        and p.status in ('approved','superseded')
        and p.price_amount=(p_resolution->>'proposedRate')::numeric
    );
  end if;
  if p_resolution->'source'->>'type'='STANDARD_ITEM_PRICE' then
    return exists(
      select 1 from private.stockflow_standard_item_prices p
      where p.id=(p_resolution->'source'->>'reference')::uuid
        and p.status in ('approved','superseded')
        and p.price_amount=(p_resolution->>'proposedRate')::numeric
    );
  end if;
  if p_resolution->'source'->>'type'<>'LAST_TALLY_INVOICE' or nullif(p_resolution->>'proposedRate','') is null then
    return false;
  end if;
  base_resolution:=private.stockflow_customer_price(p_customer,p_item,p_pricing_date);
  return exists(
    select 1 from private.stockflow_price_book_decisions d
    where d.customer_id=p_customer
      and d.tally_item_key=p_item
      and d.evidence_hash=base_resolution->>'evidenceHash'
      and d.price=(p_resolution->>'proposedRate')::numeric
  );
end $$;

revoke all on function private.stockflow_is_governed_order_price(uuid,text,date,jsonb)
  from public,anon,authenticated;

alter function public.stockflow_pricing_gateway(text,text,text,jsonb)
  rename to stockflow_pricing_gateway_v3;

revoke all on function public.stockflow_pricing_gateway_v3(text,text,text,jsonb)
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
set search_path=pg_catalog,private
as $$
declare
  pricing_date date:=coalesce(nullif(p_payload->>'pricingDate','')::date,(now() at time zone 'Asia/Kolkata')::date);
  workspace jsonb;
  line jsonb;
  governed_lines jsonb:='[]'::jsonb;
  customer uuid;
  order_row private.stockflow_orders%rowtype;
begin
  if p_action not in ('get_order_pricing','apply_governed_order_pricing') then
    return public.stockflow_pricing_gateway_v3(p_gateway_key,p_actor_email,p_action,p_payload);
  end if;

  workspace:=public.stockflow_pricing_gateway_v3(
    p_gateway_key,p_actor_email,'get_order_pricing',
    jsonb_build_object('orderId',p_payload->>'orderId','pricingDate',pricing_date)
  );
  customer:=nullif(workspace->>'customerId','')::uuid;

  for line in select value from jsonb_array_elements(workspace->'lines') loop
    line:=line||jsonb_build_object(
      'governed',private.stockflow_is_governed_order_price(customer,line->>'tallyKey',pricing_date,line)
    );
    governed_lines:=governed_lines||jsonb_build_array(line);
  end loop;
  workspace:=workspace||jsonb_build_object('lines',governed_lines);

  if p_action='get_order_pricing' then return workspace; end if;

  select * into order_row from private.stockflow_orders
  where id=(p_payload->>'orderId')::uuid and archived_at is null for update;
  if not found then raise exception 'Order was not found' using errcode='22023'; end if;
  if order_row.version<>(p_payload->>'expectedVersion')::integer then
    raise exception 'Order has changed; refresh before trying again' using errcode='40001';
  end if;
  if order_row.pricing_state='approved' then
    raise exception 'Order pricing is already approved' using errcode='22023';
  end if;
  if jsonb_array_length(governed_lines)=0 then
    raise exception 'Order has no pricing lines' using errcode='22023';
  end if;
  if exists(
    select 1 from jsonb_array_elements(governed_lines) x
    where not coalesce((x->>'governed')::boolean,false)
       or x->>'guardrail'='PRICE_REVIEW_REQUIRED'
       or coalesce((x->>'proposedRate')::numeric,0)<=0
  ) then
    raise exception 'Every order line requires a current governed price; review exceptions manually' using errcode='22023';
  end if;

  return public.stockflow_pricing_gateway_v3(
    p_gateway_key,p_actor_email,'submit_order_pricing',
    jsonb_build_object(
      'orderId',order_row.id,
      'expectedVersion',order_row.version,
      'pricingDate',pricing_date,
      'idempotencyKey',p_payload->>'idempotencyKey',
      'lines',(select jsonb_agg(jsonb_build_object(
        'lineId',x->>'lineId',
        'enteredRate',(x->>'proposedRate')::numeric,
        'evidenceHash',x->>'evidenceHash'
      ) order by x->>'lineId') from jsonb_array_elements(governed_lines) x)
    )
  );
end $$;

revoke all on function public.stockflow_pricing_gateway(text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.stockflow_pricing_gateway(text,text,text,jsonb)
  to service_role;
