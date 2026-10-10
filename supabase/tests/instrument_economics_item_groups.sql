begin;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('economic-group-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status) values('group-manager@test.local','management','active'),('group-account@test.local','accounts','active');
insert into public.stockflow_snapshots(id,company,fetched_at,payload) values('suprabha','SUPRABHA DISTRIBUTORS',now()::text,'{"catalog":[]}'::jsonb) on conflict(id) do nothing;
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values('aaaaaaaa-eeee-4eee-8eee-eeeeeeeeeeee','Group fixture customer','group-fixture-customer','test');
-- This suite covers the manual purchase-cost path; automatic costing has its own suite.
insert into private.stockflow_economic_policy_versions(actor,reason,automatic_purchase_cost) values('test','Manual purchase-cost verification path fixture',false);
insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,created_by_email,updated_by_email,idempotency_key) values('aaaaaaaa-eeee-4eee-8eee-eeeeeeeeeeed','GROUP-TEST-ORDER','aaaaaaaa-eeee-4eee-8eee-eeeeeeeeeeee','Group fixture customer','phone','delivered','test','test','group-order-fixture');
insert into private.stockflow_equipment_installations(id,order_id,tally_key,item_name,status,scheduled_date,serial_number,created_by_email,completed_at) values('aaaaaaaa-eeee-4eee-8eee-eeeeeeeeeeec','aaaaaaaa-eeee-4eee-8eee-eeeeeeeeeeed','group-instrument','Group instrument','completed',private.stockflow_economic_business_date()-60,'GROUP-SERIAL','test',now()-interval '60 days');

do $test$
declare period date:=(date_trunc('month',private.stockflow_economic_business_date())-interval '1 month')::date;
 catalog jsonb;next_catalog jsonb;doc jsonb;vouchers jsonb;target uuid;catalog_id uuid;payload jsonb;receipt jsonb;workspace jsonb;row record;sale_id uuid;purchase_id uuid;count_before integer;
