begin;

create table private.stockflow_reorder_policies (
  id uuid primary key default gen_random_uuid(),
  cover_days integer not null check (cover_days between 7 and 365),
  effective_from date not null,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  reason text not null
);
alter table private.stockflow_reorder_policies enable row level security;
revoke all on private.stockflow_reorder_policies from public,anon,authenticated,service_role;
insert into private.stockflow_reorder_policies(cover_days,effective_from,created_by_email,reason)
values(60,'2026-01-01','owner-form@stockflow.local','Owner chose 60 days of sales as the reorder target (form, 23 Nov 2026)');

create function private.stockflow_reorder_check(p_today date) returns jsonb
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
), steady as (
  select s.*,coalesce(t.in_list,false) as in_list,t.reorder_level,u.used_90,
    ceil(u.used_90*p.cover_days/90.0) as target
  from stock s join usage u using(item_key) left join tally t using(item_key) cross join policy p
  where u.months_sold>=3 and u.used_90>0
), short_items as (
  select *,floor(greatest(closing+coalesce(purchase_order,0),0)*90.0/used_90) as days_cover
  from steady where not in_list and closing is not null and closing+coalesce(purchase_order,0)<target
), level_items as (
  select *,case when reorder_level<0.5*target then 'low' else 'high' end as direction,
    case when reorder_level<=0 then 'Infinity'::numeric
      else greatest(reorder_level/target,target/reorder_level) end as distance
  from steady where in_list and reorder_level is not null
    and (reorder_level<0.5*target or reorder_level>2*target)
), short_page as (
  select * from short_items order by days_cover,item_key collate "C" limit 200
), level_page as (
  select * from level_items order by (direction='low') desc,distance desc,item_key collate "C" limit 200
)
select jsonb_build_object('view','reorder_check','coverDays',(select cover_days from policy),'windowDays',90,
  'salesThrough',case when exists(select 1 from policy) then
    (select max(business_date) from latest where not cancelled and kind='sale') end,
  'shortCount',(select count(*) from short_items),'levelCount',(select count(*) from level_items),
  'short',coalesce((select jsonb_agg(jsonb_build_object('itemKey',item_key,'closing',closing,
    'onOrder',coalesce(purchase_order,0),'target',target,'usedLast90',round(used_90,2),'daysCover',days_cover)
    order by days_cover,item_key collate "C") from short_page),'[]'::jsonb),
  'level',coalesce((select jsonb_agg(jsonb_build_object('itemKey',item_key,'reorderLevel',reorder_level,
    'target',target,'usedLast90',round(used_90,2),'direction',direction)
    order by (direction='low') desc,distance desc,item_key collate "C") from level_page),'[]'::jsonb))
$$;
revoke all on function private.stockflow_reorder_check(date) from public,anon,authenticated,service_role;

alter function public.stockflow_requirements_gateway(text,text,text,jsonb)
  rename to stockflow_requirements_gateway_before_reorder_check;
create function public.stockflow_requirements_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare v_hash text; v_roles text[];
begin
  if p_action='get_requirements' and coalesce(p_payload->>'view','')='reorder_check' then
    select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
    if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
      raise exception 'Unauthorized gateway' using errcode='42501';
    end if;
    select roles into v_roles from public.stockflow_members
      where email=lower(btrim(coalesce(p_actor_email,''))) and status='active';
    if not found then
      raise exception 'Active membership required' using errcode='42501';
    end if;
    if not coalesce(private.stockflow_valid_roles(v_roles) and v_roles && array['administrator','management','operations'],false) then
      raise exception 'Role cannot see reorder checks' using errcode='42501';
    end if;
    if p_payload - 'view' <> '{}'::jsonb then
      raise exception 'Invalid requirements view' using errcode='22023';
    end if;
    return private.stockflow_reorder_check((now() at time zone 'Asia/Kolkata')::date);
  end if;
  return public.stockflow_requirements_gateway_before_reorder_check(p_gateway_key,p_actor_email,p_action,p_payload);
end $$;
revoke all on function public.stockflow_requirements_gateway_before_reorder_check(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.stockflow_requirements_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_requirements_gateway(text,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
