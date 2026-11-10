begin;

-- Extract the installed item-kind GP pipeline verbatim. Only carry additional
-- identity fields through its projections. Guard every seam before replacing GP.
do $extract$
declare f text; body text; prefix text; anchor text; replacement text; helper text;
begin
 select replace(pg_get_functiondef('private.stockflow_growth_gp(date)'::regprocedure),chr(13),'') into f;
 select replace(prosrc,chr(13),'') into body from pg_proc
 where oid='private.stockflow_growth_gp(date)'::regprocedure;
 anchor:=', totals as (';
 if (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 then
  raise exception 'Unexpected margin GP totals seam';end if;
 prefix:=split_part(body,anchor,1);
 helper:=prefix;
 anchor:='select c.company_id,c.product_id,c.business_date,c.net,';
 replacement:='select c.company_id,c.product_id,c.customer_source_id,c.unit,c.quantity,c.kind,c.business_date,c.net,';
 if (length(helper)-length(replace(helper,anchor,'')))/length(anchor)<>1 then
  raise exception 'Unexpected margin GP attribution seam';end if;
 helper:=replace(helper,anchor,replacement);
 anchor:='select c.business_date,c.net,c.bulk,c.unreliable,case when c.unreliable then null else c.cost end cost,';
 replacement:='select c.company_id,c.product_id,c.customer_source_id,c.unit,c.quantity,c.kind,c.business_date,c.net,c.bulk,c.unreliable,case when c.unreliable then null else c.cost end cost,';
 if (length(helper)-length(replace(helper,anchor,'')))/length(anchor)<>1 then
  raise exception 'Unexpected margin GP cost seam';end if;
 helper:=replace(helper,anchor,replacement)||' select company_id,product_id,customer_source_id,unit,quantity,kind,business_date,net,bulk,unreliable,cost,instrument from costed';
 execute 'create function private.stockflow_growth_costed_lines(p_today date)
 returns table(company_id text,product_id text,customer_source_id text,unit text,quantity numeric,kind text,
 business_date date,net numeric,bulk boolean,unreliable boolean,cost numeric,instrument boolean)
 language sql stable security definer set search_path=pg_catalog,private,public,extensions as '||quote_literal(helper);
 replacement:=$sql$with bounds as (
 select date_trunc('month',p_today)::date window_end,
  (date_trunc('month',p_today)-interval '12 months')::date window_start,
  (date_trunc('month',p_today)-interval '6 months')::date h2_start
), costed as materialized (select * from private.stockflow_growth_costed_lines(p_today))$sql$;
 if (length(f)-length(replace(f,prefix,'')))/length(prefix)<>1 then
  raise exception 'Unexpected margin GP pipeline seam';end if;
 execute replace(f,prefix,replacement);
end$extract$;

-- One materialized costed set supplies totals, pair prices and both list views.
create function private.stockflow_growth_margin_model(p_today date) returns jsonb
language sql stable security definer set search_path=pg_catalog,private,public,extensions as $$
with costed as materialized (select * from private.stockflow_growth_costed_lines(p_today)),
 consumables as materialized (select * from costed where not instrument),
 company_totals as (
 select coalesce(sum(net) filter(where cost is not null),0) known,
  coalesce(sum(net) filter(where cost is not null),0)-coalesce(sum(cost),0) gp from consumables
 ), company_margin as (
 select case when known>0 then round(100*gp/known,1) end margin from company_totals
 ), threshold as (select margin,round(margin/2,1) threshold from company_margin),
 catalogs as materialized (
 select distinct on(company_id) company_id,content from private.stockflow_economic_item_catalogs
 order by company_id,observed_at desc,id desc
 ), names as (
 select c.company_id,p->>'id' product_id,p->>'name' name
 from catalogs c cross join lateral jsonb_array_elements(c.content->'products') p
 ), pairs as materialized (
 select company_id,product_id,unit,customer_source_id,
  company_id||'|'||product_id||'|'||unit item_key,company_id||'|'||customer_source_id lab_key,
  sum(net) sales,coalesce(sum(net) filter(where cost is not null),0) known,coalesce(sum(cost),0) cost,
  coalesce(sum(quantity) filter(where kind='sale' and quantity>0 and net>0),0) quantity,
  sum(net) filter(where kind='sale' and quantity>0 and net>0)
   /nullif(sum(quantity) filter(where kind='sale' and quantity>0 and net>0),0) price
 from consumables group by company_id,product_id,unit,customer_source_id
 ), medians as (
 select item_key,case when count(price)>=3 then
  percentile_cont(0.5) within group(order by price)::numeric end typical
 from pairs where customer_source_id is not null group by item_key
 ), priced as materialized (
 select p.*,m.typical,coalesce(p.price>=0.4*m.typical and p.price<0.9*m.typical,false) below,
  coalesce(p.price<0.4*m.typical,false) pack
 from pairs p left join medians m using(item_key)
 ), lab_totals as (
 select company_id,customer_source_id,lab_key,sum(sales) sales,sum(known) known,sum(cost) cost
 from pairs where customer_source_id is not null group by company_id,customer_source_id,lab_key
 ), labs as materialized (
 select l.*,c.id customer_id,coalesce(c.name,private.stockflow_growth_ledger_name(l.company_id,l.customer_source_id)) name,
  c.city town,known-cost gp,case when known>0 then round(100*(known-cost)/known,1) end margin,
  case when sales<>0 then round(100*known/sales,1) end coverage
 from lab_totals l left join private.stockflow_economic_customer_identities i
  on i.company_id=l.company_id and i.source_id=l.customer_source_id
 left join private.stockflow_customers c on c.id=i.customer_id
 ), item_totals as (
 select company_id,product_id,unit,item_key,sum(sales) sales,sum(known) known,sum(cost) cost,
  count(*) filter(where customer_source_id is not null) labs,max(typical) typical,
  min(price) filter(where customer_source_id is not null and price between 0.4*typical and 2.5*typical) price_low,
  max(price) filter(where customer_source_id is not null and price between 0.4*typical and 2.5*typical) price_high,
  round(coalesce(sum((typical-price)*quantity) filter(where customer_source_id is not null and below),0)) spread,
  count(*) filter(where customer_source_id is not null and below) spread_pairs
 from priced group by company_id,product_id,unit,item_key
 ), items as materialized (
 select i.*,n.name,case when exists(select 1 from private.stockflow_products p where p.tally_item_key=n.name)
  then n.name end tally_item_key,known-cost gp,
  case when known>0 then round(100*(known-cost)/known,1) end margin
 from item_totals i left join names n using(company_id,product_id)
 ), item_rows as materialized (
 select i.*,coalesce(i.sales>=2500000 and i.margin<t.threshold,false) low,
  jsonb_build_object('itemKey',item_key,'name',name,'salesPaise',sales,'knownSalesPaise',known,
   'gpPaise',gp,'marginPct',i.margin,'labs',labs,'priceLowPaise',price_low,'typicalPricePaise',typical,
   'priceHighPaise',price_high,'spreadPaise',spread,'low',coalesce(i.sales>=2500000 and i.margin<t.threshold,false),
   'belowCost',gp<0 and sales>=250000) row
 from items i cross join threshold t
 )
select jsonb_build_object('consumablesMarginPct',t.margin,'thresholdPct',t.threshold,
 'labs',coalesce((select jsonb_agg(jsonb_build_object('labKey',lab_key,'customerId',customer_id,'name',name,'town',town,
  'salesPaise',sales,'knownSalesPaise',known,'gpPaise',gp,'marginPct',margin,'coveragePct',coverage,
  'low',coalesce(sales>=10000000 and margin<t.threshold,false)) order by lab_key) from labs),'[]'),
 'items',coalesce((select jsonb_agg(row||jsonb_build_object('tallyItemKey',tally_item_key) order by item_key) from item_rows),'[]'),
 'pairs',coalesce((select jsonb_agg(jsonb_build_object('itemKey',p.item_key,'labKey',p.lab_key,
  'unitPricePaise',p.price,'typicalPricePaise',p.typical,'quantity',p.quantity,'salesPaise',p.sales,
  'gpPaise',p.known-p.cost,'marginPct',case when p.known>0 then round(100*(p.known-p.cost)/p.known,1) end,
  'belowTypical',p.below,'packDifference',p.pack)) from priced p where p.customer_source_id is not null),'[]'),
 'levers',jsonb_build_object(
  'priceSpread',(select jsonb_build_object('items',count(*) filter(where spread>0),'pairs',coalesce(sum(spread_pairs),0),
   'paise',coalesce(sum(spread),0)) from items),
  'lowMargin',jsonb_build_object('items',(select count(*) from item_rows where low),
   'paiseToThreshold',(select coalesce(sum(greatest(0,sales*t.threshold/100-gp)),0) from item_rows where low),
   'examples',coalesce((select jsonb_agg(jsonb_build_object('name',name,'marginPct',margin,'salesPaise',sales,'labs',labs)
    order by sales desc,item_key) from (select * from item_rows where low order by sales desc,item_key limit 2) e),'[]')),
  'freeGoods',(select jsonb_build_object('lines',count(*),'costPaise',coalesce(sum(cost),0))
   from consumables where net=0 and quantity>0 and cost is not null),
  'instrumentsGpPaise',(select coalesce(sum(net) filter(where cost is not null),0)-coalesce(sum(cost),0)
   from costed where instrument))) from threshold t
$$;

create function private.stockflow_growth_margin_read(p_today date,p_payload jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,private,public,extensions as $$
declare view_name text:=p_payload->>'view'; sort_name text:=coalesce(p_payload->>'sort','sales');
 filter_name text:=coalesce(p_payload->>'filter','all'); query text; page_number integer; model jsonb; result jsonb;
begin
 if p_today is null or jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception 'Invalid margin request' using errcode='22023';end if;
 if p_payload-array['view','page','sort','filter','q']<>'{}'::jsonb
  or jsonb_typeof(p_payload->'view') is distinct from 'string' or view_name not in ('labs','items')
  or jsonb_typeof(p_payload->'page') is distinct from 'number'
  or (p_payload->>'page') !~ '^[1-9][0-9]*$' or length(p_payload->>'page')>10
  or (p_payload ? 'sort' and jsonb_typeof(p_payload->'sort') is distinct from 'string')
  or (p_payload ? 'filter' and jsonb_typeof(p_payload->'filter') is distinct from 'string')
  or sort_name not in ('sales','gp','margin','margin_asc','spread')
  or (view_name='labs' and (sort_name='spread' or filter_name not in ('all','low','unlinked')))
  or (view_name='items' and filter_name not in ('all','low','below_cost','spread')) then
  raise exception 'Invalid margin options' using errcode='22023';end if;
 begin page_number:=(p_payload->>'page')::integer;
 exception when numeric_value_out_of_range then raise exception 'Invalid page' using errcode='22023';end;
 if p_payload ? 'q' then
  query:=btrim(p_payload->>'q');
  if jsonb_typeof(p_payload->'q') is distinct from 'string' or char_length(query) not between 1 and 60 then
   raise exception 'Invalid margin search' using errcode='22023';end if;
 end if;
 model:=private.stockflow_growth_margin_model(p_today);
 with selected as materialized (
  select r from jsonb_array_elements(model->view_name) r
  where (query is null or strpos(lower(r->>'name'),lower(query))>0)
   and (filter_name='all' or (filter_name='low' and (r->>'low')::boolean)
    or (filter_name='unlinked' and r->>'customerId' is null)
    or (filter_name='below_cost' and (r->>'belowCost')::boolean)
    or (filter_name='spread' and (r->>'spreadPaise')::numeric>0))
 ), ranked as (
  select r,row_number() over(order by
   case sort_name when 'sales' then (r->>'salesPaise')::numeric when 'gp' then (r->>'gpPaise')::numeric
    when 'margin' then (r->>'marginPct')::numeric when 'spread' then (r->>'spreadPaise')::numeric end desc nulls last,
   case when sort_name='margin_asc' then (r->>'marginPct')::numeric end asc nulls last,
   coalesce(r->>'labKey',r->>'itemKey')) ordinal from selected
 ), page as (select * from ranked order by ordinal limit 20 offset (page_number::bigint-1)*20)
 select jsonb_build_object('view',view_name,'sort',sort_name,'filter',filter_name,'q',query,'page',page_number,
  'pageSize',20,'total',(select count(*) from selected),'rows',coalesce(jsonb_agg(r-'tallyItemKey' order by ordinal),'[]'))
 into result from page;
 return result||(model-'labs'-'items'-'pairs');
end$$;

create function private.stockflow_growth_margin_detail(p_today date,p_payload jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,private,public,extensions as $$
declare item_key text:=p_payload->>'itemKey'; lab_key text:=p_payload->>'labKey'; page_number integer;
 model jsonb; entity jsonb; result jsonb; is_item boolean:=p_payload ? 'itemKey';
begin
 if p_today is null or jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception 'Invalid margin detail request' using errcode='22023';end if;
 if p_payload-array['itemKey','labKey','page']<>'{}'::jsonb
  or (p_payload ? 'itemKey')=(p_payload ? 'labKey')
  or jsonb_typeof(p_payload->case when is_item then 'itemKey' else 'labKey' end) is distinct from 'string'
  or jsonb_typeof(p_payload->'page') is distinct from 'number'
  or (p_payload->>'page') !~ '^[1-9][0-9]*$' or length(p_payload->>'page')>10 then
  raise exception 'Invalid margin detail options' using errcode='22023';end if;
 begin page_number:=(p_payload->>'page')::integer;
 exception when numeric_value_out_of_range then raise exception 'Invalid page' using errcode='22023';end;
 model:=private.stockflow_growth_margin_model(p_today);
 select r into entity from jsonb_array_elements(model->case when is_item then 'items' else 'labs' end) r
 where case when is_item then r->>'itemKey'=item_key else r->>'labKey'=lab_key end;
 if entity is null then raise exception 'Unknown margin key' using errcode='22023';end if;
 with selected as materialized (
  select r from jsonb_array_elements(model->'pairs') r
  -- Item detail lists observed lab prices. Lab detail also retains unpriced
  -- credits, returns and free goods, with a nullable unit price.
  where case when is_item then r->>'itemKey'=item_key and r->>'unitPricePaise' is not null
   else r->>'labKey'=lab_key end
 ), ranked as (
  select r,row_number() over(order by
   case when is_item then (r->>'unitPricePaise')::numeric end asc nulls last,
   case when not is_item then (r->>'salesPaise')::numeric end desc,
   case when is_item then r->>'labKey' else r->>'itemKey' end) ordinal from selected
 ), page as (select * from ranked order by ordinal limit 20 offset (page_number::bigint-1)*20),
 enriched as (
  select p.*,l,i from page p
  join jsonb_array_elements(model->'labs') l on l->>'labKey'=r->>'labKey'
  join jsonb_array_elements(model->'items') i on i->>'itemKey'=r->>'itemKey'
 ) select jsonb_build_object('page',page_number,'pageSize',20,'total',(select count(*) from selected),
  'rows',coalesce(jsonb_agg(
   (case when is_item then (r-'itemKey'-'typicalPricePaise'-'gpPaise'-'marginPct')||
    jsonb_build_object('customerId',l->'customerId','name',l->'name','town',l->'town')
   else (r-'labKey')||jsonb_build_object('name',i->'name','tallyItemKey',i->'tallyItemKey') end)
   ||jsonb_build_object('approvedPricePaise',(
    select round(c.price_amount*100) from private.stockflow_customer_product_prices c
    where c.customer_id=(l->>'customerId')::uuid and c.tally_item_key=i->>'tallyItemKey'
     and c.status='approved' and c.valid_from<=p_today and (c.valid_to is null or c.valid_to>=p_today)
    order by c.valid_from desc,c.created_at desc,c.id desc limit 1)) order by ordinal),'[]')) into result from enriched;
 if is_item then
  return result||jsonb_build_object('kind','item','itemKey',item_key,'name',entity->'name',
   'typicalPricePaise',entity->'typicalPricePaise','labs',entity->'labs','marginPct',entity->'marginPct','tallyItemKey',entity->'tallyItemKey');
 end if;
 return result||jsonb_build_object('kind','lab','labKey',lab_key,'customerId',entity->'customerId','name',entity->'name',
  'town',entity->'town','salesPaise',entity->'salesPaise','gpPaise',entity->'gpPaise','marginPct',entity->'marginPct');
end$$;

do $patch$
declare f text; anchor text:='if p_action is distinct from ''get_growth'' or p_payload is distinct from ''{}''::jsonb then';
begin
 select replace(pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'') into f;
 if (length(f)-length(replace(f,anchor,'')))/length(anchor)<>1 then raise exception 'Unexpected margin gateway seam';end if;
 execute replace(f,anchor,$new$if p_action='get_growth_margin' then
  return private.stockflow_growth_margin_read((now() at time zone 'Asia/Kolkata')::date,p_payload);
 end if;
 if p_action='get_growth_margin_detail' then
  return private.stockflow_growth_margin_detail((now() at time zone 'Asia/Kolkata')::date,p_payload);
 end if;
 if p_action is distinct from 'get_growth' or p_payload is distinct from '{}'::jsonb then$new$);
end$patch$;

revoke all on function private.stockflow_growth_costed_lines(date),private.stockflow_growth_gp(date),
 private.stockflow_growth_margin_model(date),private.stockflow_growth_margin_read(date,jsonb),
 private.stockflow_growth_margin_detail(date,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_growth_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_growth_gateway(text,text,text,jsonb) to service_role;
commit;
notify pgrst,'reload schema';
