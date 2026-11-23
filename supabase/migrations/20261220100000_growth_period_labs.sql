begin;

create function private.stockflow_growth_lab_months_window(p_from date,p_to date)
 returns jsonb language sql stable security definer
 set search_path=pg_catalog,private,public,extensions as $$
with bounds as (
 select date_trunc('month',p_from)::date window_start
), latest as materialized (
 -- Bound the source to the window, but check newer revisions across all dates:
 -- a moved or cancelled latest revision must suppress the old one.
 select distinct on(v.company_id,v.source_id) v.id,v.company_id,v.source_id,v.source_revision,
  v.customer_source_id,v.business_date,v.kind,v.cancelled
 from private.stockflow_economic_source_vouchers v cross join bounds b
 where v.business_date between p_from and p_to
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
), top as (
 select * from labs order by total desc,lab_key collate "C" limit 20
), months as (
 select m::date month_start,ordinal
 from bounds b cross join lateral generate_series(b.window_start::timestamp,
  date_trunc('month',p_to)::timestamp,interval '1 month') with ordinality g(m,ordinal)
)
select jsonb_build_object(
 'window',jsonb_build_object('from',p_from,'to',p_to),
 'months',(select jsonb_agg(to_char(month_start,'YYYY-MM') order by ordinal) from months),
 'totalLabs',(select count(*) from labs),
 'rows',coalesce((select jsonb_agg(jsonb_build_object('labKey',t.lab_key,'customerId',c.id,
   'name',coalesce(c.name,private.stockflow_growth_ledger_name(t.company_id,t.customer_source_id)),
   'town',c.city,'totalPaise',t.total,
   'monthsPaise',(select jsonb_agg(coalesce(n.net,0) order by m.ordinal) from months m
    left join lab_months n on n.company_id=t.company_id
     and n.customer_source_id is not distinct from t.customer_source_id and n.sale_month=m.month_start),
   'buyingMonths',t.buying_months) order by t.total desc,t.lab_key collate "C")
  from top t left join private.stockflow_economic_customer_identities i
   on i.company_id=t.company_id and i.source_id=t.customer_source_id
  left join private.stockflow_customers c on c.id=i.customer_id),'[]'::jsonb))
$$;

create function private.stockflow_growth_period_labs(p_today date,p_roles text[],p_payload jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,private,public,extensions as $$
declare p jsonb; cmp jsonb; companies text[]; model jsonb; result jsonb;
 list_name text:=p_payload->>'list'; comparison text:=p_payload->>'comparison'; page_number integer:=(p_payload->>'page')::int;
begin
 if not coalesce(p_roles&&array['administrator','management'],false) then
  raise exception 'Growth access required' using errcode='PT403';end if;
 p:=private.stockflow_growth_period(p_today,p_payload#>>'{period,kind}',(p_payload#>>'{period,fy}')::int,(p_payload#>>'{period,quarter}')::int);
 select value into cmp from jsonb_array_elements(p->'comparisons') where value->>'key'=comparison;
 result:=jsonb_build_object('list',list_name,'comparison',comparison,'page',page_number,'pageSize',20,'period',p-'comparisons');
 with windows as materialized (
  select 'current'::text key,(p->>'from')::date s,(p->>'to')::date e
  union all select value->>'key',(value->>'from')::date,(value->>'to')::date from jsonb_array_elements(p->'comparisons')
 ), bounds as (select min(s) lo,max(e) hi from windows), latest as materialized (
  select distinct on(v.company_id,v.source_id) v.id,v.company_id,v.source_id,v.source_revision,
   v.customer_source_id,v.business_date,v.kind,v.cancelled
  from private.stockflow_economic_source_vouchers v cross join bounds
  where v.business_date between lo and hi
   and not exists(select 1 from private.stockflow_economic_source_vouchers n
    where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
  order by v.company_id,v.source_id,v.source_revision desc
 ), vouchers as materialized (
  select v.id,v.company_id,v.customer_source_id,v.business_date,v.kind,sum(l.net_sales_paise::numeric) net
  from latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id
  where not v.cancelled and v.kind in ('sale','return','credit') group by v.id,v.company_id,v.customer_source_id,v.business_date,v.kind
 ), tagged as materialized (
  select v.company_id,v.customer_source_id,v.business_date,v.net,w.key from vouchers v join windows w on v.business_date between w.s and w.e
 ), lab_months as materialized (
  select key,company_id,customer_source_id,date_trunc('month',business_date) m,sum(net) net,max(business_date) last_date
  from tagged group by 1,2,3,4
 ), labs as (
  select company_id,customer_source_id,company_id||'|'||coalesce(customer_source_id,'') lab_key,
   coalesce(sum(net) filter(where key=comparison),0) h1,coalesce(sum(net) filter(where key='current'),0) h2,
   count(*) filter(where key=comparison and net>0) h1_months,count(*) filter(where key='current' and net>0) h2_months,max(last_date) last_date
  from lab_months where key='current' or key=comparison group by 1,2
 ), classified as (
  select *,case when h1<=0 and h2>0 then 'bridge_new' when h1>0 and h2<=0 then 'bridge_stopped'
   when h1>0 and h2>h1 then 'bridge_grew' when h1>0 and h2>0 and h2<h1 then 'bridge_fell'
   else 'other' end class from labs
 ), filtered as materialized (
  select *,case when list_name='window_labs' then h2 when class in ('bridge_stopped','bridge_fell') then h1-h2 else h2-h1 end value
  from classified where (case when list_name='window_labs' then h2>0 else class=list_name end)
   and (not coalesce((p_payload->>'regularOnly')::boolean,false) or h1_months>=3)
 ), paged as (
  select * from filtered order by value desc,lab_key collate "C" limit 20 offset (page_number-1)*20
 )
 select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(jsonb_build_object(
  'labKey',t.lab_key,'customerId',c.id,'name',coalesce(c.name,private.stockflow_growth_ledger_name(t.company_id,t.customer_source_id)),
  'town',c.city,'valuePaise',t.value,'comparisonPaise',case when list_name='window_labs' then null else t.h1 end,
  'currentPaise',t.h2,'monthsBought',t.h2_months,'lastBoughtOn',t.last_date) order by t.value desc,t.lab_key collate "C")
  from paged t left join private.stockflow_economic_customer_identities i on i.company_id=t.company_id and i.source_id=t.customer_source_id
  left join private.stockflow_customers c on c.id=i.customer_id),'[]'::jsonb)),
  coalesce((select array_agg(distinct company_id order by company_id) from tagged),'{}'::text[])
 into model,companies;
 if comparison is not null and private.stockflow_growth_window_check(companies,(cmp->>'from')::date,(cmp->>'to')::date)->>'state'='no_history' then
  return result||jsonb_build_object('total',0,'rows','[]'::jsonb,'reason','no_history');end if;
 return result||model;
