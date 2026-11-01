begin;
-- Isolated fixture prefix: b3a10000 (including all concurrency fixtures checked).
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('brand-mapping-test-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status)
select 'bm-'||r||'@test.local',r,'active' from unnest(array['sales','operations','management','administrator']) r;
insert into private.stockflow_products(id,tally_item_key,name,item_group)
select ('b3a10000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'BM-test-'||n,'BM fixture '||lpad(n::text,2,'0'),
 case when n<=2 then 'BM test group' when n=3 then E'\u0004 BM Primary' else 'BM unmapped group' end
from generate_series(1,25) n;
insert into private.stockflow_products(tally_item_key,name,item_group,active)
values('BM-test-inactive','BM fixture inactive','BM inactive group',false);
insert into private.stockflow_orders(id,customer_name,idempotency_key,created_by_email,updated_by_email)
values('b3a10000-0000-4000-8000-000000000100','BM fixture customer','BM-fixture-order-100','bm-management@test.local','bm-management@test.local');
insert into private.stockflow_equipment_installations(order_id,tally_key,item_name,scheduled_date,created_by_email)
values('b3a10000-0000-4000-8000-000000000100','BM-test-1','BM installation fallback',current_date,'bm-management@test.local'),
 ('b3a10000-0000-4000-8000-000000000100','BM-installed-only','BM installed only',current_date,'bm-management@test.local');

create function pg_temp.bm_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL %',label;end if;end$$;
create function pg_temp.bm_call(action text,payload jsonb default '{}',actor text default 'management') returns jsonb language sql as $$
 select public.stockflow_brand_mapping_gateway('brand-mapping-test-key','bm-'||actor||'@test.local',action,payload)
$$;
create function pg_temp.bm_error(action text,payload jsonb,expected text,actor text default 'management') returns void language plpgsql as $$
begin
 begin perform pg_temp.bm_call(action,payload,actor);
 exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected % for %',expected,action;
end$$;
create function pg_temp.bm_line(source text,revision integer,item text,amount bigint,
 kind text default 'sale',cancelled boolean default false,age integer default 0) returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values('BM-test-company',source,revision,(now() at time zone 'Asia/Kolkata')::date-age,'BM-customer',kind,cancelled,'{}') returning id into voucher;
 -- product_id deliberately does not match the product UUID or key.
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1','BM-tally-guid',case when amount<0 then -1 else 1 end,'Nos',amount,jsonb_build_object('label',item));
end$$;

do $checks$
declare actor text; action text; result jsonb; payload jsonb; first_id uuid; next_id uuid;
 before_read jsonb; after_read jsonb; row_data jsonb; n bigint; t text; operation text; denied boolean;
 today date:=(now() at time zone 'Asia/Kolkata')::date; previous_sales numeric; current_sales numeric;
begin
 -- BM1: authorization precedes validation and replay for every entry point.
 foreach actor in array array['sales','operations'] loop
  foreach action in array array['get_brand_mapping','set_group_brand','set_item_brand','set_equipment_area','add_brand'] loop
   perform pg_temp.bm_error(action,'{}','PT403',actor);
  end loop;
 end loop;
 perform pg_temp.bm_call('get_brand_mapping');
 perform pg_temp.bm_call('get_brand_mapping','{}','administrator');
 raise notice 'PASS BM1 roles';

 -- BM2 and BM9: optimistic concurrency and idempotency on the same command path.
 payload:=jsonb_build_object('group','BM test group','expectedLinkId',null,'brandCode','SYSMEX','idempotencyKey','BM-group-first-command');
 result:=pg_temp.bm_call('set_group_brand',payload);first_id:=(result->>'linkId')::uuid;
 select count(*) into n from private.stockflow_brand_group_links where item_group='BM test group';
 perform pg_temp.bm_assert(pg_temp.bm_call('set_group_brand',payload)=result,'BM9 exact replay');
 perform pg_temp.bm_assert((select count(*)=n from private.stockflow_brand_group_links where item_group='BM test group'),'BM9 no extra row');
 perform pg_temp.bm_error('set_group_brand',payload,'PT403','sales');
 perform pg_temp.bm_assert((select count(*)=2 and bool_and(brand_code='SYSMEX' and source='group') from private.stockflow_item_brand_map() where tally_item_key in ('BM-test-1','BM-test-2')),'BM2 group mapping');
 perform pg_temp.bm_error('set_group_brand',payload||'{"idempotencyKey":"BM-stale-group-command"}','PT409');
 result:=pg_temp.bm_call('set_group_brand',payload||jsonb_build_object('expectedLinkId',first_id,'brandCode',null,'idempotencyKey','BM-group-none-command'));
 next_id:=(result->>'linkId')::uuid;
 perform pg_temp.bm_assert((select kind='none' and brand_code is null from private.stockflow_brand_group_links where id=next_id),'BM2 none row');
 perform pg_temp.bm_assert((select source='group' and brand_code is null from private.stockflow_item_brand_map() where tally_item_key='BM-test-1'),'BM2 none is mapped');
 raise notice 'PASS BM2 group mapping and BM9 idempotency';

 -- BM3: clearing is an append-only inherit record, not an explicit none.
 payload:=jsonb_build_object('itemKey','BM-test-1','expectedLinkId',null,'brandCode','ARKRAY','idempotencyKey','BM-item-first-command');
 result:=pg_temp.bm_call('set_item_brand',payload);first_id:=(result->>'linkId')::uuid;
 perform pg_temp.bm_assert((select source='item' and brand_code='ARKRAY' from private.stockflow_item_brand_map() where tally_item_key='BM-test-1'),'BM3 override');
 perform pg_temp.bm_error('set_item_brand',payload||'{"idempotencyKey":"BM-item-stale-command"}','PT409');
 result:=pg_temp.bm_call('set_item_brand',(payload-'brandCode')||jsonb_build_object('clear',true,'expectedLinkId',first_id,'idempotencyKey','BM-item-clear-command'));
 perform pg_temp.bm_assert((select kind='inherit' and brand_code is null from private.stockflow_brand_item_links where id=(result->>'linkId')::uuid),'BM3 inherit row');
 perform pg_temp.bm_assert((select source='group' and brand_code is null from private.stockflow_item_brand_map() where tally_item_key='BM-test-1'),'BM3 fall back');
 raise notice 'PASS BM3 override and clear';

 -- BM4: compare fixture-only helper rows, with both date boundaries and revisions.
 before_read:=pg_temp.bm_call('get_brand_mapping');
 perform pg_temp.bm_line('revision',1,'BM-test-1',99999);
 perform pg_temp.bm_line('revision',2,'BM-test-1',1000);
 perform pg_temp.bm_line('return',1,'BM-test-1',-100,'return');
 perform pg_temp.bm_line('credit',1,'BM-test-1',-50,'credit');
 perform pg_temp.bm_line('cancelled',1,'BM-test-1',99999);
 perform pg_temp.bm_line('cancelled',2,'BM-test-1',99999,'sale',true);
 perform pg_temp.bm_line('old',1,'BM-test-1',99999,'sale',false,181);
 perform pg_temp.bm_line('boundary',1,'BM-test-1',200,'sale',false,180);
 perform pg_temp.bm_line('future',1,'BM-test-1',99999,'sale',false,-1);
  perform pg_temp.bm_line('moved-out',1,'BM-test-1',99999);
  perform pg_temp.bm_line('moved-out',2,'BM-test-1',99999,'sale',false,181);
  perform pg_temp.bm_line('purchase',1,'BM-test-1',99999,'purchase');
 perform pg_temp.bm_line('primary',1,'BM-test-3',500);
 perform pg_temp.bm_line('unmapped',1,'BM-test-4',300);
 perform pg_temp.bm_assert((select sales_paise=1050 and lines=4 from private.stockflow_brand_sales_180(today) where tally_item_key='BM-test-1'),'BM4 label sales and window');
 raise notice 'PASS BM4 label joins, latest revisions and window';

 -- BM5: assert fixture-only group ordering and deltas, never ambient totals.
 after_read:=pg_temp.bm_call('get_brand_mapping','{"q":"BM fixture","page":1}');
 perform pg_temp.bm_assert((after_read->>'unmappedSalesPaise')::numeric-(before_read->>'unmappedSalesPaise')::numeric=800,'BM5 unmapped fixture delta');
 perform pg_temp.bm_assert((after_read->>'totalSalesPaise')::numeric-(before_read->>'totalSalesPaise')::numeric=1850,'BM5 total fixture delta');
 perform pg_temp.bm_assert((after_read->>'total')::int=23 and jsonb_array_length(after_read->'items')=20,'BM5 first page');
 result:=pg_temp.bm_call('get_brand_mapping','{"q":"BM fixture","page":2}');
 perform pg_temp.bm_assert(jsonb_array_length(result->'items')=3,'BM5 second page');
 result:=pg_temp.bm_call('get_brand_mapping','{"q":"BM fixture 03"}');
 perform pg_temp.bm_assert((result->>'total')::int=1 and result#>>'{items,0,itemKey}'='BM-test-3','BM5 q filter');
 perform pg_temp.bm_assert((select value->>'label'='BM Primary' from jsonb_array_elements(after_read->'groups') where value->>'group'=E'\u0004 BM Primary'),'BM5 clean label');
 previous_sales:=null;
 for row_data in select value from jsonb_array_elements(after_read->'groups') where value->>'group' in ('BM test group',E'\u0004 BM Primary','BM unmapped group') loop
  current_sales:=(row_data->>'salesPaise')::numeric;
  perform pg_temp.bm_assert(previous_sales is null or previous_sales>=current_sales,'BM5 group sales order');
  previous_sales:=current_sales;
 end loop;
 perform pg_temp.bm_assert((select value->>'name'='BM fixture 01' from jsonb_array_elements(after_read->'equipment') where value->>'itemKey'='BM-test-1'),'BM5 product equipment name');
 perform pg_temp.bm_assert((select value->>'name'='BM installed only' from jsonb_array_elements(after_read->'equipment') where value->>'itemKey'='BM-installed-only'),'BM5 installation fallback');
 raise notice 'PASS BM5 read, ordering, labels, paging and fixture deltas';

 -- Explicit item none removes only its fixture sales from unmapped; inherit restores them.
 payload:=jsonb_build_object('itemKey','BM-test-4','expectedLinkId',null,'brandCode',null,'idempotencyKey','BM-item-none-command');
 result:=pg_temp.bm_call('set_item_brand',payload);first_id:=(result->>'linkId')::uuid;
 perform pg_temp.bm_assert((select source='item' and brand_code is null from private.stockflow_item_brand_map() where tally_item_key='BM-test-4'),'BM3 item none');
 before_read:=pg_temp.bm_call('get_brand_mapping');
 perform pg_temp.bm_assert((after_read->>'unmappedSalesPaise')::numeric-(before_read->>'unmappedSalesPaise')::numeric=300,'BM5 explicit item none delta');
 perform pg_temp.bm_call('set_item_brand',(payload-'brandCode')||jsonb_build_object('clear',true,'expectedLinkId',first_id,'idempotencyKey','BM-item-inherit-unmapped'));
 perform pg_temp.bm_assert((select source='unmapped' and brand_code is null from private.stockflow_item_brand_map() where tally_item_key='BM-test-4'),'BM3 inherit without group');
 -- Timestamp ties use descending UUID, independently of insertion order.
 insert into private.stockflow_brand_item_links(id,tally_item_key,kind,brand_code,recorded_by,recorded_at) values
  ('b3a10000-0000-4000-8000-000000000202','BM-test-25','brand','SYSMEX','test',now()),
  ('b3a10000-0000-4000-8000-000000000201','BM-test-25','none',null,'test',now());
 perform pg_temp.bm_assert((select source='item' and brand_code='SYSMEX' from private.stockflow_item_brand_map() where tally_item_key='BM-test-25'),'BM3 latest ID tie breaker');

 -- BM6: installation membership, active area, stale writes and null clear.
 payload:=jsonb_build_object('itemKey','BM-test-2','expectedLinkId',null,'areaCode','HAEM','idempotencyKey','BM-equipment-command');
 perform pg_temp.bm_error('set_equipment_area',payload,'22023');
 payload:=payload||jsonb_build_object('itemKey','BM-test-1');
 perform pg_temp.bm_error('set_equipment_area',payload||'{"areaCode":"UNKNOWN"}','22023');
 result:=pg_temp.bm_call('set_equipment_area',payload);first_id:=(result->>'linkId')::uuid;
 perform pg_temp.bm_error('set_equipment_area',payload||'{"idempotencyKey":"BM-equipment-stale-command"}','PT409');
 result:=pg_temp.bm_call('set_equipment_area',payload||jsonb_build_object('expectedLinkId',first_id,'areaCode',null,'idempotencyKey','BM-equipment-clear-command'));
 perform pg_temp.bm_assert((select area_code is null from private.stockflow_equipment_area_links where id=(result->>'linkId')::uuid),'BM6 clear');
 raise notice 'PASS BM6 equipment mapping';

 -- BM7: normalization, duplicate name and duplicate normalized code.
 result:=pg_temp.bm_call('add_brand','{"name":"BM Test / Brand","idempotencyKey":"BM-add-brand-command"}');
 perform pg_temp.bm_assert(result->>'code'='BM_TEST_BRAND','BM7 derived code');
 perform pg_temp.bm_error('add_brand','{"name":"BM Test / Brand","idempotencyKey":"BM-add-duplicate-name"}','PT409');
 perform pg_temp.bm_error('add_brand','{"name":"BM Test -- Brand","idempotencyKey":"BM-add-duplicate-code"}','PT409');
 perform pg_temp.bm_assert((select name='bioMérieux' from private.stockflow_brands where code='BIOMERIEUX'),'BM7 UTF-8 seed');
 perform pg_temp.bm_assert(not exists(select 1 from private.stockflow_brand_areas where area_code='HBA1C'),'BM7 no HbA1c brand');
 raise notice 'PASS BM7 brands';

 -- BM8: all new business tables reject mutations, including no-op updates.
 insert into private.stockflow_brand_areas(brand_code,area_code) values('BM_TEST_BRAND','HAEM');
 foreach t in array array['stockflow_brand_group_links','stockflow_brand_item_links','stockflow_equipment_area_links','stockflow_brands','stockflow_brand_areas'] loop
  foreach operation in array array['delete','update'] loop
   denied:=false;
   begin
    if operation='delete' then execute format('delete from private.%I where %I=%L',t,
     case t when 'stockflow_brands' then 'code' when 'stockflow_brand_areas' then 'brand_code' when 'stockflow_brand_group_links' then 'item_group' else 'tally_item_key' end,
     case t when 'stockflow_brands' then 'BM_TEST_BRAND' when 'stockflow_brand_areas' then 'BM_TEST_BRAND' when 'stockflow_brand_group_links' then 'BM test group' else 'BM-test-1' end);
    else execute format('update private.%I set %I=%I where %I=%L',t,
     case t when 'stockflow_brands' then 'code' when 'stockflow_brand_areas' then 'brand_code' else 'id' end,
     case t when 'stockflow_brands' then 'code' when 'stockflow_brand_areas' then 'brand_code' else 'id' end,
     case t when 'stockflow_brands' then 'code' when 'stockflow_brand_areas' then 'brand_code' when 'stockflow_brand_group_links' then 'item_group' else 'tally_item_key' end,
     case t when 'stockflow_brands' then 'BM_TEST_BRAND' when 'stockflow_brand_areas' then 'BM_TEST_BRAND' when 'stockflow_brand_group_links' then 'BM test group' else 'BM-test-1' end);end if;
   exception when sqlstate '42501' or sqlstate '55000' then denied:=true;end;
   perform pg_temp.bm_assert(denied,'BM8 '||operation||' '||t);
  end loop;
 end loop;
 raise notice 'PASS BM8 immutability';

 -- Strict request validation on the SQL boundary, independent of the API.
 perform pg_temp.bm_error('unknown','{}','22023');
 foreach payload in array array['[]'::jsonb,'{"page":null}'::jsonb,'{"page":1.5}'::jsonb,'{"page":4001}'::jsonb,'{"q":false}'::jsonb,'{"extra":1}'::jsonb] loop
  perform pg_temp.bm_error('get_brand_mapping',payload,'22023');
 end loop;
 payload:='{"group":"BM test group","expectedLinkId":null,"brandCode":"SYSMEX","idempotencyKey":"BM-invalid-command"}';
 perform pg_temp.bm_error('set_group_brand',payload||'{"extra":true}','22023');
 perform pg_temp.bm_error('set_group_brand',payload-'expectedLinkId','22023');
 perform pg_temp.bm_error('set_group_brand',payload||'{"expectedLinkId":"bad"}','22023');
 perform pg_temp.bm_error('set_group_brand',payload||'{"group":" BM test group"}','22023');
 perform pg_temp.bm_error('set_group_brand',payload||'{"brandCode":"UNKNOWN"}','22023');
 perform pg_temp.bm_error('set_group_brand',payload||'{"idempotencyKey":"short"}','22023');
 perform pg_temp.bm_error('set_item_brand','{"itemKey":"BM-test-inactive","expectedLinkId":null,"brandCode":null,"idempotencyKey":"BM-invalid-item-command"}','22023');
 perform pg_temp.bm_error('set_item_brand','{"itemKey":"BM-test-1","expectedLinkId":null,"brandCode":null,"clear":true,"idempotencyKey":"BM-invalid-clear-command"}','22023');
 perform pg_temp.bm_error('add_brand','{"name":"12","idempotencyKey":"BM-invalid-brand-command"}','22023');
end $checks$;
rollback;
