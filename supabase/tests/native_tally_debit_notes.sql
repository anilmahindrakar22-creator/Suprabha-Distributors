begin;
insert into private.stockflow_economic_policy_versions(actor,reason,automatic_approval) values('test','Native Debit Note fixture',false);
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('native-debit-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status) values('native-debit@test.local','management','active');
insert into public.stockflow_snapshots(id,company,fetched_at,payload) values('suprabha','SUPRABHA DISTRIBUTORS',now()::text,'{"catalog":[]}'::jsonb) on conflict(id) do nothing;
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values('19191919-eeee-4eee-8eee-eeeeeeeeeeee','Native debit customer','native-debit-customer','test');
insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,created_by_email,updated_by_email,idempotency_key) values('19191919-eeee-4eee-8eee-eeeeeeeeeeed','NATIVE-DEBIT-ORDER','19191919-eeee-4eee-8eee-eeeeeeeeeeee','Native debit customer','phone','delivered','test','test','native-debit-fixture-order');
insert into private.stockflow_equipment_installations(id,order_id,tally_key,item_name,status,scheduled_date,serial_number,created_by_email,completed_at) values('19191919-eeee-4eee-8eee-eeeeeeeeeeec','19191919-eeee-4eee-8eee-eeeeeeeeeeed','native-debit-instrument','Native debit instrument','completed',date '2026-08-20','NATIVE-DEBIT-SERIAL','test',now());
do $test$
declare doc jsonb; run uuid; target uuid; receipt jsonb; first_count bigint; return_line uuid; purchase_line uuid;
begin
 select jsonb_build_object('schemaVersion',1,'companyId','native-debit-test','sourceVersion','native-debit-v1','completeWindow',false,'vouchers',jsonb_agg(
  jsonb_build_object('sourceId',s.id,'revision','1','date',date '2026-09-01'+s.day,'kind',s.kind,'amountStatus','verified','sourceReference',s.id,
   'customerSourceId',case when s.kind='sale' then 'native-debit-customer' else null end,
   'voucherType',case when s.kind='purchase_return' or s.id='sales-value-debit' then 'Debit Note' else s.kind end,
   'classificationPolicy',case when s.kind='purchase_return' or s.id='sales-value-debit' then 'native_debit_note_v1' else 'native_economic_v1' end,
   'nativeTradeSide',case when s.kind='purchase_return' then 'purchase' when s.id='sales-value-debit' then 'sale' else null end,
   'lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId',s.product,'quantity',s.qty,'unit','pack','batchId','B','netSalesPaise',s.amount))))) into doc
 from (values
  ('p','purchase','r','5','50000',0),('sale-before','sale','r','1','20000',1),
  ('debit','purchase_return','r','-3','-30000',2),('sale-after','sale','r','2','40000',3),
  ('sales-value-debit','sale','r','0','500',4),
  ('q-p','purchase','q','1','1000',0),('q-return','purchase_return','q','-2','-2000',1),
  ('q-later-p','purchase','q','3','3000',2),('q-sale','sale','q','1','4000',3)
 ) s(id,kind,product,qty,amount,day);
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 if exists(select 1 from private.stockflow_economic_import_exceptions where company_id='native-debit-test') then raise exception 'Native signed Debit Note was rejected';end if;
 receipt:=public.stockflow_economics_gateway('native-debit-key','native-debit@test.local','create_target',jsonb_build_object('kind','placement','name','Native Debit Note instrument','companyId','native-debit-test','customerId','19191919-eeee-4eee-8eee-eeeeeeeeeeee','customerSourceId','native-debit-customer','siteId','native-debit-site','modelId','native-debit-model','installationId','19191919-eeee-4eee-8eee-eeeeeeeeeeec','effectiveFrom','2026-08-20','capitalPaise','0','idempotencyKey','native-debit-create-0001'));
 target:=(receipt->>'entityId')::uuid;
 perform public.stockflow_economics_gateway('native-debit-key','native-debit@test.local','set_mapping',jsonb_build_object('companyId','native-debit-test','modelId','native-debit-model','productId','r','targetId',target,'effect','include','effectiveFrom','2026-08-20','reason','Native Debit Note cost fixture','idempotencyKey','native-debit-map-0001'));
 perform public.stockflow_economics_gateway('native-debit-key','native-debit@test.local','approve_target',jsonb_build_object('targetId',target,'expectedVersion',1,'expectedGeneration',(select id from private.stockflow_economic_runs where active),'decision','approved','reason','Native Debit Note actual-only fixture','idempotencyKey','native-debit-approve-0001'));
 select id into run from private.stockflow_economic_runs where active;
 select l.id into return_line from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id='native-debit-test' and v.source_id='debit';
 select l.id into purchase_line from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id='native-debit-test' and v.source_id='p';
 if (select sum(quantity) from private.stockflow_economic_auto_cost_links where run_id=run and sale_line_id=return_line) is distinct from 3::numeric then raise exception 'Supplier returned stock was not reserved';end if;
 if (select sum(cost_paise) from private.stockflow_economic_auto_cost_links where run_id=run and sale_line_id=return_line) is distinct from 30000::numeric then raise exception 'Supplier return cost allocation incorrect';end if;
 if exists(select 1 from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and v.kind='purchase_return' and (r.target_id is not null or r.revenue_paise<>0 or r.gp_paise is not null)) then raise exception 'Supplier return was counted as instrument revenue or GP';end if;
 if (select sum(quantity) from private.stockflow_economic_auto_cost_links where run_id=run and purchase_line_id=purchase_line) is distinct from 5::numeric then raise exception 'Stock consumption before/return/after was not conserved';end if;
 if (select sum(a.quantity) from private.stockflow_economic_auto_cost_links a join private.stockflow_economic_source_lines l on l.id=a.sale_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where a.run_id=run and v.source_id='sale-after') is distinct from 1::numeric then raise exception 'Later sale reused supplier returned stock';end if;
 if (select sum(gp_paise) from private.stockflow_economic_results where run_id=run and target_id=target) is distinct from 10500::numeric then raise exception 'Native supplier return or value-only sales debit produced wrong instrument GP';end if;
 if (select sum(amount_paise) from private.stockflow_economic_events where target_id=target) is distinct from 10500::numeric then raise exception 'Native Debit Note GP ledger disagrees with results';end if;
 if exists(select 1 from private.stockflow_economic_auto_cost_links a join private.stockflow_economic_source_lines l on l.id=a.sale_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where a.run_id=run and v.source_id='q-sale') then raise exception 'Unfunded supplier return was silently forgotten when later purchases arrived';end if;
 select count(*) into first_count from private.stockflow_economic_source_vouchers where company_id='native-debit-test';
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 if first_count<>(select count(*) from private.stockflow_economic_source_vouchers where company_id='native-debit-test') then raise exception 'Debit Note replay duplicated source';end if;
 -- Cancellation must release its prior reserved stock in a new immutable run.
 doc:=jsonb_set(doc,'{vouchers}',jsonb_build_array(jsonb_build_object('sourceId','debit','revision','2','date','2026-09-03','kind','purchase_return','amountStatus','verified','voucherType','Debit Note','classificationPolicy','native_debit_note_v1','nativeTradeSide','cancelled','cancelled',true,'lines','[]'::jsonb)));
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 select id into run from private.stockflow_economic_runs where active;
 if exists(select 1 from private.stockflow_economic_auto_cost_links where run_id=run and sale_line_id=return_line) then raise exception 'Cancelled supplier return still consumed stock';end if;
 if (select sum(a.quantity) from private.stockflow_economic_auto_cost_links a join private.stockflow_economic_source_lines l on l.id=a.sale_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where a.run_id=run and v.source_id='sale-after') is distinct from 2::numeric then raise exception 'Cancellation did not restore eligible purchase stock';end if;
 if (select sum(amount_paise) from private.stockflow_economic_events where target_id=target) is distinct from 30500::numeric then raise exception 'Cancellation/rebuild duplicated or failed to restore GP';end if;
 if not exists(select 1 from private.stockflow_economic_auto_cost_links where sale_line_id=return_line) then raise exception 'Prior supplier return allocation audit was lost';end if;
 if has_function_privilege('authenticated','private.stockflow_economic_auto_cost(uuid,uuid)','execute') then raise exception 'Private cost allocator exposed';end if;
end$test$;
rollback;
