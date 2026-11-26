begin;

create or replace function private.stockflow_reorder_check(p_today date) returns jsonb
language sql stable security definer set search_path=pg_catalog,private,public,extensions as $$
with policy as (
  select cover_days from private.stockflow_reorder_policies
  where effective_from<=p_today order by effective_from desc,created_at desc limit 1
), stock_numbers as (
  select item->>'item' as item_key,
    case when char_length(item->>'closing')<=30 and item->>'closing' ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (item->>'closing')::numeric end as closing,
    case when char_length(item->>'purchaseOrder')<=30 and item->>'purchaseOrder' ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (item->>'purchaseOrder')::numeric end as purchase_order
  from public.stockflow_snapshots s cross join lateral
    jsonb_array_elements(case when jsonb_typeof(s.payload->'catalog')='array'
      then s.payload->'catalog' else '[]'::jsonb end) item
  where s.id='suprabha' and nullif(btrim(item->>'item'),'') is not null
), stock as (
  select item_key,case when count(*)=1 then min(closing) end as closing,
    case when count(*)=1 then min(purchase_order) end as purchase_order
  from stock_numbers group by item_key
), tally_numbers as (
  select item->>'item' as item_key,
    case when char_length(item->>'reorderLevel')<=30 and item->>'reorderLevel' ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (item->>'reorderLevel')::numeric end as reorder_level
  from public.stockflow_snapshots s cross join lateral
    jsonb_array_elements(case when jsonb_typeof(s.payload->'rows')='array'
      then s.payload->'rows' else '[]'::jsonb end) item
  where s.id='suprabha' and nullif(btrim(item->>'item'),'') is not null
), tally as (
  select item_key,true as in_list,case when count(*)=1 then min(reorder_level) end as reorder_level
  from tally_numbers group by item_key
), latest as materialized (
  select distinct on(v.company_id,v.source_id) v.*
  from private.stockflow_economic_source_vouchers v
  where v.business_date>p_today-180 and v.business_date<=p_today
    and not exists(select 1 from private.stockflow_economic_source_vouchers n
      where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
  order by v.company_id,v.source_id,v.source_revision desc
), catalogs as materialized (
  select distinct on(company_id) company_id,content from private.stockflow_economic_item_catalogs
  order by company_id,observed_at desc,id desc
), names as materialized (
  select c.company_id,p->>'id' product_id,p->>'name' name
  from catalogs c cross join lateral jsonb_array_elements(c.content->'products') p
  where p->>'name' in (select item_key from stock)
), window_lines as materialized (
  select v.company_id,v.kind,v.business_date,l.product_id,l.quantity
  from latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id
  where not v.cancelled and v.kind in ('sale','return','credit') and v.business_date>p_today-180
), usage as (
  select n.name as item_key,
    sum(case when w.business_date>p_today-90 then
      case when w.kind='sale' then w.quantity else -w.quantity end else 0 end) as used_90,
    count(distinct date_trunc('month',w.business_date)) filter(where w.kind='sale' and w.quantity>0) as months_sold
  from window_lines w join names n on n.company_id=w.company_id and n.product_id=w.product_id
  group by n.name
), lead as (
  select lead_time_days from private.stockflow_stock_policies
  where effective_from<=p_today order by effective_from desc,created_at desc limit 1
), steady as (
  select s.*,coalesce(t.in_list,false) as in_list,t.reorder_level,u.used_90,
    u.used_90/90.0 as daily,p.cover_days,
    coalesce((select lead_time_days from lead),7)+1 as l
  from stock s join usage u using(item_key) left join tally t using(item_key) cross join policy p
  where u.months_sold>=3 and u.used_90>0
), daily_net as (
  select n.name as item_key,w.business_date,
    sum(case when w.kind='sale' then w.quantity else -w.quantity end) as quantity
  from window_lines w join names n on n.company_id=w.company_id and n.product_id=w.product_id
  join steady s on s.item_key=n.name
  group by n.name,w.business_date
), daily_demand as (
  select s.item_key,s.l,p_today-179+d.day as day,
    greatest(coalesce(n.quantity,0),0) as quantity
  from steady s cross join generate_series(0,179) d(day)
  left join daily_net n on n.item_key=s.item_key and n.business_date=p_today-179+d.day
), cumulative as (
  select *,sum(quantity) over(partition by item_key order by day) as total
  from daily_demand
), lagged as (
  select *,lag(total,l,0::numeric) over(partition by item_key order by day) as prior_total
  from cumulative
), demand_windows as (
  select item_key,total-prior_total as window_sum
  from lagged where day-l+1>=p_today-179
), percentiles as (
  select item_key,percentile_cont(0.95) within group (order by window_sum)::numeric as p95
  from demand_windows group by item_key
), points as (
  select s.*,ceil(greatest(l*daily,coalesce(p.p95,0))) as reorder_point
  from steady s left join percentiles p using(item_key)
), safety_stock as (
  select *,reorder_point-l*daily as safety from points
), levels as (
  select *,ceil(cover_days*daily+safety) as order_up_to,
    closing+coalesce(purchase_order,0) as held
  from safety_stock
), short_items as (
  select *,floor(greatest(closing+coalesce(purchase_order,0),0)*90.0/used_90) as days_cover,
    greatest(ceil(order_up_to-held),0) as suggested
  from levels where not in_list and closing is not null and held<=reorder_point
), level_items as (
  select *,case when reorder_level<0.5*reorder_point then 'low' else 'high' end as direction,
    case when reorder_level<=0 then 'Infinity'::numeric
      else greatest(reorder_level/reorder_point,reorder_point/reorder_level) end as distance
  from levels where in_list and reorder_level is not null
    and (reorder_level<0.5*reorder_point or reorder_level>2*reorder_point)
), short_page as (
  select * from short_items order by days_cover,item_key collate "C" limit 200
), level_page as (
  select * from level_items order by (direction='low') desc,distance desc,item_key collate "C" limit 200
)
select jsonb_build_object('view','reorder_check','coverDays',(select cover_days from policy),'windowDays',90,
  'leadTimeDays',coalesce((select lead_time_days from lead),7),'reviewDays',1,
  'salesThrough',case when exists(select 1 from policy) then
    (select max(business_date) from latest where not cancelled and kind='sale') end,
  'shortCount',(select count(*) from short_items),'levelCount',(select count(*) from level_items),
  'short',coalesce((select jsonb_agg(jsonb_build_object('itemKey',item_key,'closing',closing,
    'onOrder',coalesce(purchase_order,0),'usedLast90',round(used_90,2),'daysCover',days_cover,
    'reorderPoint',reorder_point,'orderUpTo',order_up_to,'suggestedQty',suggested)
    order by days_cover,item_key collate "C") from short_page),'[]'::jsonb),
  'level',coalesce((select jsonb_agg(jsonb_build_object('itemKey',item_key,'reorderLevel',reorder_level,
    'usedLast90',round(used_90,2),'direction',direction,'reorderPoint',reorder_point,'orderUpTo',order_up_to)
    order by (direction='low') desc,distance desc,item_key collate "C") from level_page),'[]'::jsonb))
$$;
revoke all on function private.stockflow_reorder_check(date) from public,anon,authenticated,service_role;

commit;
