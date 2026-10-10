begin;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('economic-auto-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status) values('auto-manager@test.local','management','active');
insert into public.stockflow_snapshots(id,company,fetched_at,payload) values('suprabha','SUPRABHA DISTRIBUTORS',now()::text,'{"catalog":[]}'::jsonb) on conflict(id) do nothing;
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values('abababab-eeee-4eee-8eee-eeeeeeeeeeee','Auto cost customer','auto-cost-customer','test');
insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,created_by_email,updated_by_email,idempotency_key) values('abababab-eeee-4eee-8eee-eeeeeeeeeeed','AUTO-COST-ORDER','abababab-eeee-4eee-8eee-eeeeeeeeeeee','Auto cost customer','phone','delivered','test','test','auto-cost-order-fixture');
insert into private.stockflow_equipment_installations(id,order_id,tally_key,item_name,status,scheduled_date,serial_number,created_by_email,completed_at) values('abababab-eeee-4eee-8eee-eeeeeeeeeeec','abababab-eeee-4eee-8eee-eeeeeeeeeeed','auto-instrument','Auto instrument','completed',private.stockflow_economic_business_date()-60,'AUTO-SERIAL','test',now()-interval '60 days');

do $test$
declare period date:=(date_trunc('month',private.stockflow_economic_business_date())-interval '1 month')::date;
 vouchers jsonb;doc jsonb;target uuid;receipt jsonb;run uuid;events_before bigint;
 function_cost bigint;
