begin;

create function private.stockflow_growth_read(p_today date,p_roles text[]) returns jsonb
language plpgsql stable security definer
set search_path=pg_catalog,private,public,extensions as $$
declare
 window_end date:=date_trunc('month',p_today)::date;
 window_start date:=(window_end-interval '12 months')::date;
 h2_start date:=(window_end-interval '6 months')::date;
 companies text[]; company text; top_company text; month_index integer;
 confirmed boolean:=true; reason text; status jsonb; result jsonb; bridge jsonb;
 gp jsonb; costed_pct numeric; computed_at timestamptz;
 first_sale date; months_imported integer:=0; unmapped_pct numeric;
 catalog jsonb:=jsonb_build_object('observedAt',null,'groups',null);
begin
 if not coalesce(p_roles&&array['administrator','management'],false) then
  raise exception 'Growth access required' using errcode='42501';end if;
 if p_today is null then raise exception 'Growth date required' using errcode='22023';end if;

 -- Bound the materialized source to the window, but check newer revisions across
 -- all dates/kinds: a moved or cancelled latest revision must suppress the old one.
 with latest as materialized (
  select distinct on(v.company_id,v.source_id) v.*
  from private.stockflow_economic_source_vouchers v
  where v.business_date>=window_start and v.business_date<window_end
   and not exists(select 1 from private.stockflow_economic_source_vouchers n
    where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
  order by v.company_id,v.source_id,v.source_revision desc
 ), vouchers as materialized (
  select v.id,v.company_id,v.customer_source_id,v.business_date,v.kind,sum(l.net_sales_paise::numeric) net
  from latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id
  where not v.cancelled and v.kind in ('sale','return','credit')
  group by v.id,v.company_id,v.customer_source_id,v.business_date,v.kind
 ), sales as materialized (
  select *,(kind='sale' and net>=20000000)
   or (kind in ('return','credit') and net<=-20000000) bulk,
   case when business_date<h2_start then 'H1' else 'H2' end half from vouchers
 ), periods as (
  select 'ALL' period union all select 'H1' union all select 'H2'
 ), period_sales as materialized (
  select p.period,s.* from periods p join sales s on p.period='ALL' or p.period=s.half
 ), buying as (
  -- NULL ledger is its own lab per company; no StockFlow link is required.
  select period,company_id,customer_source_id,date_trunc('month',business_date) as buying_month
  from period_sales where not bulk
  group by 1,2,3,4 having sum(net)>0
 ), buying_counts as (
  select period,count(*) months,count(distinct (company_id,customer_source_id)) labs
  from buying group by period
 ), trees as (
  select p.period,jsonb_build_object(
   'revenuePaise',coalesce(sum(s.net),0),
   'repeatPaise',coalesce(sum(s.net) filter(where not s.bulk),0),
   'bulkPaise',coalesce(sum(s.net) filter(where s.bulk),0),
   'bulkInvoices',count(s.id) filter(where s.bulk and s.kind='sale'),
   'bulkReturns',count(s.id) filter(where s.bulk and s.kind in ('return','credit')),
   'labsBuying',coalesce(b.labs,0),'buyingMonths',coalesce(b.months,0),
   'perBuyingMonthPaise',round(coalesce(sum(s.net) filter(where not s.bulk),0)/nullif(b.months,0))) tree
  from periods p left join period_sales s on s.period=p.period
  left join buying_counts b on b.period=p.period group by p.period,b.labs,b.months
 ), labs as (
  select company_id,customer_source_id,
   coalesce(sum(net) filter(where half='H1'),0) h1,
   coalesce(sum(net) filter(where half='H2'),0) h2
  from sales group by company_id,customer_source_id
 ), classified as (
  select *,case when h1<=0 and h2>0 then 'new' when h1>0 and h2<=0 then 'stopped'
   when h1>0 and h2>h1 then 'grew' when h1>0 and h2>0 and h2<h1 then 'fell'
   when h1>0 and h2=h1 then 'same' else 'other' end class from labs
 ), classes as (
  select c.class,jsonb_build_object('labs',count(l.class),'paise',
   coalesce(sum(case when c.class in ('stopped','fell') then h1-h2 else h2-h1 end),0)) value
  from unnest(array['new','stopped','grew','fell','same','other']) c(class)
  left join classified l on l.class=c.class group by c.class
 ), company_sales as (
  select company_id,sum(net) revenue from sales group by company_id
 )
 select jsonb_build_object('tree',(select tree from trees where period='ALL'),
  'halves',(select jsonb_agg(jsonb_build_object('half',period)||tree order by period) from trees where period<>'ALL'),
  'bridge',jsonb_build_object('h1Paise',(select coalesce(sum(h1),0) from labs),
   'h2Paise',(select coalesce(sum(h2),0) from labs))||(select jsonb_object_agg(class,value) from classes)),
  coalesce((select array_agg(company_id order by company_id) from company_sales),'{}'::text[]),
  (select company_id from company_sales order by revenue desc,company_id limit 1)
 into result,companies,top_company;

 bridge:=result->'bridge';
 if (bridge->>'h1Paise')::numeric+(bridge#>>'{new,paise}')::numeric
  -(bridge#>>'{stopped,paise}')::numeric+(bridge#>>'{grew,paise}')::numeric
  -(bridge#>>'{fell,paise}')::numeric+(bridge#>>'{other,paise}')::numeric
  <> (bridge->>'h2Paise')::numeric then raise exception 'Growth bridge identity failed';end if;

 if cardinality(companies)=0 then confirmed:=false;reason:='No sales in window';end if;
 foreach company in array companies loop
  status:=private.stockflow_sales_coverage_status(company,window_start,window_end-1);
  if (status->>'complete')::boolean is distinct from true then
   confirmed:=false;reason:=coalesce(reason,'Sales coverage incomplete: '||company);end if;
  for month_index in 0..11 loop
   status:=private.stockflow_sales_reconciliation(company,(window_start+month_index*interval '1 month')::date);
   if status->>'state' is distinct from 'matches' then
    confirmed:=false;reason:=coalesce(reason,'Sales reconciliation '||(status->>'state')||': '||company||' '||(status->>'month'));end if;
  end loop;
 end loop;

 begin
  if top_company is not null then
   gp:=private.stockflow_company_gp_summary(p_roles,top_company,window_start,window_end);
   if gp->>'runId' is not null then
    costed_pct:=round((gp#>>'{coverage,costedPct}')::numeric,1);
    computed_at:=(gp->>'computedAt')::timestamptz;
   end if;
  end if;
 exception when others then costed_pct:=null;computed_at:=null;
 end;

 -- History belongs to the same companies, including earlier imported sales.
 select min(v.business_date) into first_sale from private.stockflow_economic_source_vouchers v
 where v.company_id=any(companies) and v.kind='sale' and not v.cancelled and v.business_date<window_end
  and exists(select 1 from private.stockflow_economic_source_lines l where l.voucher_id=v.id)
  and not exists(select 1 from private.stockflow_economic_source_vouchers n
   where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision);
 if first_sale is not null then
  months_imported:=extract(year from age(window_end,first_sale))::integer*12+extract(month from age(window_end,first_sale))::integer;
 end if;
 begin
  with sales as materialized (select * from private.stockflow_brand_sales_180(p_today)),
  mapped as materialized (select * from private.stockflow_item_brand_map())
  select round(100*coalesce(sum(s.sales_paise) filter(where m.source='unmapped'),0)/nullif(sum(s.sales_paise),0),1)
  into unmapped_pct from sales s join mapped m using(tally_item_key);
 exception when others then unmapped_pct:=null;
 end;
 select jsonb_build_object('observedAt',observed_at,'groups',jsonb_array_length(content->'groups'))
 into catalog from private.stockflow_economic_item_catalogs order by observed_at desc,id desc limit 1;

 return result||jsonb_build_object('window',jsonb_build_object('from',window_start,'to',window_end,'h1From',window_start,'h2From',h2_start),
  'companyCount',cardinality(companies),'confirmed',confirmed,'confirmedReason',reason,
  'health',jsonb_build_object('gp',jsonb_build_object('costedPct',costed_pct,'computedAt',computed_at),
   'history',jsonb_build_object('firstSaleOn',first_sale,'monthsImported',months_imported),
   'itemGroups',jsonb_build_object('unmappedPct',unmapped_pct),
   'catalog',coalesce(catalog,jsonb_build_object('observedAt',null,'groups',null)),
   'reasons',jsonb_build_object(
    'visitReasons180',(select count(*) from private.stockflow_visit_reasons where (recorded_at at time zone 'Asia/Kolkata')::date between p_today-180 and p_today),
    'visits180',(select count(*) from private.stockflow_customer_visits where visited_on between p_today-180 and p_today),
    'constraints',(select count(*) from private.stockflow_commercial_constraints),
    'openActions',(select count(*) from private.stockflow_commercial_actions a where not exists(
     select 1 from private.stockflow_commercial_action_results r where r.action_id=a.id)))));
end$$;

create function public.stockflow_growth_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,private,public,extensions
set statement_timeout='20s' as $$
declare actor text:=lower(btrim(p_actor_email)); roles text[]; hash text;
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
 if p_action is distinct from 'get_growth' or p_payload is distinct from '{}'::jsonb then
  raise exception 'Invalid growth request' using errcode='22023';end if;
 return private.stockflow_growth_read((now() at time zone 'Asia/Kolkata')::date,roles);
end$$;

revoke all on function private.stockflow_growth_read(date,text[]) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_growth_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_growth_gateway(text,text,text,jsonb) to service_role;

commit;
notify pgrst,'reload schema';
