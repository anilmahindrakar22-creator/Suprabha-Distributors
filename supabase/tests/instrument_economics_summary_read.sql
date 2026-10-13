begin;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('sale-date-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status) values('sale-date-manager@test.local','management','active');
insert into public.stockflow_snapshots(id,company,fetched_at,payload) values('suprabha','SUPRABHA DISTRIBUTORS',now()::text,'{"catalog":[]}'::jsonb) on conflict(id) do nothing;
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values('dededede-eeee-4eee-8eee-eeeeeeeeeeee','Sale date customer','sale-date-customer','test');
insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,created_by_email,updated_by_email,idempotency_key) values('dededede-eeee-4eee-8eee-eeeeeeeeeeed','SALE-DATE-ORDER','dededede-eeee-4eee-8eee-eeeeeeeeeeee','Sale date customer','phone','delivered','test','test','sale-date-order-fixture');
insert into private.stockflow_equipment_installations(id,order_id,tally_key,item_name,status,scheduled_date,serial_number,created_by_email,completed_at) values('dededede-eeee-4eee-8eee-eeeeeeeeeeec','dededede-eeee-4eee-8eee-eeeeeeeeeeed','date-instrument','Date instrument','completed',private.stockflow_economic_business_date()-20,'SALE-DATE-SERIAL','test',now()-interval '20 days');
-- Fixture lifecycle and sale-date amounts reuse the existing canonical sale-date scenario.
create function pg_temp.assert_economic_summary() returns void language plpgsql as $check$
declare full_read jsonb:=private.stockflow_economic_workspace(array['management']);
 summary jsonb:=public.stockflow_economics_gateway('sale-date-key','sale-date-manager@test.local','get_instrument_economics','{"view":"summary"}');
 item jsonb; expected jsonb; key text; todo bigint;
begin
 if summary->>'readView'<>'summary' then raise exception 'Summary contract missing';end if;
 foreach key in array array['sourceLines','attributionLines','itemGroupCatalogs','mappings','cases','leakage','customers','installations','exceptions'] loop
  if summary->key<>'[]'::jsonb then raise exception 'Evidence eagerly loaded: %',key;end if;
 end loop;
 if (summary-array['targets','readView','todoCount','sourceLines','attributionLines','itemGroupCatalogs','mappings','cases','leakage','customers','installations','exceptions','instrumentBillings','acquisitionLinks','acquisitionReviews','acquisitionReviewItems','itemGroupMappings','groupMemberships','allocations','observations','sourceDocumentExclusions','ledger','expectationHistory','caseHistory'])
 <> (full_read-array['targets','readView','todoCount','sourceLines','attributionLines','itemGroupCatalogs','mappings','cases','leakage','customers','installations','exceptions','instrumentBillings','acquisitionLinks','acquisitionReviews','acquisitionReviewItems','itemGroupMappings','groupMemberships','allocations','observations','sourceDocumentExclusions','ledger','expectationHistory','caseHistory']) then raise exception 'Summary metadata/totals differ';end if;
 if (select jsonb_agg(t-'itemBreakdown' order by t->>'id') from jsonb_array_elements(summary->'targets') t)
 <> (select jsonb_agg(t-'itemBreakdown' order by t->>'id') from jsonb_array_elements(full_read->'targets') t) then raise exception 'Target totals/recovery/unknown-cost/date/status changed';end if;
 for item in select * from jsonb_array_elements(summary->'targets') loop
  if item->'itemBreakdown'<>'[]'::jsonb then raise exception 'Item rows eagerly loaded';end if;
  select jsonb_build_object('salesPaise',coalesce(sum((a->>'revenuePaise')::numeric),0)::text,
   'knownGpPaise',coalesce(sum((a->>'gpPaise')::numeric),0)::text,'lines',count(*),
   'missingCostLines',count(*) filter(where a->>'gpPaise' is null))
  into expected from jsonb_array_elements(full_read->'attributionLines') a
  where a->>'targetId'=item->>'id' and a->>'status'<>'instrument_billing';
  if item->'reagentLifetime'<>expected then raise exception 'Lifetime differs from complete canonical attribution';end if;
 end loop;
 select count(*) into todo from jsonb_array_elements(full_read->'sourceLines') l
 where l->>'kind'='sale' and (l->>'quantity')::numeric>0 and exists(
  select 1 from jsonb_array_elements(full_read->'attributionLines') a where a->>'sourceLineId'=l->>'id'
  and a->>'targetId' is not null and a->>'status'='cost_unavailable' and a->>'costPaise' is null);
 todo:=todo+(select count(*) from jsonb_array_elements(full_read->'exceptions') e where e->>'status'='import_rejected');
 if (summary->>'todoCount')::bigint<>todo then raise exception 'To do count differs from full queue';end if;
end$check$;

do $test$
declare period date:=(date_trunc('month',private.stockflow_economic_business_date())-interval '1 month')::date;
 vouchers jsonb; doc jsonb; target uuid; run uuid; workspace jsonb; receipt jsonb; version integer;