begin
 -- Purchases: P1 old batch B1, P2 newer batch B2, P3 zero-value item z, P4 after every sale.
 select jsonb_agg(jsonb_build_object('sourceId',s.id,'revision','1','date',period+s.day,'kind',s.kind,'amountStatus','verified','sourceReference',upper(s.id),
  'customerSourceId',case when s.kind='sale' then 'auto-customer-guid' else null end,
  'lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId',s.product,'quantity',s.qty,'unit','pack','netSalesPaise',s.amount,'batchId',s.batch)))) into vouchers
 from (values
  ('p1','purchase','r','2','10000','B1',1),('p2','purchase','r','2','30000','B2',2),('p3','purchase','z','1','0',null,1),('p4','purchase','r','5','99999','B2',20),
  ('s1','sale','r','1','40000','B2',5),('s2','sale','r','2','60000',null,6),('s3','sale','r','2','60000',null,7),('s4','sale','z','1','25000',null,8),('s8','sale','r','1','50000',null,8),
  ('q1','purchase','q','1','10000','X1',1),('q2','purchase','q','1','30000','X2',2),('q3','purchase','q','2','8000','X3',3),
  ('s5','sale','q','2','90000','NO-SUCH-BATCH',5),('s6','sale','q','2','90000','X1',6),
  ('w1','purchase','w','1','11100','W1',-400),('w2','purchase','w','1','22200','W2',-200),('s7','sale','w','1','50000','W1',9)
 ) s(id,kind,product,qty,amount,batch,day);
 doc:=jsonb_build_object('schemaVersion',1,'companyId','auto-company','sourceVersion',(period::timestamp at time zone 'Asia/Kolkata')::text,'completeWindow',true,'windowFrom',period,'windowTo',(period+interval '1 month')::date,'vouchers',vouchers);
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';

 receipt:=public.stockflow_economics_gateway('economic-auto-key','auto-manager@test.local','create_target',jsonb_build_object('kind','placement','name','Auto cost instrument','companyId','auto-company','customerId','abababab-eeee-4eee-8eee-eeeeeeeeeeee','customerSourceId','auto-customer-guid','siteId','auto-site','modelId','auto-model','installationId','abababab-eeee-4eee-8eee-eeeeeeeeeeec','effectiveFrom',period-10,'capitalPaise','0','idempotencyKey','auto-create-000001'));
 target:=(receipt->>'entityId')::uuid;
 perform public.stockflow_economics_gateway('economic-auto-key','auto-manager@test.local','set_mapping',jsonb_build_object('companyId','auto-company','modelId','auto-model','productId','r','targetId',target,'effect','include','effectiveFrom',period,'reason','Reagent r counts for this instrument','idempotencyKey','auto-map-reagent-r-0001'));
 perform public.stockflow_economics_gateway('economic-auto-key','auto-manager@test.local','set_mapping',jsonb_build_object('companyId','auto-company','modelId','auto-model','productId','z','targetId',target,'effect','include','effectiveFrom',period,'reason','Reagent z counts for this instrument','idempotencyKey','auto-map-reagent-z-0001'));
 perform public.stockflow_economics_gateway('economic-auto-key','auto-manager@test.local','set_mapping',jsonb_build_object('companyId','auto-company','modelId','auto-model','productId','q','targetId',target,'effect','include','effectiveFrom',period,'reason','Reagent q counts for this instrument','idempotencyKey','auto-map-reagent-q-0001'));
 perform public.stockflow_economics_gateway('economic-auto-key','auto-manager@test.local','set_mapping',jsonb_build_object('companyId','auto-company','modelId','auto-model','productId','w','targetId',target,'effect','include','effectiveFrom',period,'reason','Reagent w counts for this instrument','idempotencyKey','auto-map-reagent-w-0001'));
 perform public.stockflow_economics_gateway('economic-auto-key','auto-manager@test.local','approve_target',jsonb_build_object('targetId',target,'expectedVersion',1,'expectedGeneration',(select id from private.stockflow_economic_runs where active),'decision','approved','reason','Track actual automatic costs','idempotencyKey','auto-approve-00001'));
 select id into run from private.stockflow_economic_runs where active;

 -- s1 has batch B2: it must use P2 even though P1 is older. Cost = 30000 * 1/2.
 if (select r.cost_paise from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and v.source_id='s1')<>15000 then raise exception 'Batch match did not take precedence over older purchase';end if;
 -- s2 has no batch: oldest first takes both P1 units. Cost = 10000.
 if (select r.cost_paise from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and v.source_id='s2')<>10000 then raise exception 'Oldest-first allocation incorrect';end if;
 -- s3 needs 2 but only 1 P2 unit remains: GP stays unavailable, but known stock is reserved.
 if exists(select 1 from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and v.source_id='s3' and (r.cost_paise is not null or r.status<>'cost_unavailable')) then raise exception 'Short purchase quantity invented a cost';end if;
 if not exists(select 1 from private.stockflow_economic_auto_cost_links a join private.stockflow_economic_source_lines l on l.id=a.sale_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where a.run_id=run and v.source_id='s3' and a.quantity=1 and a.cost_paise=15000) then raise exception 'Uncovered sale did not reserve its available stock';end if;
 if exists(select 1 from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and v.source_id='s8' and (r.cost_paise is not null or r.gp_paise is not null)) then raise exception 'Later sale reused stock already consumed by an incompletely covered sale';end if;
 -- s5's batch matches no purchase: FIFO across batches q1+q2, weighted average cost 40000 for 2 units.
 if (select r.cost_paise from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and v.source_id='s5')<>40000 then raise exception 'Unmatched batch did not fall back to FIFO average cost';end if;
 -- s6's batch X1 is already used up: FIFO across batches takes the remaining q3 units (8000).
 if (select r.cost_paise from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and v.source_id='s6')<>8000 then raise exception 'Exhausted batch did not fall back to remaining FIFO stock';end if;
 -- s7's batch W1 was bought more than a year earlier: outside the lookback, so FIFO uses the in-year W2 purchase.
 if (select r.cost_paise from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and v.source_id='s7')<>22200 then raise exception 'Purchase older than one year was used or in-year fallback missed';end if;
 -- s4 uses a zero-value supplier purchase: genuine zero cost, full GP.
 if not exists(select 1 from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and v.source_id='s4' and r.cost_paise=0 and r.gp_paise=25000 and r.status='verified' and r.reason like 'Automatic Tally purchase cost%') then raise exception 'Zero-value purchase was not used as genuine zero cost';end if;
 -- Purchase quantity is never used twice in one run.
 if exists(select 1 from (select a.purchase_line_id,sum(a.quantity) used from private.stockflow_economic_auto_cost_links a where a.run_id=run group by 1) u join private.stockflow_economic_source_lines pl on pl.id=u.purchase_line_id where u.used>pl.quantity) then raise exception 'Purchase quantity reused';end if;
 if exists(select 1 from private.stockflow_economic_auto_cost_links a join private.stockflow_economic_source_lines pl on pl.id=a.purchase_line_id join private.stockflow_economic_source_vouchers pv on pv.id=pl.voucher_id where a.run_id=run and pv.source_id='p4') then raise exception 'Purchase dated after the sale was used';end if;
 -- Readable evidence names the Tally purchase.
 if not exists(select 1 from jsonb_array_elements(private.stockflow_economic_workspace(array['management'])->'attributionLines') a where a->>'costEvidence' like 'Auto from Tally purchase P2 line 1%') then raise exception 'Automatic cost evidence is not readable';end if;
 -- Repeating the rebuild restates once: same totals, no duplicated GP.
 if not exists(select 1 from jsonb_array_elements(private.stockflow_economic_workspace(array['management'])->'attributionLines') a where a->>'costEvidence' like 'Partial stock reservation (full cost unavailable) from Tally purchase P2 line 1%') then raise exception 'Partial stock reservation was shown as complete cost evidence';end if;
 events_before:=(select coalesce(sum(amount_paise),0) from private.stockflow_economic_events where target_id=target);
 perform private.stockflow_rebuild_instrument_economics('auto-cost-test');
 if events_before<>(select coalesce(sum(amount_paise),0) from private.stockflow_economic_events where target_id=target) then raise exception 'Repeated rebuild changed or duplicated automatic GP';end if;
 if (select count(*) from private.stockflow_economic_auto_cost_links a join private.stockflow_economic_runs u on u.id=a.run_id and u.active)<>8 then raise exception 'Active run automatic allocations not recalculated exactly';end if;
 -- The policy switch turns automatic costing off; a later policy version that does not mention it keeps it off.
 insert into private.stockflow_economic_policy_versions(actor,reason,automatic_purchase_cost) values('test','Automatic costing off',false);
 insert into private.stockflow_economic_policy_versions(actor,reason) values('test','Unrelated threshold change');
 perform private.stockflow_rebuild_instrument_economics('auto-cost-test');
 if exists(select 1 from private.stockflow_economic_auto_cost_links a join private.stockflow_economic_runs u on u.id=a.run_id and u.active) or exists(select 1 from private.stockflow_economic_results r join private.stockflow_economic_runs u on u.id=r.run_id and u.active where r.target_id=target and r.cost_paise is not null) then raise exception 'Automatic costing ran while switched off';end if;
 -- The helper cannot be called by API roles.
 if has_function_privilege('authenticated','private.stockflow_economic_auto_cost(uuid,uuid)','execute') then raise exception 'Automatic cost helper exposed';end if;