begin
 catalog:='{"groups":[{"id":"chemistry","name":"Chemistry","parentId":null},{"id":"reagents","name":"Reagents","parentId":"chemistry"},{"id":"other","name":"Other","parentId":null}],"products":[{"id":"a","name":"Same display name","groupId":"reagents","unit":"pack"},{"id":"b","name":"Reagent B","groupId":"chemistry","unit":"pack"},{"id":"x","name":"Same display name","groupId":"other","unit":"pack"}]}'::jsonb;
 select jsonb_agg(jsonb_build_object('sourceId',s.id,'revision','1','date',period+s.day,'kind',s.kind,'amountStatus','verified','customerSourceId',case when s.kind='sale' then 'group-customer-guid' else null end,'lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId',s.product,'quantity','1','unit','pack','netSalesPaise',s.amount)))) into vouchers
 from (values('purchase-a','purchase','a','3200000',1),('purchase-b','purchase','b','500000',1),('purchase-x','purchase','x','1000000',1),('sale-a','sale','a','5000000',3),('sale-b','sale','b','1000000',3),('sale-x','sale','x','99999999',3)) s(id,kind,product,amount,day);
 doc:=jsonb_build_object('schemaVersion',1,'companyId','group-company','sourceVersion',(period::timestamp at time zone 'Asia/Kolkata')::text,'itemCatalog',catalog,'completeWindow',true,'windowFrom',period,'windowTo',(period+interval '1 month')::date,'vouchers',vouchers);
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 if exists(select 1 from public.stockflow_snapshots s where s.payload ? 'economicEvidence') then raise exception 'Private group catalog leaked into public stock snapshot';end if;
 select id into catalog_id from private.stockflow_economic_item_catalogs where company_id='group-company';
 if catalog_id is null then raise exception 'Canonical item-group catalog was not imported';end if;
 receipt:=public.stockflow_economics_gateway('economic-group-key','group-manager@test.local','create_target',jsonb_build_object('kind','placement','name','Group mapped instrument','companyId','group-company','customerId','aaaaaaaa-eeee-4eee-8eee-eeeeeeeeeeee','customerSourceId','group-customer-guid','siteId','group-site','modelId','group-model','installationId','aaaaaaaa-eeee-4eee-8eee-eeeeeeeeeeec','effectiveFrom',period-10,'capitalPaise','0','idempotencyKey','group-create-0000001'));
 target:=(receipt->>'entityId')::uuid;
 perform public.stockflow_economics_gateway('economic-group-key','group-manager@test.local','set_expectation',jsonb_build_object('targetId',target,'effectiveFrom',period-10,'monthlyRevenuePaise','6000000','monthlyGpPaise','2300000','reason','Reviewed fixture baseline','idempotencyKey','group-baseline-00001'));
 payload:=jsonb_build_object('targetId',target,'groupId','chemistry','expectedCatalogId',catalog_id,'effect','include','effectiveFrom',period,'reason','Reviewed all group items including descendants','idempotencyKey','group-map-0000000001','mappedProductIds','["x"]'::jsonb);
 receipt:=public.stockflow_economics_gateway('economic-group-key','group-manager@test.local','set_item_group_mapping',payload);
 if receipt<>public.stockflow_economics_gateway('economic-group-key','group-manager@test.local','set_item_group_mapping',payload) then raise exception 'Group command replay changed';end if;
 if (select count(*) from private.stockflow_economic_item_group_mappings where target_id=target)<>1 then raise exception 'Group mapping replay duplicated a rule';end if;
 if not exists(select 1 from private.stockflow_economic_audit a where a.action='set_item_group_mapping' and a.entity_id=(receipt->>'entityId')::uuid and a.payload->'mappedProductIds'='["a","b"]'::jsonb) then raise exception 'Group mapping audit trusted caller products or omitted subgroup products';end if;
 begin
  perform public.stockflow_economics_gateway('economic-group-key','group-account@test.local','set_item_group_mapping',payload||'{"idempotencyKey":"group-account-denied"}');raise exception 'Accounts changed group mapping';
 exception when insufficient_privilege then null;end;
 perform public.stockflow_economics_gateway('economic-group-key','group-manager@test.local','approve_target',jsonb_build_object('targetId',target,'expectedVersion',1,'expectedGeneration',(select id from private.stockflow_economic_runs where active),'decision','approved','reason','Reviewed no-capital placement','idempotencyKey','group-approve-000001'));
 for row in select * from (values('a'),('b'),('x')) s(product) loop
  select l.id into sale_id from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id='group-company' and v.source_id='sale-'||row.product;
  select l.id into purchase_id from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id='group-company' and v.source_id='purchase-'||row.product;
  perform public.stockflow_economics_gateway('economic-group-key','group-manager@test.local','verify_cost',jsonb_build_object('sourceLineId',sale_id,'purchaseAllocations',jsonb_build_array(jsonb_build_object('purchaseLineId',purchase_id,'quantity','1')),'evidenceReference','Reviewed original historical purchase','idempotencyKey','group-cost-initial-'||row.product));
 end loop;
 workspace:=public.stockflow_economics_gateway('economic-group-key','group-account@test.local','get_instrument_economics','{}');
 if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=target::text and t->>'revenuePaise'='6000000' and t->>'knownGpPaise'='2300000') then raise exception 'Group sales/GP include outside items or omit nested items';end if;
 if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=target::text
  and jsonb_array_length(t->'itemBreakdown')=2
  and (select sum((i->>'knownCostPaise')::bigint) from jsonb_array_elements(t->'itemBreakdown') i)=3700000
  and not exists(select 1 from jsonb_array_elements(t->'itemBreakdown') i where i->>'productId'='x')) then raise exception 'Item summary counts unmapped sales or loses verified purchase cost';end if;
 if not exists(select 1 from jsonb_array_elements(workspace->'itemGroupCatalogs') c,jsonb_array_elements(c->'groups') g where c->>'companyId'='group-company' and g->>'id'='chemistry' and g->>'itemCount'='2') then raise exception 'Read model does not count descendants';end if;
 if private.stockflow_economic_mapping_effect('another-company','group-model',target,'a',period+3) is not null then raise exception 'Group identity crossed company';end if;

 -- A new observed catalog adds C and moves B out. It cannot restate earlier B sales.
 next_catalog:=jsonb_set(catalog,'{products,1,groupId}','"other"'::jsonb);
 next_catalog:=jsonb_set(next_catalog,'{products}',next_catalog->'products'||'[{"id":"c","name":"New reagent","groupId":"reagents","unit":"pack"}]'::jsonb);
 select jsonb_agg(jsonb_build_object('sourceId',s.id,'revision','1','date',period+s.day,'kind',s.kind,'amountStatus','verified','customerSourceId',case when s.kind='sale' then 'group-customer-guid' else null end,'lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId',s.product,'quantity',s.quantity,'unit','pack','netSalesPaise',s.amount)))) into vouchers
 from (values('purchase-c','purchase','c','2000000','2',8),('sale-c-before','sale','c','2000000','1',10),('sale-c-after','sale','c','2000000','1',20),('sale-b-after','sale','b','1000000','1',20)) s(id,kind,product,amount,quantity,day);
 doc:=doc||jsonb_build_object('sourceVersion',((period+15)::timestamp at time zone 'Asia/Kolkata')::text,'itemCatalog',next_catalog,'completeWindow',false,'vouchers',vouchers);
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 if private.stockflow_economic_mapping_effect('group-company','group-model',target,'c',period+10) is not null or private.stockflow_economic_mapping_effect('group-company','group-model',target,'c',period+20)<>'include' or private.stockflow_economic_mapping_effect('group-company','group-model',target,'b',period+3)<>'include' or private.stockflow_economic_mapping_effect('group-company','group-model',target,'b',period+20) is not null then raise exception 'Group additions/removals changed the wrong dates';end if;
 select l.id into sale_id from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id='group-company' and v.source_id='sale-c-after';
 select l.id into purchase_id from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id='group-company' and v.source_id='purchase-c';
 workspace:=public.stockflow_economics_gateway('economic-group-key','group-manager@test.local','get_instrument_economics','{}');
 if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=target::text and (t->>'missingCostLines')::int=1 and t->>'knownGpPaise'='2300000') then raise exception 'New group product invented cost or GP';end if;
 if not exists(select 1 from jsonb_array_elements(workspace->'targets') t,jsonb_array_elements(t->'itemBreakdown') i
  where t->>'id'=target::text and i->>'productId'='c' and i->>'revenuePaise'='2000000'
  and i->>'knownCostPaise' is null and i->>'knownGpPaise' is null and i->>'missingCostLines'='1') then raise exception 'Item summary invented zero cost or GP for an unavailable purchase';end if;
 perform public.stockflow_economics_gateway('economic-group-key','group-manager@test.local','verify_cost',jsonb_build_object('sourceLineId',sale_id,'purchaseAllocations',jsonb_build_array(jsonb_build_object('purchaseLineId',purchase_id,'quantity','1')),'evidenceReference','Verified new reagent historical purchase','idempotencyKey','group-new-cost-00001'));
 workspace:=public.stockflow_economics_gateway('economic-group-key','group-manager@test.local','get_instrument_economics','{}');
 if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=target::text and t->>'revenuePaise'='8000000' and t->>'knownGpPaise'='3300000') then raise exception 'Later group product did not flow through real net sales and purchase GP';end if;
 count_before:=(select count(*) from private.stockflow_economic_item_group_mappings);
 begin perform public.stockflow_economics_gateway('economic-group-key','group-manager@test.local','set_item_group_mapping',payload||'{"idempotencyKey":"group-stale-catalog"}');raise exception 'Stale group preview accepted';exception when sqlstate 'PT409' then null;end;
 if count_before<>(select count(*) from private.stockflow_economic_item_group_mappings) or exists(select 1 from private.stockflow_command_results where idempotency_key='group-stale-catalog') then raise exception 'Stale group command partially committed';end if;

 -- Direct product exclusions remain explicit exceptions to a group rule.
 perform public.stockflow_economics_gateway('economic-group-key','group-manager@test.local','set_mapping',jsonb_build_object('companyId','group-company','modelId','group-model','productId','a','targetId',target,'effect','exclude','effectiveFrom',period+25,'reason','Explicitly excluded non-reagent use','idempotencyKey','group-product-exclude'));
 if private.stockflow_economic_mapping_effect('group-company','group-model',target,'a',period+26)<>'exclude' or private.stockflow_economic_mapping_effect('group-company','group-model',target,'a',period+3)<>'include' then raise exception 'Product exclusion does not override group at the right date';end if;
 -- Add a separate individual item alongside the full group; its older sales stay outside.
 perform public.stockflow_economics_gateway('economic-group-key','group-manager@test.local','set_mapping',jsonb_build_object('companyId','group-company','modelId','group-model','productId','x','targetId',target,'effect','include','effectiveFrom',period+22,'reason','Verified separate individual reagent alongside group','idempotencyKey','group-plus-individual'));
 if private.stockflow_economic_mapping_effect('group-company','group-model',target,'x',period+23)<>'include' or private.stockflow_economic_mapping_effect('group-company','group-model',target,'x',period+3) is not null then raise exception 'Individual item did not combine with dated group mapping';end if;
 select jsonb_agg(jsonb_build_object('sourceId',s.id,'revision','1','date',period+s.day,'kind',s.kind,'amountStatus','verified','customerSourceId',case when s.kind='sale' then 'group-customer-guid' else null end,'lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','x','quantity','1','unit','pack','netSalesPaise',s.amount)))) into vouchers from (values('purchase-extra-x','purchase','100000',21),('sale-extra-x','sale','300000',23)) s(id,kind,amount,day);
 doc:=doc||jsonb_build_object('sourceVersion',((period+24)::timestamp at time zone 'Asia/Kolkata')::text,'vouchers',vouchers);
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 select l.id into sale_id from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id='group-company' and v.source_id='sale-extra-x';
 select l.id into purchase_id from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id='group-company' and v.source_id='purchase-extra-x';
 perform public.stockflow_economics_gateway('economic-group-key','group-manager@test.local','verify_cost',jsonb_build_object('sourceLineId',sale_id,'purchaseAllocations',jsonb_build_array(jsonb_build_object('purchaseLineId',purchase_id,'quantity','1')),'evidenceReference','Verified independent additional reagent purchase','idempotencyKey','group-individual-cost'));
 workspace:=public.stockflow_economics_gateway('economic-group-key','group-manager@test.local','get_instrument_economics','{}');
 if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=target::text and t->>'revenuePaise'='8300000' and t->>'knownGpPaise'='3500000') then raise exception 'Group plus individual item double counted or omitted actual revenue/GP';end if;
 -- A linked return inherits its original group attribution despite later exclusion.
 select l.id into sale_id from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id='group-company' and v.source_id='sale-a';
 doc:=doc||jsonb_build_object('sourceVersion',((period+24)::timestamp at time zone 'Asia/Kolkata')::text,'vouchers',jsonb_build_array(jsonb_build_object('sourceId','return-a','revision','1','date',period+26,'kind','return','amountStatus','verified','customerSourceId','group-customer-guid','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','a','quantity','-0.2','unit','pack','netSalesPaise','-1000000')))));
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 select l.id into purchase_id from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id='group-company' and v.source_id='return-a';
 perform public.stockflow_economics_gateway('economic-group-key','group-manager@test.local','resolve_line',jsonb_build_object('sourceLineId',purchase_id,'originalSaleLineId',sale_id,'reason','Verified linked reagent return after exclusion','idempotencyKey','group-return-review-01'));
 workspace:=public.stockflow_economics_gateway('economic-group-key','group-manager@test.local','get_instrument_economics','{}');
 if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=target::text and t->>'revenuePaise'='7300000' and t->>'knownGpPaise'='3140000') then raise exception 'Return lost original group attribution or original purchase cost';end if;
 -- Group rename keeps the canonical mapping. A rejected newer hierarchy fails visibly.
 next_catalog:=jsonb_set(next_catalog,'{groups,0,name}','"Renamed chemistry"'::jsonb);
 doc:=doc||jsonb_build_object('sourceVersion',((period+26)::timestamp at time zone 'Asia/Kolkata')::text,'itemCatalog',next_catalog,'vouchers','[]'::jsonb);
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 if private.stockflow_economic_mapping_effect('group-company','group-model',target,'c',period+27)<>'include' then raise exception 'Group rename broke canonical mapping';end if;
 doc:=doc||jsonb_build_object('sourceVersion',((period+27)::timestamp at time zone 'Asia/Kolkata')::text,'itemCatalog',jsonb_set(next_catalog,'{groups,0,parentId}','"reagents"'::jsonb));
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 if private.stockflow_economic_item_catalog_current('group-company') or private.stockflow_economic_mapping_effect('group-company','group-model',target,'c',period+27) is not null or private.stockflow_economic_mapping_effect('group-company','group-model',target,'x',period+27)<>'include' then raise exception 'Rejected hierarchy silently used old group membership';end if;
 if not exists(select 1 from private.stockflow_economic_import_exceptions where company_id='group-company' and evidence->>'kind'='item_group_catalog') then raise exception 'Group source failure not audited';end if;
 doc:=doc||jsonb_build_object('sourceVersion',((period+28)::timestamp at time zone 'Asia/Kolkata')::text,'itemCatalog',next_catalog);
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 if not private.stockflow_economic_item_catalog_current('group-company') or private.stockflow_economic_mapping_effect('group-company','group-model',target,'c',period+28)<>'include' then raise exception 'Verified catalog recovery did not restore group mapping';end if;
 count_before:=(select count(*) from private.stockflow_economic_item_catalogs where company_id='group-company');
 doc:=doc||jsonb_build_object('sourceVersion',((period+29)::timestamp at time zone 'Asia/Kolkata')::text);
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 if count_before<>(select count(*) from private.stockflow_economic_item_catalogs where company_id='group-company') then raise exception 'Unchanged sync duplicated full catalog evidence';end if;
 workspace:=public.stockflow_economics_gateway('economic-group-key','group-manager@test.local','get_instrument_economics','{}');
 if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=target::text and t->>'revenuePaise'='7300000' and t->>'knownGpPaise'='3140000') or (select coalesce(sum(amount_paise),0) from private.stockflow_economic_events where target_id=target and kind<>'capital')<>3140000 then raise exception 'Catalog recovery duplicated or changed actual GP in the immutable ledger';end if;

 -- Explicitly including an already grouped product must not count it twice.
 perform public.stockflow_economics_gateway('economic-group-key','group-manager@test.local','set_mapping',jsonb_build_object('companyId','group-company','modelId','group-model','productId','c','targetId',target,'effect','include','effectiveFrom',period+15,'reason','Verified individual item already included in reagent group','idempotencyKey','group-individual-dedup'));
 workspace:=public.stockflow_economics_gateway('economic-group-key','group-manager@test.local','get_instrument_economics','{}');
 if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=target::text and t->>'revenuePaise'='7300000' and t->>'knownGpPaise'='3140000') then raise exception 'An item in both group and individual mappings counted twice';end if;
 if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=target::text
  and jsonb_array_length(t->'itemBreakdown')=4
  and (select sum((i->>'revenuePaise')::bigint) from jsonb_array_elements(t->'itemBreakdown') i)=7300000
  and (select sum((i->>'knownGpPaise')::bigint) from jsonb_array_elements(t->'itemBreakdown') i)=3140000
  and (select sum((i->>'sourceLines')::int) from jsonb_array_elements(t->'itemBreakdown') i)=5) then raise exception 'Item summary does not reconcile with monthly instrument totals';end if;
 if not exists(select 1 from jsonb_array_elements(workspace->'targets') t,jsonb_array_elements(t->'itemBreakdown') i
  where t->>'id'=target::text and i->>'productId'='a' and (i->>'quantity')::numeric=0.8
  and i->>'revenuePaise'='4000000' and i->>'knownCostPaise'='2560000' and i->>'knownGpPaise'='1440000'
  and i->>'sourceLines'='2') then raise exception 'Per-item GP did not net the inherited return quantity/revenue/cost';end if;
end$test$;
rollback;
