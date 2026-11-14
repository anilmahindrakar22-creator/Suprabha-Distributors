begin;
set local lock_timeout='60s';
set local statement_timeout='300s';

-- The replay captures these actual definitions immediately before this migration.
do $baseline$
declare definitions record;
begin
 select * into strict definitions from public.test_growth_item_kind_before;
 execute replace(definitions.gateway,'public.stockflow_brand_mapping_gateway(','pg_temp.before_gateway(');
 execute replace(definitions.gp,'private.stockflow_growth_gp(','pg_temp.before_gp(');
end$baseline$;

create function pg_temp.k_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Item kind assertion failed: %',label;end if;end$$;
create function pg_temp.k_call(payload jsonb,actor text default 'management') returns jsonb language sql as $$
 select public.stockflow_brand_mapping_gateway('growth-kind-key','growth-kind-'||actor||'@test.local','set_item_kind',payload)
$$;
create function pg_temp.k_payload(item text,kind text,request text) returns jsonb language sql as $$
 select jsonb_build_object('companyId','growth-kind-co','productId',item,'kind',kind,'reason','Management exception',
  'requestId','growth-kind-command-'||request)
$$;
create function pg_temp.k_error(payload jsonb,expected text,actor text default 'management') returns void language plpgsql as $$
begin
 begin perform pg_temp.k_call(payload,actor);
 exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected item kind SQLSTATE %',expected;
