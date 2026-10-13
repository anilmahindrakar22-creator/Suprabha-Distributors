begin;
-- Own fixtures; no financial or operational data survives this test.
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('rr-read-test-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status) values('rr-management@test.local','management','active');
insert into public.stockflow_snapshots(id,company,fetched_at,payload) values('suprabha','SUPRABHA DISTRIBUTORS',now()::text,'{"catalog":[]}'::jsonb) on conflict(id) do nothing;
insert into private.stockflow_economic_policy_versions(actor,reason,automatic_approval,automatic_purchase_cost)
 values('test','RR explicit manual policy fixture',false,false);
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values
 ('aa110000-0000-4000-8000-000000000001','RR Lab A','rr-customer-a','test'),
 ('aa110000-0000-4000-8000-000000000002','RR Lab B','rr-customer-b','test');
insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,created_by_email,updated_by_email,idempotency_key) values
 ('aa110000-0000-4000-8000-000000000003','RR-ORDER-A','aa110000-0000-4000-8000-000000000001','RR Lab A','phone','delivered','test','test','rr-order-a-fixture'),
 ('aa110000-0000-4000-8000-000000000004','RR-ORDER-B','aa110000-0000-4000-8000-000000000002','RR Lab B','phone','delivered','test','test','rr-order-b-fixture');
insert into private.stockflow_equipment_installations(id,order_id,tally_key,item_name,status,scheduled_date,serial_number,created_by_email,completed_at)
 values('aa110000-0000-4000-8000-000000000005','aa110000-0000-4000-8000-000000000003','rr-equipment','RR instrument','completed',private.stockflow_economic_business_date()-60,'RR-1','test',now()-interval '60 days');
do $test$
declare v_response jsonb; v_target uuid; v_version integer; v_full jsonb; v_a jsonb; v_b jsonb; v_instrument uuid;
begin
 v_response:=public.stockflow_economics_gateway('rr-read-test-key','rr-management@test.local','create_target',jsonb_build_object(
  'kind','placement','name','RR placement A','companyId','rr-company','customerId','aa110000-0000-4000-8000-000000000001',
  'customerSourceId','rr-customer-guid-a','siteId','rr-site-a','modelId','rr-model','installationId','aa110000-0000-4000-8000-000000000005',
  'effectiveFrom',private.stockflow_economic_business_date()-60,'capitalPaise','0','idempotencyKey','rr-create-placement-a'));
 v_target:=(v_response->>'entityId')::uuid;
 select version into v_version from private.stockflow_economic_targets where id=v_target;
 perform public.stockflow_economics_gateway('rr-read-test-key','rr-management@test.local','close_target',jsonb_build_object(
  'targetId',v_target,'expectedVersion',v_version,'effectiveTo',private.stockflow_economic_business_date()-30,
  'reason','RR instrument moved away','idempotencyKey','rr-close-placement-a'));
 insert into private.stockflow_equipment_installations(id,order_id,tally_key,item_name,status,scheduled_date,serial_number,created_by_email,completed_at)
  values('aa110000-0000-4000-8000-000000000006','aa110000-0000-4000-8000-000000000004','rr-equipment','RR instrument','completed',private.stockflow_economic_business_date()-20,'rr 1','test',now()-interval '20 days');
 select instrument_id into v_instrument from private.stockflow_equipment_installations where id='aa110000-0000-4000-8000-000000000005';
 v_full:=public.stockflow_economics_gateway('rr-read-test-key','rr-management@test.local','get_instrument_economics','{"view":"full"}');
 select value into v_a from jsonb_array_elements(v_full->'installations') where value->>'id'='aa110000-0000-4000-8000-000000000005';
 select value into v_b from jsonb_array_elements(v_full->'installations') where value->>'id'='aa110000-0000-4000-8000-000000000006';
 if v_a is null or v_b is null or v_b->>'instrumentId' is distinct from v_instrument::text
  or v_a->>'instrumentId' is distinct from v_instrument::text
  or v_b->>'modelId' is distinct from 'rr-model' or v_b->>'movedFrom' is distinct from 'RR Lab A'
  or v_a->'movedFrom' is distinct from 'null'::jsonb then
  raise exception 'RR installation identity/model/movement read incorrect: A %, B %',v_a,v_b;
 end if;
 v_response:=public.stockflow_economics_gateway('rr-read-test-key','rr-management@test.local','get_instrument_economics','{"view":"summary"}');
 if v_response->'installations' is distinct from '[]'::jsonb then raise exception 'RR summary eagerly reads installations';end if;
end$test$;
rollback;