begin
 select jsonb_agg(jsonb_build_object('sourceId',s.id,'revision','1','date',period+s.day,'kind',s.kind,'amountStatus','verified','sourceReference',upper(s.id),
  'customerSourceId',case when s.kind='sale' then 'sale-date-customer-guid' else null end,'siteId','sale-date-site',
  'lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId',s.product,'quantity',s.qty,'unit',s.unit,'netSalesPaise',s.amount)))) into vouchers
 from (values
  ('date-instrument-purchase','purchase','instrument','1','nos','100000',0),
  ('date-instrument-sale','sale','instrument','1','nos','60000',5),
  ('date-reagent-purchase','purchase','reagent','10','pack','10000',0),
  ('date-before','sale','reagent','1','pack','5000',4),
  ('date-same','sale','reagent','1','pack','5000',5),
  ('date-before-install','sale','reagent','1','pack','5000',7),
  ('date-after-install','sale','reagent','1','pack','5000',11)
 ) s(id,kind,product,qty,unit,amount,day);
 doc:=jsonb_build_object('schemaVersion',1,'companyId','sale-date-company','sourceVersion','sale-date-v1','completeWindow',true,'windowFrom',period,'windowTo',(period+interval '1 month')::date,'vouchers',vouchers);
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 target:=(public.stockflow_economics_gateway('sale-date-key','sale-date-manager@test.local','create_target',jsonb_build_object('kind','placement','name','Invoice before installation','companyId','sale-date-company','customerId','dededede-eeee-4eee-8eee-eeeeeeeeeeee','customerSourceId','sale-date-customer-guid','siteId','sale-date-site','modelId','sale-date-model','installationId','dededede-eeee-4eee-8eee-eeeeeeeeeeec','effectiveFrom',period+10,'capitalPaise','0','acquisitionPurchaseLineId',(select l.id from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.source_id='date-instrument-purchase'),'capitalEvidence','Serial and purchase checked','idempotencyKey','sale-date-create-0001'))->>'entityId')::uuid;
 perform public.stockflow_economics_gateway('sale-date-key','sale-date-manager@test.local','link_instrument_billing',jsonb_build_object('targetId',target,'expectedVersion',1,'sourceLineId',(select l.id from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.source_id='date-instrument-sale'),'reason','Linked instrument invoice','idempotencyKey','sale-date-billing-001'));
 perform public.stockflow_economics_gateway('sale-date-key','sale-date-manager@test.local','set_mapping',jsonb_build_object('companyId','sale-date-company','modelId','sale-date-model','productId','reagent','targetId',target,'effect','include','effectiveFrom',period,'reason','Reagent mapping predates invoice','idempotencyKey','sale-date-mapping-001'));
 select t.version into version from private.stockflow_economic_targets t where t.id=target;
 receipt:=public.stockflow_economics_gateway('sale-date-key','sale-date-manager@test.local','approve_target',jsonb_build_object('targetId',target,'expectedVersion',version,'expectedGeneration',(select id from private.stockflow_economic_runs where active),'decision','approved','reason','Track actuals from instrument invoice','idempotencyKey','sale-date-approve-001'));
 select id into run from private.stockflow_economic_runs where active;
 perform pg_temp.assert_economic_summary();
 if (select coalesce(sum(r.revenue_paise),0) from private.stockflow_economic_results r where r.run_id=run and r.target_id=target and r.status<>'instrument_billing')<>15000 then raise exception 'Reagent sales did not start inclusively on instrument invoice date';end if;
 if exists(select 1 from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and r.target_id=target and v.source_id='date-before') then raise exception 'Reagent sale before instrument invoice was counted';end if;
 if (select sum(e.amount_paise) from private.stockflow_economic_events e where e.target_id=target and e.kind<>'capital')<>72000 then raise exception 'Recovery must include billing once plus 12000 reagent GP';end if;
 workspace:=private.stockflow_economic_workspace(array['management']);
 if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=target::text and t->>'salesFrom'=(period+5)::text and t->>'effectiveFrom'=(period+10)::text) then raise exception 'Invoice start was not exposed separately from installation';end if;
 -- A current invoice revision changes the cutoff and rebuild reverses prior GP.
 doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','date-instrument-sale','revision','2','date',period+11,'kind','sale','amountStatus','verified','customerSourceId','sale-date-customer-guid','siteId','sale-date-site','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','instrument','quantity','1','unit','nos','netSalesPaise','60000')))));
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc||'{"sourceVersion":"sale-date-v2"}') where id='suprabha';
 select id into run from private.stockflow_economic_runs where active;
 perform pg_temp.assert_economic_summary();
 if (select sum(r.revenue_paise) from private.stockflow_economic_results r where r.run_id=run and r.target_id=target and r.status<>'instrument_billing')<>5000 then raise exception 'Revised invoice date did not restate reagent sales';end if;
 if (select sum(e.amount_paise) from private.stockflow_economic_events e where e.target_id=target and e.kind<>'capital')<>64000 then raise exception 'Revised sale-date GP was duplicated or not reversed';end if;
 perform pg_temp.assert_economic_summary();
 -- A cancelled linked invoice must not silently fall back to installation.
 doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','date-instrument-sale','revision','3','date',period+11,'kind','sale','cancelled',true,'amountStatus','verified','lines','[]'::jsonb)));
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc||'{"sourceVersion":"sale-date-v3"}') where id='suprabha';
 if private.stockflow_economic_sales_from(target) is not null then raise exception 'Cancelled invoice invented a sales start';end if;
 if exists(select 1 from private.stockflow_economic_results r join private.stockflow_economic_runs u on u.id=r.run_id and u.active where r.target_id=target and r.status<>'instrument_billing') then raise exception 'Cancelled instrument invoice retained reagent GP';end if;
 if has_function_privilege('authenticated','private.stockflow_economic_sales_from(uuid)','execute') then raise exception 'Sales-date helper exposed to API role';end if;
