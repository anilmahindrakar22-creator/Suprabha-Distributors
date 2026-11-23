begin;

create or replace function private.stockflow_idle_stock(p_today date,p_page integer) returns jsonb
language sql stable security definer set search_path=pg_catalog,private,public,extensions as $$
with stock_values as (
  select item->>'item' as item_key,
    nullif(nullif(btrim(regexp_replace(coalesce(item->>'group',''),'[[:cntrl:]]','','g')),''),'Primary') as item_group,
    item->>'baseUnit' as base_unit,
    case when char_length(item->>'closing')<=30 and item->>'closing' ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (item->>'closing')::numeric end as closing
  from public.stockflow_snapshots s cross join lateral
    jsonb_array_elements(case when jsonb_typeof(s.payload->'catalog')='array'
      then s.payload->'catalog' else '[]'::jsonb end) item
  where s.id='suprabha' and nullif(item->>'item','') is not null
    and item->'active' is distinct from 'false'::jsonb
), in_stock as materialized (
  select item_key,max(closing) as closing,min(item_group) as item_group,min(base_unit) as base_unit
  from stock_values where closing>0 group by item_key order by item_key collate "C" limit 5000
), latest as materialized (
  select distinct on(v.company_id,v.source_id) v.*
  from private.stockflow_economic_source_vouchers v
  where v.kind='sale' and not v.cancelled
    and not exists(select 1 from private.stockflow_economic_source_vouchers n
      where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
  order by v.company_id,v.source_id,v.source_revision desc
), sale_lines as materialized (
  select v.company_id,v.customer_source_id,v.business_date,l.product_id
  from latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id and l.quantity>0
), catalogs as materialized (
  select distinct on(company_id) company_id,content from private.stockflow_economic_item_catalogs
  order by company_id,observed_at desc,id desc
), names as materialized (
  select c.company_id,p->>'id' product_id,p->>'name' name
  from catalogs c cross join lateral jsonb_array_elements(c.content->'products') p
  where p->>'name' in (select item_key from in_stock)
), sales as (
  select n.name as item_key,max(w.business_date) as last_sold_on,count(distinct ci.customer_id) as buyer_count
  from sale_lines w join names n on n.company_id=w.company_id and n.product_id=w.product_id
  left join private.stockflow_economic_customer_identities ci on ci.company_id=w.company_id and ci.source_id=w.customer_source_id
  group by n.name
), idle as materialized (
  select s.*,v.last_sold_on,v.buyer_count from in_stock s left join sales v using(item_key)
  where v.last_sold_on is null or v.last_sold_on<=p_today-180
), paged as (
  select * from idle order by last_sold_on asc nulls first,item_key collate "C"
  offset (p_page-1)*50 limit 50
)
select jsonb_build_object('view','idle','asOf',p_today,'windowDays',180,
  'historyFrom',(select min(business_date) from latest),
  'salesThrough',(select max(business_date) from latest where business_date<=p_today),
  'inStockCount',(select count(*) from in_stock),'idleCount',(select count(*) from idle),
  'page',p_page,'pageSize',50,
  'items',coalesce((select jsonb_agg(jsonb_build_object('itemKey',item_key,'group',item_group,
    'closing',round(closing,3),'baseUnit',base_unit,'lastSoldOn',last_sold_on,'buyerCount',coalesce(buyer_count,0))
    order by last_sold_on asc nulls first,item_key collate "C") from paged),'[]'::jsonb))
$$;
revoke all on function private.stockflow_idle_stock(date,integer) from public,anon,authenticated,service_role;

create function private.stockflow_idle_buyers(p_item_key text,p_scope_email text) returns jsonb
language sql stable security definer set search_path=pg_catalog,private,public,extensions as $$
with latest as materialized (
  select distinct on(v.company_id,v.source_id) v.*
  from private.stockflow_economic_source_vouchers v
  where v.kind='sale' and not v.cancelled
    and not exists(select 1 from private.stockflow_economic_source_vouchers n
      where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
  order by v.company_id,v.source_id,v.source_revision desc
), sale_lines as materialized (
  select v.id as voucher_id,v.company_id,v.customer_source_id,v.business_date,l.product_id,l.quantity
  from latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id and l.quantity>0
), catalogs as materialized (
  select distinct on(company_id) company_id,content from private.stockflow_economic_item_catalogs
  order by company_id,observed_at desc,id desc
), names as materialized (
  select c.company_id,p->>'id' product_id,p->>'name' name
  from catalogs c cross join lateral jsonb_array_elements(c.content->'products') p
  where p->>'name'=p_item_key
), item_lines as materialized (
  select w.* from sale_lines w
  where exists(select 1 from names n where n.company_id=w.company_id and n.product_id=w.product_id)
), customers as (
  select c.id as customer_id,c.name as customer_name,max(w.business_date) as last_bought_on,
    round(sum(w.quantity),3) as quantity,count(distinct w.voucher_id) as bills,
    p_scope_email is null or exists(select 1 from private.stockflow_customer_assignments a
      where a.customer_id=c.id and a.effective_to is null and a.owner_email=p_scope_email) as in_scope
  from item_lines w
  join private.stockflow_economic_customer_identities ci on ci.company_id=w.company_id and ci.source_id=w.customer_source_id
  join private.stockflow_customers c on c.id=ci.customer_id
  group by c.id,c.name
), selected as (
  select * from customers where in_scope order by last_bought_on desc,customer_name limit 3
)
select jsonb_build_object('view','idle_buyers','itemKey',p_item_key,
  'buyers',coalesce((select jsonb_agg(jsonb_build_object('customerId',customer_id,'customerName',customer_name,
    'lastBoughtOn',last_bought_on,'quantity',quantity,'bills',bills) order by last_bought_on desc,customer_name)
    from selected),'[]'::jsonb),
  'totalInScope',(select count(*) from customers where in_scope),
  'otherBuyers',(select count(*) from customers where not in_scope))
$$;
revoke all on function private.stockflow_idle_buyers(text,text) from public,anon,authenticated,service_role;

alter function public.stockflow_requirements_gateway(text,text,text,jsonb)
  rename to stockflow_requirements_gateway_before_idle_buyers;
create function public.stockflow_requirements_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare v_hash text; v_roles text[]; v_email text:=lower(btrim(coalesce(p_actor_email,''))); v_scope text;
begin
  if p_action='get_requirements' and coalesce(p_payload->>'view','')='idle_buyers' then
    select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
    if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
      raise exception 'Unauthorized gateway' using errcode='42501';
    end if;
    select roles into v_roles from public.stockflow_members where email=v_email and status='active';
    if not found then
      raise exception 'Active membership required' using errcode='42501';
    end if;
    if jsonb_typeof(p_payload) is distinct from 'object' or p_payload - 'view' - 'itemKey' <> '{}'::jsonb
      or jsonb_typeof(p_payload->'itemKey') is distinct from 'string'
      or char_length(p_payload->>'itemKey') not between 1 and 220 or btrim(p_payload->>'itemKey')='' then
      raise exception 'Invalid requirements view' using errcode='22023';
    end if;
    if coalesce(private.stockflow_valid_roles(v_roles) and v_roles && array['administrator','management','operations'],false) then
      v_scope:=null;
    elsif coalesce(private.stockflow_valid_roles(v_roles) and v_roles && array['sales'],false) then
      v_scope:=v_email;
    else
      raise exception 'Role cannot see buyers' using errcode='42501';
    end if;
    return private.stockflow_idle_buyers(p_payload->>'itemKey',v_scope);
  end if;
  return public.stockflow_requirements_gateway_before_idle_buyers(p_gateway_key,p_actor_email,p_action,p_payload);
end $$;
revoke all on function public.stockflow_requirements_gateway_before_idle_buyers(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.stockflow_requirements_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_requirements_gateway(text,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
