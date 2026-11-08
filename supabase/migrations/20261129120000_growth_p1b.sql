begin;

-- One latest-revision read supplies every new bar and its drill-down membership.
-- Internal arrays never leave the gateway; names are resolved only for the page.
create function private.stockflow_growth_p1b_model(p_today date) returns jsonb
language sql stable security definer
set search_path=pg_catalog,private,public,extensions as $$
with bounds as (
 select date_trunc('month',p_today)::date e,
 (date_trunc('month',p_today)-interval '12 months')::date s
), months as materialized (
 select generate_series(s,e-interval '1 month',interval '1 month')::date m from bounds
), vouchers as materialized (
 select v.id,v.company_id,v.customer_source_id,v.business_date,v.kind,sum(l.net_sales_paise::numeric) net
 from private.stockflow_economic_source_vouchers v
 join private.stockflow_economic_source_lines l on l.voucher_id=v.id
 where not v.cancelled and v.kind in ('sale','return','credit','purchase')
 and not exists(select 1 from private.stockflow_economic_source_vouchers n
  where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
 group by v.id
), lm as materialized (
 select company_id,customer_source_id,date_trunc('month',business_date)::date m,sum(net) net,
 max(business_date) filter(where net>0) last_positive
 from vouchers where kind<>'purchase' group by 1,2,3
), history as (
 select min(m) first_month from lm
), lab_base as (
 select l.company_id,l.customer_source_id,
 l.company_id||'|'||coalesce(l.customer_source_id,'(no ledger)') lab_key,
 min(l.m) filter(where l.net>0) first_month,
 coalesce(sum(l.net) filter(where l.m>=b.s and l.m<b.e),0) net,
 coalesce(sum(l.net) filter(where l.m>=b.s and l.m<b.s+interval '6 months'),0) h1,
 coalesce(sum(l.net) filter(where l.m>=b.s+interval '6 months' and l.m<b.e),0) h2,
 count(*) filter(where l.m>=b.s and l.m<b.e and l.net>0) months_bought,
 count(*) filter(where l.m>=b.s and l.m<b.s+interval '6 months' and l.net>0) h1_months,
 coalesce(sum(l.net) filter(where l.m>=b.e-interval '3 months' and l.m<b.e),0) recent,
 coalesce(sum(l.net) filter(where l.m>=b.e-interval '6 months' and l.m<b.e-interval '3 months'),0) prior,
 bool_or(l.m>=b.s and l.m<b.e) in_window,
 coalesce(jsonb_object_agg(to_char(l.m,'YYYY-MM'),l.net) filter(where l.m>=b.s and l.m<b.e),'{}') month_nets,
 array_agg(l.m) filter(where l.net>0) bought,
 max(l.last_positive) filter(where l.m<b.e) last_bought
 from lm l cross join bounds b group by l.company_id,l.customer_source_id,b.s,b.e
), labs as materialized (
 select l.*,coalesce((select jsonb_agg(to_char(mm.m,'YYYY-MM') order by mm.m) from months mm
  where (select count(*) from unnest(l.bought) x(m) where x.m>=mm.m-interval '11 months' and x.m<mm.m)>=6
  and not coalesce(mm.m=any(l.bought),false)), '[]') skipped from lab_base l
), classified as materialized (
 select *,case when h1<=0 and h2>0 then 'new' when h1>0 and h2<=0 then 'stopped'
 when h1>0 and h2>h1 then 'grew' when h1>0 and h2>0 and h2<h1 then 'fell'
 when h1>0 and h2=h1 then 'same' else 'other' end class from labs
), totals as (
 select coalesce(sum(net),0) revenue from labs
), purchases as materialized (
 select v.* from vouchers v cross join bounds b where kind='purchase' and business_date>=s and business_date<e
)
select jsonb_build_object(
 'scorecard',jsonb_build_object('regularLabs',(select count(*) from labs where months_bought>=10),
 'regularPct',case when revenue>0 then round(100*(select coalesce(sum(net),0) from labs where months_bought>=10)/revenue,1) end,
 'top10Pct',case when revenue>0 then round(100*(select coalesce(sum(net),0) from
  (select net from labs where in_window order by net desc,company_id,customer_source_id limit 10) t)/revenue,1) end),
 'months',(select jsonb_agg(jsonb_build_object('month',to_char(m,'YYYY-MM'),
 'labsBuying',(select count(*) from lm where lm.m=mm.m and net>0),
 'salesPaise',(select coalesce(sum(net),0) from lm where lm.m=mm.m),
 'firstTime',case when m>first_month then (select count(*) from labs where labs.first_month=mm.m) end,
 'skippedRegulars',case when first_month<=m-interval '11 months' then
  (select count(*) from labs where skipped ? to_char(mm.m,'YYYY-MM')) end,
 'purchasesRegularPaise',(select coalesce(sum(net),0) from purchases where business_date>=m and business_date<m+interval '1 month' and net<20000000),
 'purchasesLargePaise',(select coalesce(sum(net),0) from purchases where business_date>=m and business_date<m+interval '1 month' and net>=20000000),
 'largePurchaseInvoices',(select count(*) from purchases where business_date>=m and business_date<m+interval '1 month' and net>=20000000)) order by m) from months mm cross join history),
 'labs',coalesce((select jsonb_agg(to_jsonb(c)) from classified c),'[]'),
 'purchases',coalesce((select jsonb_agg(to_jsonb(p)) from purchases p where net>=20000000),'[]')) from totals;
$$;

-- Add keys at the single return seam, retaining the established read verbatim.
do $patch$
declare f text; anchor text:='return result||jsonb_build_object(''window''';
begin
 select replace(pg_get_functiondef('private.stockflow_growth_read(date,text[])'::regprocedure),chr(13),'') into f;
 if (length(f)-length(replace(f,anchor,'')))/length(anchor)<>1 then raise exception 'Unexpected Growth return seam';end if;
 execute replace(f,anchor,'return result||(private.stockflow_growth_p1b_model(p_today)-''labs''-''purchases'')||jsonb_build_object(''window''');
end$patch$;

create function private.stockflow_growth_ledger_name(p_company text,p_source text) returns text
language sql stable security definer set search_path=pg_catalog,private as $$
 select l.name from private.stockflow_economic_ledger_masters l
 where l.company_id=p_company and l.guid=p_source and l.source_version=(
  select g.catalog_version from private.stockflow_economic_ledger_generations g
  where g.company_id=p_company and g.valid order by g.observed_at desc,g.imported_at desc,g.source_version desc limit 1)
$$;

create function private.stockflow_growth_labs_read(p_today date,p_roles text[],p_payload jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,private,public,extensions as $$
declare list_name text:=p_payload->>'list'; sort_name text; month_name text:=p_payload->>'month';
 page_number integer; regular_only boolean:=true; model jsonb; result jsonb;
begin
 if not coalesce(p_roles&&array['administrator','management'],false) then
  raise exception 'Growth access required' using errcode='42501';end if;
 if p_today is null or jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception 'Invalid growth labs request' using errcode='22023';end if;
 if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('list','page','sort','month','regularOnly'))
 or jsonb_typeof(p_payload->'list') is distinct from 'string'
 or list_name not in ('month_buying','month_first','month_skipped','month_large_purchases','bridge_new','bridge_stopped','bridge_grew','bridge_fell','regular_labs')
 or jsonb_typeof(p_payload->'page') is distinct from 'number'
 or (p_payload->>'page') !~ '^[1-9][0-9]*$'
 or length(p_payload->>'page')>10 then
  raise exception 'Invalid growth labs request' using errcode='22023';end if;
 begin page_number:=(p_payload->>'page')::integer;
 exception when numeric_value_out_of_range then raise exception 'Invalid page' using errcode='22023';end;
 sort_name:=case when list_name='month_skipped' then 'months' else 'value' end;
 if p_payload ? 'sort' then
  if jsonb_typeof(p_payload->'sort') is distinct from 'string' then raise exception 'Invalid sort' using errcode='22023';end if;
  sort_name:=p_payload->>'sort';
 end if;
 if sort_name not in ('value','months','last') or (list_name='month_large_purchases' and sort_name='months')
 or ((left(list_name,6)='month_') is distinct from (p_payload ? 'month'))
 or (p_payload ? 'month' and (jsonb_typeof(p_payload->'month') is distinct from 'string' or not exists(
  select 1 from generate_series(date_trunc('month',p_today)-interval '12 months',date_trunc('month',p_today)-interval '1 month',interval '1 month') m
  where to_char(m,'YYYY-MM')=month_name)))
 or (p_payload ? 'regularOnly' and (list_name<>'bridge_stopped' or jsonb_typeof(p_payload->'regularOnly') is distinct from 'boolean')) then
  raise exception 'Invalid growth labs options' using errcode='22023';end if;
 if p_payload ? 'regularOnly' then regular_only:=(p_payload->>'regularOnly')::boolean;end if;
 model:=private.stockflow_growth_p1b_model(p_today);
 if list_name='month_large_purchases' then
  with selected as materialized (
   select p from jsonb_array_elements(model->'purchases') p where left(p->>'business_date',7)=month_name
  ), page as (
   select p from selected order by
    case when sort_name='value' then (p->>'net')::numeric end desc nulls last,
    case when sort_name='last' then p->>'business_date' end desc nulls last,
    p->>'company_id',p->>'id' limit 20 offset (page_number::bigint-1)*20
  ) select jsonb_build_object('total',(select count(*) from selected),'rows',coalesce(jsonb_agg(jsonb_build_object(
   'supplierName',private.stockflow_growth_ledger_name(p->>'company_id',p->>'customer_source_id'),
   'valuePaise',(p->>'net')::numeric,'date',p->>'business_date') order by
    case when sort_name='value' then (p->>'net')::numeric end desc nulls last,
    case when sort_name='last' then p->>'business_date' end desc nulls last,
    p->>'company_id',p->>'id'),'[]')) into result from page;
 else
  with selected as materialized (
   select l,case when list_name in ('month_buying','month_first') then (l#>>array['month_nets',month_name])::numeric
    when list_name='month_skipped' then null when list_name='regular_labs' then (l->>'net')::numeric
    when list_name in ('bridge_stopped','bridge_fell') then (l->>'h1')::numeric-(l->>'h2')::numeric
    else (l->>'h2')::numeric-(l->>'h1')::numeric end val
   from jsonb_array_elements(model->'labs') l where case list_name
    when 'month_buying' then (l#>>array['month_nets',month_name])::numeric>0
    when 'month_first' then left(l->>'first_month',7)=month_name and exists(
     select 1 from jsonb_array_elements(model->'months') m where m->>'month'=month_name and m->'firstTime'<>'null'::jsonb)
    when 'month_skipped' then l->'skipped' ? month_name and exists(
     select 1 from jsonb_array_elements(model->'months') m where m->>'month'=month_name and m->'skippedRegulars'<>'null'::jsonb)
    when 'regular_labs' then (l->>'months_bought')::int>=10
    else (l->>'in_window')::boolean and l->>'class'=substr(list_name,8)
     and (list_name<>'bridge_stopped' or not regular_only or (l->>'h1_months')::int>=3) end
  ), page as (
   select * from selected order by
    case when sort_name='value' then val end desc nulls last,
    case when sort_name='months' then (l->>'months_bought')::int end desc,
    case when sort_name in ('months','last') then l->>'last_bought' end desc nulls last,
    l->>'lab_key' limit 20 offset (page_number::bigint-1)*20
  ) select jsonb_build_object('total',(select count(*) from selected),'rows',coalesce(jsonb_agg(jsonb_build_object(
   'labKey',l->>'lab_key','customerId',c.id,'name',coalesce(c.name,private.stockflow_growth_ledger_name(l->>'company_id',l->>'customer_source_id')),
   'town',c.city,'valuePaise',val,'monthsBought',(l->>'months_bought')::int,'lastBoughtOn',l->>'last_bought',
   'trend',case when (l->>'recent')::numeric<=0 and (l->>'prior')::numeric<=0 then null
    when (l->>'recent')::numeric>1.1*(l->>'prior')::numeric then 'up'
    when (l->>'recent')::numeric<0.9*(l->>'prior')::numeric then 'down' else 'flat' end) order by
    case when sort_name='value' then val end desc nulls last,
    case when sort_name='months' then (l->>'months_bought')::int end desc,
    case when sort_name in ('months','last') then l->>'last_bought' end desc nulls last,
    l->>'lab_key'),'[]')) into result
   from page left join private.stockflow_economic_customer_identities i on i.company_id=l->>'company_id' and i.source_id=l->>'customer_source_id'
   left join private.stockflow_customers c on c.id=i.customer_id;
 end if;
 return jsonb_build_object('list',list_name,'month',month_name,'page',page_number,'pageSize',20)||result;
end$$;

-- Preserve key verification, role union and the gateway's 20 second timeout.
do $patch$
declare f text; anchor text:='if p_action is distinct from ''get_growth'' or p_payload is distinct from ''{}''::jsonb then';
begin
 select replace(pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'') into f;
 if (length(f)-length(replace(f,anchor,'')))/length(anchor)<>1 then raise exception 'Unexpected Growth gateway seam';end if;
 execute replace(f,anchor,$new$if p_action='get_growth_labs' then
  return private.stockflow_growth_labs_read((now() at time zone 'Asia/Kolkata')::date,roles,p_payload);
 end if;
 if p_action is distinct from 'get_growth' or p_payload is distinct from '{}'::jsonb then$new$);
end$patch$;

revoke all on function private.stockflow_growth_p1b_model(date) from public,anon,authenticated,service_role;
revoke all on function private.stockflow_growth_ledger_name(text,text) from public,anon,authenticated,service_role;
revoke all on function private.stockflow_growth_labs_read(date,text[],jsonb) from public,anon,authenticated,service_role;
revoke all on function private.stockflow_growth_read(date,text[]) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_growth_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_growth_gateway(text,text,text,jsonb) to service_role;
commit;
notify pgrst,'reload schema';
