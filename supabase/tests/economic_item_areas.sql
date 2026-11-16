begin;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('item-area-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status) values('item-area-manager@test.local','management','active'),('item-area-accounts@test.local','accounts','active'),('item-area-ops@test.local','operations','active');
insert into public.stockflow_snapshots(id,company,fetched_at,payload) values('suprabha','SUPRABHA DISTRIBUTORS',now()::text,'{"catalog":[]}'::jsonb) on conflict(id) do nothing;
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','Item area customer','item-area-customer','test');
insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,created_by_email,updated_by_email,idempotency_key) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02','ITEM-AREA-ORDER','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','Item area customer','phone','delivered','test','test','item-area-order-fixture');
insert into private.stockflow_equipment_installations(id,order_id,tally_key,item_name,status,scheduled_date,serial_number,created_by_email,completed_at) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02','item-area-instrument','Item area instrument','completed',private.stockflow_economic_business_date()-60,'ITEM-AREA-SERIAL','test',now()-interval '60 days');

create function pg_temp.ea_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',label;end if;end$$;
create function pg_temp.ea_call(action text,payload jsonb) returns jsonb language sql as $$
 select public.stockflow_economics_gateway('item-area-key','item-area-manager@test.local',action,
  jsonb_build_object('idempotencyKey','item-area-'||extensions.gen_random_uuid()::text)||payload)
$$;
create function pg_temp.ea_counts() returns jsonb language sql as $$
 select jsonb_build_array(
  (select count(*) from private.stockflow_economic_item_area_links),
  (select count(*) from private.stockflow_economic_mappings),
  (select count(*) from private.stockflow_economic_item_group_mappings),
  (select count(*) from private.stockflow_economic_runs),
  (select count(*) from private.stockflow_economic_audit),
  (select count(*) from private.stockflow_command_results))
$$;
create function pg_temp.ea_reject(action text,payload jsonb,code text,label text,message_pattern text default '%') returns void language plpgsql as $$
declare before_counts jsonb:=pg_temp.ea_counts(); caught boolean:=false;
begin
 begin perform pg_temp.ea_call(action,payload);
 exception when others then
  if sqlstate<>code or sqlerrm not like message_pattern then raise exception '%: wrong failure %: %',label,sqlstate,sqlerrm;end if;
  caught:=true;
 end;
 perform pg_temp.ea_assert(caught and pg_temp.ea_counts()=before_counts,label||': expected refusal with no partial writes');
end$$;
create function pg_temp.ea_results(target uuid) returns jsonb language sql as $$
 select coalesce(jsonb_agg(to_jsonb(r)-'id'-'run_id' order by r.source_line_id,r.status),'[]'::jsonb)
 from private.stockflow_economic_results r join private.stockflow_economic_runs u on u.id=r.run_id and u.active where r.target_id=target
$$;

do $test$
declare period date:=(date_trunc('month',private.stockflow_economic_business_date())-interval '1 month')::date;
 catalog jsonb;fixture_catalog_id uuid;doc jsonb;vouchers jsonb;target uuid;payload jsonb;batch jsonb;workspace jsonb;view_name text;row_value jsonb;
 old_link uuid;new_link uuid;runs_before bigint;maps_before bigint;groups_before bigint;results_before jsonb;effect_before text;coverage_before jsonb;
 receipt jsonb;replayed jsonb;counts_before jsonb;bad jsonb;test_role text;
