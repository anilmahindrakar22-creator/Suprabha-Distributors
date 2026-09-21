alter function public.stockflow_pricing_gateway(text,text,text,jsonb)
  rename to stockflow_pricing_gateway_v2;

revoke all on function public.stockflow_pricing_gateway_v2(text,text,text,jsonb)
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
  actor_email text:=lower(btrim(p_actor_email));
  role text;
  secret text;
  customer uuid;
  pricing_date date:=coalesce(nullif(p_payload->>'pricingDate','')::date,(now() at time zone 'Asia/Kolkata')::date);
  offset_rows integer:=coalesce((p_payload->>'offset')::integer,0);
  selected_tab text:=coalesce(p_payload->>'tab','purchased');
  search_text text:=lower(nullif(btrim(p_payload->>'search'),''));
  rows jsonb;
begin
  if p_action<>'get_customer_price_book' then
    return public.stockflow_pricing_gateway_v2(p_gateway_key,p_actor_email,p_action,p_payload);
  end if;

  select secret_sha256 into secret from private.stockflow_gateway_config where name='orders';
  if secret is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>secret then
    raise exception 'Unauthorized gateway' using errcode='42501';
  end if;
  select m.role into role
  from public.stockflow_members m
  where m.email=actor_email and m.status='active';
  perform private.stockflow_assert_pricing_role(role);
  if offset_rows<0 or offset_rows>100000 or selected_tab not in ('purchased','exceptions','all') then
    raise exception 'Invalid price-book filters' using errcode='22023';
  end if;

  customer:=(p_payload->>'customerId')::uuid;
  if not exists(select 1 from private.stockflow_customers where id=customer and active) then
    raise exception 'Customer was not found' using errcode='22023';
  end if;

  with candidates as (
    select distinct sp.tally_item_key
    from private.stockflow_tally_sales_prices sp
    where sp.customer_id=customer and sp.invoice_date<=pricing_date
      and not sp.exceptional and sp.exception_type is null and sp.invoice_rate>0
      and selected_tab in ('purchased','exceptions')
    union
    select distinct cp.tally_item_key
    from private.stockflow_customer_product_prices cp
    where cp.customer_id=customer and selected_tab='exceptions'
    union
    select p.tally_item_key
    from private.stockflow_products p
    where p.active and selected_tab='all'
  ), resolved as (
    select private.stockflow_customer_price(customer,c.tally_item_key,pricing_date) as price_row
    from candidates c
    where search_text is null or strpos(lower(c.tally_item_key||' '||coalesce((select p.name from private.stockflow_products p where p.tally_item_key=c.tally_item_key),'')),search_text)>0
  ), filtered as (
    select price_row from resolved
    where selected_tab<>'exceptions'
       or coalesce((price_row->>'fixed')::boolean,false)
       or price_row->>'status'='REVIEW_REQUIRED'
  ), page as (
    select price_row from filtered order by price_row->>'tallyKey' limit 51 offset offset_rows
  )
  select coalesce(jsonb_agg(price_row order by price_row->>'tallyKey'),'[]'::jsonb) into rows from page;

  return jsonb_build_object(
    'rows',coalesce((select jsonb_agg(value) from jsonb_array_elements(rows) with ordinality x(value,n) where n<=50),'[]'::jsonb),
    'hasMore',jsonb_array_length(rows)>50,
    'offset',offset_rows
  );
end $$;

revoke all on function public.stockflow_pricing_gateway(text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.stockflow_pricing_gateway(text,text,text,jsonb)
  to service_role;