end$$;

alter function public.stockflow_growth_gateway(text,text,text,jsonb) rename to stockflow_growth_gateway_before_period_labs;
create function public.stockflow_growth_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,public,extensions
set statement_timeout to '20s' as $$
declare hash text; roles text[]; p jsonb; fy numeric; quarter numeric; page_number numeric; period_window jsonb;
begin
 if p_action in ('get_growth_lab_months_period','get_growth_labs_period') then
  select secret_sha256 into hash from private.stockflow_gateway_config where name='orders';
  if hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>hash then
   raise exception 'Unauthorized gateway' using errcode='42501';end if;
  begin roles:=private.stockflow_active_member_roles(lower(btrim(p_actor_email)));
  exception when sqlstate '42501' then raise exception 'Growth access required' using errcode='PT403';end;
  if not coalesce(roles&&array['administrator','management'],false) then
   raise exception 'Growth access required' using errcode='PT403';end if;
  if p_action='get_growth_labs_period' then
   if jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload-array['period','comparison','list','page','regularOnly'] is distinct from '{}'::jsonb
    or jsonb_typeof(p_payload->'list') is distinct from 'string'
    or coalesce(p_payload->>'list','') not in ('bridge_new','bridge_stopped','bridge_grew','bridge_fell','window_labs')
    or jsonb_typeof(p_payload->'page') is distinct from 'number'
    or (p_payload ? 'regularOnly' and (p_payload->>'list'<>'bridge_stopped' or jsonb_typeof(p_payload->'regularOnly') is distinct from 'boolean'))
    or (case when p_payload->>'list'='window_labs' then p_payload ? 'comparison'
     else jsonb_typeof(p_payload->'comparison') is distinct from 'string' or coalesce(p_payload->>'comparison','') not in ('last_year','previous') end)
    or (p_payload->>'comparison'='previous' and p_payload#>>'{period,kind}' is distinct from 'quarter') then
    raise exception 'Invalid growth labs request' using errcode='22023';end if;
   page_number:=(p_payload->>'page')::numeric;
   if page_number<>trunc(page_number) or page_number not between 1 and 1000 then
    raise exception 'Invalid growth labs request' using errcode='22023';end if;
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object'
   or (p_action='get_growth_lab_months_period' and p_payload-'period' is distinct from '{}'::jsonb)
   or jsonb_typeof(p_payload->'period') is distinct from 'object' then
   raise exception 'Invalid growth period' using errcode='22023';end if;
  p:=p_payload->'period';
  if jsonb_typeof(p->'kind') is distinct from 'string' or coalesce(p->>'kind','') not in ('fy','quarter')
   or jsonb_typeof(p->'fy') is distinct from 'number'
   or (p->>'kind'='fy' and p-array['kind','fy'] is distinct from '{}'::jsonb)
   or (p->>'kind'='quarter' and (p-array['kind','fy','quarter'] is distinct from '{}'::jsonb
    or jsonb_typeof(p->'quarter') is distinct from 'number')) then
   raise exception 'Invalid growth period' using errcode='22023';end if;
  fy:=(p->>'fy')::numeric; quarter:=(p->>'quarter')::numeric;
  if fy<>trunc(fy) or fy not between 2017 and 2147483646
   or (p->>'kind'='quarter' and (quarter<>trunc(quarter) or quarter not between 1 and 4)) then
   raise exception 'Invalid growth period' using errcode='22023';end if;
  p:=jsonb_set(p,'{fy}',to_jsonb(fy::int));
  if p->>'kind'='quarter' then p:=jsonb_set(p,'{quarter}',to_jsonb(quarter::int));end if;
  if p_action='get_growth_lab_months_period' then
   period_window:=private.stockflow_growth_period((now() at time zone 'Asia/Kolkata')::date,p->>'kind',(p->>'fy')::int,(p->>'quarter')::int);
   return private.stockflow_growth_integer_paise(private.stockflow_growth_lab_months_window((period_window->>'from')::date,(period_window->>'to')::date));
  end if;
  return private.stockflow_growth_integer_paise(private.stockflow_growth_period_labs((now() at time zone 'Asia/Kolkata')::date,roles,jsonb_set(p_payload,'{period}',p)));
 end if;
 return public.stockflow_growth_gateway_before_period_labs(p_gateway_key,p_actor_email,p_action,p_payload);
end$$;

revoke all on function private.stockflow_growth_lab_months_window(date,date) from public,anon,authenticated,service_role;
revoke all on function private.stockflow_growth_period_labs(date,text[],jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_growth_gateway_before_period_labs(text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_growth_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_growth_gateway(text,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