end$$;
create function pg_temp.k_line(src text,item text,qty numeric,net bigint,kind text default 'purchase',
 d date default '2020-01-01',u text default 'pack',revision bigint default 1,cancel boolean default false,
 company text default 'growth-kind-co') returns uuid language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values(company,src,revision,d,'kind-lab',kind,cancel,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1',item,qty,u,net,jsonb_build_object('label','Kind fixture '||item));
 return voucher;
end$$;
create function pg_temp.k_old_gp(g jsonb) returns jsonb language sql as $$
 select (g-'consumables'-'instruments')||jsonb_build_object('months',(
  select jsonb_agg(m-array['consumablesKnownSalesPaise','consumablesGpPaise','instrumentsKnownSalesPaise','instrumentsGpPaise'] order by n)
  from jsonb_array_elements(g->'months') with ordinality e(m,n)))
$$;

insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('growth-kind-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status)
select 'growth-kind-'||r||'@test.local',r,array[r],'active'
from unnest(array['administrator','management','sales','operations']) r;
insert into private.stockflow_products(tally_item_key,name,item_group)
select 'Kind fixture '||item,'Kind fixture '||item,'Kind fixture group'
from unnest(array['threshold','under','instrument','unknown','catalog-only','return-only']) item;
insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
values('growth-kind-co','kind-old','2020-01-01','{"groups":[],"products":[{"id":"removed","name":"Kind fixture removed","unit":"pack"}]}');
insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
select 'growth-kind-co','kind-current','2031-07-15',jsonb_build_object('groups','[]'::jsonb,'products',
 jsonb_agg(jsonb_build_object('id',item,'name','Kind fixture '||item,'unit','pack')))
from unnest(array['threshold','under','instrument','unknown','catalog-only','return-only']) item;

do $test$
<<checks>>
declare today date:='2031-07-15'; g jsonb; before_gp jsonb; before_read jsonb; after_read jsonb;
 payload jsonb; result jsonb; row_data jsonb; m jsonb; field text; actor_name text; operation text;
 started timestamptz; elapsed interval; f text; anchor text; n bigint; audit_count bigint; override_count bigint;
begin
 -- K1. All history and units contribute to a weighted average at the exact boundary.
 perform pg_temp.k_line('threshold-pack','threshold',1,2000000);
 perform pg_temp.k_line('threshold-box','threshold',2,5500000,'purchase','2032-01-01','box');
 perform pg_temp.k_line('under','under',1,2499999);
 perform pg_temp.k_line('instrument','instrument',1,14000000);
 perform pg_temp.k_line('unknown','unknown',1,1000,'sale','2030-07-10');
 perform pg_temp.k_line('other-company','threshold',1,100,'purchase','2020-01-01','pack',1,false,'growth-kind-other');
 perform pg_temp.k_assert((select kind='instrument' and source='auto' and average_cost_paise=2500000
  from private.stockflow_growth_item_kind('growth-kind-co','threshold')),'K1 inclusive weighted threshold across history and units');
 perform pg_temp.k_assert((select kind='consumable' and source='auto' and average_cost_paise=2499999
  from private.stockflow_growth_item_kind('growth-kind-co','under')),'K1 just under threshold');
 perform pg_temp.k_assert((select kind='consumable' and average_cost_paise is null
  from private.stockflow_growth_item_kind('growth-kind-co','unknown')),'K1 no purchase cost');
 perform pg_temp.k_assert((select kind='consumable' and average_cost_paise=100
  from private.stockflow_growth_item_kind('growth-kind-other','threshold')),'K1 company isolation');
 perform pg_temp.k_line('superseded','threshold',1,999999999);
 perform pg_temp.k_line('superseded','threshold',1,999999999,'non_economic','2020-01-01','pack',2);
 perform pg_temp.k_line('cancelled','threshold',1,999999999);
 perform pg_temp.k_line('cancelled','threshold',1,999999999,'purchase','2020-01-01','pack',2,true);
 perform pg_temp.k_line('zero-qty','threshold',0,999999999);
 perform pg_temp.k_line('negative-qty','threshold',-1,999999999);
 perform pg_temp.k_line('zero-net','threshold',1,0);
 perform pg_temp.k_line('negative-net','threshold',1,-999999999);
 perform pg_temp.k_line('cancelled-only','cancelled-only',1,999999999,'purchase','2020-01-01','pack',1,true);
 perform pg_temp.k_assert((select kind='consumable' and average_cost_paise is null
  from private.stockflow_growth_item_kinds() where company_id='growth-kind-co' and product_id='cancelled-only'),
  'K1 historical item retained with no valid purchase cost');
 perform pg_temp.k_assert((select average_cost_paise=2500000 from private.stockflow_growth_item_kind('growth-kind-co','threshold')),
  'K1 latest revisions, cancelled and invalid purchases excluded');
 perform pg_temp.k_assert((select count(*)=1 from private.stockflow_growth_item_kinds()
  where company_id='growth-kind-co' and product_id='threshold'),'K1 one row per item');

 -- K2. Latest append, including auto, supersedes all previous overrides.
 payload:=pg_temp.k_payload('threshold','consumable','threshold-consumable');
 result:=pg_temp.k_call(payload);
 perform pg_temp.k_assert(result='{"companyId":"growth-kind-co","productId":"threshold","kind":"consumable","source":"override"}'::jsonb,'K2 costly reagent override');
 perform pg_temp.k_assert(pg_temp.k_call(pg_temp.k_payload('threshold','auto','threshold-auto'))->>'kind'='instrument','K2 auto restores threshold');
 perform pg_temp.k_assert((select source='auto' from private.stockflow_growth_item_kind('growth-kind-co','threshold')),'K2 auto clears source');
 perform pg_temp.k_call(pg_temp.k_payload('under','instrument','under-instrument'));
 perform pg_temp.k_assert((select kind='instrument' and source='override'
  from private.stockflow_growth_item_kind('growth-kind-co','under')),'K2 override inexpensive item');
 perform pg_temp.k_call(pg_temp.k_payload('under','consumable','under-consumable'),'administrator');
 perform pg_temp.k_assert((select kind='consumable' and source='override'
  from private.stockflow_growth_item_kind('growth-kind-co','under')),'K2 latest override wins');
 perform pg_temp.k_call(pg_temp.k_payload('under','auto','under-auto'));
 -- Equal timestamps use descending id. Both rows are older than the gateway appends.
 insert into private.stockflow_growth_item_kind_overrides(id,company_id,product_id,kind,reason,actor,recorded_at) values
 ('f1000000-0000-4000-8000-000000000001','growth-kind-co','catalog-only','consumable','Tie fixture','fixture','2020-01-01'),
 ('f1000000-0000-4000-8000-000000000002','growth-kind-co','catalog-only','instrument','Tie fixture','fixture','2020-01-01');
 perform pg_temp.k_assert((select kind='instrument' and source='override' and average_cost_paise is null
  from private.stockflow_growth_item_kind('growth-kind-co','catalog-only')),'K2 catalog-only override and id tie-break');
 perform pg_temp.k_call(pg_temp.k_payload('catalog-only','auto','catalog-clear'));
 perform pg_temp.k_assert((select kind='consumable' and source='auto'
  from private.stockflow_growth_item_kind('growth-kind-co','catalog-only')),'K2 catalog-only auto reset');

 -- K3. A 1.4 lakh instrument on its own repeat voucher enters the instrument aggregate.
 before_gp:=private.stockflow_growth_gp(today);
 perform pg_temp.k_line('instrument-sale','instrument',1,14000000,'sale','2030-08-10');
 g:=private.stockflow_growth_gp(today);
 perform pg_temp.k_assert((g#>>'{instruments,salesPaise}')::numeric-(before_gp#>>'{instruments,salesPaise}')::numeric=14000000
  and (g#>>'{instruments,costPaise}')::numeric-(before_gp#>>'{instruments,costPaise}')::numeric=14000000
  and (g#>>'{repeat,salesPaise}')::numeric-(before_gp#>>'{repeat,salesPaise}')::numeric=14000000
  and g->'bulk'=before_gp->'bulk','K3 instrument on repeat voucher');
 perform pg_temp.k_assert(pg_temp.k_old_gp(g)::text=pg_temp.before_gp(today)::text,'K3 every legacy GP value byte-identical');

 -- K4. Mixed known/unknown lines, bulk consumables, negative lines and credits reconcile.
 perform pg_temp.k_line('consumable-sale','under',1,3000000,'sale','2030-09-10');
 perform pg_temp.k_line('historical-bulk','under',10,25000000,'sale','2030-05-01');
 before_gp:=private.stockflow_growth_gp(today);
 perform pg_temp.k_line('bulk-return','under',-1,-2500000,'return','2030-07-01');
 g:=private.stockflow_growth_gp(today);
 perform pg_temp.k_assert((g#>>'{instruments,salesPaise}')::numeric-(before_gp#>>'{instruments,salesPaise}')::numeric=-2500000
  and g->'consumables'=before_gp->'consumables','K4 return inherits historical bulk sale');
 perform pg_temp.k_line('bulk-consumable','under',10,25000000,'sale','2030-10-01');
 perform pg_temp.k_line('instrument-return','instrument',-1,-14000000,'return','2030-11-01');
 perform pg_temp.k_line('value-credit','unknown',0,-100,'credit','2030-12-01');
 perform pg_temp.k_line('free-goods','under',1,0,'sale','2031-01-01');
 perform pg_temp.k_line('unreliable','under',1,100,'sale','2031-02-01');
 perform pg_temp.k_call(pg_temp.k_payload('return-only','instrument','return-only'));
 perform pg_temp.k_line('return-only','return-only',-1,-500,'return','2031-03-01');
 g:=private.stockflow_growth_gp(today);
 perform pg_temp.k_assert(g#>>'{months,8,instrumentsKnownSalesPaise}'='0'
  and (g#>>'{instruments,salesPaise}')::numeric=22499500,'K4 return-only override without purchase/sale history');
 foreach field in array array['salesPaise','knownSalesPaise','costPaise','gpPaise','unreliableLines'] loop
  perform pg_temp.k_assert((g#>>array['consumables',field])::numeric+(g#>>array['instruments',field])::numeric
   =(g#>>array['window',field])::numeric,'K4 top-level reconciliation '||field);
 end loop;
 perform pg_temp.k_assert((select array_agg(key order by key) from jsonb_object_keys(g->'instruments') key)
  =(select array_agg(key order by key) from jsonb_object_keys(g->'window') key),'K4 same fields as window');
 for m in select value from jsonb_array_elements(g->'months') loop
  perform pg_temp.k_assert((m->>'consumablesKnownSalesPaise')::numeric+(m->>'instrumentsKnownSalesPaise')::numeric=(m->>'knownSalesPaise')::numeric
   and (m->>'consumablesGpPaise')::numeric+(m->>'instrumentsGpPaise')::numeric=(m->>'gpPaise')::numeric,'K4 month reconciliation');
 end loop;
 perform pg_temp.k_assert(pg_temp.k_old_gp(g)::text=pg_temp.before_gp(today)::text,'K4 existing GP outputs byte-identical');

 -- K5. Validation, management role gate, receipt replay and atomic audit.
 payload:=pg_temp.k_payload('threshold','consumable','validation');
 perform pg_temp.k_error(payload||'{"productId":"missing"}','22023');
 perform pg_temp.k_error(payload||'{"productId":"removed"}','22023');
 perform pg_temp.k_error(payload||'{"companyId":"missing"}','22023');
 perform pg_temp.k_error(payload||'{"kind":"reagent"}','22023');
 perform pg_temp.k_error(payload||'{"extra":true}','22023');
 perform pg_temp.k_error(payload||'{"reason":" x "}','22023');
 perform pg_temp.k_error(payload||jsonb_build_object('reason',repeat('x',501)),'22023');
 perform pg_temp.k_error(payload||'{"requestId":"short"}','22023');
 perform pg_temp.k_error(payload-'reason','22023');
 perform pg_temp.k_error(payload||'{"kind":null}','22023');
 perform pg_temp.k_error(payload||'{"productId":123}','22023');
 foreach actor_name in array array['sales','operations'] loop
  perform pg_temp.k_error(payload,'PT403',actor_name);
  perform pg_temp.k_error('{}','PT403',actor_name);
 end loop;
 select count(*) into audit_count from private.stockflow_economic_audit where action='set_item_kind';
 select count(*) into override_count from private.stockflow_growth_item_kind_overrides;
 result:=pg_temp.k_call(payload);
 perform pg_temp.k_assert(pg_temp.k_call(payload)=result,'K5 stored replay');
 perform pg_temp.k_error(payload||'{"kind":"instrument"}','22023');
 perform pg_temp.k_assert((select count(*)=override_count+1 from private.stockflow_growth_item_kind_overrides)
  and (select count(*)=audit_count+1 from private.stockflow_economic_audit where action='set_item_kind'),'K5 one override and audit on replay');
 perform pg_temp.k_assert(exists(select 1 from private.stockflow_economic_audit a
  join private.stockflow_growth_item_kind_overrides o on o.id=a.entity_id
  where a.action='set_item_kind' and a.payload=checks.payload and a.actor='growth-kind-management@test.local'
   and o.actor=a.actor and o.reason='Management exception'),'K5 audit entity and actor');
 perform pg_temp.k_call(pg_temp.k_payload('threshold','instrument','later-command'));
 perform pg_temp.k_assert(pg_temp.k_call(payload)=result,'K5 replay returns original result after later override');
 perform pg_temp.k_assert((select kind='instrument' from private.stockflow_growth_item_kind('growth-kind-co','threshold')),
  'K5 replay does not overwrite newer decision');

 -- K6. Append-only enforcement and private ACLs.
 foreach operation in array array['update','delete'] loop
  begin
   if operation='update' then
    update private.stockflow_growth_item_kind_overrides set reason='Changed fixture' where company_id='growth-kind-co';
   else delete from private.stockflow_growth_item_kind_overrides where company_id='growth-kind-co';end if;
   raise exception 'K6 immutable operation was accepted';
  exception when sqlstate '42501' or sqlstate '55000' then null;end;
 end loop;
 perform pg_temp.k_assert((select relrowsecurity from pg_class where oid='private.stockflow_growth_item_kind_overrides'::regclass),'K6 RLS');
 foreach actor_name in array array['anon','authenticated','service_role'] loop
  perform pg_temp.k_assert(not has_table_privilege(actor_name,'private.stockflow_growth_item_kind_overrides','SELECT,INSERT,UPDATE,DELETE')
   and not has_function_privilege(actor_name,'private.stockflow_growth_item_kinds()','EXECUTE')
   and not has_function_privilege(actor_name,'private.stockflow_growth_item_kind(text,text)','EXECUTE'),'K6 private ACL '||actor_name);
 end loop;

 -- K7. Compare actual pre-patch calls, preserving brand-link state as brandKind.
 perform pg_temp.k_call(pg_temp.k_payload('threshold','consumable','display-costly-reagent'));
 perform pg_temp.k_call(pg_temp.k_payload('under','instrument','display-inexpensive-instrument'));
 insert into private.stockflow_brand_item_links(tally_item_key,kind,brand_code,recorded_by)
 values('Kind fixture instrument','brand','SYSMEX','growth-kind-management@test.local');
 before_read:=pg_temp.before_gateway('growth-kind-key','growth-kind-management@test.local','get_brand_mapping','{"q":"Kind fixture"}');
 after_read:=public.stockflow_brand_mapping_gateway('growth-kind-key','growth-kind-management@test.local','get_brand_mapping','{"q":"Kind fixture"}')-array['tree','catalogObservedAt'];
 perform pg_temp.k_assert((after_read-'items')::text=(before_read-'items')::text,'K7 all other top-level keys byte-identical');
 select (after_read-'items')||jsonb_build_object('items',jsonb_agg(
  (item-array['kind','kindSource','brandKind','companyId','productId','autoKind'])
   ||jsonb_build_object('kind',item->'brandKind') order by ordinal))
 into result from jsonb_array_elements(after_read->'items') with ordinality rows(item,ordinal);
 perform pg_temp.k_assert(result::text=before_read::text,'K7 every original item field and ordering preserved');
 perform pg_temp.k_assert((select bool_and(item ?& array['companyId','productId','autoKind','kind','kindSource']
  and item->>'companyId'='growth-kind-co' and item->>'productId'=replace(item->>'itemKey','Kind fixture ',''))
  from jsonb_array_elements(after_read->'items') item),'K7 all five fields and canonical catalog identifiers');
 select item into row_data from jsonb_array_elements(after_read->'items') item where item->>'itemKey'='Kind fixture instrument';
 perform pg_temp.k_assert(row_data->>'kind'='instrument' and row_data->>'kindSource'='auto'
  and row_data->>'autoKind'='instrument' and row_data->>'companyId'='growth-kind-co' and row_data->>'productId'='instrument'
  and row_data->>'brandKind'='brand' and row_data->>'brandCode'='SYSMEX','K7 automatic kind beside existing brand mapping');
 select item into row_data from jsonb_array_elements(after_read->'items') item where item->>'itemKey'='Kind fixture threshold';
 perform pg_temp.k_assert(row_data->>'kind'='consumable' and row_data->>'kindSource'='override'
  and row_data->>'autoKind'='instrument' and row_data->>'companyId'='growth-kind-co' and row_data->>'productId'='threshold',
  'K7 costly reagent override retains automatic instrument rule');
 select item into row_data from jsonb_array_elements(after_read->'items') item where item->>'itemKey'='Kind fixture under';
 perform pg_temp.k_assert(row_data->>'kind'='instrument' and row_data->>'kindSource'='override'
  and row_data->>'autoKind'='consumable' and row_data->>'companyId'='growth-kind-co' and row_data->>'productId'='under',
  'K7 instrument override retains automatic consumable rule');
 select item into row_data from jsonb_array_elements(after_read->'items') item where item->>'itemKey'='Kind fixture catalog-only';
 perform pg_temp.k_assert(row_data->>'kind'='consumable' and row_data->>'kindSource'='auto'
  and row_data->>'autoKind'='consumable','K7 catalog-only auto has no purchase cost');

 -- K8. The runner executes the unchanged GP1-GP12 file immediately before this test.
 -- Compare the legacy GP function again through the normal get_growth entry point.
 f:=pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure);
 anchor:='return private.stockflow_growth_read((now() at time zone ''Asia/Kolkata'')::date,roles);';
 perform pg_temp.k_assert((length(f)-length(replace(f,anchor,'')))/length(anchor)=1,'K8 gateway clock anchor');
 execute replace(f,anchor,'return private.stockflow_growth_read(''2031-07-15''::date,roles);');
 before_read:=private.stockflow_growth_read(today,array['management']);
 started:=clock_timestamp();
 after_read:=public.stockflow_growth_gateway('growth-kind-key','growth-kind-management@test.local','get_growth');
 elapsed:=clock_timestamp()-started;
 perform pg_temp.k_assert(after_read=before_read,'K8 gateway read parity');
 perform pg_temp.k_assert(pg_temp.k_old_gp(after_read->'gp')::text=pg_temp.before_gp(today)::text,'K8 legacy GP byte parity at gateway');
 perform pg_temp.k_assert(elapsed<interval '2 seconds','K8 get_growth under 2 seconds');
 raise notice 'K8 get_growth duration %',elapsed;
 -- Use the original GP function inside the Growth read and compare its entire non-GP payload.
 f:=pg_get_functiondef('private.stockflow_growth_read(date,text[])'::regprocedure);
 execute replace(f,'private.stockflow_growth_gp(p_today)','pg_temp.before_gp(p_today)');
 before_read:=private.stockflow_growth_read(today,array['management']);
 perform pg_temp.k_assert((after_read-'gp')::text=(before_read-'gp')::text,'K8 entire existing Growth payload byte-identical');
end$test$;
rollback;

drop table public.test_growth_item_kind_before;
do $$begin
 if exists(select 1 from private.stockflow_growth_item_kind_overrides where company_id='growth-kind-co')
  or exists(select 1 from private.stockflow_economic_source_vouchers where company_id like 'growth-kind-%')
  or exists(select 1 from public.stockflow_members where email like 'growth-kind-%@test.local') then
  raise exception 'Item kind fixture leaked';end if;
 raise notice 'PASS growth item kind K1-K8';
end$$;
