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
  select v.company_id,v.business_date,l.product_id
  from latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id and l.quantity>0
), catalogs as materialized (
  select distinct on(company_id) company_id,content from private.stockflow_economic_item_catalogs
  order by company_id,observed_at desc,id desc
), names as materialized (
  select c.company_id,p->>'id' product_id,p->>'name' name
  from catalogs c cross join lateral jsonb_array_elements(c.content->'products') p
  where p->>'name' in (select item_key from in_stock)
), sales as (
  select n.name as item_key,max(w.business_date) as last_sold_on
  from sale_lines w join names n on n.company_id=w.company_id and n.product_id=w.product_id
  group by n.name
), idle as materialized (
  select s.*,v.last_sold_on from in_stock s left join sales v using(item_key)
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
    'closing',round(closing,3),'baseUnit',base_unit,'lastSoldOn',last_sold_on)
    order by last_sold_on asc nulls first,item_key collate "C") from paged),'[]'::jsonb))
$$;
revoke all on function private.stockflow_idle_stock(date,integer) from public,anon,authenticated,service_role;
commit;
