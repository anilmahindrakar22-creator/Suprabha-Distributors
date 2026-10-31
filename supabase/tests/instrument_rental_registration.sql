begin;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('rental-test-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status) values('rental-manager@test.local','management','active');
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values
 ('19300000-0000-4000-8000-000000000001','Rental lab','rental-lab','test'),
 ('19300000-0000-4000-8000-000000000002','Unlinked rental lab','rental-unlinked','test');
insert into public.stockflow_snapshots(id,company,fetched_at,payload) values('suprabha','Fixture',now()::text,'{}') on conflict(id) do nothing;
do $test$
declare
 day date:=(date_trunc('month',private.stockflow_economic_business_date())-interval '1 month')::date;
 purchase uuid; sale uuid; installation uuid; target uuid; receipt jsonb; payload jsonb; workspace jsonb; row jsonb;
begin
 update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',jsonb_build_object(
  'schemaVersion',1,'companyId','rental-fixture-company','sourceVersion',now()::text,'completeWindow',true,'windowFrom',day,'windowTo',(day+interval '2 months')::date,'vouchers',jsonb_build_array(
   jsonb_build_object('sourceId','rental-purchase','revision','1','date',day,'kind','purchase','amountStatus','verified','sourceReference','RENT-P01','partyName','Rental supplier','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','rental-machine','label','Rental analyzer','quantity','1','unit','qty','batchId','RENT-001','netSalesPaise','42000000'))),
   jsonb_build_object('sourceId','rental-sale','revision','1','date',day+1,'kind','sale','amountStatus','verified','customerSourceId','rental-ledger','sourceReference','RENT-S01','partyName','Rental lab','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','rental-machine','label','Rental analyzer','quantity','1','unit','qty','batchId','SOLD-001','netSalesPaise','30000000')))
  ))) where id='suprabha';
 select l.id into purchase from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id='rental-fixture-company' and v.source_id='rental-purchase';
 select l.id into sale from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id='rental-fixture-company' and v.source_id='rental-sale';
 insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by) values('rental-fixture-company','rental-ledger','19300000-0000-4000-8000-000000000001','rental-manager@test.local');
 workspace:=public.stockflow_economics_gateway('rental-test-key','rental-manager@test.local','get_instrument_economics',jsonb_build_object('view','detail'));
 if not exists(select 1 from jsonb_array_elements(workspace->'sourceLines') s where s->>'id'=sale::text and s->>'partyName'='Rental lab' and s->'usedByInstrument'='false'::jsonb)
  or not exists(select 1 from jsonb_array_elements(workspace->'sourceLines') s where s->>'id'=purchase::text and s->>'partyName'='Rental supplier') then raise exception 'Equipment sale for a customer without placement or readable party missing from detail';end if;
 if not exists(select 1 from jsonb_array_elements(workspace->'customers') c,jsonb_array_elements(c->'tallyIdentities') i where c->>'id'='19300000-0000-4000-8000-000000000001' and i->>'customerSourceId'='rental-ledger') then raise exception 'Confirmed rental identity missing from customer read';end if;
 payload:=jsonb_build_object('basis','rental','sourceLineId',purchase,'expectedSourceRevision','1','customerId','19300000-0000-4000-8000-000000000001','installedOn',day+2,'serialNumber','RENT-001','reason','Confirmed rental installation','idempotencyKey','rental-register-000001');
 -- IR4: source kind is enforced for both bases.
 begin perform public.stockflow_economics_gateway('rental-test-key','rental-manager@test.local','register_historical_instrument',payload||jsonb_build_object('sourceLineId',sale,'serialNumber','SOLD-001'));raise exception 'IR4 accepted rental sale';exception when invalid_parameter_value then null;end;
 begin perform public.stockflow_economics_gateway('rental-test-key','rental-manager@test.local','register_historical_instrument',payload||jsonb_build_object('basis','sold'));raise exception 'IR4 accepted sold purchase';exception when invalid_parameter_value then null;end;
 raise notice 'IR4 PASS';
 -- IR5: no identity may be created by rental registration.
 begin perform public.stockflow_economics_gateway('rental-test-key','rental-manager@test.local','register_historical_instrument',payload||jsonb_build_object('customerId','19300000-0000-4000-8000-000000000002'));raise exception 'IR5 accepted unlinked lab';exception when invalid_parameter_value then
  if sqlerrm<>'Link this lab to Tally first' then raise exception 'IR5 wrong error: %',sqlerrm;end if;
 end;
 if exists(select 1 from private.stockflow_economic_customer_identities where customer_id='19300000-0000-4000-8000-000000000002') then raise exception 'IR5 inserted identity';end if;
 raise notice 'IR5 PASS';
 -- IR1: purchase registration and proposed acquisition without billing.
 receipt:=public.stockflow_economics_gateway('rental-test-key','rental-manager@test.local','register_historical_instrument',payload);
 installation:=(receipt->>'entityId')::uuid;
 if public.stockflow_economics_gateway('rental-test-key','rental-manager@test.local','register_historical_instrument',payload)<>receipt then raise exception 'IR1 retry changed receipt';end if;
 if not exists(select 1 from private.stockflow_equipment_installations where id=installation and tally_key='rental-fixture-company:rental-purchase:1' and historical_sale_line_id=purchase) then raise exception 'IR1 missing purchase installation';end if;
 receipt:=public.stockflow_economics_gateway('rental-test-key','rental-manager@test.local','create_target',jsonb_build_object('kind','placement','name','Rental analyzer at lab','companyId','rental-fixture-company','customerId','19300000-0000-4000-8000-000000000001','customerSourceId','rental-ledger','siteId','Rental lab','modelId','Rental analyzer','installationId',installation,'effectiveFrom',day+2,'acquisitionPurchaseLineId',purchase,'capitalEvidence','Tally purchase RENT-P01','idempotencyKey','rental-placement-000001'));
 target:=(receipt->>'entityId')::uuid;
 if not exists(select 1 from private.stockflow_economic_targets where id=target and approval='proposed') or (select sum(amount_paise) from private.stockflow_economic_events where target_id=target and kind='capital')<>42000000 or exists(select 1 from private.stockflow_economic_instrument_billings where target_id=target) then raise exception 'IR1 wrong capital/approval/billing';end if;
 raise notice 'IR1 PASS';
 workspace:=public.stockflow_economics_gateway('rental-test-key','rental-manager@test.local','get_instrument_economics',jsonb_build_object('view','detail'));
 if not exists(select 1 from jsonb_array_elements(workspace->'sourceLines') s where s->>'id'=purchase::text and s->'usedByInstrument'='true'::jsonb) then raise exception 'Registered purchase offered for reuse';end if;
 -- IR2: no billing is valid evidence after approval.
 perform public.stockflow_economics_gateway('rental-test-key','rental-manager@test.local','approve_target',jsonb_build_object('targetId',target,'expectedVersion',1,'expectedGeneration',(select id from private.stockflow_economic_runs where active),'decision','approved','reason','Rental capital verified','idempotencyKey','rental-approve-000001'));
 workspace:=public.stockflow_economics_gateway('rental-test-key','rental-manager@test.local','get_instrument_economics',jsonb_build_object());
 select value into row from jsonb_array_elements(workspace->'targets') where value->>'id'=target::text;
 if row is null or row->>'health'='data_incomplete' or not private.stockflow_economic_billing_current(target) then raise exception 'IR2 rental billing marked incomplete: %',row;end if;
 raise notice 'IR2 PASS';
 -- IR3: the same logical purchase cannot be registered twice.
 begin perform public.stockflow_economics_gateway('rental-test-key','rental-manager@test.local','register_historical_instrument',payload||jsonb_build_object('idempotencyKey','rental-duplicate-000001'));raise exception 'IR3 duplicate accepted';exception when sqlstate 'PT409' then null;end;
 raise notice 'IR3 PASS';
 -- IR6: omitted basis retains the sold path and its identity handling.
 receipt:=public.stockflow_economics_gateway('rental-test-key','rental-manager@test.local','register_historical_instrument',payload-'basis'||jsonb_build_object('sourceLineId',sale,'serialNumber','SOLD-001','idempotencyKey','rental-sold-legacy-000001'));
 if not exists(select 1 from private.stockflow_equipment_installations where id=(receipt->>'entityId')::uuid and historical_sale_line_id=sale) then raise exception 'IR6 sold registration changed';end if;
 raise notice 'IR6 PASS';
end$test$;
rollback;
