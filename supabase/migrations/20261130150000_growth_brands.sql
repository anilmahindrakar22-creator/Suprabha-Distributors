begin;

-- BL4: Growth "Sales by principal". A management read of window sales, H1/H2
-- and consumables margin per brand and per Tally line. Read only; no table,
-- link or existing read changes.

-- Guards: stop unless the three functions this read builds on still have the
-- reviewed production bodies.
do $guard$
declare actual text;
begin
 select md5(replace(p.prosrc,chr(13),'')) into actual from pg_proc p
 where p.oid='private.stockflow_item_brand_map()'::regprocedure;
 if actual is distinct from 'cb13904f786d0492324e27def7eef2f0' then
  raise exception 'Unexpected stockflow_item_brand_map body (md5 %)',actual;end if;
 select md5(replace(p.prosrc,chr(13),'')) into actual from pg_proc p
 where p.oid='public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure;
 if actual is distinct from '77586b24655a54800858c559d8563013' then
  raise exception 'Unexpected stockflow_growth_gateway body (md5 %)',actual;end if;
 select md5(replace(p.prosrc,chr(13),'')) into actual from pg_proc p
 where p.oid='private.stockflow_growth_costed_lines(date)'::regprocedure;
 if actual is distinct from 'eccbd78f44c97229ab9519f836acc482' then
  raise exception 'Unexpected stockflow_growth_costed_lines body (md5 %)',actual;end if;
end$guard$;

-- One materialized costed set feeds every level. Paise are rounded once per
-- item, so lines, rows and totals are integer sums of the same item values.
create function private.stockflow_growth_brands_read(p_today date) returns jsonb
language sql stable security definer set search_path=pg_catalog,private,public,extensions as $$
with bounds as (
 select date_trunc('month',p_today)::date window_end,
  (date_trunc('month',p_today)-interval '12 months')::date window_start,
  (date_trunc('month',p_today)-interval '6 months')::date h2_start
), costed as materialized (select * from private.stockflow_growth_costed_lines(p_today)),
 catalogs as materialized (
 select distinct on(company_id) company_id,content from private.stockflow_economic_item_catalogs
 order by company_id,observed_at desc,id desc
 ), names as materialized (
 -- One name per catalog product id, so every costed line counts once.
 select distinct on(c.company_id,p.entry->>'id') c.company_id,p.entry->>'id' product_id,p.entry->>'name' name
 from catalogs c cross join lateral jsonb_array_elements(
  case when jsonb_typeof(c.content->'products')='array' then c.content->'products' else '[]'::jsonb end)
  with ordinality p(entry,ordinal)
 where p.entry->>'id' is not null
 order by c.company_id,p.entry->>'id',p.ordinal
 ), brand_map as materialized (select * from private.stockflow_item_brand_map()),
 tree as materialized (select group_name,depth from private.stockflow_brand_group_tree()),
 areas as materialized (
 select distinct on(item_group) item_group,area_code from private.stockflow_group_area_links
 order by item_group,recorded_at desc,id desc
 ), item_totals as (
 select c.company_id,c.product_id,
  round(coalesce(sum(c.net),0)) sales,
  round(coalesce(sum(c.net) filter(where c.business_date<b.h2_start),0)) h1,
  round(coalesce(sum(c.net) filter(where c.instrument),0)) instrument_sales,
  round(coalesce(sum(c.net) filter(where not c.instrument and c.cost is not null),0)) known,
  round(coalesce(sum(c.cost) filter(where not c.instrument),0)) cost
 from costed c cross join bounds b group by c.company_id,c.product_id
 ), items as materialized (
 select t.sales,t.h1,t.sales-t.h1 h2,t.instrument_sales,t.sales-t.instrument_sales consumables,
  t.known,t.known-t.cost gp,
  case when m.tally_item_key is null or m.source='unmapped' then 'unmapped'
   when m.brand_code is null then 'none' else 'brand' end row_kind,
  case when m.source<>'unmapped' then m.brand_code end brand_code,
  case when m.source='item' then 'individual' when g.depth>0 then 'line' else 'direct' end line_kind,
  case when m.source<>'item' then p.item_group end line_group
 from item_totals t
 left join names n on n.company_id=t.company_id and n.product_id=t.product_id
 left join private.stockflow_products p on p.tally_item_key=n.name
 left join brand_map m on m.tally_item_key=p.tally_item_key
 left join tree g on g.group_name=p.item_group
 ), line_rows as (
 select row_kind,brand_code,line_kind,line_group,sum(sales) sales,sum(h1) h1,sum(h2) h2,
  sum(instrument_sales) instrument_sales,sum(consumables) consumables,sum(known) known,sum(gp) gp,count(*) items
 from items where row_kind<>'unmapped' group by row_kind,brand_code,line_kind,line_group
 ), bucket_rows as (
 select row_kind,brand_code,sum(sales) sales,sum(h1) h1,sum(h2) h2,
  sum(instrument_sales) instrument_sales,sum(consumables) consumables,sum(known) known,sum(gp) gp,count(*) items
 from items group by row_kind,brand_code
 ), all_rows as (
 select * from bucket_rows where row_kind='brand'
 union all
 -- The none and unmapped rows are always present.
 select f.row_kind,null,coalesce(r.sales,0),coalesce(r.h1,0),coalesce(r.h2,0),coalesce(r.instrument_sales,0),
  coalesce(r.consumables,0),coalesce(r.known,0),coalesce(r.gp,0),coalesce(r.items,0)
 from (values ('none'),('unmapped')) f(row_kind) left join bucket_rows r on r.row_kind=f.row_kind
 ), levels as (
 select 'line' level,row_kind,brand_code,line_kind,line_group,sales,h1,h2,instrument_sales,consumables,known,gp,items from line_rows
 union all
 select 'row',row_kind,brand_code,null,null,sales,h1,h2,instrument_sales,consumables,known,gp,items from all_rows
 union all
 select 'total',null,null,null,null,coalesce(sum(sales),0),coalesce(sum(h1),0),coalesce(sum(h2),0),
  coalesce(sum(instrument_sales),0),coalesce(sum(consumables),0),coalesce(sum(known),0),coalesce(sum(gp),0),count(*) from items
 ), measured as materialized (
 select l.*,jsonb_build_object('salesPaise',sales,'h1Paise',h1,'h2Paise',h2,'instrumentSalesPaise',instrument_sales,
  'consumablesSalesPaise',consumables,'knownSalesPaise',known,'gpPaise',gp,
  'marginPct',case when known>0 then round(100*gp/known,1) end,'items',items) measures
 from levels l
 ), line_lists as (
 select l.row_kind,l.brand_code,jsonb_agg(
  jsonb_build_object('kind',l.line_kind,'group',l.line_group,'areaCode',a.area_code)||l.measures
  order by l.sales desc,l.line_group collate "C" nulls last,l.line_kind) lines
 from measured l left join areas a on l.line_kind<>'individual' and a.item_group=l.line_group
 where l.level='line' group by l.row_kind,l.brand_code
 )