perform pg_temp.assert_economic_summary();
end$test$;

-- Restore billing, then prove verified negative FOC GP and unknown full-sale cost
-- survive the summary. The oversized sale reserves stock but cannot book GP.
do $test$
declare period date:=(date_trunc('month',private.stockflow_economic_business_date())-interval '1 month')::date;
 doc jsonb; summary jsonb; life jsonb;
begin
 doc:=jsonb_build_object('schemaVersion',1,'companyId','sale-date-company','sourceVersion','summary-cost-edges',
  'completeWindow',true,'windowFrom',period,'windowTo',(period+interval '1 month')::date,
  'vouchers',(select jsonb_agg(jsonb_build_object('sourceId',s.id,'revision',s.revision,'date',period+s.day,'kind','sale',
   'amountStatus','verified','customerSourceId','sale-date-customer-guid','siteId','sale-date-site',
   'lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId',s.product,'quantity',s.qty,'unit',s.unit,'netSalesPaise',s.amount,'focReason',case when s.id='summary-foc' then 'commercial_support' else null end))))
   from (values ('date-instrument-sale','4','instrument','1','nos','60000',5),
    ('summary-foc','1','reagent','1','pack','0',6),('summary-missing','1','reagent','20','pack','1000',12)) s(id,revision,product,qty,unit,amount,day)));
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 perform pg_temp.assert_economic_summary();
 summary:=private.stockflow_economic_workspace_read(array['management'],true);
 select t->'reagentLifetime' into life from jsonb_array_elements(summary->'targets') t where t->>'customerId'='dededede-eeee-4eee-8eee-eeeeeeeeeeee';
 if life is distinct from '{"salesPaise":"16000","knownGpPaise":"11000","lines":5,"missingCostLines":1}'::jsonb then
  raise exception 'FOC fixture admission: lifetime %, target %, exceptions %',life,summary->'targets'->0,private.stockflow_economic_workspace(array['management'])->'exceptions';end if;
 if (summary->>'todoCount')::integer<1 then raise exception 'Missing-cost action disappeared';end if;
end$test$;

-- A large catalogue changes full payload size, never the summary.
insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
 select 'sale-date-company','summary-catalog',now(),jsonb_build_object('groups','[{"id":"g","name":"Group","parentId":null}]'::jsonb,
 'products',(select jsonb_agg(jsonb_build_object('id','item-'||i,'name','Bulk item '||i,'groupId','g','unit','pack')) from generate_series(1,1000) i));
select pg_temp.assert_economic_summary();
do $test$
declare full_read jsonb:=private.stockflow_economic_workspace(array['management']);
 summary jsonb:=private.stockflow_economic_workspace_read(array['management'],true);
begin
 if octet_length(summary::text)>=octet_length(full_read::text)/2 then raise exception 'Summary did not reduce catalogue payload';end if;
 raise notice 'Summary payload bytes %, full bytes %',octet_length(summary::text),octet_length(full_read::text);
 if has_function_privilege('anon','private.stockflow_economic_workspace_read(text[],boolean)','execute')
 or has_function_privilege('authenticated','private.stockflow_economic_lifetime(uuid,uuid)','execute') then raise exception 'Private summary helper exposed';end if;
 begin
  perform public.stockflow_economics_gateway('bad-key','sale-date-manager@test.local','get_instrument_economics','{"view":"summary"}');
  raise exception 'Invalid key accepted';
 exception when insufficient_privilege then null;end;
 begin
  perform public.stockflow_economics_gateway('sale-date-key','missing@test.local','get_instrument_economics','{"view":"summary"}');
  raise exception 'Inactive/missing actor accepted';
 exception when insufficient_privilege then null;end;
 begin
  perform public.stockflow_economics_gateway('sale-date-key','sale-date-manager@test.local','get_instrument_economics','{"view":"unknown"}');
  raise exception 'Unknown view accepted';
 exception when invalid_parameter_value then null;end;
end$test$;
-- Prove the summary does not merely build the full read and trim it.
create or replace function private.stockflow_economic_leakage(p_run uuid,p_from date,p_to date)
 returns jsonb language plpgsql stable as $probe$begin raise exception 'Evidence query probe' using errcode='P1234';end$probe$;
do $test$begin
 perform private.stockflow_economic_workspace_read(array['management'],true);
 begin perform private.stockflow_economic_workspace(array['management']);raise exception 'Full read skipped evidence probe';
 exception when sqlstate 'P1234' then null;end;
end$test$;

rollback;
