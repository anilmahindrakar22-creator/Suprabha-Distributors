begin;

insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('brand-group-inherit-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status)
values('bg-management@test.local','management','active');
insert into private.stockflow_brands(code,name,created_by) values
 ('BG_BRAND_A','BG Test Brand A','test'),('BG_BRAND_B','BG Test Brand B','test');
insert into private.stockflow_products(tally_item_key,name,item_group) values
 ('BG-p','BG principal item','BG Principal'),('BG-l','BG line item','BG Line'),
 ('BG-l2','BG grandchild item','BG Grandchild');
insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
select 'bg-company','bg-inherit',greatest(now(),coalesce(max(observed_at),now()))+interval '1 hour',
 '{"products":[],"groups":[{"id":"bg-p","name":"BG Principal","parentId":null},
 {"id":"bg-l","name":"BG Line","parentId":"bg-p"},
 {"id":"bg-l2","name":"BG Grandchild","parentId":"bg-l"}]}'::jsonb
from private.stockflow_economic_item_catalogs;

create function pg_temp.bg_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL %',label;end if;end$$;
create function pg_temp.bg_call(action text,payload jsonb default '{}') returns jsonb language sql as $$
 select public.stockflow_brand_mapping_gateway('brand-group-inherit-key','bg-management@test.local',action,payload)
$$;
create function pg_temp.bg_error(payload jsonb,expected text) returns void language plpgsql as $$
begin
 begin perform pg_temp.bg_call('set_group_brand',payload);
 exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected %',expected;
end$$;
create function pg_temp.bg_map(item text) returns text language sql as $$
 select coalesce(m.brand_code,'-')||'|'||m.source from private.stockflow_item_brand_map() m where m.tally_item_key=item
$$;