select jsonb_build_object(
 'window',(select jsonb_build_object('from',window_start,'to',window_end,'h2From',h2_start) from bounds),
 'totals',(select measures-'h1Paise'-'h2Paise'-'items' from measured where level='total'),
 'rows',(select jsonb_agg(
   jsonb_build_object('key',case when r.row_kind='brand' then 'brand:'||r.brand_code else r.row_kind end,
    'kind',r.row_kind,'brandCode',r.brand_code,
    'name',case r.row_kind when 'brand' then coalesce(b.name,r.brand_code)
     when 'none' then 'Not a principal product' else 'Not mapped' end,
    'lines',coalesce(l.lines,'[]'::jsonb))||r.measures
   order by case r.row_kind when 'brand' then 0 when 'none' then 1 else 2 end,r.sales desc,r.brand_code collate "C")
  from measured r
  left join private.stockflow_brands b on b.code=r.brand_code
  left join line_lists l on l.row_kind=r.row_kind and l.brand_code is not distinct from r.brand_code
  where r.level='row'))
$$;

-- Single-match seam: dispatch the new action after the gateway's role check.
do $patch$
declare f text; anchor text:='if p_action=''get_growth_margin'' then';
begin
 select replace(pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'') into f;
 if (length(f)-length(replace(f,anchor,'')))/length(anchor)<>1 then raise exception 'Unexpected growth brands gateway seam';end if;
 execute replace(f,anchor,$new$if p_action='get_growth_brands' then if p_payload is distinct from '{}'::jsonb then raise exception 'Invalid growth brands request' using errcode='22023';end if; return private.stockflow_growth_brands_read((now() at time zone 'Asia/Kolkata')::date);end if;
 $new$||anchor);
end$patch$;

revoke all on function private.stockflow_growth_brands_read(date) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_growth_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_growth_gateway(text,text,text,jsonb) to service_role;
commit;
notify pgrst,'reload schema';
