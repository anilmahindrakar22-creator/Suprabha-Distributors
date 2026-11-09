begin;

create function private.stockflow_growth_gp(p_today date) returns jsonb
language sql stable security definer
set search_path=pg_catalog,private,public,extensions as $$
with bounds as (
 select date_trunc('month',p_today)::date window_end,
  (date_trunc('month',p_today)-interval '12 months')::date window_start,
  (date_trunc('month',p_today)-interval '6 months')::date h2_start
), vouchers as materialized (
 select v.id,v.company_id,v.customer_source_id,v.business_date,v.kind
 from private.stockflow_economic_source_vouchers v cross join bounds b
 where not v.cancelled and v.business_date<b.window_end
  and (v.kind in ('purchase','sale') or (v.kind in ('return','credit') and v.business_date>=b.window_start))
  and not exists(select 1 from private.stockflow_economic_source_vouchers n
   where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
), lines as (
 select v.*,l.id line_id,l.product_id,lower(btrim(l.unit)) unit,l.quantity::numeric quantity,l.net_sales_paise::numeric net,
  sum(l.net_sales_paise::numeric) over(partition by v.id) voucher_net
 from vouchers v join private.stockflow_economic_source_lines l on l.voucher_id=v.id
), running as (
 -- RANGE includes all purchase peers on the same date before any sale peers.
 -- Both cumulative sums share one ordered pass over each company/product/unit.
 select *,sum(net) filter(where kind='purchase') over costs purchase_net,
  sum(quantity) filter(where kind='purchase') over costs purchase_quantity
 from lines where kind<>'purchase' or (quantity>0 and net>0)
 window costs as (partition by company_id,product_id,unit
  order by business_date,(kind='purchase') desc range between unbounded preceding and current row)
), average_costs as materialized (
 select *,kind='sale' and voucher_net>=20000000 bulk,
  case when quantity=0 then 0 else round(quantity*purchase_net/nullif(purchase_quantity,0)) end cost
 from running where kind<>'purchase'
), negative_lines as materialized (
 select c.* from average_costs c cross join bounds b
 where c.quantity<0 and c.business_date>=b.window_start
), sale_candidates as (
 -- Rank matches only for in-window negative lines. Historical sales retain their
 -- own rounded cost and whole-voucher bucket, including sales before the window.
 select n.line_id,s.quantity,s.cost,s.bulk,
  row_number() over(partition by n.line_id order by s.business_date desc,s.line_id desc) match_rank
 from negative_lines n join average_costs s
  on s.company_id=n.company_id and s.customer_source_id is not distinct from n.customer_source_id
   and s.product_id=n.product_id and s.unit=n.unit and s.business_date<=n.business_date
 where s.kind='sale' and s.quantity>0
), attributed as (
 select c.business_date,c.net,
  case when c.quantity<0 then coalesce(s.bulk,false) else c.bulk end bulk,
  coalesce(round(c.quantity*(s.cost/s.quantity)),c.cost) cost
 from average_costs c cross join bounds b
 left join sale_candidates s on c.line_id=s.line_id and s.match_rank=1
 where c.business_date>=b.window_start
), checked as (
 -- Compare numeric products to avoid division rounding at the strict boundaries.
 -- Zero-value goods retain cost. Only positive-net outliers reduce coverage.
 select *,net>0 and cost is not null and (abs(cost)>10*abs(net) or abs(cost)<0.1*abs(net)) unreliable
 from attributed
), costed as materialized (
 select business_date,net,bulk,unreliable,case when unreliable then null else cost end cost from checked
), totals as (
 select p.period,coalesce(sum(c.net),0) sales,
  coalesce(sum(c.net) filter(where c.cost is not null),0) known,coalesce(sum(c.cost),0) cost,
  count(*) filter(where c.unreliable) unreliable_lines
 from (values ('window'),('H1'),('H2'),('repeat'),('bulk')) p(period) cross join bounds b
 left join costed c on p.period='window'
  or (p.period='H1' and c.business_date<b.h2_start)
  or (p.period='H2' and c.business_date>=b.h2_start)
  or (p.period='repeat' and not c.bulk) or (p.period='bulk' and c.bulk)
 group by p.period
), summaries as (
 select period,jsonb_build_object('salesPaise',sales,'knownSalesPaise',known,'costPaise',cost,
  'gpPaise',known-cost,'gpPct',case when known>0 then round(100*(known-cost)/known,1) end,
  'coveragePct',case when sales>0 then round(100*known/sales,1) end)
  ||case when period='window' then jsonb_build_object('unreliableLines',unreliable_lines) else '{}'::jsonb end value from totals
), months as (
 select generate_series(window_start,window_end-interval '1 month',interval '1 month')::date as month from bounds
), monthly as (
 select m.month,jsonb_build_object('month',to_char(m.month,'YYYY-MM'),
  'salesPaise',coalesce(sum(c.net),0),'knownSalesPaise',coalesce(sum(c.net) filter(where c.cost is not null),0),
  'gpPaise',coalesce(sum(c.net) filter(where c.cost is not null),0)-coalesce(sum(c.cost),0)) value
 from months m left join costed c on c.business_date>=m.month and c.business_date<m.month+interval '1 month'
 group by m.month
)
select jsonb_build_object('method','average_purchase_cost_to_date',
 'window',(select value from summaries where period='window'),
 'halves',(select jsonb_agg(jsonb_build_object('half',period)||value order by period) from summaries where period in ('H1','H2')),
 'repeat',(select value from summaries where period='repeat'),'bulk',(select value from summaries where period='bulk'),
 'months',(select jsonb_agg(value order by month) from monthly))
$$;

-- Retain the existing return expression and add exactly one management read key.
do $patch$
declare f text; anchor text:='return result||(private.stockflow_growth_p1b_model(p_today)-''labs''-''purchases'')||jsonb_build_object(''window''';
begin
 select replace(pg_get_functiondef('private.stockflow_growth_read(date,text[])'::regprocedure),chr(13),'') into f;
 if (length(f)-length(replace(f,anchor,'')))/length(anchor)<>1 then raise exception 'Unexpected Growth GP return seam';end if;
 execute replace(f,anchor,'return result||jsonb_build_object(''gp'',private.stockflow_growth_gp(p_today))||(private.stockflow_growth_p1b_model(p_today)-''labs''-''purchases'')||jsonb_build_object(''window''');
end$patch$;

revoke all on function private.stockflow_growth_gp(date) from public,anon,authenticated,service_role;

commit;
notify pgrst,'reload schema';
