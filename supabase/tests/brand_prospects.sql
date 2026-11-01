begin;
-- Prefix b4a10000 was searched across supabase/tests before adding this fixture.
-- Local rollback benchmark: 300 candidate labs, 1,900 latest vouchers, 2,600
-- lines, 100 products. Before bounding window_lines: 3,617 ms / 5.35M buffers.
-- After: 74 ms cold, 69 ms warm, 68 ms CLIA page 2 / about 17.4K buffers.
-- Synthetic local timings are not production latency or a full replay pass.
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('brand-prospects-test-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status)
select 'bp-'||r||'@test.local',r,'active' from unnest(array['sales','operations','management','administrator']) r;
insert into private.stockflow_customers(id,name,city,created_by_email)
select ('b4a10000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'BP lab '||lpad(n::text,2,'0'),'BP city','test'
from generate_series(1,25) n;

create function pg_temp.bp_id(n integer) returns uuid language sql as $$
 select ('b4a10000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.bp_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL %',label;end if;end$$;
create function pg_temp.bp_call(payload jsonb default '{"brand":"DIASYS"}',actor text default 'management') returns jsonb language sql as $$
 select public.stockflow_customer_map_gateway('brand-prospects-test-key','bp-'||actor||'@test.local','get_prospects',payload)
$$;
create function pg_temp.bp_error(payload jsonb,expected text,actor text default 'management') returns void language plpgsql as $$
begin
 begin perform pg_temp.bp_call(payload,actor);
 exception when others then
  if sqlstate=expected then
   if actor='operations' and sqlerrm<>'Prospects access required' then raise exception 'BP1 wrong authorization boundary: %',sqlerrm;end if;
   return;
  end if;
  raise;
 end;
 raise exception 'Expected %',expected;
end$$;
create function pg_temp.bp_report(n integer,areas jsonb,suffix text default 'first') returns void language sql as $$
 select public.stockflow_accounts_gateway('brand-prospects-test-key','bp-management@test.local','record_lab_mix',
  jsonb_build_object('customerId',pg_temp.bp_id(n),'areas',areas,'idempotencyKey','BP-lab-report-'||n||'-'||suffix))
$$;
create function pg_temp.bp_map(action text,payload jsonb) returns jsonb language sql as $$
 select public.stockflow_brand_mapping_gateway('brand-prospects-test-key','bp-management@test.local',action,payload)
$$;
-- Gather pages so fixture assertions never depend on ambient customer totals/order.
create function pg_temp.bp_rows(payload jsonb default '{"brand":"DIASYS"}',actor text default 'management') returns jsonb language plpgsql as $$
declare result jsonb:='[]'; response jsonb; page_number integer:=1;
begin
 loop
  response:=pg_temp.bp_call(payload||jsonb_build_object('page',page_number),actor);
  result:=result||(response->'rows');
  exit when page_number*20>=(response->>'total')::integer or page_number=4000;
  page_number:=page_number+1;
 end loop;
 return result;
end$$;
create function pg_temp.bp_line(source text,revision integer,item text,amount bigint,
 kind text default 'sale',cancelled boolean default false,age integer default 0,
 company text default 'BP-company',customer_source text default 'BP-customer') returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values(company,source,revision,(now() at time zone 'Asia/Kolkata')::date-age,customer_source,kind,cancelled,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1','BP-unrelated-tally-guid',case when amount<0 then -1 else 1 end,'Nos',amount,jsonb_build_object('label',item));
end$$;

do $checks$
declare response jsonb; rows_data jsonb; r jsonb; bad jsonb; territory uuid; link uuid;
 n integer; ids uuid[]; before_share jsonb; started timestamptz;
begin
 -- Real assignment path; customer 2 remains unassigned for BP1.
 response:=public.stockflow_accounts_gateway('brand-prospects-test-key','bp-management@test.local','create_territory',
  '{"name":"BP territory","idempotencyKey":"BP-create-territory-command"}');
 territory:=(response#>>'{territory,id}')::uuid;
 perform public.stockflow_accounts_gateway('brand-prospects-test-key','bp-management@test.local','assign_account',
  jsonb_build_object('customerId',pg_temp.bp_id(1),'ownerEmail','bp-sales@test.local','territoryId',territory,
   'expectedVersion',null,'idempotencyKey','BP-assign-account-one'));
 perform pg_temp.bp_report(1,'[{"area":"IMMUNO","status":"in_house","exact":25}]');
 perform pg_temp.bp_report(2,'[{"area":"BIOCHEM","status":"in_house","exact":100}]');
 perform pg_temp.bp_report(3,'[{"area":"HAEM","status":"in_house","exact":20}]');
 perform pg_temp.bp_report(4,'[{"area":"IMMUNO","status":"sends_out"},{"area":"BIOCHEM","status":"not_done"}]');
 perform pg_temp.bp_report(5,'[{"area":"IMMUNO","status":"in_house","exact":14}]');
 perform pg_temp.bp_report(6,'[{"area":"BIOCHEM","status":"in_house","exact":200}]');
 perform pg_temp.bp_report(7,'[{"area":"BIOCHEM","status":"in_house","exact":50}]');
 perform pg_temp.bp_report(7,'[{"area":"HAEM","status":"in_house","exact":20}]','replacement');
 update private.stockflow_customers set active=false where id=pg_temp.bp_id(6);

 perform pg_temp.bp_error('{"brand":"DIASYS"}','PT403','operations');
 response:=pg_temp.bp_call('{"brand":"DIASYS"}','sales');
 perform pg_temp.bp_assert(response->'mappedShare'='null'::jsonb,'BP1 sales mappedShare null');
 perform pg_temp.bp_assert((select count(*)=2 and bool_and(value ? 'buysBrand' and not (value ? 'brandSalesPaise'))
  from jsonb_array_elements(pg_temp.bp_rows('{"brand":"DIASYS"}','sales'))
  where value->>'customerId' in (pg_temp.bp_id(1)::text,pg_temp.bp_id(2)::text)),'BP1 sales both and redaction');
 rows_data:=pg_temp.bp_rows();
 perform pg_temp.bp_assert((select count(*)=2 and bool_and(value ? 'brandSalesPaise' and not (value ? 'buysBrand'))
  from jsonb_array_elements(rows_data) where value->>'customerId' in (pg_temp.bp_id(1)::text,pg_temp.bp_id(2)::text)),'BP1 management both');
 perform pg_temp.bp_assert(pg_temp.bp_call('{}'::jsonb||'{"brand":"DIASYS"}','administrator')->'mappedShare' is not null,'BP1 administrator');
 raise notice 'PASS BP1 roles, all active customers and financial boundary';

 select array_agg((value->>'customerId')::uuid order by ord) into ids
 from jsonb_array_elements(rows_data) with ordinality t(value,ord) where value->>'customerId' like 'b4a10000-%';
 perform pg_temp.bp_assert(ids=array[pg_temp.bp_id(2),pg_temp.bp_id(1),pg_temp.bp_id(5),pg_temp.bp_id(4)],'BP2 candidates/latest/active and BP7 volume order');
 select value into r from jsonb_array_elements(rows_data) where value->>'customerId'=pg_temp.bp_id(4)::text;
 perform pg_temp.bp_assert(r->'areas'='[{"area":"BIOCHEM","name":"Biochemistry","status":"not_done","min":null,"max":null,"exact":false},{"area":"IMMUNO","name":"Hormones / immunoassay","status":"sends_out","min":null,"max":null,"exact":false}]'::jsonb,'BP2 all brand areas in area order');
 select value into r from jsonb_array_elements(rows_data) where value->>'customerId'=pg_temp.bp_id(1)::text;
 perform pg_temp.bp_assert(r->'reportedOn'=private.stockflow_lab_mix_read(pg_temp.bp_id(1))->'reportedOn'
  and r->'stale'=private.stockflow_lab_mix_read(pg_temp.bp_id(1))->'stale','BP2 freshness');
 raise notice 'PASS BP2 candidates, latest report, freshness and area order';

 rows_data:=pg_temp.bp_rows('{"brand":"DIASYS","fit":"clia"}');
 perform pg_temp.bp_assert((select array_agg(value->>'customerId')=array[pg_temp.bp_id(1)::text]
  from jsonb_array_elements(rows_data) where value->>'customerId' like 'b4a10000-%'),'BP3 CLIA filter');
 rows_data:=pg_temp.bp_rows('{"brand":"SYSMEX"}');
 perform pg_temp.bp_assert((select count(*)=2 and bool_and(value->'fit'='null'::jsonb and value->'packWasteRisk'='null'::jsonb)
  from jsonb_array_elements(rows_data) where value->>'customerId' in (pg_temp.bp_id(3)::text,pg_temp.bp_id(7)::text)),'BP3 non-immuno nulls');
 raise notice 'PASS BP3 fit';

 insert into private.stockflow_products(tally_item_key,name,item_group) values
  ('BP-item','BP product','BP group'),('BP-other','BP unmapped product','BP other');
 -- A customer-linked installation is historical; an OMS order installation
 -- cannot carry customer_id under stockflow_installation_origin.
 perform pg_temp.bp_line('installation',1,'BP-item',50000,'sale',false,181,'BP-equipment-company');
 insert into private.stockflow_equipment_installations(customer_id,tally_key,item_name,status,serial_number,scheduled_date,installed_on,historical_sale_line_id,created_by_email)
 select pg_temp.bp_id(2),'BP-item','BP machine','completed','BP-MACHINE-001',current_date,current_date,l.id,'bp-management@test.local'
 from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
 where v.company_id='BP-equipment-company' and v.source_id='installation';
 response:=pg_temp.bp_map('set_equipment_area','{"itemKey":"BP-item","expectedLinkId":null,"areaCode":"IMMUNO","idempotencyKey":"BP-equipment-map-immuno"}');
 link:=(response->>'linkId')::uuid;
 rows_data:=pg_temp.bp_rows();
 select array_agg((value->>'customerId')::uuid order by ord) into ids
 from jsonb_array_elements(rows_data) with ordinality t(value,ord) where value->>'customerId' like 'b4a10000-%';
 perform pg_temp.bp_assert(ids=array[pg_temp.bp_id(1),pg_temp.bp_id(5),pg_temp.bp_id(4),pg_temp.bp_id(2)],'BP4 machine last');
 perform pg_temp.bp_assert((select (value->>'hasOurMachine')::boolean from jsonb_array_elements(rows_data) where value->>'customerId'=pg_temp.bp_id(2)::text),'BP4 machine true');
 response:=pg_temp.bp_map('set_equipment_area',jsonb_build_object('itemKey','BP-item','expectedLinkId',link,'areaCode',null,'idempotencyKey','BP-equipment-clear-immuno'));
 perform pg_temp.bp_assert((select not (value->>'hasOurMachine')::boolean from jsonb_array_elements(pg_temp.bp_rows()) where value->>'customerId'=pg_temp.bp_id(2)::text),'BP4 latest equipment clear wins');
 perform pg_temp.bp_map('set_equipment_area',jsonb_build_object('itemKey','BP-item','expectedLinkId',response->>'linkId','areaCode','IMMUNO','idempotencyKey','BP-equipment-restore-immuno'));
 raise notice 'PASS BP4 latest equipment mapping';

 perform pg_temp.bp_map('set_item_brand','{"itemKey":"BP-item","expectedLinkId":null,"brandCode":"DIASYS","idempotencyKey":"BP-item-brand-map-diasys"}');
 insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
 values('BP-company','BP-customer',pg_temp.bp_id(1),'test'),('BP-company-two','BP-customer',pg_temp.bp_id(2),'test');
 before_share:=pg_temp.bp_call()->'mappedShare';
 perform pg_temp.bp_line('revised',1,'BP-item',99999);
 perform pg_temp.bp_line('revised',2,'BP-item',1000);
 perform pg_temp.bp_line('cancelled',1,'BP-item',99999);
 perform pg_temp.bp_line('cancelled',2,'BP-item',99999,'sale',true);
 perform pg_temp.bp_line('return',1,'BP-item',-100,'return');
 perform pg_temp.bp_line('credit',1,'BP-item',-50,'credit');
 perform pg_temp.bp_line('boundary',1,'BP-item',200,'sale',false,180);
 perform pg_temp.bp_line('old',1,'BP-item',99999,'sale',false,181);
 perform pg_temp.bp_line('future',1,'BP-item',99999,'sale',false,-1);
 perform pg_temp.bp_line('moved',1,'BP-item',99999);
 perform pg_temp.bp_line('moved',2,'BP-item',99999,'sale',false,181);
 perform pg_temp.bp_line('purchase',1,'BP-item',99999,'purchase');
 perform pg_temp.bp_line('unmapped',1,'BP-other',300);
 perform pg_temp.bp_line('other-company',1,'BP-other',20,'sale',false,0,'BP-company-two');
 perform pg_temp.bp_line('unlinked',1,'BP-item',30,'sale',false,0,'BP-company','BP-unlinked');
 rows_data:=pg_temp.bp_rows();
 perform pg_temp.bp_assert((select (value->>'brandSalesPaise')::numeric=1050 from jsonb_array_elements(rows_data) where value->>'customerId'=pg_temp.bp_id(1)::text),'BP5 attributed sales');
 perform pg_temp.bp_assert((select (value->>'brandSalesPaise')::numeric=0 from jsonb_array_elements(rows_data) where value->>'customerId'=pg_temp.bp_id(2)::text),'BP5 company identity and zero');
 perform pg_temp.bp_assert((select value->'buysBrand'='true'::jsonb and not (value ? 'brandSalesPaise') from jsonb_array_elements(pg_temp.bp_rows('{"brand":"DIASYS"}','sales')) where value->>'customerId'=pg_temp.bp_id(1)::text),'BP5 sales boolean');
 response:=pg_temp.bp_call()->'mappedShare';
 perform pg_temp.bp_assert((response->>'unmappedSalesPaise')::numeric-(before_share->>'unmappedSalesPaise')::numeric=320
  and (response->>'totalSalesPaise')::numeric-(before_share->>'totalSalesPaise')::numeric=1400,'BP5 fixture mapped-share deltas including unlinked');
 -- Assign the zero-sales customer after BP1 verifies scope is assignment independent.
 perform public.stockflow_accounts_gateway('brand-prospects-test-key','bp-management@test.local','assign_account',
  jsonb_build_object('customerId',pg_temp.bp_id(2),'ownerEmail','bp-sales@test.local','territoryId',territory,
   'expectedVersion',null,'idempotencyKey','BP-assign-account-two'));
 perform pg_temp.bp_assert((select value->'buysBrand'='false'::jsonb from jsonb_array_elements(pg_temp.bp_rows('{"brand":"DIASYS"}','sales')) where value->>'customerId'=pg_temp.bp_id(2)::text),'BP5 zero buysBrand false');
 raise notice 'PASS BP5 latest sales, dates, label join and company/customer attribution';

 foreach bad in array array['{}'::jsonb,'[]'::jsonb,'{"brand":"UNKNOWN"}'::jsonb,'{"brand":"DIASYS","fit":"bad"}'::jsonb,
  '{"brand":"DIASYS","fit":null}'::jsonb,'{"brand":"DIASYS","page":0}'::jsonb,'{"brand":"DIASYS","page":4001}'::jsonb,
  '{"brand":"DIASYS","page":1.5}'::jsonb,'{"brand":"DIASYS","page":"1"}'::jsonb,'{"brand":"DIASYS","page":null}'::jsonb,
  '{"brand":"DIASYS","extra":true}'::jsonb] loop
  perform pg_temp.bp_error(bad,'22023');
 end loop;
 raise notice 'PASS BP6 strict validation';

 -- 18 cheap mix-only reports bring our DIASYS candidates to 22, without ambient totals.
 started:=clock_timestamp();
 for n in 8..25 loop
  perform pg_temp.bp_report(n,jsonb_build_array(jsonb_build_object('area','BIOCHEM','status','in_house','exact',n)));
 end loop;
 rows_data:=pg_temp.bp_rows();
 perform pg_temp.bp_assert((select count(*)=22 from jsonb_array_elements(rows_data) where value->>'customerId' like 'b4a10000-%'),'BP7 fixture paging count');
 response:=pg_temp.bp_call('{"brand":"DIASYS","page":2}');
 perform pg_temp.bp_assert((response->>'page')::integer=2 and jsonb_array_length(response->'rows')<=20,'BP7 second page');
 perform pg_temp.bp_assert((select count(*)>=2 from jsonb_array_elements(rows_data) where value->>'customerId' like 'b4a10000-%'
  and not (pg_temp.bp_call()->'rows' @> jsonb_build_array(value))),'BP7 fixtures beyond first page');
 raise notice 'PASS BP7 paging; fixture reports and reads took % ms',extract(epoch from clock_timestamp()-started)*1000;
end $checks$;
rollback;
