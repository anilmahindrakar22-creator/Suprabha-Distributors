begin;

create function private.stockflow_growth_lapsing_labs_read(p_today date) returns jsonb
language sql stable security definer set search_path=pg_catalog,private,public,extensions as $$
with bounds as (
 select date_trunc('month',p_today)::date window_end,
  (date_trunc('month',p_today)-interval '12 months')::date window_start
), latest as materialized (
 -- Bound the source to the window, but check newer revisions across all dates:
 -- a moved or cancelled latest revision must suppress the old one.
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
), cadence as (
 select l.company_id,l.customer_source_id,
  percentile_cont(0.5) within group(order by n.net) filter(where n.net>0) usual,
  count(*) filter(where m.ordinal>=10 and coalesce(n.net,0)<=0) missed
 from labs l cross join months m
 left join lab_months n on n.company_id=l.company_id
  and n.customer_source_id is not distinct from l.customer_source_id and n.sale_month=m.month_start
 group by l.company_id,l.customer_source_id
), lapsing as materialized (
 select l.*,s.last_sale,c.usual,c.missed
 from labs l join last_sale s on s.company_id=l.company_id
  and s.customer_source_id is not distinct from l.customer_source_id
 join cadence c on c.company_id=l.company_id
  and c.customer_source_id is not distinct from l.customer_source_id
 where l.buying_months>=5 and s.last_sale<p_today-30
  and (s.last_sale<=p_today-60 or c.missed>=2)
), selected as (
 select * from lapsing order by usual desc,lab_key collate "C" limit 50
)
select jsonb_build_object(
 'window',(select jsonb_build_object('from',window_start,'to',window_end) from bounds),
 'months',(select jsonb_agg(to_char(month_start,'YYYY-MM') order by ordinal) from months),
 'totalLabs',(select count(*) from lapsing),
 'rows',coalesce((select jsonb_agg(jsonb_build_object('labKey',t.lab_key,'customerId',c.id,
   'name',coalesce(c.name,private.stockflow_growth_ledger_name(t.company_id,t.customer_source_id)),
   'town',c.city,'totalPaise',t.total,
   'monthsPaise',(select jsonb_agg(coalesce(n.net,0) order by m.ordinal) from months m
    left join lab_months n on n.company_id=t.company_id
     and n.customer_source_id is not distinct from t.customer_source_id and n.sale_month=m.month_start),
   'buyingMonths',t.buying_months,'lastPurchaseOn',t.last_sale::text,
   'usualMonthlyPaise',round(t.usual::numeric)::bigint,'monthsMissed',t.missed::integer,'phone',c.phone)
   order by t.usual desc,t.lab_key collate "C")
  from selected t left join private.stockflow_economic_customer_identities i
   on i.company_id=t.company_id and i.source_id=t.customer_source_id
  left join private.stockflow_customers c on c.id=i.customer_id),'[]'::jsonb))
$$;

-- Replace only the established lab-months dispatch, after the existing role gate.
do $patch$
declare f text;
 anchor text:=$old$if p_action='get_growth_lab_months' then if p_payload is distinct from '{}'::jsonb then raise exception 'Invalid growth lab months request' using errcode='22023';end if; return private.stockflow_growth_lab_months_read((now() at time zone 'Asia/Kolkata')::date);end if;$old$;
begin
 select replace(pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'') into f;
 if (length(f)-length(replace(f,anchor,'')))/length(anchor)<>1 then raise exception 'Unexpected growth lapsing seam';end if;
 execute replace(f,anchor,$new$if p_action='get_growth_lab_months' then
  if p_payload='{}'::jsonb then return private.stockflow_growth_lab_months_read((now() at time zone 'Asia/Kolkata')::date);
  elsif p_payload='{"filter":"lapsing"}'::jsonb then return private.stockflow_growth_lapsing_labs_read((now() at time zone 'Asia/Kolkata')::date);
  else raise exception 'Invalid growth lab months request' using errcode='22023';end if;
 end if;$new$);
end$patch$;

revoke all on function private.stockflow_growth_lapsing_labs_read(date) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_growth_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_growth_gateway(text,text,text,jsonb) to service_role;
commit;
