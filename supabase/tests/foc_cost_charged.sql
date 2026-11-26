begin;
set local statement_timeout='120s';

do $definitions$
declare signature text; definition text;
begin
 foreach signature in array array['private.stockflow_rebuild_instrument_economics(text)','private.stockflow_rebuild_instrument_economics_full_scan(text)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position('''cost charged''' in definition)=0 or position('foc_unclassified' in definition)>0 then raise exception 'FOC classification definition incorrect: %',signature;end if;
 end loop;
 foreach signature in array array['private.stockflow_economic_workspace_read(text[],boolean)','private.stockflow_economic_workspace_detail(text[])'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position('''freeLines''' in definition)=0 or position('''freeCostPaise''' in definition)=0 then raise exception 'Free-line read definition incorrect: %',signature;end if;
 end loop;
end$definitions$;

update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('foc-test-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status) values('foc-manager@test.local','management','active');
insert into public.stockflow_snapshots(id,company,fetched_at,payload) values('suprabha','TEST COMPANY',now()::text,'{"catalog":[]}'::jsonb) on conflict(id) do nothing;
insert into private.stockflow_economic_policy_versions(actor,reason,automatic_purchase_cost) values('test','Manual FOC purchase-cost fixture',false);
insert into private.stockflow_economic_policy_versions(actor,reason,automatic_approval) values('test','Manual FOC approval fixture',false);

do $test$
declare customer uuid:=extensions.gen_random_uuid(); order_id uuid:=extensions.gen_random_uuid(); installation uuid:=extensions.gen_random_uuid();
 company text:='foc-company-'||extensions.gen_random_uuid()::text; target uuid; sale uuid; purchase uuid; response jsonb; workspace jsonb; doc jsonb;
 period date:=(date_trunc('month',private.stockflow_economic_business_date())-interval '1 month')::date;
begin
 insert into private.stockflow_customers(id,name,tally_key,created_by_email) values(customer,'Free supply fixture','foc-customer','test');
 insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,created_by_email,updated_by_email,idempotency_key)
 values(order_id,'FOC-TEST-ORDER',customer,'Free supply fixture','phone','delivered','test','test','foc-order-fixture');
 insert into private.stockflow_equipment_installations(id,order_id,tally_key,item_name,status,scheduled_date,serial_number,created_by_email,completed_at)
 values(installation,order_id,'foc-instrument','Fixture instrument','completed',period-10,'FOC-SERIAL','test',now()-interval '60 days');
 response:=public.stockflow_economics_gateway('foc-test-key','foc-manager@test.local','create_target',jsonb_build_object(
  'kind','placement','name','Free supply instrument','companyId',company,'customerId',customer,'customerSourceId','foc-customer','siteId','foc-site','modelId','foc-model',
  'installationId',installation,'effectiveFrom',period-10,'capitalPaise','1000000','capitalEvidence','Reviewed acquisition invoice','idempotencyKey','foc-target-create'));
 target:=(response->>'entityId')::uuid;
 perform public.stockflow_economics_gateway('foc-test-key','foc-manager@test.local','set_mapping',jsonb_build_object(
  'companyId',company,'modelId','foc-model','productId','foc-product','effect','include','effectiveFrom',period,'reason','Verified compatibility','idempotencyKey','foc-product-mapping'));
 perform public.stockflow_economics_gateway('foc-test-key','foc-manager@test.local','approve_target',jsonb_build_object(
  'expectedGeneration',(select id from private.stockflow_economic_runs where active),'targetId',target,'expectedVersion',1,'decision','approved',
  'reason','Track verified actual economics without a planning target','idempotencyKey','foc-target-approve'));
 doc:=jsonb_build_object('schemaVersion',1,'companyId',company,'sourceVersion','foc-source-v1','completeWindow',true,'windowFrom',period-10,'windowTo',period+interval '1 month','vouchers',jsonb_build_array(
  jsonb_build_object('sourceId','foc-purchase','revision',1,'date',period,'kind','purchase','amountStatus','verified','lines',jsonb_build_array(
   jsonb_build_object('lineKey','1','productId','foc-product','quantity','70','unit','pack','netSalesPaise','3200000'))),
  jsonb_build_object('sourceId','foc-sale','revision',1,'date',period+1,'kind','sale','customerSourceId','foc-customer','siteId','foc-site','amountStatus','verified','lines',jsonb_build_array(
   jsonb_build_object('lineKey','1','productId','foc-product','quantity','70','unit','pack','netSalesPaise','0','focReason','unsupported_source_reason')))
 ));
 update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc) where id='suprabha';
 select l.id into sale from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id=company and v.source_id='foc-sale';
 select l.id into purchase from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id=company and v.source_id='foc-purchase';
 perform public.stockflow_economics_gateway('foc-test-key','foc-manager@test.local','verify_cost',jsonb_build_object(
  'sourceLineId',sale,'purchaseAllocations',jsonb_build_array(jsonb_build_object('purchaseLineId',purchase,'quantity','70')),
  'evidenceReference','Actual FOC historical purchase cost','idempotencyKey','foc-cost-verification'));
 perform private.stockflow_rebuild_instrument_economics('foc-manager@test.local');
 if not exists(select 1 from private.stockflow_economic_results r join private.stockflow_economic_runs g on g.id=r.run_id and g.active
  where r.source_line_id=sale and r.target_id=target and r.status='verified' and r.reason='FOC: cost charged' and r.revenue_paise=0 and r.quantity=70 and r.cost_paise=3200000 and r.gp_paise=-3200000)
 then raise exception 'Unclassified FOC did not charge actual cost';end if;
 workspace:=private.stockflow_economic_workspace_read(array['management'],false);
 if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=target::text and t->>'freeLines'='1' and t->>'freeCostPaise'='3200000')
 then raise exception 'Workspace free-line count or cost incorrect: %',workspace->'targets';end if;
end$test$;

rollback;
