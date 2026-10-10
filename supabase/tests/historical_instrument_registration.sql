begin;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('historical-test-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status) values('historical-manager@test.local','management','active'),('historical-account@test.local','accounts','active'),('historical-sales@test.local','sales','active');
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values('bbbbbbbb-abcd-4abc-8abc-aaaaaaaaaaa1','Historical fixture customer','historical-fixture-customer','test');
insert into public.stockflow_snapshots(id,company,fetched_at,payload) values('suprabha','Fixture',now()::text,'{}') on conflict(id) do nothing;
do $test$
declare period date:=(date_trunc('month',private.stockflow_economic_business_date())-interval '1 month')::date;
 line_id uuid;installation uuid;target uuid;receipt jsonb;payload jsonb;workspace jsonb;ticket jsonb;before_orders integer;bad jsonb;
begin
 update public.stockflow_snapshots snapshot set payload=snapshot.payload||jsonb_build_object('economicEvidence',jsonb_build_object('schemaVersion',1,'companyId','historical-fixture-company','sourceVersion',now()::text,'completeWindow',false,'vouchers',jsonb_build_array(jsonb_build_object('sourceId','historical-invoice','revision','1','date',period+1,'kind','sale','amountStatus','verified','customerSourceId','historical-customer-guid','sourceReference','HIST-01','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','historical-analyzer','label','Historical analyzer','quantity','1','unit','qty','batchId','HIST-SERIAL','netSalesPaise','40000000')))))) where id='suprabha';
 select l.id into line_id from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.source_id='historical-invoice';
 payload:=jsonb_build_object('sourceLineId',line_id,'expectedSourceRevision','1','customerId','bbbbbbbb-abcd-4abc-8abc-aaaaaaaaaaa1','installedOn',period+5,'serialNumber','HIST-SERIAL','reason','Confirmed historical installation, invoice and serial','idempotencyKey','historical-registration-0001');
 select count(*) into before_orders from private.stockflow_orders;
 begin perform public.stockflow_economics_gateway('historical-test-key','historical-account@test.local','register_historical_instrument',payload);raise exception 'Accounts registered equipment';exception when insufficient_privilege then null;end;
 begin perform public.stockflow_economics_gateway('historical-test-key','historical-sales@test.local','register_historical_instrument',payload);raise exception 'Sales registered equipment';exception when insufficient_privilege then null;end;
 for bad in select value from jsonb_array_elements(jsonb_build_array(jsonb_build_object('installedOn',period),jsonb_build_object('installedOn',private.stockflow_economic_business_date()+1),'{"serialNumber":"WRONG"}'::jsonb,'{"reason":""}'::jsonb)) loop
  begin perform public.stockflow_economics_gateway('historical-test-key','historical-manager@test.local','register_historical_instrument',payload||bad);raise exception 'Invalid registration accepted';exception when invalid_parameter_value then null;end;
 end loop;
 begin perform public.stockflow_economics_gateway('historical-test-key','historical-manager@test.local','register_historical_instrument',payload||'{"expectedSourceRevision":"2"}');raise exception 'Stale invoice accepted';exception when sqlstate 'PT409' then null;end;
 if exists(select 1 from private.stockflow_equipment_installations where serial_number='HIST-SERIAL') or exists(select 1 from private.stockflow_economic_customer_identities where company_id='historical-fixture-company') then raise exception 'Rejected registration partially saved';end if;
 receipt:=public.stockflow_economics_gateway('historical-test-key','historical-manager@test.local','register_historical_instrument',payload);installation:=(receipt->>'entityId')::uuid;
 if public.stockflow_economics_gateway('historical-test-key','historical-manager@test.local','register_historical_instrument',payload)<>receipt then raise exception 'Registration retry changed receipt';end if;
 if (select count(*) from private.stockflow_equipment_installations where serial_number='HIST-SERIAL')<>1 or (select count(*) from private.stockflow_orders)<>before_orders then raise exception 'Duplicate asset or fictitious order created';end if;
 if not exists(select 1 from private.stockflow_equipment_installations where id=installation and order_id is null and customer_id='bbbbbbbb-abcd-4abc-8abc-aaaaaaaaaaa1' and installed_on=period+5 and historical_sale_line_id=line_id) then raise exception 'Historical identity/date/source not retained';end if;
 if (select count(*) from private.stockflow_economic_audit where action='register_historical_instrument' and entity_id=installation)<>1 then raise exception 'Registration audit duplicated';end if;
 begin perform public.stockflow_economics_gateway('historical-test-key','historical-manager@test.local','register_historical_instrument',payload||'{"idempotencyKey":"historical-registration-0002"}');raise exception 'Duplicate instrument accepted';exception when sqlstate 'PT409' then null;end;
 workspace:=public.stockflow_service_gateway('historical-test-key','historical-sales@test.local','get_service_workspace','{}');
 if not exists(select 1 from jsonb_array_elements(workspace->'assets') a where a->>'installationId'=installation::text and a->>'customerName'='Historical fixture customer' and a->>'installedAt'=(period+5)::text and a->>'orderNumber'='Tally HIST-01' and a->'orderId'='null'::jsonb) then raise exception 'Historical asset missing from service portfolio or wrong date';end if;
 if workspace::text ~ '40000000|netSalesPaise|capitalPaise' then raise exception 'Service view leaked instrument finances';end if;
 ticket:=public.stockflow_service_gateway('historical-test-key','historical-sales@test.local','create_service_ticket',jsonb_build_object('installationId',installation,'category','training','priority','normal','summary','Historical instrument training request','idempotencyKey','historical-ticket-0001'));
 if not exists(select 1 from private.stockflow_service_tickets where id=(ticket->>'ticketId')::uuid and order_id is null and installation_id=installation) then raise exception 'Historical equipment service ticket failed';end if;
 workspace:=public.stockflow_economics_gateway('historical-test-key','historical-account@test.local','get_instrument_economics','{}');
 if not exists(select 1 from jsonb_array_elements(workspace->'installations') a where a->>'id'=installation::text and a->>'customerName'='Historical fixture customer') then raise exception 'Economics setup missing historical instrument';end if;
 if not exists(select 1 from jsonb_array_elements(workspace->'sourceLines') s where s->>'id'=line_id::text and s->>'voucherId'='historical-invoice' and s->>'voucherNumber'='HIST-01') then raise exception 'Source line missing readable Tally voucher number';end if;
 receipt:=public.stockflow_economics_gateway('historical-test-key','historical-manager@test.local','create_target',jsonb_build_object('kind','placement','name','Historical fixture placement','companyId','historical-fixture-company','customerId','bbbbbbbb-abcd-4abc-8abc-aaaaaaaaaaa1','customerSourceId','historical-customer-guid','siteId','historical-site','modelId','historical-model','installationId',installation,'effectiveFrom',period+5,'capitalPaise','0','idempotencyKey','historical-placement-0001'));
 target:=(receipt->>'entityId')::uuid;
 if not exists(select 1 from private.stockflow_economic_targets where id=target and installation_id=installation) then raise exception 'Historical placement creation failed';end if;
end$test$;
rollback;