end$test$;
rollback;

-- Unmapped items bought by the same customer belong elsewhere and do not make the instrument Data incomplete.
begin;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('economic-tidy-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status) values('tidy-manager@test.local','management','active');
insert into public.stockflow_snapshots(id,company,fetched_at,payload) values('suprabha','SUPRABHA DISTRIBUTORS',now()::text,'{"catalog":[]}'::jsonb) on conflict(id) do nothing;
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values('cdcdcdcd-eeee-4eee-8eee-eeeeeeeeeeee','Tidy customer','tidy-customer','test');
insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,created_by_email,updated_by_email,idempotency_key) values('cdcdcdcd-eeee-4eee-8eee-eeeeeeeeeeed','TIDY-ORDER','cdcdcdcd-eeee-4eee-8eee-eeeeeeeeeeee','Tidy customer','phone','delivered','test','test','tidy-order-fixture');
insert into private.stockflow_equipment_installations(id,order_id,tally_key,item_name,status,scheduled_date,serial_number,created_by_email,completed_at) values('cdcdcdcd-eeee-4eee-8eee-eeeeeeeeeeec','cdcdcdcd-eeee-4eee-8eee-eeeeeeeeeeed','tidy-instrument','Tidy instrument','completed',private.stockflow_economic_business_date()-60,'TIDY-SERIAL','test',now()-interval '60 days'),('cdcdcdcd-eeee-4eee-8eee-eeeeeeeeeeeb','cdcdcdcd-eeee-4eee-8eee-eeeeeeeeeeed','tidy-instrument-2','Tidy second instrument','completed',private.stockflow_economic_business_date()-60,'TIDY-SERIAL-2','test',now()-interval '60 days');
do $test$
declare period date:=(date_trunc('month',private.stockflow_economic_business_date())-interval '1 month')::date; vouchers jsonb; target uuid; second uuid; health text;
begin
 select jsonb_agg(jsonb_build_object('sourceId',s.id,'revision','1','date',period+s.day,'kind',s.kind,'amountStatus','verified','customerSourceId',case when s.kind='sale' then 'tidy-customer-guid' else null end,
  'lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId',s.product,'quantity','1','unit','pack','netSalesPaise',s.amount)))) into vouchers
 from (values('tp1','purchase','m','1000',1),('ts1','sale','m','5000',5),('ts2','sale','other-analyser-reagent','7000',6)) s(id,kind,product,amount,day);
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',jsonb_build_object('schemaVersion',1,'companyId','tidy-company','sourceVersion',(period::timestamp at time zone 'Asia/Kolkata')::text,'completeWindow',true,'windowFrom',period,'windowTo',(period+interval '1 month')::date,'vouchers',vouchers)) where id='suprabha';
 target:=(public.stockflow_economics_gateway('economic-tidy-key','tidy-manager@test.local','create_target',jsonb_build_object('kind','placement','name','Tidy instrument','companyId','tidy-company','customerId','cdcdcdcd-eeee-4eee-8eee-eeeeeeeeeeee','customerSourceId','tidy-customer-guid','siteId','tidy-site','modelId','tidy-model','installationId','cdcdcdcd-eeee-4eee-8eee-eeeeeeeeeeec','effectiveFrom',period,'capitalPaise','0','idempotencyKey','tidy-create-0000001'))->>'entityId')::uuid;
 perform public.stockflow_economics_gateway('economic-tidy-key','tidy-manager@test.local','set_mapping',jsonb_build_object('companyId','tidy-company','modelId','tidy-model','productId','m','targetId',target,'effect','include','effectiveFrom',period,'reason','Reagent m counts for this instrument','idempotencyKey','tidy-map-reagent-m-01'));
 perform public.stockflow_economics_gateway('economic-tidy-key','tidy-manager@test.local','approve_target',jsonb_build_object('targetId',target,'expectedVersion',1,'expectedGeneration',(select id from private.stockflow_economic_runs where active),'decision','approved','reason','Track actual costs','idempotencyKey','tidy-approve-0000001'));
 select t->>'health' into health from jsonb_array_elements(private.stockflow_economic_workspace(array['management'])->'targets') t where t->>'id'=target::text;
 if health='data_incomplete' then raise exception 'An unmapped item bought by the same customer kept the instrument Data incomplete: % / results %',(select t from jsonb_array_elements(private.stockflow_economic_workspace(array['management'])->'targets') t where t->>'id'=target::text),(select jsonb_agg(jsonb_build_object('s',r.status,'r',r.reason,'t',r.target_id)) from private.stockflow_economic_results r join private.stockflow_economic_runs u on u.id=r.run_id and u.active join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id='tidy-company');end if;
 -- A sale two instruments could claim is still unresolved.
 second:=(public.stockflow_economics_gateway('economic-tidy-key','tidy-manager@test.local','create_target',jsonb_build_object('kind','placement','name','Tidy second instrument','companyId','tidy-company','customerId','cdcdcdcd-eeee-4eee-8eee-eeeeeeeeeeee','customerSourceId','tidy-customer-guid','siteId','tidy-site','modelId','tidy-model-2','installationId','cdcdcdcd-eeee-4eee-8eee-eeeeeeeeeeeb','effectiveFrom',period,'capitalPaise','0','idempotencyKey','tidy-create-0000002'))->>'entityId')::uuid;
 perform public.stockflow_economics_gateway('economic-tidy-key','tidy-manager@test.local','set_mapping',jsonb_build_object('companyId','tidy-company','modelId','tidy-model-2','productId','m','targetId',second,'effect','include','effectiveFrom',period,'reason','Reagent m also counts here','idempotencyKey','tidy-map-reagent-m-02'));
 perform public.stockflow_economics_gateway('economic-tidy-key','tidy-manager@test.local','approve_target',jsonb_build_object('targetId',second,'expectedVersion',1,'expectedGeneration',(select id from private.stockflow_economic_runs where active),'decision','approved','reason','Track actual costs','idempotencyKey','tidy-approve-0000002'));
 select t->>'health' into health from jsonb_array_elements(private.stockflow_economic_workspace(array['management'])->'targets') t where t->>'id'=target::text;
 if health<>'data_incomplete' then raise exception 'A sale claimable by two instruments was not treated as unresolved (health %)',health;end if;
end$test$;
rollback;
