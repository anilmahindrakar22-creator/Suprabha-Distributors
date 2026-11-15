begin;

-- Charts C2: Growth "lab by month" heatmap. A management read of net sales per
-- lab and month over the Growth window. Read only; no table or existing read
-- changes.

-- Guard: stop unless the gateway still has the reviewed body.
do $guard$
declare actual text;
begin
 select md5(replace(p.prosrc,chr(13),'')) into actual from pg_proc p
 where p.oid='public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure;
 if actual is distinct from '291846b9aa4cf7e128ac33f285b0c74d' then
  raise exception 'Unexpected stockflow_growth_gateway body (md5 %)',actual;end if;
end$guard$;

-- Same vouchers as stockflow_growth_read: the latest revision, not cancelled,
-- kind sale/return/credit. A NULL ledger is its own lab per company.
create function private.stockflow_growth_lab_months_read(p_today date) returns jsonb
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
), top as (
 select * from labs order by total desc,lab_key collate "C" limit 20
), months as (
 select m::date month_start,ordinal
 from bounds b cross join lateral generate_series(b.window_start::timestamp,
  b.window_end::timestamp-interval '1 month',interval '1 month') with ordinality g(m,ordinal)
)
select jsonb_build_object(
 'window',(select jsonb_build_object('from',window_start,'to',window_end) from bounds),
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

-- Single-match seam: dispatch the new action after the gateway's role check.
do $patch$
declare f text; anchor text:='if p_action=''get_growth_brands'' then';
begin
 select replace(pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'') into f;
 if (length(f)-length(replace(f,anchor,'')))/length(anchor)<>1 then raise exception 'Unexpected growth lab months gateway seam';end if;
 execute replace(f,anchor,$new$if p_action='get_growth_lab_months' then if p_payload is distinct from '{}'::jsonb then raise exception 'Invalid growth lab months request' using errcode='22023';end if; return private.stockflow_growth_lab_months_read((now() at time zone 'Asia/Kolkata')::date);end if;
 $new$||anchor);
end$patch$;

revoke all on function private.stockflow_growth_lab_months_read(date) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_growth_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_growth_gateway(text,text,text,jsonb) to service_role;
commit;
notify pgrst,'reload schema';
