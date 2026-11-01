begin;

create function private.stockflow_brand_prospects(p_actor text,p_roles text[],p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,private,extensions as $$
declare
 v_brand text; v_fit text; v_page numeric:=1; v_financial boolean;
 v_today date:=(now() at time zone 'Asia/Kolkata')::date; v_result jsonb;
begin
 if not coalesce(p_roles && array['administrator','management','sales']::text[],false) then
  raise exception 'Prospects access required' using errcode='PT403';end if;
 v_financial:=p_roles && array['administrator','management']::text[];
 if jsonb_typeof(p_payload) is distinct from 'object' or p_payload-array['brand','fit','page']<>'{}'::jsonb
  or jsonb_typeof(p_payload->'brand') is distinct from 'string'
  or (p_payload->>'brand') !~ '^[A-Z][A-Z0-9_]{1,39}$'
  or (p_payload ? 'fit' and (jsonb_typeof(p_payload->'fit') is distinct from 'string'
   or p_payload->>'fit' not in ('vidas','clia','none','check','unknown')))
  or (p_payload ? 'page' and jsonb_typeof(p_payload->'page') is distinct from 'number') then
  raise exception 'Invalid prospects query' using errcode='22023';end if;
 v_brand:=p_payload->>'brand';v_fit:=p_payload->>'fit';v_page:=coalesce((p_payload->>'page')::numeric,1);
 if v_page<>trunc(v_page) or v_page not between 1 and 4000 then
  raise exception 'Invalid prospects page' using errcode='22023';end if;
 if not exists(select 1 from private.stockflow_brands where code=v_brand and active) then
  raise exception 'Active brand required' using errcode='22023';end if;

 with brand_areas as materialized (
  select area_code from private.stockflow_brand_areas where brand_code=v_brand
 ), visible as materialized (
  select c.id,c.name,c.city from private.stockflow_customers c
  -- Same scope as Accounts get_accounts default "all": every active customer.
  where c.active
 ), latest_reports as materialized (
  select distinct on(r.customer_id) r.customer_id,r.id
  from private.stockflow_lab_mix_reports r join visible c on c.id=r.customer_id
  order by r.customer_id,r.reported_at desc,r.id desc
 ), area_rows as materialized (
  select r.customer_id,
   jsonb_agg(jsonb_build_object('area',a.area_code,'name',l.name,'status',a.status,
    'min',a.min_per_day,'max',a.max_per_day,'exact',a.exact) order by l.sort_order,l.code) areas,
   coalesce(sum(a.min_per_day) filter(where a.status='in_house'),0) volume,
   bool_or(a.status='in_house') in_house
  from latest_reports r join private.stockflow_lab_mix_report_areas a on a.report_id=r.id
  join brand_areas b on b.area_code=a.area_code join private.stockflow_lab_areas l on l.code=a.area_code
  group by r.customer_id having bool_or(a.status in ('in_house','sends_out'))
 ), candidates as materialized (
  -- Materialization ensures the shared read runs once per candidate, never per
  -- active customer, per output key, or per sales line.
  select c.*,a.areas,a.volume,a.in_house,private.stockflow_lab_mix_read(c.id) mix
  from area_rows a join visible c on c.id=a.customer_id
 ), equipment_links as materialized (
  select distinct on(tally_item_key) tally_item_key,area_code
  from private.stockflow_equipment_area_links order by tally_item_key,recorded_at desc,id desc
 ), installed as (
  select distinct e.customer_id from private.stockflow_equipment_installations e
  join equipment_links l on l.tally_item_key=e.tally_key join brand_areas a on a.area_code=l.area_code
 ), filtered as materialized (
  select c.*,i.customer_id is not null has_machine from candidates c left join installed i on i.customer_id=c.id
  where v_fit is null or c.mix->>'fit'=v_fit
 ), selected as materialized (
  select * from filtered order by has_machine,in_house desc,volume desc,name,id limit 20 offset (v_page::integer-1)*20
 ), item_map as materialized (
  select * from private.stockflow_item_brand_map()
 ), latest_vouchers as materialized (
  -- Same latest-revision-before-filter, label join and inclusive 180-day window
  -- as stockflow_brand_sales_180. Keep company/source identity for attribution.
  select distinct on(v.company_id,v.source_id) v.* from private.stockflow_economic_source_vouchers v
  order by v.company_id,v.source_id,v.source_revision desc
 ), window_lines as materialized (
  -- Bound the voucher/line join before product mapping. Without this boundary,
  -- low/stale statistics can rescan every label-matched line for each voucher.
  select v.company_id,v.customer_source_id,l.evidence->>'label' item_label,l.net_sales_paise::numeric sales_paise
  from latest_vouchers v join private.stockflow_economic_source_lines l on l.voucher_id=v.id
  where not v.cancelled and v.kind in ('sale','return','credit')
   and v.business_date>=v_today-180 and v.business_date<v_today+1
 ), sales as materialized (
  select l.company_id,l.customer_source_id,p.tally_item_key,l.sales_paise,m.brand_code,m.source
  from window_lines l join private.stockflow_products p on l.item_label=p.tally_item_key
  join item_map m on m.tally_item_key=p.tally_item_key
 ), ledgers as (
  select company_id,customer_source_id,sum(sales_paise) net from sales where brand_code=v_brand
  group by company_id,customer_source_id
 ), customer_sales as materialized (
  -- Wallet v2: company_id AND source_id identify the economic customer ledger.
  select i.customer_id,sum(l.net) sales_paise from ledgers l
  join private.stockflow_economic_customer_identities i on i.company_id=l.company_id and i.source_id=l.customer_source_id
  join selected s on s.id=i.customer_id group by i.customer_id
 ), brands as materialized (
  select b.code,b.name,jsonb_build_object('code',b.code,'name',b.name,'areas',
   coalesce((select jsonb_agg(a.area_code order by a.area_code) from private.stockflow_brand_areas a where a.brand_code=b.code),'[]'::jsonb)) data
  from private.stockflow_brands b where b.active
 )
 select jsonb_build_object(
  'brand',(select data from brands where code=v_brand),
  'brands',coalesce((select jsonb_agg(data order by name,code) from brands),'[]'::jsonb),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('customerId',s.id,'name',s.name,'city',s.city,
   'reportedOn',s.mix->'reportedOn','stale',s.mix->'stale',
   'fit',case when exists(select 1 from brand_areas where area_code='IMMUNO') then s.mix->'fit' end,
   'packWasteRisk',case when exists(select 1 from brand_areas where area_code='IMMUNO') then s.mix->'packWasteRisk' end,
   'areas',s.areas,'volume',s.volume,'hasOurMachine',s.has_machine)
   ||case when v_financial then jsonb_build_object('brandSalesPaise',coalesce(cs.sales_paise,0))
    else jsonb_build_object('buysBrand',coalesce(cs.sales_paise,0)>0) end
   order by s.has_machine,s.in_house desc,s.volume desc,s.name,s.id)
   from selected s left join customer_sales cs on cs.customer_id=s.id),'[]'::jsonb),
  'total',(select count(*) from filtered),'page',v_page,
  -- Equivalent to get_brand_mapping: include all product sales, even unlinked
  -- customer ledgers; explicit none is mapped (source=item/group), not unmapped.
  'mappedShare',case when v_financial then (select jsonb_build_object(
   'unmappedSalesPaise',coalesce(sum(sales_paise) filter(where source='unmapped'),0),
   'totalSalesPaise',coalesce(sum(sales_paise),0)) from sales) end) into v_result;
 return v_result;
end $$;
revoke all on function private.stockflow_brand_prospects(text,text[],jsonb) from public,anon,authenticated,service_role;

-- Patch only unique seams in the live definition, preserving prior packages.
-- The gateway previously expressed its action list as an elsif chain ending
-- in get_customer_sheet. Make that list explicit at its unique first branch.
do $patch$
declare definition text; old_text text; new_text text;
begin
 definition:=replace(pg_get_functiondef('public.stockflow_customer_map_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
 old_text:=$old$ if p_action='get_not_on_map' then$old$;
 new_text:=$new$ if p_action is null or p_action not in ('get_map_pins','get_not_on_map','get_pin_labs','get_customer_sheet','get_prospects') then
  raise exception 'Unsupported customer map action' using errcode='22023';end if;
 if p_action='get_not_on_map' then$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected customer map action list anchor';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old$ elsif p_action is distinct from 'get_customer_sheet' then$old$;
 new_text:=$new$ elsif p_action='get_prospects' then
  return private.stockflow_brand_prospects(v_actor,v_roles,p_payload);
 elsif p_action is distinct from 'get_customer_sheet' then$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected customer map prospects dispatch anchor';end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;
end $patch$;

commit;
