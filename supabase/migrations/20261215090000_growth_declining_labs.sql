begin;

create function private.stockflow_growth_declining_labs_read(p_today date) returns jsonb
language sql stable security definer set search_path=pg_catalog,private,public,extensions as $$
with bounds as (
 select date_trunc('month',p_today)::date window_end,
  (date_trunc('month',p_today)-interval '12 months')::date window_start
), latest as materialized (
 select distinct on(v.company_id,v.source_id) v.*
 from private.stockflow_economic_source_vouchers v cross join bounds b
 where v.business_date>=b.window_start and v.business_date<b.window_end
  and not exists(select 1 from private.stockflow_economic_source_vouchers n
   where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
 order by v.company_id,v.source_id,v.source_revision desc
), lab_months as materialized (
 select v.company_id,v.customer_source_id,date_trunc('month',v.business_date)::date sale_month,
  sum(l.net_sales_paise::numeric) net
 from latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id
 where not v.cancelled and v.kind in ('sale','return','credit')
 group by v.company_id,v.customer_source_id,date_trunc('month',v.business_date)::date
), labs as materialized (
 select company_id,customer_source_id,company_id||'|'||coalesce(customer_source_id,'') lab_key,
  sum(net) total,count(*) filter(where net>0) buying_months
 from lab_months group by company_id,customer_source_id having sum(net)>0
), months as (
 select m::date month_start,ordinal
 from bounds b cross join lateral generate_series(b.window_start::timestamp,
  b.window_end::timestamp-interval '1 month',interval '1 month') with ordinality g(m,ordinal)
), recent_latest as materialized (
 -- Independent of the whole-month window; newer revisions on any date suppress old ones.
 select distinct on(v.company_id,v.source_id) v.*
 from private.stockflow_economic_source_vouchers v
 where v.business_date between p_today-179 and p_today
  and not exists(select 1 from private.stockflow_economic_source_vouchers n
   where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
 order by v.company_id,v.source_id,v.source_revision desc
), item_kinds as materialized (
 select * from private.stockflow_growth_item_kinds()
), windows as (
 select v.company_id,v.customer_source_id,
  coalesce(sum(l.net_sales_paise::numeric) filter(where v.business_date<=p_today-90),0) prev90,
  coalesce(sum(l.net_sales_paise::numeric) filter(where v.business_date>=p_today-89),0) last90
 from recent_latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id
 where not v.cancelled and v.kind in ('sale','return','credit')
  and not exists(select 1 from item_kinds k where k.company_id=v.company_id
   and k.product_id=l.product_id and k.kind='instrument')
 group by v.company_id,v.customer_source_id
), sale_latest as materialized (
 select distinct on(v.company_id,v.source_id) v.*
 from private.stockflow_economic_source_vouchers v
 where v.business_date<=p_today
  and not exists(select 1 from private.stockflow_economic_source_vouchers n
   where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
 order by v.company_id,v.source_id,v.source_revision desc
), positive_sales as (
 select v.company_id,v.customer_source_id,v.id,v.business_date
 from sale_latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id
 where not v.cancelled and v.kind='sale'
 group by v.company_id,v.customer_source_id,v.id,v.business_date
 having sum(l.net_sales_paise::numeric)>0
), last_sale as (
 select company_id,customer_source_id,max(business_date) last_sale
 from positive_sales group by company_id,customer_source_id
), declining as materialized (
 select l.*,w.prev90,w.last90,s.last_sale
 from labs l join windows w on w.company_id=l.company_id
  and w.customer_source_id is not distinct from l.customer_source_id
 join last_sale s on s.company_id=l.company_id
  and s.customer_source_id is not distinct from l.customer_source_id
 where w.prev90>0 and w.last90>0 and w.last90<=0.7*w.prev90 and w.prev90-w.last90>=1000000
), selected as (
 select * from declining order by prev90-last90 desc,lab_key collate "C" limit 50
)
select jsonb_build_object(
 'window',(select jsonb_build_object('from',window_start,'to',window_end) from bounds),
 'months',(select jsonb_agg(to_char(month_start,'YYYY-MM') order by ordinal) from months),
 'totalLabs',(select count(*) from declining),
 'rows',coalesce((select jsonb_agg(jsonb_build_object('labKey',t.lab_key,'customerId',c.id,
   'name',coalesce(c.name,private.stockflow_growth_ledger_name(t.company_id,t.customer_source_id)),
   'town',c.city,'totalPaise',t.total,
   'monthsPaise',(select jsonb_agg(coalesce(n.net,0) order by m.ordinal) from months m
    left join lab_months n on n.company_id=t.company_id
     and n.customer_source_id is not distinct from t.customer_source_id and n.sale_month=m.month_start),
   'buyingMonths',t.buying_months,'lastPurchaseOn',t.last_sale::text,'phone',c.phone,
   'usualMonthlyPaise',round(t.prev90/3)::bigint,
   'previousNinetyPaise',t.prev90::bigint,'lastNinetyPaise',t.last90::bigint)
   order by t.prev90-t.last90 desc,t.lab_key collate "C")
  from selected t left join private.stockflow_economic_customer_identities i
   on i.company_id=t.company_id and i.source_id=t.customer_source_id
  left join private.stockflow_customers c on c.id=i.customer_id),'[]'::jsonb))
$$;

do $patch$
declare f text;
 anchor text:=$old$elsif p_payload='{"filter":"lapsing"}'::jsonb then return private.stockflow_growth_lapsing_labs_read((now() at time zone 'Asia/Kolkata')::date);$old$;
begin
 select replace(pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'') into f;
 if (length(f)-length(replace(f,anchor,'')))/length(anchor)<>1 then raise exception 'Unexpected growth declining seam';end if;
 execute replace(f,anchor,anchor||$new$
  elsif p_payload='{"filter":"declining"}'::jsonb then return private.stockflow_growth_declining_labs_read((now() at time zone 'Asia/Kolkata')::date);$new$);
 if not coalesce((select 'statement_timeout=20s'=any(proconfig) from pg_proc
  where oid='public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure),false) then
  raise exception 'Growth gateway statement timeout lost';end if;
end$patch$;

create function private.stockflow_growth_stopped_items_read(p_today date,p_lab_keys text[]) returns jsonb
language sql stable security definer set search_path=pg_catalog,private,public,extensions as $$
with recent_latest as materialized (
 select distinct on(v.company_id,v.source_id) v.*
 from private.stockflow_economic_source_vouchers v
 where v.business_date between p_today-179 and p_today
  and not exists(select 1 from private.stockflow_economic_source_vouchers n
   where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
 order by v.company_id,v.source_id,v.source_revision desc
), item_kinds as materialized (
 select * from private.stockflow_growth_item_kinds()
), lines as materialized (
 select v.company_id||'|'||coalesce(v.customer_source_id,'') lab_key,
  l.evidence->>'label' item_key,v.business_date,v.source_id,l.line_key,l.quantity,l.unit,l.net_sales_paise,l.foc_reason
 from recent_latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id
 where not v.cancelled and v.kind='sale' and l.quantity>0
  and v.company_id||'|'||coalesce(v.customer_source_id,'')=any(p_lab_keys)
  and not exists(select 1 from item_kinds k where k.company_id=v.company_id
   and k.product_id=l.product_id and k.kind='instrument')
), stopped as (
 select l.lab_key,l.item_key,sum(l.quantity) quantity,sum(l.net_sales_paise::numeric) net
 from lines l where l.business_date<=p_today-90
  and not exists(select 1 from lines n where n.lab_key=l.lab_key
   and n.item_key is not distinct from l.item_key and n.business_date>=p_today-89)
 group by l.lab_key,l.item_key having sum(l.quantity)>0
), ranked as (
 select *,row_number() over(partition by lab_key order by net desc,item_key collate "C") rank
 from stopped
)
select jsonb_build_object('labs',coalesce((select jsonb_agg(jsonb_build_object('labKey',k.lab_key,
 'items',coalesce((select jsonb_agg(jsonb_build_object(
  'itemKey',s.item_key,'itemName',coalesce(p.name,s.item_key),
  'usualMonthlyQuantity',round(s.quantity/3,3),'unit',last_line.unit,
  'lastBilledOn',to_char(last_line.business_date,'YYYY-MM-DD'),'lastRatePaise',paid.rate)
  order by s.net desc,s.item_key collate "C")
 from ranked s left join private.stockflow_products p on p.tally_item_key=s.item_key
 cross join lateral (select l.unit,l.business_date from lines l
  where l.lab_key=s.lab_key and l.item_key is not distinct from s.item_key and l.business_date<=p_today-90
  order by l.business_date desc,l.source_id collate "C" desc,l.line_key collate "C" desc limit 1) last_line
 left join lateral (select round(l.net_sales_paise::numeric/l.quantity)::bigint rate from lines l
  where l.lab_key=s.lab_key and l.item_key is not distinct from s.item_key and l.business_date<=p_today-90
   and l.foc_reason is null and l.net_sales_paise>0
  order by l.business_date desc,l.source_id collate "C" desc,l.line_key collate "C" desc limit 1) paid on true
 where s.lab_key=k.lab_key and s.rank<=3),'[]'::jsonb)) order by k.ordinal)
 from unnest(p_lab_keys) with ordinality k(lab_key,ordinal)),'[]'::jsonb))
$$;

create function public.stockflow_growth_stopped_items_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer
set search_path=pg_catalog,private,public,extensions
set statement_timeout='20s' as $$
declare actor text:=lower(btrim(p_actor_email)); roles text[]; hash text; lab_keys text[];
begin
 select secret_sha256 into hash from private.stockflow_gateway_config where name='orders';
 if hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>hash then
  raise exception 'Unauthorized gateway' using errcode='42501';end if;
 begin
  roles:=private.stockflow_active_member_roles(actor);
 exception when sqlstate '42501' then
  raise exception 'Growth access required' using errcode='PT403';
 end;
 if not coalesce(roles&&array['administrator','management'],false) then
  raise exception 'Growth access required' using errcode='PT403';end if;
 if p_action is distinct from 'get_growth_stopped_items'
  or jsonb_typeof(p_payload) is distinct from 'object'
  or p_payload-'labKeys' is distinct from '{}'::jsonb
  or jsonb_typeof(p_payload->'labKeys') is distinct from 'array' then
  raise exception 'Invalid stopped items request' using errcode='22023';end if;
 if jsonb_array_length(p_payload->'labKeys') not between 1 and 8
  or exists(select 1 from jsonb_array_elements(p_payload->'labKeys') e
   where jsonb_typeof(e) is distinct from 'string' or char_length(e#>>'{}') not between 3 and 300
    or position('|' in (e#>>'{}'))=0) then
  raise exception 'Invalid stopped items request' using errcode='22023';end if;
 select array_agg(value order by ordinal) into lab_keys
 from jsonb_array_elements_text(p_payload->'labKeys') with ordinality e(value,ordinal);
 if cardinality(lab_keys)<>(select count(distinct k) from unnest(lab_keys) k) then
  raise exception 'Invalid stopped items request' using errcode='22023';end if;
 return private.stockflow_growth_stopped_items_read((now() at time zone 'Asia/Kolkata')::date,lab_keys);
end$$;

revoke all on function private.stockflow_growth_declining_labs_read(date) from public,anon,authenticated,service_role;
revoke all on function private.stockflow_growth_stopped_items_read(date,text[]) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_growth_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_growth_gateway(text,text,text,jsonb) to service_role;
revoke all on function public.stockflow_growth_stopped_items_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_growth_stopped_items_gateway(text,text,text,jsonb) to service_role;
commit;