do $checks$
declare result jsonb; payload jsonb; own_id uuid; inherit_id uuid; row_data jsonb; n bigint;
begin
 -- G1: the own line link overrides the principal.
 perform pg_temp.bg_call('set_group_brand','{"group":"BG Principal","expectedLinkId":null,"brandCode":"BG_BRAND_A","idempotencyKey":"BG-principal-brand-first"}');
 result:=pg_temp.bg_call('set_group_brand','{"group":"BG Line","expectedLinkId":null,"brandCode":"BG_BRAND_B","idempotencyKey":"BG-line-brand-first"}');
 own_id:=(result->>'linkId')::uuid;
 perform pg_temp.bg_assert(pg_temp.bg_map('BG-l')='BG_BRAND_B|group','G1 own line brand');

 -- G2: latest first, then skip inherit; never resurrect the old B link.
 payload:=jsonb_build_object('group','BG Line','expectedLinkId',own_id,'clear',true,'idempotencyKey','BG-line-clear-first');
 result:=pg_temp.bg_call('set_group_brand',payload);inherit_id:=(result->>'linkId')::uuid;
 perform pg_temp.bg_assert(pg_temp.bg_map('BG-l')='BG_BRAND_A|inherited','G2 follows principal');
 perform pg_temp.bg_assert(pg_temp.bg_call('set_group_brand',payload)=result,'G2 idempotent replay');

 -- G3: tree and BL1 retain the latest own ID, including cleared links.
 result:=pg_temp.bg_call('get_brand_mapping');
 select value into row_data from jsonb_array_elements(result->'tree') where value->>'group'='BG Line';
 perform pg_temp.bg_assert(row_data->>'kind'='inherit' and row_data->>'linkId'=inherit_id::text
  and row_data->'brandCode'='null'::jsonb and row_data->>'inheritedBrandCode'='BG_BRAND_A','G3 cleared tree row');
 select value into row_data from jsonb_array_elements(result->'groups') where value->>'group'='BG Line';
 perform pg_temp.bg_assert(row_data->>'kind'='inherit' and row_data->>'linkId'=inherit_id::text
  and row_data->'brandCode'='null'::jsonb,'G3 BL1 latest own link');
 perform pg_temp.bg_assert(not exists(select 1 from jsonb_array_elements(result->'items') i where i->>'itemKey'='BG-l'),'G3 mapped line excluded from candidates');

 -- G4: a stale clear must not append anything.
 select count(*) into n from private.stockflow_brand_group_links;
 perform pg_temp.bg_error(payload||'{"idempotencyKey":"BG-line-clear-stale"}','PT409');
 perform pg_temp.bg_assert((select count(*)=n from private.stockflow_brand_group_links),'G4 no append');

 -- G5: a grandchild skips its cleared nearest ancestor in both resolution and read.
 perform pg_temp.bg_assert(pg_temp.bg_map('BG-l2')='BG_BRAND_A|inherited','G5 grandchild skips line');
 select value into row_data from jsonb_array_elements(result->'tree') where value->>'group'='BG Grandchild';
 perform pg_temp.bg_assert(row_data->>'inheritedBrandCode'='BG_BRAND_A','G5 tree skips line');

 -- G6: save again using the inherit row as the expected link.
 result:=pg_temp.bg_call('set_group_brand',jsonb_build_object('group','BG Line','expectedLinkId',inherit_id,
  'brandCode','BG_BRAND_B','idempotencyKey','BG-line-brand-again'));
 own_id:=(result->>'linkId')::uuid;
 perform pg_temp.bg_assert(pg_temp.bg_map('BG-l')='BG_BRAND_B|group','G6 set after clear');

 -- G7: exact shape, JSON true only, and no brandCode with clear.
 payload:=jsonb_build_object('group','BG Line','expectedLinkId',own_id,'clear',true,'idempotencyKey','BG-line-invalid-clear');
 select count(*) into n from private.stockflow_brand_group_links;
 perform pg_temp.bg_error(payload||'{"clear":false}','22023');
 perform pg_temp.bg_error(payload||'{"brandCode":null}','22023');
 perform pg_temp.bg_error(payload||'{"extra":true}','22023');
 perform pg_temp.bg_assert((select count(*)=n from private.stockflow_brand_group_links),'G7 no append');

 -- G9: a cleared top with no ancestor retains its ID for a subsequent save.
 select id into own_id from private.stockflow_brand_group_links where item_group='BG Principal' order by recorded_at desc,id desc limit 1;
 result:=pg_temp.bg_call('set_group_brand',jsonb_build_object('group','BG Principal','expectedLinkId',own_id,
  'clear',true,'idempotencyKey','BG-principal-clear-first'));
 inherit_id:=(result->>'linkId')::uuid;
 result:=pg_temp.bg_call('get_brand_mapping');
 select value into row_data from jsonb_array_elements(result->'groups') where value->>'group'='BG Principal';
 perform pg_temp.bg_assert(row_data->>'linkId'=inherit_id::text and row_data->>'kind'='inherit'
  and row_data->'brandCode'='null'::jsonb and pg_temp.bg_map('BG-p')='-|unmapped','G9 BL1 cleared top unmapped');
 perform pg_temp.bg_assert(exists(select 1 from jsonb_array_elements(result->'items') i where i->>'itemKey'='BG-p'),'G9 cleared unmapped candidate');
 perform pg_temp.bg_call('set_group_brand',jsonb_build_object('group','BG Principal','expectedLinkId',row_data->>'linkId',
  'brandCode','BG_BRAND_B','idempotencyKey','BG-principal-brand-again'));
 perform pg_temp.bg_assert(pg_temp.bg_map('BG-p')='BG_BRAND_B|group','G9 set using BL1 inherit ID');

 -- G8: the table enforces valid kind/code combinations even on direct inserts.
 begin
  insert into private.stockflow_brand_group_links(item_group,kind,brand_code) values('BG Line','inherit','BG_BRAND_A');
  raise exception 'G8 inherit with code accepted';
 exception when check_violation then null;end;
 begin
  insert into private.stockflow_brand_group_links(item_group,kind,brand_code) values('BG Line','brand',null);
  raise exception 'G8 brand without code accepted';
 exception when check_violation then null;end;
 raise notice 'PASS brand group inherit G1-G8';
 raise notice 'PASS brand group inherit G9';
end$checks$;
rollback;
