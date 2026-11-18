begin;

create table private.stockflow_stock_policies (
  id uuid primary key default gen_random_uuid(),
  lead_time_days integer not null check (lead_time_days between 1 and 180),
  effective_from date not null,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  reason text not null
);
alter table private.stockflow_stock_policies enable row level security;
revoke all on private.stockflow_stock_policies from public,anon,authenticated;
insert into private.stockflow_stock_policies(lead_time_days,effective_from,created_by_email,reason)
values(7,'2026-01-01','system-migration','Owner default lead time, 18 Nov 2026');

create function private.stockflow_stock_cover(p_today date) returns jsonb
language sql stable security definer set search_path=pg_catalog,private,public,extensions as $$
with policy as (
  select lead_time_days from private.stockflow_stock_policies
  where effective_from<=p_today order by effective_from desc,created_at desc limit 1
), demand as (
    select l.tally_item_key,min(l.item_name) as item_name,
      sum(greatest(l.quantity-l.fulfilled_quantity,0)) as open_demand,
      count(distinct o.id) as waiting_orders,min(o.created_at) as oldest_order_at
    from private.stockflow_orders o join private.stockflow_order_lines l on l.order_id=o.id
    where o.archived_at is null
      and o.status not in ('draft','phone_order_received','awaiting_confirmation','awaiting_approval','cancelled','delivered')
      and l.quantity>l.fulfilled_quantity
    group by l.tally_item_key
), reorder_values as (
  select item->>'item' as item_key,
    case when char_length(item->>'closing')<=30 and item->>'closing' ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (item->>'closing')::numeric end as closing,
    case when char_length(item->>'purchaseOrder')<=30 and item->>'purchaseOrder' ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (item->>'purchaseOrder')::numeric end as purchase_order
  from public.stockflow_snapshots s cross join lateral
    jsonb_array_elements(case when jsonb_typeof(s.payload->'rows')='array'
      then s.payload->'rows' else '[]'::jsonb end) item
  where s.id='suprabha' and nullif(item->>'item','') is not null
), reorder as (
  select item_key,case when count(*)=1 then min(closing) end as closing,
    case when count(*)=1 then min(purchase_order) end as purchase_order
  from reorder_values group by item_key order by item_key collate "C" limit 2000
), latest as materialized (
  -- Check newer revisions across all dates, including moved/cancelled vouchers.
  select distinct on(v.company_id,v.source_id) v.*
  from private.stockflow_economic_source_vouchers v
  where v.business_date>p_today-90 and v.business_date<=p_today
    and not exists(select 1 from private.stockflow_economic_source_vouchers n
      where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
  order by v.company_id,v.source_id,v.source_revision desc
), catalogs as materialized (
 select distinct on(company_id) company_id,content from private.stockflow_economic_item_catalogs
 order by company_id,observed_at desc,id desc
), names as materialized (
 select c.company_id,p->>'id' product_id,p->>'name' name
 from catalogs c cross join lateral jsonb_array_elements(c.content->'products') p
 where p->>'name' in (select item_key from reorder)
), window_lines as materialized (
  select v.company_id,v.kind,l.product_id,l.quantity
  from latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id
  where not v.cancelled and v.kind in ('sale','return','credit') and v.business_date>p_today-90
), usage as (
  select n.name as item_key,
    sum(case when w.kind='sale' then w.quantity else -w.quantity end) as used_90
  from window_lines w join names n on n.company_id=w.company_id and n.product_id=w.product_id
  group by n.name
), available as (
  select r.item_key,r.closing,u.used_90,
    r.closing+coalesce(r.purchase_order,0)-coalesce(d.open_demand,0) as available,
    case when u.used_90>0 then u.used_90/90.0 end as daily_use
  from reorder r left join demand d on d.tally_item_key=r.item_key
  left join usage u on u.item_key=r.item_key
), days as (
  select *,case when available is not null and daily_use is not null
    then floor(greatest(available,0)/daily_use)::integer end as days_left
  from available
), classified as (
  select *,case when closing is null then 'stock_unknown'
    when used_90 is null or used_90<=0 then 'no_recent_use'
    when days_left<(select lead_time_days from policy) then 'runs_out'
    when days_left is not null and (select lead_time_days from policy) is not null then 'covered'
    else 'no_lead_time' end as state from days
)
select jsonb_build_object('view','cover','asOf',p_today,
  'leadTimeDays',(select lead_time_days from policy),'windowDays',90,
  'salesThrough',(select max(business_date) from latest where not cancelled and kind='sale'),
  'runsOutCount',(select count(*) from classified where state='runs_out'),
  'items',coalesce((select jsonb_agg(jsonb_build_object('itemKey',item_key,
    'usedLast90',round(used_90,2),'daysLeft',days_left,'state',state) order by item_key collate "C")
    from classified),'[]'::jsonb))
$$;
revoke all on function private.stockflow_stock_cover(date) from public,anon,authenticated,service_role;

alter function public.stockflow_requirements_gateway(text,text,text,jsonb)
  rename to stockflow_requirements_gateway_before_cover;
create function public.stockflow_requirements_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare v_hash text;
begin
  if p_action='get_requirements' and coalesce(p_payload->>'view','')='cover' then
    select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
    if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
      raise exception 'Unauthorized gateway' using errcode='42501';
    end if;
    if not exists(select 1 from public.stockflow_members
      where email=lower(btrim(coalesce(p_actor_email,''))) and status='active') then
      raise exception 'Active membership required' using errcode='42501';
    end if;
    if p_payload - 'view' <> '{}'::jsonb then
      raise exception 'Invalid requirements view' using errcode='22023';
    end if;
    return private.stockflow_stock_cover((now() at time zone 'Asia/Kolkata')::date);
  end if;
  return public.stockflow_requirements_gateway_before_cover(p_gateway_key,p_actor_email,p_action,p_payload);
end $$;
revoke all on function public.stockflow_requirements_gateway_before_cover(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.stockflow_requirements_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_requirements_gateway(text,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