begin
 catalog:='{"groups":[{"id":"g","name":"Sysmex","parentId":null}],"products":[{"id":"p1","name":"Coagulation reagent","groupId":"g","unit":"pack"},{"id":"p2","name":"Coagulation control","groupId":"g","unit":"pack"},{"id":"p3","name":"CBC reagent","groupId":"g","unit":"pack"}]}'::jsonb;
 select jsonb_agg(jsonb_build_object('sourceId',s.id,'revision','1','date',period+s.day,'kind',s.kind,'amountStatus','verified','sourceReference',s.id,
  'customerSourceId',case when s.kind='sale' then 'item-area-customer-guid' else null end,'siteId','item-area-site',
  'lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','p1','quantity',s.qty,'unit','pack','netSalesPaise',s.amount)))) into vouchers
 from (values ('area-purchase','purchase','10','10000',0),('area-sale','sale','1','5000',5)) s(id,kind,qty,amount,day);
 doc:=jsonb_build_object('schemaVersion',1,'companyId','item-area-company','sourceVersion',(period::timestamp at time zone 'Asia/Kolkata')::text,'itemCatalog',catalog,
  'completeWindow',true,'windowFrom',period,'windowTo',(period+interval '1 month')::date,'vouchers',vouchers);
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 target:=(pg_temp.ea_call('create_target',jsonb_build_object('kind','placement','name','Area metadata instrument','companyId','item-area-company',
  'customerId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','customerSourceId','item-area-customer-guid','siteId','item-area-site','modelId','item-area-model',
  'installationId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03','effectiveFrom',period-10,'capitalPaise','0'))->>'entityId')::uuid;
 select id into fixture_catalog_id from private.stockflow_economic_item_catalogs where company_id='item-area-company' order by observed_at desc,id desc limit 1;
 perform pg_temp.ea_call('set_mapping',jsonb_build_object('companyId','item-area-company','modelId','item-area-model','targetId',target,
  'productId','p1','effect','include','effectiveFrom',period-10,'reason','Initial attribution fixture'));
 -- Ensure a non-empty attribution comparison, including real sale/cost amounts.
 perform pg_temp.ea_call('approve_target',jsonb_build_object('targetId',target,'expectedVersion',(select version from private.stockflow_economic_targets where id=target),
  'expectedGeneration',(select id from private.stockflow_economic_runs where active),'decision','approved','reason','Track actuals for area fixture'));
 results_before:=pg_temp.ea_results(target);
 perform pg_temp.ea_assert(jsonb_array_length(results_before)=1 and results_before->0->>'revenue_paise'='5000','A8 non-empty attribution fixture');
 effect_before:=private.stockflow_economic_mapping_effect('item-area-company','item-area-model',target,'p1',period+5);
 coverage_before:=public.stockflow_economics_gateway('item-area-key','item-area-manager@test.local','get_sales_coverage','{}');
 runs_before:=(select count(*) from private.stockflow_economic_runs);

 -- A1: one command tags two items; all three workspace views expose the metadata.
 payload:=jsonb_build_object('companyId','item-area-company','reason','Coagulation items in shared group','areaCode','COAG',
  'items','[{"productId":"p2","expectedLinkId":null},{"productId":"p1","expectedLinkId":null}]'::jsonb,'idempotencyKey','item-area-tag-000001');
 receipt:=pg_temp.ea_call('set_item_areas',payload);
 perform pg_temp.ea_assert((select count(*)=2 from private.stockflow_economic_item_area_links where company_id='item-area-company' and area_code='COAG' and recorded_by='item-area-manager@test.local' and reason='Coagulation items in shared group'),'A1 two area links');
 foreach view_name in array array['summary','detail','full'] loop
  workspace:=public.stockflow_economics_gateway('item-area-key','item-area-manager@test.local','get_instrument_economics',jsonb_build_object('view',view_name));
  perform pg_temp.ea_assert(workspace->>'readView'=view_name and (select count(*)=2 from jsonb_array_elements(workspace->'itemAreas') a where a->>'companyId'='item-area-company' and a->>'areaCode'='COAG' and a->>'linkId' is not null),'A1 read areas in '||view_name);
  perform pg_temp.ea_assert(workspace->'labAreas'=(select jsonb_agg(jsonb_build_object('code',code,'name',name) order by sort_order,code) from private.stockflow_lab_areas where active),'A1 active ordered lab areas in '||view_name);
 end loop;
 old_link:=(select id from private.stockflow_economic_item_area_links where company_id='item-area-company' and product_id='p1');
 -- Idempotent retry and recovery both retain one batch and one audit row.
 counts_before:=pg_temp.ea_counts();replayed:=pg_temp.ea_call('set_item_areas',payload);
 perform pg_temp.ea_assert(receipt=replayed and pg_temp.ea_counts()=counts_before,'A1 idempotent retry');
 perform pg_temp.ea_assert(public.stockflow_economics_gateway('item-area-key','item-area-manager@test.local','recover_economic_command',
  '{"commandAction":"set_item_areas","commandKey":"item-area-tag-000001","closeUnresolved":false}')->>'status'='accepted','A1 recovery allowlist');
 payload:=payload-'idempotencyKey';

 -- A2: a stale expected link rejects the whole command.
 perform pg_temp.ea_reject('set_item_areas',payload||'{"items":[{"productId":"p1","expectedLinkId":null}]}','PT409','A2 stale link','Item p1 area changed; refresh and try again');
 -- A3: unknown and inactive areas are rejected, including inactive options in reads.
 perform pg_temp.ea_reject('set_item_areas',payload||'{"areaCode":"UNKNOWN"}','22023','A3 unknown area');
 update private.stockflow_lab_areas set active=false where code='COAG';
 perform pg_temp.ea_reject('set_item_areas',payload,'22023','A3 inactive area');
 workspace:=public.stockflow_economics_gateway('item-area-key','item-area-manager@test.local','get_instrument_economics','{"view":"summary"}');
 perform pg_temp.ea_assert(not exists(select 1 from jsonb_array_elements(workspace->'labAreas') a where a->>'code'='COAG'),'A3 inactive option hidden');
 update private.stockflow_lab_areas set active=true where code='COAG';
 -- A4: a product is scoped to the selected company's current catalog.
 perform pg_temp.ea_reject('set_item_areas',payload||'{"items":[{"productId":"absent","expectedLinkId":null}]}','22023','A4 unknown item','Item absent is not in the current catalog');
 perform pg_temp.ea_reject('set_item_areas',payload||'{"companyId":"another-company"}','22023','A4 company isolation');
 -- A5: two valid new writes before an invalid final product must both roll back.
 batch:=payload||jsonb_build_object('items',jsonb_build_array(jsonb_build_object('productId','p1','expectedLinkId',old_link),
  jsonb_build_object('productId','p3','expectedLinkId',null),jsonb_build_object('productId','z-bad','expectedLinkId',null)));
 perform pg_temp.ea_reject('set_item_areas',batch,'22023','A5 atomic three-item batch','Item z-bad is not in the current catalog');
 perform pg_temp.ea_reject('set_item_areas',payload||jsonb_build_object('items',jsonb_build_array(jsonb_build_object('productId','p1','expectedLinkId',old_link),jsonb_build_object('productId','p2','expectedLinkId',null))),
  'PT409','A5 atomic stale second item','Item p2 area changed; refresh and try again');
 -- A6: clearing appends a new optimistic concurrency token, even within this transaction.
 perform pg_temp.ea_call('set_item_areas',payload||jsonb_build_object('areaCode',null,'items',jsonb_build_array(jsonb_build_object('productId','p1','expectedLinkId',old_link))));
 select id into new_link from private.stockflow_economic_item_area_links where company_id='item-area-company' and product_id='p1' order by recorded_at desc,id desc limit 1;
 foreach view_name in array array['summary','detail','full'] loop
  workspace:=public.stockflow_economics_gateway('item-area-key','item-area-manager@test.local','get_instrument_economics',jsonb_build_object('view',view_name));
  select a into row_value from jsonb_array_elements(workspace->'itemAreas') a where a->>'companyId'='item-area-company' and a->>'productId'='p1';
  perform pg_temp.ea_assert(new_link<>old_link and row_value->'areaCode'='null'::jsonb and row_value->>'linkId'=new_link::text,'A6 null clear in '||view_name);
 end loop;
 -- Retag the attributed product, so A8 also tests a non-null area during rebuild.
 perform pg_temp.ea_call('set_item_areas',payload||jsonb_build_object('items',jsonb_build_array(jsonb_build_object('productId','p1','expectedLinkId',new_link))));
 -- A7: tagging, clearing, retries and all rejected commands do not rebuild.
 perform pg_temp.ea_assert((select count(*) from private.stockflow_economic_runs)=runs_before,'A7 metadata unexpectedly rebuilt economics');
 -- A8: neither mapping resolution, current attribution nor coverage changes.
 perform pg_temp.ea_assert(pg_temp.ea_results(target)=results_before and private.stockflow_economic_mapping_effect('item-area-company','item-area-model',target,'p1',period+5)=effect_before,'A8 tagging changed attribution');
 perform pg_temp.ea_assert(public.stockflow_economics_gateway('item-area-key','item-area-manager@test.local','get_sales_coverage','{}')=coverage_before,'A8 tagging changed coverage');
 perform pg_temp.ea_call('rebuild','{}');
 perform pg_temp.ea_assert(pg_temp.ea_results(target)=results_before,'A8 independent rebuild read area metadata');

 -- A9: group include and two exclusions are committed together with exactly one rebuild.
 batch:=jsonb_build_object('companyId','item-area-company','modelId','item-area-model','targetId',target,'reason','Shared group with coagulation excluded',
  'group',jsonb_build_object('groupId','g','expectedCatalogId',fixture_catalog_id,'effectiveFrom',period,'effectiveTo',period+20),
  'items',jsonb_build_array(jsonb_build_object('productId','p2','effect','exclude','effectiveFrom',period),jsonb_build_object('productId','p1','effect','exclude','effectiveFrom',period)),
  'idempotencyKey','item-area-combined-001');
 runs_before:=(select count(*) from private.stockflow_economic_runs);maps_before:=(select count(*) from private.stockflow_economic_mappings);groups_before:=(select count(*) from private.stockflow_economic_item_group_mappings);
 receipt:=pg_temp.ea_call('set_mappings',batch);
 perform pg_temp.ea_assert((select count(*) from private.stockflow_economic_runs)=runs_before+1 and (select count(*) from private.stockflow_economic_mappings)=maps_before+2
  and (select count(*) from private.stockflow_economic_item_group_mappings)=groups_before+1,'A9 combined save counts');
 perform pg_temp.ea_assert(exists(select 1 from private.stockflow_economic_item_group_mappings where company_id='item-area-company' and model_id='item-area-model' and target_id=target and group_id='g' and effect='include' and catalog_id=fixture_catalog_id and effective_from=period and effective_to=period+20)
  and (select count(*)=2 from private.stockflow_economic_mappings where target_id=target and product_id in ('p1','p2') and effective_from=period and effect='exclude'),'A9 rows have intended scope, dates and effects');
 perform pg_temp.ea_assert(private.stockflow_economic_mapping_effect('item-area-company','item-area-model',target,'p1',period+5)='exclude'
  and private.stockflow_economic_mapping_effect('item-area-company','item-area-model',target,'p2',period+5)='exclude'
  and private.stockflow_economic_mapping_effect('item-area-company','item-area-model',target,'p3',period+5)='include','A9 group and item resolution');
 counts_before:=pg_temp.ea_counts();
 perform pg_temp.ea_assert(pg_temp.ea_call('set_mappings',batch)=receipt and pg_temp.ea_counts()=counts_before,'A9 combined replay');
 batch:=batch-'idempotencyKey';
 -- A10: duplicate group date is a conflict; no item rows can escape the transaction.
 perform pg_temp.ea_reject('set_mappings',batch||jsonb_build_object('items',jsonb_build_array(jsonb_build_object('productId','p3','effect','exclude','effectiveFrom',period))),
  'PT409','A10 duplicate group','Group g was already changed for this date; refresh and try again');
 -- A11: IG1 still accepts a single item without a group and rejects an empty list.
 perform pg_temp.ea_call('set_mappings',(batch-'group')||jsonb_build_object('items',jsonb_build_array(jsonb_build_object('productId','p3','effect','include','effectiveFrom',period+1))));
 perform pg_temp.ea_assert((select count(*) from private.stockflow_economic_item_group_mappings)=groups_before+1 and (select count(*) from private.stockflow_economic_mappings)=maps_before+3,'A11 unchanged item-only save');
 perform pg_temp.ea_reject('set_mappings',(batch-'group')||'{"items":[]}','22023','A11 item-only empty batch');
 -- A12: both financial readers and operations are refused; no batch side effects.
 counts_before:=pg_temp.ea_counts();
 foreach test_role in array array['accounts','ops'] loop
  begin
   perform public.stockflow_economics_gateway('item-area-key','item-area-'||test_role||'@test.local','set_item_areas',payload||jsonb_build_object('idempotencyKey','item-area-denied-'||test_role));
   raise exception 'A12 unauthorized role saved areas';
  exception when insufficient_privilege then null;end;
 end loop;
 perform pg_temp.ea_assert(pg_temp.ea_counts()=counts_before,'A12 refused role left writes');

 -- Additional boundaries: strict payloads, UUIDs, maximum work, catalog freshness,
 -- group-only saves, and rollback of the group when a later item conflicts.
 for bad in select value from jsonb_array_elements(jsonb_build_array(
  payload-'areaCode',payload||'{"areaCode":12}',payload||'{"reason":"  "}',payload||'{"companyId":12}',payload||'{"extra":true}',
  payload||'{"items":[]}',payload||'{"items":null}',payload||'{"items":[{"productId":"p3"}]}',payload||'{"items":[{"productId":"p3","expectedLinkId":"bad"}]}',
  payload||'{"items":[{"productId":"p3","expectedLinkId":12}]}',payload||'{"items":[{"productId":" ","expectedLinkId":null}]}',
  payload||'{"items":[{"productId":"p3","expectedLinkId":null,"effect":"exclude"}]}',payload||'{"items":[{"productId":"p3","expectedLinkId":null},{"productId":" p3 ","expectedLinkId":null}]}',
  payload||jsonb_build_object('items',(select jsonb_agg(jsonb_build_object('productId','bulk-'||n,'expectedLinkId',null)) from generate_series(1,201) n))
 )) loop perform pg_temp.ea_reject('set_item_areas',bad,'22023','strict area payload');end loop;
 perform pg_temp.ea_reject('set_mappings',jsonb_set(batch,'{group,expectedCatalogId}',to_jsonb(extensions.gen_random_uuid()::text)),'PT409','stale group catalog');
 perform pg_temp.ea_reject('set_mappings',jsonb_set(batch,'{group,groupId}','"absent"'),'22023','unknown group');
 perform pg_temp.ea_reject('set_mappings',jsonb_set(batch,'{group,effectiveFrom}',to_jsonb((period+2)::text)),'PT409','item conflict rolls back group');
 runs_before:=(select count(*) from private.stockflow_economic_runs);
 perform pg_temp.ea_call('set_mappings',jsonb_set(batch,'{group,effectiveFrom}',to_jsonb((period+2)::text))||'{"items":[]}');
 perform pg_temp.ea_assert((select count(*) from private.stockflow_economic_runs)=runs_before+1,'group-only save rebuild count');

 -- Latest catalog wins; retired products disappear without erasing link history.
 insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
  select company_id,'area-new-catalog',observed_at+interval '1 day',jsonb_set(content,'{products}',(select jsonb_agg(p) from jsonb_array_elements(content->'products') p where p->>'id'<>'p2'))
  from private.stockflow_economic_item_catalogs where id=fixture_catalog_id;
 perform pg_temp.ea_reject('set_item_areas',payload||'{"items":[{"productId":"p2","expectedLinkId":null}]}','22023','retired catalog product');
 foreach view_name in array array['summary','detail','full'] loop
  workspace:=public.stockflow_economics_gateway('item-area-key','item-area-manager@test.local','get_instrument_economics',jsonb_build_object('view',view_name));
  perform pg_temp.ea_assert(not exists(select 1 from jsonb_array_elements(workspace->'itemAreas') a where a->>'productId'='p2'),'retired area omitted in '||view_name);
 end loop;
 -- Table remains private, immutable and append-only; gateway privileges unchanged.
 perform pg_temp.ea_assert((select relrowsecurity from pg_class where oid='private.stockflow_economic_item_area_links'::regclass),'area RLS');
 foreach test_role in array array['anon','authenticated','service_role'] loop
  perform pg_temp.ea_assert(not has_table_privilege(test_role,'private.stockflow_economic_item_area_links','select,insert,update,delete'),'area table grants: '||test_role);
  perform pg_temp.ea_assert(has_function_privilege(test_role,'public.stockflow_economics_gateway(text,text,text,jsonb)','execute')=(test_role='service_role'),'gateway grants: '||test_role);
 end loop;
 begin update private.stockflow_economic_item_area_links set area_code='HAEM' where id=new_link;raise exception 'Area update allowed';exception when sqlstate '55000' then null;end;
 begin delete from private.stockflow_economic_item_area_links where id=new_link;raise exception 'Area delete allowed';exception when insufficient_privilege then null;end;
 raise notice 'PASS economic item areas A1-A12';
end$test$;
rollback;
