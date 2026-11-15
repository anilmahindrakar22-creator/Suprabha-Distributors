begin;
set local statement_timeout='300s';
set local lock_timeout='60s';
-- BL4 fixtures use the gb- / GB_ prefix and generic names only.

create function pg_temp.gb_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Growth brands assertion failed: %',label;end if;end$$;

create function pg_temp.gb_line(src text,item text,qty numeric,net bigint,d date default '2030-08-10',
 kind text default 'sale',label text default null) returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values('gb-co',src,1,d,case when kind='purchase' then null else 'gb-lab' end,kind,false,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1',item,qty,'pack',net,case when label is null then '{}'::jsonb else jsonb_build_object('label',label) end);
end$$;

create function pg_temp.gb_call(payload jsonb default '{}',actor text default 'management') returns jsonb language sql as $$
 select public.stockflow_growth_gateway('growth-brands-key','gb-'||actor||'@test.local','get_growth_brands',payload)
$$;
create function pg_temp.gb_row(result jsonb,row_key text) returns jsonb language sql as $$
 select value from jsonb_array_elements(result->'rows') where value->>'key'=row_key
$$;
create function pg_temp.gb_line_of(result jsonb,row_key text,line_kind text,line_group text) returns jsonb language sql as $$
 select value from jsonb_array_elements(pg_temp.gb_row(result,row_key)->'lines')
 where value->>'kind'=line_kind and value->>'group' is not distinct from line_group
$$;
-- The measures of a row or a line, without its identity keys.
create function pg_temp.gb_measures(entry jsonb) returns jsonb language sql as $$
 select entry-array['key','kind','brandCode','name','lines','group','areaCode']
$$;

insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('growth-brands-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status)
select 'gb-'||r||'@test.local',r,array[r],'active'
from unnest(array['administrator','management','sales','operations']) r;

-- The gateway reads a fixed day: window 2030-07-01 to 2031-07-01, H2 from 2031-01-01.
do $clock$
declare f text;
begin
 select pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure) into f;
 execute replace(f,'(now() at time zone ''Asia/Kolkata'')::date','''2031-07-15''::date');
end$clock$;

do $empty$
declare r jsonb;
begin
 if exists(select 1 from private.stockflow_growth_costed_lines('2031-07-15')) then
  raise exception 'Growth brands precondition: the fixed window already holds sales lines';end if;
 r:=pg_temp.gb_call();
 perform pg_temp.gb_assert(r->'window'='{"from":"2030-07-01","to":"2031-07-01","h2From":"2031-01-01"}'::jsonb,'empty window bounds');
 perform pg_temp.gb_assert(r->'totals'='{"salesPaise":0,"instrumentSalesPaise":0,"consumablesSalesPaise":0,
  "knownSalesPaise":0,"gpPaise":0,"marginPct":null}'::jsonb,'empty totals');
 perform pg_temp.gb_assert(jsonb_array_length(r->'rows')=2 and r#>>'{rows,0,key}'='none' and r#>>'{rows,1,key}'='unmapped'
  and r#>'{rows,0,lines}'='[]'::jsonb and r#>'{rows,1,lines}'='[]'::jsonb
  and pg_temp.gb_measures(r#>'{rows,0}')=pg_temp.gb_measures(r#>'{rows,1}')
  and pg_temp.gb_measures(r#>'{rows,0}')='{"salesPaise":0,"h1Paise":0,"h2Paise":0,"instrumentSalesPaise":0,
   "consumablesSalesPaise":0,"knownSalesPaise":0,"gpPaise":0,"marginPct":null,"items":0}'::jsonb,'B12 empty none and unmapped rows');
 raise notice 'PASS empty window';
end$empty$;

do $fixture$
declare seen_at timestamptz;
begin
 insert into private.stockflow_brands(code,name,created_by) values('GB_ALPHA','Brand Alpha','test'),('GB_BETA','Brand Beta','test');
 -- The group tree reads the latest catalog overall, so this one must be the newest.
 select coalesce(max(observed_at),now())+interval '1 day' into seen_at from private.stockflow_economic_item_catalogs;
 insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content) values
  ('gb-co','gb-old',seen_at-interval '1 hour','{"products":[{"id":"gb-1","name":"Item 1 old name"}],"groups":[]}'),
  ('gb-co','gb-new',seen_at,'{"products":[
    {"id":"gb-1","name":"Item 1"},{"id":"gb-2","name":"Item 2"},{"id":"gb-3","name":"Item 3"},
    {"id":"gb-4","name":"Item 4"},{"id":"gb-5","name":"Item 5"},{"id":"gb-6","name":"Item 6"},
    {"id":"gb-7","name":"Item 7"},{"id":"gb-9","name":"Item 9"}],
   "groups":[
    {"id":"gb-g-alpha","name":"Principal Alpha","parentId":null},
    {"id":"gb-g-a1","name":"Line A1","parentId":"gb-g-alpha"},
    {"id":"gb-g-a2","name":"Line A2","parentId":"gb-g-alpha"},
    {"id":"gb-g-none","name":"Principal None","parentId":null},
    {"id":"gb-g-open","name":"Principal Open","parentId":null}]}');
 -- Item 6 has a catalog name and no product row. gb-8 has no catalog name.
 insert into private.stockflow_products(tally_item_key,name,item_group) values
  ('Item 1','Item 1','Principal Alpha'),('Item 2','Item 2','Line A1'),('Item 3','Item 3','Line A2'),
  ('Item 4','Item 4','Line A1'),('Item 5','Item 5','Principal None'),('Item 7','Item 7','Principal Open'),
  ('Item 9','Item 9','Line A1');
 insert into private.stockflow_brand_group_links(item_group,kind,brand_code,recorded_by) values
  ('Principal Alpha','brand','GB_ALPHA','test'),('Line A2','brand','GB_BETA','test'),('Principal None','none',null,'test');
 insert into private.stockflow_brand_item_links(tally_item_key,kind,brand_code,recorded_by) values('Item 4','brand','GB_BETA','test');

 -- Costs: 50000 a pack for items 1, 2, 4 and 5; 3000000 for the instrument; none for 3, 6, 7 and 8.
 perform pg_temp.gb_line('buy-1','gb-1',10,500000,'2020-01-01','purchase');
 perform pg_temp.gb_line('buy-2','gb-2',10,500000,'2020-01-01','purchase');
 perform pg_temp.gb_line('buy-4','gb-4',10,500000,'2020-01-01','purchase');
 perform pg_temp.gb_line('buy-5','gb-5',10,500000,'2020-01-01','purchase');
 perform pg_temp.gb_line('buy-9','gb-9',10,30000000,'2020-01-01','purchase');
 perform pg_temp.gb_line('s-1-h1','gb-1',2,200000);
 perform pg_temp.gb_line('s-1-h2','gb-1',1,150000,'2031-02-10');
 perform pg_temp.gb_line('s-2-h1','gb-2',1,100000);
 perform pg_temp.gb_line('s-3-h1','gb-3',1,300000);
 perform pg_temp.gb_line('s-4-h2','gb-4',1,80000,'2031-02-10');
 perform pg_temp.gb_line('s-5-h1','gb-5',4,400000);
 perform pg_temp.gb_line('s-6-h1','gb-6',1,40000);
 perform pg_temp.gb_line('s-7-h2','gb-7',1,30000,'2031-01-01');
 perform pg_temp.gb_line('s-8-h1','gb-8',1,20000,'2030-12-31');
 perform pg_temp.gb_line('s-9-h2','gb-9',1,4000000,'2031-02-10');
 -- After the window and inside the 180 day Data health read: one inherited item, one unmapped item.
 perform pg_temp.gb_line('h-2','gb-2',1,70000,'2031-07-05','sale','Item 2');
 perform pg_temp.gb_line('h-7','gb-7',1,70000,'2031-07-05','sale','Item 7');
end$fixture$;

do $checks$
declare today date:='2031-07-15'; r jsonb; entry jsonb; line jsonb; field text; n numeric;
 started timestamptz; elapsed interval;
begin
 started:=clock_timestamp();r:=pg_temp.gb_call();elapsed:=clock_timestamp()-started;
 raise notice 'get_growth_brands duration %',elapsed;
 perform pg_temp.gb_assert(elapsed<interval '2 seconds','read under 2 seconds');
 perform pg_temp.gb_assert(r=private.stockflow_growth_brands_read(today),'gateway returns the private read');
 perform pg_temp.gb_assert(r->'window'='{"from":"2030-07-01","to":"2031-07-01","h2From":"2031-01-01"}'::jsonb
  and (select array_agg(k order by k)=array['rows','totals','window'] from jsonb_object_keys(r) k),'response shape');

 -- B1: a brand on a top group; its own items are direct, the subgroup is an inherited line.
 entry:=pg_temp.gb_row(r,'brand:GB_ALPHA');
 perform pg_temp.gb_assert(entry->>'kind'='brand' and entry->>'brandCode'='GB_ALPHA' and entry->>'name'='Brand Alpha','B1 brand row identity');
 perform pg_temp.gb_assert(pg_temp.gb_measures(entry)='{"salesPaise":4450000,"h1Paise":300000,"h2Paise":4150000,
  "instrumentSalesPaise":4000000,"consumablesSalesPaise":450000,"knownSalesPaise":450000,"gpPaise":250000,
  "marginPct":55.6,"items":3}'::jsonb,'B1 brand row measures');
 perform pg_temp.gb_assert(entry->'lines'='[
  {"kind":"line","group":"Line A1","areaCode":null,"salesPaise":4100000,"h1Paise":100000,"h2Paise":4000000,
   "instrumentSalesPaise":4000000,"consumablesSalesPaise":100000,"knownSalesPaise":100000,"gpPaise":50000,"marginPct":50.0,"items":2},
  {"kind":"direct","group":"Principal Alpha","areaCode":null,"salesPaise":350000,"h1Paise":200000,"h2Paise":150000,
   "instrumentSalesPaise":0,"consumablesSalesPaise":350000,"knownSalesPaise":350000,"gpPaise":200000,"marginPct":57.1,"items":1}
  ]'::jsonb,'B1 direct and inherited line, by sales');
 -- Every brand and none row is exactly the sum of its lines; unmapped has no lines.
 for entry in select value from jsonb_array_elements(r->'rows') loop
  if entry->>'kind'='unmapped' then
   perform pg_temp.gb_assert(entry->'lines'='[]'::jsonb,'B1 unmapped has no lines');
  else
   foreach field in array array['salesPaise','h1Paise','h2Paise','instrumentSalesPaise','consumablesSalesPaise','knownSalesPaise','gpPaise','items'] loop
    select coalesce(sum((value->>field)::numeric),0) into n from jsonb_array_elements(entry->'lines');
    perform pg_temp.gb_assert(n=(entry->>field)::numeric,'B1 lines sum to row '||(entry->>'key')||' '||field);
   end loop;
  end if;
 end loop;
 raise notice 'PASS B1 direct and line';

 -- B2: a line linked to another brand than its top group sits under the line's brand.
 entry:=pg_temp.gb_row(r,'brand:GB_BETA');
 perform pg_temp.gb_assert(entry->>'name'='Brand Beta' and pg_temp.gb_measures(entry)='{"salesPaise":380000,"h1Paise":300000,"h2Paise":80000,
  "instrumentSalesPaise":0,"consumablesSalesPaise":380000,"knownSalesPaise":80000,"gpPaise":30000,"marginPct":37.5,"items":2}'::jsonb,'B2 brand row');
 perform pg_temp.gb_assert(entry#>'{lines,0}'='{"kind":"line","group":"Line A2","areaCode":null,"salesPaise":300000,"h1Paise":300000,"h2Paise":0,
  "instrumentSalesPaise":0,"consumablesSalesPaise":300000,"knownSalesPaise":0,"gpPaise":0,"marginPct":null,"items":1}'::jsonb,'B2 line under its own brand');
 perform pg_temp.gb_assert(pg_temp.gb_line_of(r,'brand:GB_ALPHA','line','Line A2') is null,'B2 line left its top group brand');
 raise notice 'PASS B2 line brand';

 -- B3: an item override is an individual line under the other brand, without group or area.
 perform pg_temp.gb_assert(jsonb_array_length(entry->'lines')=2 and entry#>'{lines,1}'='{"kind":"individual","group":null,"areaCode":null,
  "salesPaise":80000,"h1Paise":0,"h2Paise":80000,"instrumentSalesPaise":0,"consumablesSalesPaise":80000,"knownSalesPaise":80000,
  "gpPaise":30000,"marginPct":37.5,"items":1}'::jsonb,'B3 individual line');
 raise notice 'PASS B3 item override';

 -- B4: an explicit none group link is the none row.
 entry:=pg_temp.gb_row(r,'none');
 perform pg_temp.gb_assert(entry->>'kind'='none' and entry->'brandCode'='null'::jsonb and entry->>'name'='Not a principal product'
  and entry->'lines'='[{"kind":"direct","group":"Principal None","areaCode":null,"salesPaise":400000,"h1Paise":400000,"h2Paise":0,
   "instrumentSalesPaise":0,"consumablesSalesPaise":400000,"knownSalesPaise":400000,"gpPaise":200000,"marginPct":50.0,"items":1}]'::jsonb,'B4 none row');
 raise notice 'PASS B4 explicit none';

 -- B5: no product row, no catalog name and a group without a link are all unmapped.
 entry:=pg_temp.gb_row(r,'unmapped');
 perform pg_temp.gb_assert(entry->>'kind'='unmapped' and entry->'brandCode'='null'::jsonb and entry->>'name'='Not mapped'
  and pg_temp.gb_measures(entry)='{"salesPaise":90000,"h1Paise":60000,"h2Paise":30000,"instrumentSalesPaise":0,
   "consumablesSalesPaise":90000,"knownSalesPaise":0,"gpPaise":0,"marginPct":null,"items":3}'::jsonb,'B5 unmapped row');
 raise notice 'PASS B5 unmapped';

 -- B6: the instrument counts in sales and instrument sales only; margin is consumables only.
 line:=pg_temp.gb_line_of(r,'brand:GB_ALPHA','line','Line A1');
 perform pg_temp.gb_assert((line->>'salesPaise')::numeric=4100000 and (line->>'instrumentSalesPaise')::numeric=4000000
  and (line->>'consumablesSalesPaise')::numeric=100000 and (line->>'knownSalesPaise')::numeric=100000
  and (line->>'gpPaise')::numeric=50000 and (line->>'marginPct')::numeric=50.0,'B6 instrument outside margin');
 perform pg_temp.gb_assert(r->'totals'='{"salesPaise":5320000,"instrumentSalesPaise":4000000,"consumablesSalesPaise":1320000,
  "knownSalesPaise":930000,"gpPaise":480000,"marginPct":51.6}'::jsonb,'B6 totals');
 raise notice 'PASS B6 instrument';

 -- B7: the halves split at h2From (2031-01-01 is H2, 2030-12-31 is H1) and add up everywhere.
 for entry in select value from jsonb_array_elements(r->'rows')
  union all select l from jsonb_array_elements(r->'rows') e,jsonb_array_elements(e->'lines') l loop
  perform pg_temp.gb_assert((entry->>'h1Paise')::numeric+(entry->>'h2Paise')::numeric=(entry->>'salesPaise')::numeric
   and (entry->>'instrumentSalesPaise')::numeric+(entry->>'consumablesSalesPaise')::numeric=(entry->>'salesPaise')::numeric,'B7 halves add up');
 end loop;
 raise notice 'PASS B7 halves';

 -- B8: identities against the GP read and the margin model; every paise value is an integer.
 select sum((value->>'salesPaise')::numeric) into n from jsonb_array_elements(r->'rows');
 perform pg_temp.gb_assert(n=(r#>>'{totals,salesPaise}')::numeric
  and n=round((private.stockflow_growth_gp(today)->'window'->>'salesPaise')::numeric),'B8 sales identity');
 foreach field in array array['instrumentSalesPaise','consumablesSalesPaise','knownSalesPaise','gpPaise'] loop
  select sum((value->>field)::numeric) into n from jsonb_array_elements(r->'rows');
  perform pg_temp.gb_assert(n=(r->'totals'->>field)::numeric,'B8 totals equal rows '||field);
 end loop;
 perform pg_temp.gb_assert(r#>'{totals,marginPct}'=private.stockflow_growth_margin_model(today)->'consumablesMarginPct'
  and r#>>'{totals,marginPct}'=private.stockflow_growth_margin_model(today)->>'consumablesMarginPct','B8 margin model identity');
 select count(*) into n from (
  select t.value from jsonb_each(r->'totals') t where t.key like '%Paise'
  union all select t.value from jsonb_array_elements(r->'rows') e,jsonb_each(e) t where t.key like '%Paise'
  union all select t.value from jsonb_array_elements(r->'rows') e,jsonb_array_elements(e->'lines') l,jsonb_each(l) t where t.key like '%Paise'
 ) v where jsonb_typeof(v.value) is distinct from 'number' or (v.value::text)::numeric<>trunc((v.value::text)::numeric)
  or v.value::text !~ '^-?[0-9]+$';
 perform pg_temp.gb_assert(n=0,'B8 integer paise');
 perform pg_temp.gb_assert(private.stockflow_growth_integer_paise(r)=r,'B8 gateway rounding is a no-op');
 raise notice 'PASS B8 identities';

 -- B12: brands by sales, then none, then unmapped, although none outsells Brand Beta.
 perform pg_temp.gb_assert((select array_agg(value->>'key' order by ordinality)=array['brand:GB_ALPHA','brand:GB_BETA','none','unmapped']
  from jsonb_array_elements(r->'rows') with ordinality),'B12 row order');
 perform pg_temp.gb_assert((pg_temp.gb_row(r,'none')->>'salesPaise')::numeric>(pg_temp.gb_row(r,'brand:GB_BETA')->>'salesPaise')::numeric,'B12 none outsells a brand');
 raise notice 'PASS B12 order';

 -- B9: the latest group area shows on line and direct lines only; a later null clears it.
 insert into private.stockflow_group_area_links(item_group,area_code,recorded_by) values('Line A1','HAEM','test');
 r:=pg_temp.gb_call();
 perform pg_temp.gb_assert(pg_temp.gb_line_of(r,'brand:GB_ALPHA','line','Line A1')->>'areaCode'='HAEM','B9 area on the line');
 perform pg_temp.gb_assert(pg_temp.gb_line_of(r,'brand:GB_BETA','individual',null)->'areaCode'='null'::jsonb
  and pg_temp.gb_line_of(r,'brand:GB_ALPHA','direct','Principal Alpha')->'areaCode'='null'::jsonb,'B9 no area elsewhere');
 insert into private.stockflow_group_area_links(item_group,area_code,recorded_by) values('Line A1',null,'test');
 r:=pg_temp.gb_call();
 perform pg_temp.gb_assert(pg_temp.gb_line_of(r,'brand:GB_ALPHA','line','Line A1')->'areaCode'='null'::jsonb,'B9 null clears the area');
 raise notice 'PASS B9 area';

 -- B10: exact empty payload, management or administrator only, private function not exposed.
 for entry in select value from jsonb_array_elements('[{"x":1},{"page":1},[],null,"",0]'::jsonb) loop
  begin perform pg_temp.gb_call(entry);raise exception 'B10 accepted payload %',entry;
  exception when sqlstate '22023' then null;end;
 end loop;
 begin perform pg_temp.gb_call(null);raise exception 'B10 accepted a null payload';
 exception when sqlstate '22023' then null;end;
 foreach field in array array['sales','operations'] loop
  begin perform pg_temp.gb_call('{}',field);raise exception 'B10 unauthorized role %',field;
  exception when sqlstate 'PT403' then null;end;
 end loop;
 begin perform pg_temp.gb_call('{}','missing');raise exception 'B10 unknown member accepted';
 exception when sqlstate 'PT403' then null;end;
 perform pg_temp.gb_assert(pg_temp.gb_call('{}','administrator')=r,'B10 administrator read');
 foreach field in array array['public','anon','authenticated','service_role'] loop
  perform pg_temp.gb_assert(not has_function_privilege(field,'private.stockflow_growth_brands_read(date)','execute'),'B10 private ACL '||field);
 end loop;
 perform pg_temp.gb_assert(has_function_privilege('service_role','public.stockflow_growth_gateway(text,text,text,jsonb)','execute')
  and not has_function_privilege('anon','public.stockflow_growth_gateway(text,text,text,jsonb)','execute')
  and not has_function_privilege('authenticated','public.stockflow_growth_gateway(text,text,text,jsonb)','execute'),'B10 gateway ACL');
 raise notice 'PASS B10 gateway';

 -- B11: Data health counts an inherited link as mapped: one inherited and one unmapped item, equal sales.
 perform pg_temp.gb_assert((select m.source from private.stockflow_item_brand_map() m where m.tally_item_key='Item 2')='inherited'
  and (select m.source from private.stockflow_item_brand_map() m where m.tally_item_key='Item 7')='unmapped','B11 fixture sources');
 perform pg_temp.gb_assert(private.stockflow_growth_read(today,array['management'])->'health'->'itemGroups'->>'unmappedPct'='50.0','B11 inherited counts as mapped');
 raise notice 'PASS B11 data health';
end $checks$;

rollback;
do $$begin
 if exists(select 1 from private.stockflow_economic_source_vouchers where company_id='gb-co') then
  raise exception 'Growth brands fixture leaked';end if;
 raise notice 'PASS growth brands B1-B12';
end$$;
