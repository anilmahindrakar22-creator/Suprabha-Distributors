begin;
-- BL2 fixtures use the BL- / bl- prefix and generic names only.
-- Earlier concurrency suites commit catalog rows. T10 needs a database with no
-- catalog, so remove them inside this rolled-back transaction only. Replica
-- mode skips the no-delete trigger and the mapping foreign key for that delete.
set local session_replication_role=replica;
delete from private.stockflow_economic_item_catalogs;
set local session_replication_role=origin;
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('brand-line-test-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status)
values('bl-management@test.local','management','active'),('bl-sales@test.local','sales','active');
insert into private.stockflow_brands(code,name,created_by) values
 ('BL_BRAND_A','BL Test Brand A','test'),('BL_BRAND_B','BL Test Brand B','test'),('BL_BRAND_D','BL Test Brand D','test');
insert into private.stockflow_products(tally_item_key,name,item_group) values
 ('BL-a','BL item principal A','Test Principal A'),
 ('BL-a1','BL item line A1','Line A1'),
 ('BL-a1x','BL item subline A1x','Subline A1x'),
 ('BL-a1x-2','BL item subline A1x second','Subline A1x'),
 ('BL-solo','BL item solo top','Test Solo Top'),
 ('BL-orphan','BL item orphan','Test Orphan'),
 ('BL-cx','BL item cycle X','Cycle X'),
 ('BL-sys','BL item line under D','SYS 480'),
 ('BL-primary','BL item primary',E'\u0004 Primary'),
 ('BL-missing','BL item group not in catalog','BL Not In Catalog');

create function pg_temp.bl_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL %',label;end if;end$$;
create function pg_temp.bl_call(action text,payload jsonb default '{}',actor text default 'management') returns jsonb language sql as $$
 select public.stockflow_brand_mapping_gateway('brand-line-test-key','bl-'||actor||'@test.local',action,payload)
$$;
create function pg_temp.bl_error(action text,payload jsonb,expected text,actor text default 'management') returns void language plpgsql as $$
begin
 begin perform pg_temp.bl_call(action,payload,actor);
 exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected % for %',expected,action;
end$$;
create function pg_temp.bl_link(target_group text,brand text) returns void language sql as $$
 insert into private.stockflow_brand_group_links(item_group,kind,brand_code,recorded_by)
 values(target_group,case when brand is null then 'none' else 'brand' end,brand,'test')
$$;
-- One row of the brand map as 'brand|source' ('-' for a null brand).
create function pg_temp.bl_map(item text) returns text language sql as $$
 select coalesce(m.brand_code,'-')||'|'||m.source from private.stockflow_item_brand_map() m where m.tally_item_key=item
$$;
create function pg_temp.bl_tree_row(result jsonb,target_group text) returns jsonb language sql as $$
 select value from jsonb_array_elements(result->'tree') where value->>'group'=target_group
$$;

do $checks$
declare result jsonb; replay jsonb; payload jsonb; first_id uuid; clear_id uuid; row_data jsonb;
 seen_at timestamptz:=date_trunc('second',now())+interval '1 hour'; n bigint;
begin
 -- T10: with no catalog the tree is empty and the map behaves as before (no inheritance).
 if exists(select 1 from private.stockflow_economic_item_catalogs) then
  raise exception 'T10 precondition: catalog rows were not cleared for this transaction';end if;
 perform pg_temp.bl_assert((select count(*)=0 from private.stockflow_brand_group_tree()),'T10 empty tree');
 perform pg_temp.bl_link('Test Principal A','BL_BRAND_A');
 perform pg_temp.bl_assert(pg_temp.bl_map('BL-a')='BL_BRAND_A|group','T10 own group link');
 perform pg_temp.bl_assert(pg_temp.bl_map('BL-a1')='-|unmapped' and pg_temp.bl_map('BL-a1x')='-|unmapped','T10 no inheritance without a catalog');
 result:=pg_temp.bl_call('get_brand_mapping');
 perform pg_temp.bl_assert(result->'tree'='[]'::jsonb and result ? 'catalogObservedAt' and result->'catalogObservedAt'='null'::jsonb,'T10 empty tree read');
 raise notice 'PASS T10 no catalog';

 -- An older catalog with a different shape must be ignored: only the latest row counts.
 insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content) values
  ('bl-company','bl-old',seen_at-interval '1 day','{"products":[],"groups":[
    {"id":"bl-g-a1","name":"Line A1","parentId":null},
    {"id":"bl-g-old","name":"Test Old Only","parentId":null}]}'),
  ('bl-company','bl-new',seen_at,'{"products":[],"groups":[
    {"id":"bl-g-a","name":"Test Principal A","parentId":null},
    {"id":"bl-g-a1","name":"Line A1","parentId":"bl-g-a"},
    {"id":"bl-g-a1x","name":"Subline A1x","parentId":"bl-g-a1"},
    {"id":"bl-g-solo","name":"Test Solo Top","parentId":null},
    {"id":"bl-g-orphan","name":"Test Orphan","parentId":"bl-g-gone"},
    {"id":"bl-g-cx","name":"Cycle X","parentId":"bl-g-cy"},
    {"id":"bl-g-cy","name":"Cycle Y","parentId":"bl-g-cx"},
    {"id":"bl-g-d","name":"Test Principal D","parentId":null},
    {"id":"bl-g-sys","name":"SYS 480","parentId":"bl-g-d"}]}');

 -- T1: depth, top and parent for every group; the cycle ends; a missing parent is a top.
 select count(*) into n from private.stockflow_brand_group_tree();
 perform pg_temp.bl_assert(n=9,'T1 one row per latest catalog group');
 perform pg_temp.bl_assert((select bool_and(observed_at=seen_at) from private.stockflow_brand_group_tree()),'T1 observed time');
 perform pg_temp.bl_assert(not exists(
  select 1 from (values
   ('Test Principal A',null,'Test Principal A',0),
   ('Line A1','Test Principal A','Test Principal A',1),
   ('Subline A1x','Line A1','Test Principal A',2),
   ('Test Solo Top',null,'Test Solo Top',0),
   ('Test Orphan',null,'Test Orphan',0),
   ('Cycle X','Cycle Y','Cycle X',0),
   ('Cycle Y','Cycle X','Cycle Y',0),
   ('Test Principal D',null,'Test Principal D',0),
   ('SYS 480','Test Principal D','Test Principal D',1)
  ) want(group_name,parent_name,top_group,depth)
  where not exists(select 1 from private.stockflow_brand_group_tree() t
   where t.group_name=want.group_name and t.parent_name is not distinct from want.parent_name
    and t.top_group=want.top_group and t.depth=want.depth)),'T1 tree rows');
 raise notice 'PASS T1 tree, cycle and missing parent';

 -- T2: a brand on the principal only reaches its lines and sublines.
 perform pg_temp.bl_assert(pg_temp.bl_map('BL-a')='BL_BRAND_A|group','T2 principal own items');
 perform pg_temp.bl_assert(pg_temp.bl_map('BL-a1')='BL_BRAND_A|inherited','T2 line inherits');
 perform pg_temp.bl_assert(pg_temp.bl_map('BL-a1x')='BL_BRAND_A|inherited' and pg_temp.bl_map('BL-a1x-2')='BL_BRAND_A|inherited','T2 subline inherits');
 perform pg_temp.bl_assert(pg_temp.bl_map('BL-solo')='-|unmapped' and pg_temp.bl_map('BL-orphan')='-|unmapped','T2 other tops stay unmapped');
 -- A cycle never inherits: a link on Cycle Y does not reach Cycle X items.
 perform pg_temp.bl_link('Cycle Y','BL_BRAND_B');
 perform pg_temp.bl_assert(pg_temp.bl_map('BL-cx')='-|unmapped','T2 cycle groups do not inherit');
 raise notice 'PASS T2 inheritance';

 -- T3: a line link overrides the principal for the line and below.
 perform pg_temp.bl_link('Line A1','BL_BRAND_B');
 perform pg_temp.bl_assert(pg_temp.bl_map('BL-a1')='BL_BRAND_B|group','T3 line own link');
 perform pg_temp.bl_assert(pg_temp.bl_map('BL-a1x')='BL_BRAND_B|inherited','T3 subline takes the nearest ancestor');
 perform pg_temp.bl_assert(pg_temp.bl_map('BL-a')='BL_BRAND_A|group','T3 principal items keep their brand');
 raise notice 'PASS T3 line override';

 -- T4: an explicit none on the line stops inheritance and is still mapped.
 perform pg_temp.bl_link('Line A1',null);
 perform pg_temp.bl_assert(pg_temp.bl_map('BL-a1')='-|group','T4 line none');
 perform pg_temp.bl_assert(pg_temp.bl_map('BL-a1x')='-|inherited' and pg_temp.bl_map('BL-a1x-2')='-|inherited','T4 subline none is not unmapped');
 perform pg_temp.bl_assert(pg_temp.bl_map('BL-a')='BL_BRAND_A|group','T4 principal unchanged');
 raise notice 'PASS T4 explicit none';

 -- T5: an item link beats group and inherited links; an inherit record falls back.
 insert into private.stockflow_brand_item_links(tally_item_key,kind,brand_code,recorded_by) values('BL-a1x','brand','BL_BRAND_D','test');
 perform pg_temp.bl_assert(pg_temp.bl_map('BL-a1x')='BL_BRAND_D|item','T5 item brand wins');
 perform pg_temp.bl_assert(pg_temp.bl_map('BL-a1x-2')='-|inherited','T5 sibling item unchanged');
 insert into private.stockflow_brand_item_links(tally_item_key,kind,brand_code,recorded_by) values('BL-a','none',null,'test');
 perform pg_temp.bl_assert(pg_temp.bl_map('BL-a')='-|item','T5 item none wins');
 insert into private.stockflow_brand_item_links(tally_item_key,kind,brand_code,recorded_by) values('BL-a','inherit',null,'test');
 perform pg_temp.bl_assert(pg_temp.bl_map('BL-a')='BL_BRAND_A|group','T5 item inherit falls back');
 raise notice 'PASS T5 item link';

 -- T6: Primary and a group outside the catalog behave as before.
 perform pg_temp.bl_assert(pg_temp.bl_map('BL-primary')='-|unmapped' and pg_temp.bl_map('BL-missing')='-|unmapped','T6 unmapped unless linked');
 perform pg_temp.bl_link('BL Not In Catalog','BL_BRAND_A');
 perform pg_temp.bl_assert(pg_temp.bl_map('BL-missing')='BL_BRAND_A|group','T6 own group link outside the catalog');
 perform pg_temp.bl_assert(pg_temp.bl_map('BL-primary')='-|unmapped','T6 Primary stays unmapped');
 raise notice 'PASS T6 Primary and missing group';

 -- T7: a line named like another brand follows its principal, not the name.
 perform pg_temp.bl_assert(exists(select 1 from private.stockflow_brands where name='Sysmex' and active),'T7 Sysmex brand exists');
 perform pg_temp.bl_link('Test Principal D','BL_BRAND_D');
 perform pg_temp.bl_assert(pg_temp.bl_map('BL-sys')='BL_BRAND_D|inherited','T7 line resolves to the principal brand');
 raise notice 'PASS T7 line named like another brand';

 -- T8: set_group_area.
 payload:=jsonb_build_object('group','Line A1','expectedLinkId',null,'areaCode','HAEM','idempotencyKey','BL-group-area-first-1');
 perform pg_temp.bl_error('set_group_area',payload,'PT403','sales');
 result:=pg_temp.bl_call('set_group_area',payload);first_id:=(result->>'linkId')::uuid;
 perform pg_temp.bl_assert(result->'ok'='true'::jsonb and (select area_code='HAEM' and recorded_by='bl-management@test.local'
  from private.stockflow_group_area_links where id=first_id),'T8 area saved');
 replay:=pg_temp.bl_call('set_group_area',payload);
 perform pg_temp.bl_assert(replay=result and (select count(*)=1 from private.stockflow_group_area_links where item_group='Line A1'),'T8 replay is stable');
 perform pg_temp.bl_error('set_group_area',payload||'{"idempotencyKey":"BL-group-area-stale-1"}','PT409');
 perform pg_temp.bl_error('set_group_area',payload||jsonb_build_object('expectedLinkId','00000000-0000-4000-8000-000000000001','idempotencyKey','BL-group-area-stale-2'),'PT409');
 perform pg_temp.bl_error('set_group_area',payload||'{"group":"BL No Such Group","idempotencyKey":"BL-group-area-unknown"}','22023');
 perform pg_temp.bl_error('set_group_area',payload||jsonb_build_object('expectedLinkId',first_id,'areaCode','UNKNOWN','idempotencyKey','BL-group-area-bad-area'),'22023');
 perform pg_temp.bl_error('set_group_area',payload||'{"group":"","idempotencyKey":"BL-group-area-empty-1"}','22023');
 perform pg_temp.bl_error('set_group_area',payload||'{"extra":true,"idempotencyKey":"BL-group-area-extra-1"}','22023');
 perform pg_temp.bl_error('set_group_area',(payload-'areaCode')||'{"idempotencyKey":"BL-group-area-no-area"}','22023');
 perform pg_temp.bl_error('set_group_area',(payload-'expectedLinkId')||'{"idempotencyKey":"BL-group-area-no-link"}','22023');
 perform pg_temp.bl_error('set_group_area',payload||'{"expectedLinkId":"bad","idempotencyKey":"BL-group-area-bad-link"}','22023');
 perform pg_temp.bl_error('set_group_area',payload||'{"areaCode":5,"idempotencyKey":"BL-group-area-bad-type"}','22023');
 perform pg_temp.bl_assert((select count(*)=1 from private.stockflow_group_area_links),'T8 refused commands saved nothing');
 result:=pg_temp.bl_call('set_group_area',payload||jsonb_build_object('expectedLinkId',first_id,'areaCode',null,'idempotencyKey','BL-group-area-clear-1'));
 clear_id:=(result->>'linkId')::uuid;
 perform pg_temp.bl_assert((select area_code is null from private.stockflow_group_area_links where id=clear_id),'T8 null clears the area');
 -- A group known only to the tree, and one known only to products, are both accepted.
 perform pg_temp.bl_call('set_group_area','{"group":"Cycle Y","expectedLinkId":null,"areaCode":"COAG","idempotencyKey":"BL-group-area-tree-only"}');
 perform pg_temp.bl_call('set_group_area','{"group":"BL Not In Catalog","expectedLinkId":null,"areaCode":"COAG","idempotencyKey":"BL-group-area-product-only"}');
 -- The new table is append-only.
 begin
  delete from private.stockflow_group_area_links where id=first_id;
  raise exception 'T8 delete accepted';
 exception when sqlstate '42501' or sqlstate '55000' then null;end;
 begin
  update private.stockflow_group_area_links set area_code='COAG' where id=first_id;
  raise exception 'T8 update accepted';
 exception when sqlstate '42501' or sqlstate '55000' then null;end;
 raise notice 'PASS T8 set_group_area';

 -- T9: the read keeps every old key and adds the tree.
 perform pg_temp.bl_link('Line A1','BL_BRAND_B');
 result:=pg_temp.bl_call('get_brand_mapping');
 perform pg_temp.bl_assert(result ?& array['brands','groups','items','total','page','equipment','unmappedSalesPaise','totalSalesPaise','tree','catalogObservedAt'],'T9 keys');
 perform pg_temp.bl_assert((result->>'catalogObservedAt')::timestamptz=seen_at,'T9 catalog time');
 perform pg_temp.bl_assert(jsonb_array_length(result->'tree')=9,'T9 one tree row per group');
 row_data:=pg_temp.bl_tree_row(result,'Subline A1x');
 perform pg_temp.bl_assert(row_data->>'inheritedBrandCode'='BL_BRAND_B' and row_data->'linkId'='null'::jsonb and row_data->'brandCode'='null'::jsonb
  and row_data->>'parent'='Line A1' and row_data->>'top'='Test Principal A' and (row_data->>'depth')::int=2
  and (row_data->>'items')::int=2 and (row_data->>'salesPaise')::numeric=0,'T9 subline row');
 row_data:=pg_temp.bl_tree_row(result,'Line A1');
 perform pg_temp.bl_assert(row_data->>'brandCode'='BL_BRAND_B' and row_data->>'kind'='brand' and row_data->'inheritedBrandCode'='null'::jsonb
  and row_data->>'areaLinkId'=clear_id::text and row_data->'areaCode'='null'::jsonb and (row_data->>'items')::int=1,'T9 line row');
 row_data:=pg_temp.bl_tree_row(result,'Test Principal A');
 perform pg_temp.bl_assert(row_data->>'brandCode'='BL_BRAND_A' and row_data->'parent'='null'::jsonb and row_data->'inheritedBrandCode'='null'::jsonb
  and row_data->'areaLinkId'='null'::jsonb,'T9 principal row');
 row_data:=pg_temp.bl_tree_row(result,'SYS 480');
 perform pg_temp.bl_assert(row_data->>'inheritedBrandCode'='BL_BRAND_D' and row_data->>'top'='Test Principal D','T9 line under D');
 row_data:=pg_temp.bl_tree_row(result,'Cycle Y');
 perform pg_temp.bl_assert(row_data->>'areaCode'='COAG' and (row_data->>'items')::int=0 and row_data->>'top'='Cycle Y','T9 tree-only group');
 perform pg_temp.bl_assert(pg_temp.bl_tree_row(result,'Test Solo Top')->'inheritedBrandCode'='null'::jsonb,'T9 unlinked top');
 -- Within one top group the rows run by depth.
 perform pg_temp.bl_assert((select array_agg(value->>'group' order by ordinality)=array['Test Principal A','Line A1','Subline A1x']
  from jsonb_array_elements(result->'tree') with ordinality where value->>'top'='Test Principal A'),'T9 order within a top group');
 -- An explicit none on the nearest ancestor shows no inherited brand.
 perform pg_temp.bl_link('Line A1',null);
 result:=pg_temp.bl_call('get_brand_mapping');
 perform pg_temp.bl_assert(pg_temp.bl_tree_row(result,'Subline A1x')->'inheritedBrandCode'='null'::jsonb
  and pg_temp.bl_tree_row(result,'Line A1')->>'kind'='none','T9 none ancestor');
 raise notice 'PASS T9 get_brand_mapping tree';
end $checks$;
rollback;
