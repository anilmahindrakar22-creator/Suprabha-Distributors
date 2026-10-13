begin;
do $dates$
declare saved_zone text:=current_setting('TimeZone');
begin
 perform set_config('TimeZone','UTC',true);
 if private.stockflow_economic_business_date('2026-09-30 18:29:59+00'::timestamptz)<>date '2026-09-30' or private.stockflow_economic_business_date('2026-09-30 18:30:00+00'::timestamptz)<>date '2026-10-01' then raise exception 'Indian midnight/month boundary is incorrect';end if;
 perform set_config('TimeZone','America/Los_Angeles',true);
 if private.stockflow_economic_business_date('2026-09-30 18:30:00+00'::timestamptz)<>date '2026-10-01' then raise exception 'Host timezone changed the economic business date';end if;
 if date_trunc('month',private.stockflow_economic_business_date('2026-09-30 18:30:00+00'::timestamptz))::date<>date '2026-10-01' then raise exception 'Reporting month used the wrong business timezone';end if;
 perform set_config('TimeZone',saved_zone,true);
end$dates$;

update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('economic-test-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status) values('economic-administrator@test.local','administrator','active'),('economic-manager@test.local','management','active'),('economic-viewer@test.local','viewer','active'),('economic-account@test.local','accounts','active');
insert into public.stockflow_snapshots(id,company,fetched_at,payload) values('suprabha','SUPRABHA DISTRIBUTORS',now()::text,'{"catalog":[]}'::jsonb) on conflict(id) do nothing;
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Economic fixture customer','legacy-fixture','test');
-- This suite covers the manual purchase-cost path; automatic costing has its own suite.
insert into private.stockflow_economic_policy_versions(actor,reason,automatic_purchase_cost) values('test','Manual purchase-cost verification path fixture',false);
insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,created_by_email,updated_by_email,idempotency_key) values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeed','ECON-TEST-ORDER','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Economic fixture customer','phone','delivered','test','test','economic-order-fixture');
insert into private.stockflow_equipment_installations(id,order_id,tally_key,item_name,status,scheduled_date,serial_number,created_by_email,completed_at)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeec','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeed','legacy-item','SYS fixture','completed',private.stockflow_economic_business_date()-60,'ECON-SERIAL','test',now()-interval '60 days');
do $test$
declare receipt jsonb;response jsonb;replay jsonb;payload jsonb;target uuid;run uuid;line_id uuid;purchase_id uuid;case_id uuid;return_id uuid;pool uuid;second_target uuid;period date:=(date_trunc('month',private.stockflow_economic_business_date())-interval '1 month')::date;doc jsonb;before_count integer;workspace jsonb;
begin
 begin perform public.stockflow_economics_gateway('economic-test-key','economic-viewer@test.local','get_instrument_economics','{}');raise exception 'Viewer read economic data';exception when insufficient_privilege then null;end;
 begin perform public.stockflow_economics_gateway('wrong-key','economic-manager@test.local','get_instrument_economics','{}');raise exception 'Wrong gateway accepted';exception when insufficient_privilege then null;end;
 payload:=jsonb_build_object('kind','placement','name','Economic test placement','companyId','company-guid-1','customerId','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','customerSourceId','customer-guid-1','siteId','site-1','modelId','sys-240','installationId','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeec','effectiveFrom',period-10,'capitalPaise','55000000','capitalEvidence','Reviewed instrument acquisition invoice','idempotencyKey','economic-create-0001');
 response:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','create_target',payload);target:=(response->>'entityId')::uuid;
 replay:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','create_target',payload);
 if response<>replay then raise exception 'Command replay changed result';end if;
 if (select count(*) from private.stockflow_economic_events where target_id=target and kind='capital')<>1 then raise exception 'Capital duplicated';end if;
 begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','create_target',payload||'{"name":"Changed"}');raise exception 'Changed replay accepted';exception when invalid_parameter_value then null;end;
 workspace:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','get_instrument_economics','{}');
 if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=target::text and t->'approvalPreview'->>'status'='actuals_only' and t->'approvalPreview'->>'expectationId' is null and t->'approvalPreview'->>'expectedPaybackMonths' is null) then raise exception 'A verified placement without a planning target was not ready for actual tracking';end if;
 begin
  response:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','approve_target',jsonb_build_object('expectedGeneration',(select id from private.stockflow_economic_runs where active),'targetId',target,'expectedVersion',1,'decision','approved','reason','Track verified actual economics without a planning target','idempotencyKey','economic-actuals-only-approval'));
  if (select approval from private.stockflow_economic_targets where id=target)<>'approved' or private.stockflow_economic_approved_expectation(target) is not null then raise exception 'Actual-only approval invented or required a planning target';end if;
  workspace:=private.stockflow_economic_workspace(array['management']);
  if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=target::text and t->'investmentReview'->>'status'='planning_not_set') then raise exception 'Approved actual tracking hid the optional planning state';end if;
  raise exception using errcode='ZT014',message='Rollback actual-only approval fixture';
 exception when sqlstate 'ZT014' then null;end;
 perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_mapping',jsonb_build_object('companyId','company-guid-1','modelId','sys-240','productId','product-guid-1','effect','include','effectiveFrom',period,'reason','Verified OEM compatibility','idempotencyKey','economic-mapping-0001'));
 perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_expectation',jsonb_build_object('targetId',target,'effectiveFrom',period-10,'monthlyRevenuePaise','6000000','monthlyGpPaise','1800000','productId','product-guid-1','baseUnit','pack','expectedMonthlyUnits','100','expectedUnitPricePaise','10000','expectedUnitCostPaise','6000','reason','Approved test baseline','idempotencyKey','economic-expect-0001'));
 payload:=jsonb_build_object('targetId',target,'expectedVersion',1,'decision','approved','reason','Management approved baseline','idempotencyKey','economic-approve-001');
 begin
  perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','approve_target',payload||'{"idempotencyKey":"economic-approval-no-preview"}');
  raise exception 'Approval accepted without the financial preview generation';
 exception when sqlstate 'PT409' then null;end;
 payload:=payload||jsonb_build_object('expectedGeneration',(select id from private.stockflow_economic_runs where active));
 declare changed_action text; old_count integer;
 begin
  workspace:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','get_instrument_economics','{}');
  if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=target::text and t->'approvalPreview'->>'status'='within_limit' and t->'approvalPreview'->>'netInvestmentPaise'='55000000' and t->'approvalPreview'->>'expectedMonthlyGpPaise'='1800000' and abs((t->'approvalPreview'->>'expectedPaybackMonths')::numeric-550::numeric/18)<0.00000001) then raise exception 'Proposal preview does not use the approval baseline and capital';end if;
  foreach changed_action in array array['set_expectation','set_policy','record_capital'] loop
   begin
    if changed_action='set_expectation' then
     perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local',changed_action,jsonb_build_object('targetId',target,'effectiveFrom',period-10,'monthlyRevenuePaise','6000000','monthlyGpPaise','2000000','reason','Changed assumption while reviewer is reading','idempotencyKey','approval-stale-baseline'));
    elsif changed_action='set_policy' then
     perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local',changed_action,'{"attractiveMonths":24,"reviewMonths":35,"exceptionMonths":48,"forecastWindowMonths":3,"watchRevenuePercent":80,"criticalRevenuePercent":50,"reason":"Policy changed while reviewer is reading","idempotencyKey":"approval-stale-policy"}');
    else
     perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local',changed_action,jsonb_build_object('targetId',target,'kind','capital','amountPaise','100000','effectiveDate',period,'reason','Additional capital while reviewer is reading','idempotencyKey','approval-stale-capital'));
    end if;
    if (select version from private.stockflow_economic_targets where id=target)<>1 then raise exception 'Stale financial fixture unexpectedly changed target version';end if;
    select count(*) into old_count from private.stockflow_economic_audit;
    begin
     perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','approve_target',payload||jsonb_build_object('idempotencyKey','approval-stale-'||changed_action));
     raise exception 'Approval accepted obsolete financial preview after %',changed_action;
    exception when sqlstate 'PT409' then null;end;
    if (select approval from private.stockflow_economic_targets where id=target)<>'proposed' or (select count(*) from private.stockflow_economic_audit)<>old_count or exists(select 1 from private.stockflow_command_results where idempotency_key='approval-stale-'||changed_action) then raise exception 'Rejected stale approval partially committed';end if;
    raise exception using errcode='ZT011',message='Rollback changed financial preview fixture';
   exception when sqlstate 'ZT011' then null;end;
  end loop;
 end;
 response:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','approve_target',payload);
 replay:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','approve_target',payload);if response<>replay then raise exception 'Approval replay failed';end if;
 begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','close_target',jsonb_build_object('targetId',target,'expectedVersion',1,'effectiveTo',period+20,'reason','Stale closure','idempotencyKey','economic-stale-0001'));raise exception 'Stale placement edit accepted';exception when sqlstate 'PT409' then null;end;
 doc:=jsonb_build_object('schemaVersion',1,'companyId','company-guid-1','sourceVersion','economic-source-v1','completeWindow',true,'windowFrom',period-10,'windowTo',period+interval '1 month','vouchers',jsonb_build_array(
  jsonb_build_object('sourceId','purchase-1','revision',1,'date',period,'kind','purchase','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','product-guid-1','quantity','70','unit','pack','netSalesPaise','3200000'))),
  jsonb_build_object('sourceId','sale-1','revision',1,'date',period+1,'kind','sale','customerSourceId','customer-guid-1','siteId','site-1','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','product-guid-1','quantity','70','unit','pack','netSalesPaise','5000000','gstPaise','900000')))
 ));
 update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc) where id='suprabha';
 if (select count(*) from private.stockflow_economic_source_vouchers where company_id='company-guid-1')<>2 then raise exception 'Source import failed: %',(select jsonb_agg(to_jsonb(e)) from private.stockflow_economic_import_exceptions e);end if;
 if exists(select 1 from public.stockflow_snapshots s where s.id='suprabha' and s.payload?'economicEvidence') then raise exception 'Economic details leaked into stock snapshot';end if;
 update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc) where id='suprabha';
 if (select count(*) from private.stockflow_economic_source_vouchers where company_id='company-guid-1')<>2 then raise exception 'Duplicate source import';end if;
 perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','rebuild','{"idempotencyKey":"economic-rebuild-0001"}');
 if not exists(select 1 from private.stockflow_economic_results r join private.stockflow_economic_runs g on g.id=r.run_id where g.active and r.target_id=target and r.status='cost_unavailable' and r.gp_paise is null) then raise exception 'Missing cost invented GP';end if;
 workspace:=private.stockflow_economic_workspace(array['accounts']);
 if (workspace->>'canAct')::boolean or (private.stockflow_economic_workspace(array['accounts','sales','operations'])->>'canAct')::boolean then raise exception 'Read-only combined roles exposed economic case actions';end if;
 if not exists(select 1 from jsonb_array_elements(workspace->'leakage') l where l->>'targetId'=target::text and l->>'financialVarianceStatus'='missing_cost' and l->>'expectedGpPaise'='400000' and l->>'actualGpPaise' is null and l->>'gpVariancePaise' is null and l->>'actualRevenuePaise'='5000000') then raise exception 'Missing actual cost hid expected GP or invented actual GP variance';end if;
 select l.id into line_id from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.source_id='sale-1';
 select l.id into purchase_id from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.source_id='purchase-1';
 perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','verify_cost',jsonb_build_object('sourceLineId',line_id,'purchaseAllocations',jsonb_build_array(jsonb_build_object('purchaseLineId',purchase_id,'quantity','70')),'evidenceReference','Tally purchase batch fixture','idempotencyKey','economic-cost-00001'));
 if not exists(select 1 from private.stockflow_economic_results r join private.stockflow_economic_runs g on g.id=r.run_id where g.active and r.target_id=target and r.gp_paise=1800000 and r.revenue_paise=5000000 and r.cost_paise=3200000) then raise exception 'Actual GP expected 1800000 paise';end if;
 if (select sum(amount_paise) from private.stockflow_economic_events where target_id=target and kind<>'capital')<>1800000 then raise exception 'Ledger replay differs from actual GP';end if;
 workspace:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','get_instrument_economics','{}');
 if workspace->'targets'->0->>'knownGpPaise'<>'1800000' then raise exception 'Portfolio actual GP wrong: %',workspace;end if;
 if workspace->'reportingSummary'->>'netSalesPaise'<>'5000000' or workspace->'reportingSummary'->>'attributedSalesPaise'<>'5000000' or workspace->'reportingSummary'->>'knownGpPaise'<>'1800000' or workspace->'reportingSummary'->>'missingCostLines'<>'0' then raise exception 'Monthly reconciliation does not match source example';end if;
 -- Optional planning does not turn otherwise complete evidence into a data gap.
 declare actual_only_target uuid; actual_only_workspace jsonb; actual_only_response jsonb;
 begin
  actual_only_response:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','create_target',jsonb_build_object('kind','group','name','Actual-only health fixture','companyId','company-guid-1','customerId','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','customerSourceId','customer-guid-1','siteId','actual-only-site','modelId','actual-only-model','effectiveFrom',period-10,'capitalPaise','1000000','capitalEvidence','Verified actual-only acquisition evidence','idempotencyKey','economic-actual-only-health-create'));
  actual_only_target:=(actual_only_response->>'entityId')::uuid;
  perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','approve_target',jsonb_build_object('expectedGeneration',(select id from private.stockflow_economic_runs where active),'targetId',actual_only_target,'expectedVersion',1,'decision','approved','reason','Track verified actual economics without a planning target','idempotencyKey','economic-actual-only-health-approve'));
  actual_only_workspace:=private.stockflow_economic_workspace(array['management']);
  if not exists(select 1 from jsonb_array_elements(actual_only_workspace->'targets') t where t->>'id'=actual_only_target::text and t->'expectation'='null'::jsonb and t->'investmentReview'->>'status'='planning_not_set' and t->>'health'<>'data_incomplete') then raise exception 'Optional planning target still caused Data incomplete: %',actual_only_workspace->'targets';end if;
  raise exception using errcode='ZT015',message='Rollback actual-only health fixture';
 exception when sqlstate 'ZT015' then null;
 end;
 -- Healthy revenue cannot hide slow payback based on verified actual GP.
 declare saved_forecast_doc jsonb:=doc; revised_purchase uuid; cost_value bigint; source_rev integer:=1; expected_months numeric; expected_health text;
 begin
  perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_policy',jsonb_build_object('attractiveMonths',24,'reviewMonths',36,'exceptionMonths',48,'forecastWindowMonths',1,'watchRevenuePercent',80,'criticalRevenuePercent',50,'reason','One completed-month actual forecast health fixture','idempotencyKey','economic-actual-forecast-policy'));
  foreach cost_value in array array[3750000::bigint,4500000::bigint,5000000::bigint] loop
   source_rev:=source_rev+1;
   expected_months:=case when cost_value=3750000 then 43 when cost_value=4500000 then 109 else null end;
   expected_health:=case when cost_value=3750000 then 'watch' else 'critical' end;
   doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','purchase-1','revision',source_rev,'date',period,'kind','purchase','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','product-guid-1','quantity','70','unit','pack','netSalesPaise',cost_value::text)))));
   update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc||jsonb_build_object('sourceVersion','actual-forecast-health-'||source_rev::text)) where id='suprabha';
   workspace:=private.stockflow_economic_workspace(array['management']);
   if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=target::text and t->>'forecastMonths' is null and t->'forecastReview'->>'status'='not_available' and t->>'health'='data_incomplete') then raise exception 'Changed purchase cost produced a forecast before reverification';end if;
   select l.id into revised_purchase from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.source_id='purchase-1' and v.source_revision=source_rev;
   perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','verify_cost',jsonb_build_object('sourceLineId',line_id,'purchaseAllocations',jsonb_build_array(jsonb_build_object('purchaseLineId',revised_purchase,'quantity','70')),'evidenceReference','Actual revised Tally purchase cost for forecast health','idempotencyKey','economic-actual-forecast-cost-'||source_rev::text));
   workspace:=private.stockflow_economic_workspace(array['management']);
   if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=target::text and (t->>'forecastMonths')::numeric is not distinct from expected_months and t->>'health'=expected_health and t->'forecastReview'->>'status'=case when cost_value=5000000 then 'non_positive_gp' when expected_health='watch' then 'review_required' else 'limit_exceeded' end and t->'investmentReview'->>'status'='within_limit') then raise exception 'Healthy revenue hid slow actual payback: %',workspace->'targets';end if;
  end loop;
  raise exception using errcode='ZT013',message='Rollback actual forecast health fixture';
 exception when sqlstate 'ZT013' then doc:=saved_forecast_doc;
 end;
 -- A future payback forecast requires an active approved placement. Keep the
 -- historical GP visible after closure; roll this isolated scenario back.
 begin
  insert into private.stockflow_economic_policy_versions(forecast_window_months,actor,reason) values(1,'test','One complete month forecast fixture');
  workspace:=private.stockflow_economic_workspace(array['management']);
  if workspace->'targets'->0->>'forecastMonths' is null then raise exception 'Active approved placement lost supported forecast';end if;
  perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','close_target',jsonb_build_object('targetId',target,'expectedVersion',2,'effectiveTo',period+20,'reason','Forecast closure fixture','idempotencyKey','economic-forecast-close'));
  workspace:=private.stockflow_economic_workspace(array['management']);
  if workspace->'targets'->0->>'health'<>'inactive' or workspace->'targets'->0->>'forecastMonths' is not null or workspace->'targets'->0->>'knownGpPaise'<>'1800000' then raise exception 'Closed placement forecast/history incorrect';end if;
  raise exception using errcode='ZT001',message='Rollback isolated forecast fixture';
 exception when sqlstate 'ZT001' then null;
 end;
 workspace:=private.stockflow_economic_workspace(array['management']);
 if not exists(select 1 from jsonb_array_elements(workspace->'leakage') l where l->>'targetId'=target::text and l->>'expectedRevenuePaise'='1000000' and l->>'actualRevenuePaise'='5000000' and l->>'revenueVariancePaise'='4000000' and l->>'expectedGpPaise'='400000' and l->>'actualGpPaise'='1800000' and l->>'gpVariancePaise'='1400000') then raise exception 'Baseline-versus-actual economics did not reconcile with Tally GP';end if;
 -- FOC retains physical supply and actual purchase cost; financial variance separately exposes zero revenue.
 declare foc_doc jsonb:=doc; foc_sale uuid;
 begin
  foc_doc:=jsonb_set(foc_doc,'{vouchers}',foc_doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','sale-1','revision',2,'date',period+1,'kind','sale','customerSourceId','customer-guid-1','siteId','site-1','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','product-guid-1','quantity','70','unit','pack','netSalesPaise','0','focReason','unsupported_source_reason')))));
  update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',foc_doc||'{"sourceVersion":"financial-foc-fixture"}') where id='suprabha';
  workspace:=private.stockflow_economic_workspace(array['accounts']);
  if workspace->'reportingSummary'->>'missingCostLines'<>'1' or workspace->'reportingSummary'->>'missingCostSalesPaise'<>'0' then raise exception 'Zero-revenue FOC missing cost was hidden by zero sales amount';end if;
  select l.id into foc_sale from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.source_id='sale-1' and v.source_revision=2;
  perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','verify_cost',jsonb_build_object('sourceLineId',foc_sale,'purchaseAllocations',jsonb_build_array(jsonb_build_object('purchaseLineId',purchase_id,'quantity','70')),'evidenceReference','Actual FOC historical purchase cost','idempotencyKey','economic-foc-variance-cost'));
  workspace:=private.stockflow_economic_workspace(array['accounts']);
  if not exists(select 1 from private.stockflow_economic_results r join private.stockflow_economic_runs g on g.id=r.run_id and g.active where r.source_line_id=foc_sale and r.status='foc_unclassified' and r.gp_paise=-3200000) then raise exception 'Unsupported FOC source reason bypassed classification review';end if;
  perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','resolve_line',jsonb_build_object('sourceLineId',foc_sale,'focReason','commercial_support','reason','Management reviewed commercial support FOC','idempotencyKey','economic-foc-reason-review'));
  workspace:=private.stockflow_economic_workspace(array['accounts']);
  if not exists(select 1 from private.stockflow_economic_results r join private.stockflow_economic_runs g on g.id=r.run_id and g.active where r.source_line_id=foc_sale and r.status='verified' and r.gp_paise=-3200000) then raise exception 'FOC review changed actual GP or failed classification';end if;
  if not exists(select 1 from jsonb_array_elements(workspace->'leakage') l where l->>'targetId'=target::text and (l->>'actualUnits')::numeric=70 and l->>'actualRevenuePaise'='0' and l->>'revenueVariancePaise'='-1000000' and l->>'actualGpPaise'='-3200000' and l->>'gpVariancePaise'='-3600000') then raise exception 'FOC supply hid negative actual economics or duplicated cost';end if;
  raise exception using errcode='ZT008',message='Rollback FOC variance fixture';
 exception when sqlstate 'ZT008' then null;
 end;
 workspace:=private.stockflow_economic_workspace(array['management']);
 if workspace->'leakage'->0->>'shortfallUnits'<>'30.000000' or workspace->'leakage'->0->>'potentialRevenuePaise'<>'300000' then raise exception 'Leakage expected 30 units / 300000 paise: %',workspace->'leakage';end if;
 perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','record_observation',jsonb_build_object('targetId',target,'productId','product-guid-1','baseUnit','pack','windowFrom',period,'windowTo',(period+interval '1 month')::date,'testCount','1000','testsPerUnit','10','qcUnits','0','openingStock','20','closingStock','10','netTransfers','0','externalSupply','20','evidenceReference','Signed laboratory workload and stock count','idempotencyKey','economic-observation-001'));
 workspace:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','get_instrument_economics','{}');
 if workspace->'leakage'->0->>'shortfallUnits'<>'20.000000' or workspace->'leakage'->0->>'actualConsumptionUnits'<>'100.000000' or workspace->'leakage'->0->>'evidenceTier'<>'inventory_reconciled' then raise exception 'Observed workload/stock reconciliation incorrect: %',workspace->'leakage';end if;
 before_count:=(select count(*) from private.stockflow_economic_events);
 perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','rebuild','{"idempotencyKey":"economic-rebuild-0002"}');
 if (select sum(amount_paise) from private.stockflow_economic_events where target_id=target and kind<>'capital')<>1800000 then raise exception 'Rebuild duplicated GP';end if;
 perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','verify_cost',jsonb_build_object('sourceLineId',line_id,'purchaseAllocations',jsonb_build_array(jsonb_build_object('purchaseLineId',purchase_id,'quantity','70')),'evidenceReference','Reverified historical purchase; previous evidence retained','idempotencyKey','economic-cost-00002'));
 if (select count(*) from private.stockflow_economic_cost_verifications where sale_line_id=line_id)<>2 or (select sum(amount_paise) from private.stockflow_economic_events where target_id=target and kind<>'capital')<>1800000 then raise exception 'Cost reverification duplicated GP or discarded evidence';end if;
 begin update private.stockflow_economic_events set amount_paise=0 where target_id=target;raise exception 'Economic ledger mutable';exception when sqlstate '55000' then null;end;
 begin perform public.stockflow_economics_gateway('economic-test-key','economic-account@test.local','record_capital',jsonb_build_object('targetId',target,'kind','capital','amountPaise','1','effectiveDate',period,'reason','Forbidden','idempotencyKey','economic-account-001'));raise exception 'Accounts mutated economics';exception when insufficient_privilege then null;end;
 if not exists(select 1 from private.stockflow_economic_audit a where a.action='approve_target' and a.payload?'approvalExpectationId' and a.payload?'approvalPolicyId') then raise exception 'Approval baseline or policy not retained';end if;
 -- Manual increases must obey the same approved payback limits as acquisition revisions.
 begin
  perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_expectation',jsonb_build_object('targetId',target,'effectiveFrom',period-10,'monthlyRevenuePaise','6000000','monthlyGpPaise','5000000','reason','Optimistic revised planning assumption is not a new placement approval','idempotencyKey','economic-backdated-capital-plan'));
  payload:=jsonb_build_object('targetId',target,'kind','capital','amountPaise','9800001','effectiveDate',period,'reason','Additional approved instrument investment','idempotencyKey','economic-capital-review-fixture');
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','record_capital',payload);raise exception 'Manual capital increase bypassed director review';exception when invalid_parameter_value then null;end;
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-administrator@test.local','record_capital',payload||'{"amountPaise":"40000000","directorException":true,"idempotencyKey":"economic-capital-limit-fixture"}');raise exception 'Manual capital increase bypassed absolute approval limit';exception when invalid_parameter_value then null;end;
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','record_capital',jsonb_build_object('targetId',target,'kind','contribution','amountPaise','10000000','effectiveDate',private.stockflow_economic_business_date()+1,'reason','Future recovery cannot be actual today','idempotencyKey','economic-future-contribution-fixture'));raise exception 'Future contribution prematurely changed actual recovery';exception when invalid_parameter_value then null;end;
  perform public.stockflow_economics_gateway('economic-test-key','economic-administrator@test.local','record_capital',payload||'{"directorException":true}');
  if not exists(select 1 from private.stockflow_economic_audit a where a.action='record_capital' and a.payload->>'idempotencyKey'='economic-capital-review-fixture' and a.payload?'approvalExpectationId' and a.payload?'approvalPolicyId' and (a.payload->>'expectedPaybackMonths')::numeric>36 and exists(select 1 from private.stockflow_economic_events e where e.id=a.entity_id and e.target_id=target)) then raise exception 'Capital increase lost its approval evidence';end if;
  if not exists(select 1 from private.stockflow_economic_audit a join private.stockflow_economic_audit original on original.action='approve_target' and original.entity_id=target and original.payload->>'decision'='approved' where a.action='record_capital' and a.payload->>'idempotencyKey'='economic-capital-review-fixture' and a.payload->>'approvalExpectationId'=original.payload->>'approvalExpectationId') then raise exception 'Capital increase substituted a later planning version for the approved baseline';end if;
  workspace:=private.stockflow_economic_workspace(array['management']);
  if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=target::text and t->>'health'='watch' and t->'investmentReview'->>'status'='review_required' and (t->'investmentReview'->>'expectedPaybackMonths')::numeric=36) then raise exception 'Portfolio health hid a current investment review threshold';end if;
  perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_policy',jsonb_build_object('attractiveMonths',20,'reviewMonths',30,'exceptionMonths',35,'forecastWindowMonths',3,'watchRevenuePercent',80,'criticalRevenuePercent',50,'reason','Review existing investment against tighter policy','idempotencyKey','economic-capital-health-policy'));
  workspace:=private.stockflow_economic_workspace(array['management']);
  if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=target::text and t->>'health'='critical' and t->'investmentReview'->>'status'='limit_exceeded') then raise exception 'Portfolio health hid a current investment absolute limit';end if;
  raise exception using errcode='ZT010',message='Rollback capital approval fixture';
 exception when sqlstate 'ZT010' then null;
 end;
 -- Commercial recovery is an annotation, and returns restate both GP and claims.
 response:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','create_case',jsonb_build_object('targetId',target,'title','Fixture recovery','reason','competitor_supply','owner','economic-manager@test.local','action','Review reagent supply','opportunityProductId','product-guid-1','windowFrom',period-10,'windowTo',period,'idempotencyKey','economic-case-0001'));case_id:=(response->>'entityId')::uuid;
 -- Case valuation is a frozen estimate tied to baseline and source generation, not a live recalculation.
 -- Dismissal permits a replacement, but reopening must not duplicate the opportunity.
 begin
  payload:=jsonb_build_object('caseId',case_id,'expectedVersion',1,'status','dismissed','reason','Replace old opportunity review','owner','economic-manager@test.local','action','Review corrected evidence','outcome','Superseded by a replacement case','idempotencyKey','economic-case-dismiss-fixture');
  perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','update_case',payload);
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','claim_recovery',jsonb_build_object('caseId',case_id,'sourceLineId',line_id,'shareBasisPoints',10000,'reason','Closed-case recovery must require reopening','idempotencyKey','economic-dismissed-claim-fixture'));raise exception 'Dismissed case accepted new recovery evidence';exception when sqlstate 'PT409' then null;end;
  perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','create_case',jsonb_build_object('targetId',target,'title','Replacement opportunity','reason','Reviewed replacement','owner','economic-manager@test.local','action','Review replacement supply','opportunityProductId','product-guid-1','windowFrom',period-10,'windowTo',period,'idempotencyKey','economic-case-replacement-fixture'));
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','update_case',payload||'{"expectedVersion":2,"status":"qualified","idempotencyKey":"economic-case-reopen-fixture"}');raise exception 'Reopening duplicated an active opportunity';exception when sqlstate 'PT409' then null;end;
  if (select version from private.stockflow_leakage_cases where id=case_id)<>2 or (select status from private.stockflow_leakage_cases where id=case_id)<>'dismissed' then raise exception 'Rejected reopening mutated original case';end if;
  begin update private.stockflow_leakage_cases set status='qualified' where id=case_id;raise exception 'Direct reopening bypassed overlap constraint';exception when exclusion_violation then null;end;
  raise exception using errcode='ZT009',message='Rollback replacement/reopening fixture';
 exception when sqlstate 'ZT009' then null;
 end;
 declare original_evaluation jsonb;
 begin
  select evaluation into original_evaluation from private.stockflow_leakage_cases where id=case_id;
  if original_evaluation->>'expectationId' is null or original_evaluation->>'generationId' is null or original_evaluation->>'evidenceTier'<>'supply_proxy' then raise exception 'Case estimate lacks baseline/source provenance';end if;
  begin update private.stockflow_leakage_cases set evaluation='{}' where id=case_id;raise exception 'Case estimate provenance was mutable';exception when sqlstate '55000' then null;end;
  perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_expectation',jsonb_build_object('targetId',target,'effectiveFrom',period-10,'monthlyRevenuePaise','6000000','monthlyGpPaise','1800000','productId','product-guid-1','baseUnit','pack','expectedMonthlyUnits','150','expectedUnitPricePaise','10000','expectedUnitCostPaise','6000','reason','Revised fixture baseline','idempotencyKey','economic-provenance-baseline'));
  if (select evaluation from private.stockflow_leakage_cases where id=case_id) is distinct from original_evaluation then raise exception 'Baseline revision rewrote an earlier case estimate';end if;
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','create_case',jsonb_build_object('targetId',target,'title','Stale estimate fixture','reason','Data review','owner','economic-manager@test.local','action','Review stale source','opportunityProductId','product-guid-1','windowFrom',period-10,'windowTo',period,'expectedGeneration',original_evaluation->>'generationId','idempotencyKey','economic-stale-opportunity'));raise exception 'Stale opportunity generation accepted';exception when sqlstate 'PT409' then null;end;
  workspace:=private.stockflow_economic_workspace(array['accounts']);
  if not exists(select 1 from jsonb_array_elements(workspace->'caseHistory') e where e->>'caseId'=case_id::text and e->>'action'='create_case' and e->'payload'->'evaluation'=original_evaluation) then raise exception 'Case history omitted original estimate provenance';end if;
  raise exception using errcode='ZT007',message='Rollback case provenance fixture';
 exception when sqlstate 'ZT007' then null;
 end;
 -- Freezing a segmented opportunity must preserve the displayed monthly proration.
 declare segment_item jsonb; segment_receipt jsonb; segment_case uuid;
 begin
  perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_expectation',jsonb_build_object('targetId',target,'effectiveFrom',period+15,'monthlyRevenuePaise','6000000','monthlyGpPaise','1800000','productId','product-guid-1','baseUnit','pack','expectedMonthlyUnits','200','expectedUnitPricePaise','10000','expectedUnitCostPaise','6000','reason','Mid-month reagent plan revision','idempotencyKey','economic-segment-baseline'));
  workspace:=private.stockflow_economic_workspace(array['management']);
  select value into segment_item from jsonb_array_elements(workspace->'leakage') where value->>'targetId'=target::text and value->>'productId'='product-guid-1' and (value->>'windowFrom')::date=period;
  if (segment_item->>'expectedUnits')::numeric is distinct from round(100::numeric*15/((period+interval '1 month')::date-period),6) then raise exception 'Segment expected units lost calendar-month proration';end if;
  segment_receipt:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','create_case',jsonb_build_object('targetId',target,'title','Segmented estimate review','reason','Review first-half supply','owner','economic-manager@test.local','action','Review monthly plan segment','opportunityProductId','product-guid-1','windowFrom',segment_item->>'windowFrom','windowTo',segment_item->>'windowTo','expectedGeneration',workspace->>'generation','idempotencyKey','economic-segment-case'));
  segment_case:=(segment_receipt->>'entityId')::uuid;
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','create_case',jsonb_build_object('targetId',target,'title','Invalid long opportunity','reason','Review invalid range','owner','economic-manager@test.local','action','Review source','opportunityProductId','product-guid-1','windowFrom',period,'windowTo',(period+interval '2 months')::date,'idempotencyKey','economic-segment-long-window'));raise exception 'V1 case accepted a multi-month estimate';exception when invalid_parameter_value then null;end;
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','create_case',jsonb_build_object('targetId',target,'title','Invalid merged opportunity','reason','Review baseline segments','owner','economic-manager@test.local','action','Review source','opportunityProductId','product-guid-1','windowFrom',period,'windowTo',(period+interval '1 month')::date,'idempotencyKey','economic-segment-merged-window'));raise exception 'Case silently selected one of several baseline segments';exception when invalid_parameter_value then null;end;
  if (select evaluation->>'expectedUnits' from private.stockflow_leakage_cases where id=segment_case) is distinct from segment_item->>'expectedUnits' or (select potential_revenue_paise::text from private.stockflow_leakage_cases where id=segment_case) is distinct from segment_item->>'potentialRevenuePaise' then raise exception 'Case creation changed the displayed segmented estimate';end if;
  raise exception using errcode='ZT011',message='Rollback segmented estimate fixture';
 exception when sqlstate 'ZT011' then null;
 end;
 -- A shortfall is not a confirmed cause; classification and evidence commit with the case version/audit.
 begin
  payload:=jsonb_build_object('caseId',case_id,'expectedVersion',1,'status','qualified','reason','Customer sourcing investigation','owner','economic-manager@test.local','action','Review supplier evidence','primaryReason','competitor_sourcing','reasonCodes',jsonb_build_array('competitor_sourcing','pricing_pressure'),'confidence','confirmed','evidenceReference','','idempotencyKey','economic-classification-0001');
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','update_case',payload);raise exception 'Competitor sourcing confirmed without evidence';exception when check_violation then null;end;
  if (select version from private.stockflow_leakage_cases where id=case_id)<>1 then raise exception 'Rejected classification changed case version';end if;
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','update_case',payload||'{"primaryReason":"invented","reasonCodes":["invented"],"confidence":"suspected"}');raise exception 'Invented leakage reason accepted';exception when check_violation then null;end;
  replay:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','update_case',payload||'{"evidenceReference":"Visit VN-12, customer-confirmed supplier invoice"}');
  if replay is distinct from public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','update_case',payload||'{"evidenceReference":"Visit VN-12, customer-confirmed supplier invoice"}') then raise exception 'Classification receipt replay changed';end if;
  workspace:=private.stockflow_economic_workspace(array['accounts']);
  if not exists(select 1 from jsonb_array_elements(workspace->'cases') c where c->>'id'=case_id::text and c->>'primaryReason'='competitor_sourcing' and c->>'confidence'='confirmed' and jsonb_array_length(c->'reasonCodes')=2) then raise exception 'Classified reasons lost in read model';end if;
  if not exists(select 1 from private.stockflow_economic_audit a where a.entity_id=case_id and a.payload->'classification'->>'confidence'='confirmed' and a.payload->'classification'->>'evidenceReference'='Visit VN-12, customer-confirmed supplier invoice') then raise exception 'Classification audit lost evidence';end if;
  raise exception using errcode='ZT006',message='Rollback classification fixture';
 exception when sqlstate 'ZT006' then null;
 end;
 perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','claim_recovery',jsonb_build_object('caseId',case_id,'sourceLineId',line_id,'shareBasisPoints',10000,'reason','Verified post-window follow-up sale','idempotencyKey','economic-claim-0001'));
 select id into run from private.stockflow_economic_runs where active;
 if private.stockflow_economic_case_recovery(case_id,run)->>'gpPaise'<>'1800000' then raise exception 'Recovery claim invented or omitted GP';end if;
 begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','create_case',jsonb_build_object('targetId',target,'title','Duplicate recovery','reason','competitor_supply','owner','economic-manager@test.local','action','Duplicate','opportunityProductId','product-guid-1','windowFrom',period-5,'windowTo',period,'idempotencyKey','economic-case-overlap'));raise exception 'Overlapping leakage opportunity accepted';exception when sqlstate 'PT409' then null;end;
 doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(
  jsonb_build_object('sourceId','return-1','revision',1,'date',period+2,'kind','return','customerSourceId','customer-guid-1','siteId','site-1','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','product-guid-1','quantity','-35','unit','pack','netSalesPaise','-2500000'))),
  jsonb_build_object('sourceId','return-2','revision',1,'date',period+3,'kind','return','customerSourceId','customer-guid-1','siteId','site-1','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','product-guid-1','quantity','-35','unit','pack','netSalesPaise','-2500000','originalCompanyId','company-guid-1','originalVoucherId','sale-1','originalLineKey','1'))),
  jsonb_build_object('sourceId','return-3','revision',1,'date',period+4,'kind','return','customerSourceId','customer-guid-1','siteId','site-1','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','product-guid-1','quantity','-1','unit','pack','netSalesPaise','-1','originalCompanyId','company-guid-1','originalVoucherId','sale-1','originalLineKey','1')))
 ));
 update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc||'{"sourceVersion":"returns-v1"}') where id='suprabha';
 select l.id into return_id from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.source_id='return-1';
 perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','resolve_line',jsonb_build_object('sourceLineId',return_id,'originalSaleLineId',line_id,'reason','Verified return against original invoice','idempotencyKey','economic-return-link1'));
 select id into run from private.stockflow_economic_runs where active;
 if (select sum(cost_paise) from private.stockflow_economic_results where run_id=run and target_id=target)<>0 or (select sum(gp_paise) from private.stockflow_economic_results where run_id=run and target_id=target)<>0 then raise exception 'Full returns failed to conserve original cost/GP';end if;
 if not exists(select 1 from private.stockflow_economic_results where run_id=run and reason='cumulative_return_quantity_exceeds_original') then raise exception 'Excess cumulative return was accepted';end if;
 if private.stockflow_economic_case_recovery(case_id,run)->>'gpPaise'<>'0' then raise exception 'Recovery claims did not net returns';end if;
 -- Shared instruments use one group, including capital already deployed to members.
 insert into private.stockflow_equipment_installations(id,order_id,tally_key,item_name,status,scheduled_date,serial_number,created_by_email,completed_at) values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeeb','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeed','legacy-item-2','Second SYS fixture','completed',period,'ECON-SERIAL-2','test',now());
 response:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','create_target',jsonb_build_object('kind','placement','name','Second test placement','companyId','company-guid-1','customerId','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','customerSourceId','customer-guid-1','siteId','site-1','modelId','sys-240','installationId','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeeb','effectiveFrom',period,'capitalPaise','0','idempotencyKey','economic-second-0001'));second_target:=(response->>'entityId')::uuid;
 perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_expectation',jsonb_build_object('targetId',second_target,'effectiveFrom',period,'monthlyRevenuePaise','0','monthlyGpPaise','0','reason','Shared group baseline','idempotencyKey','economic-second-expect'));
 perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','approve_target',jsonb_build_object('expectedGeneration',(select id from private.stockflow_economic_runs where active),'targetId',second_target,'expectedVersion',1,'decision','approved','reason','Shared instrument approved','idempotencyKey','economic-second-approve'));
 select id into run from private.stockflow_economic_runs where active;
 if not exists(select 1 from private.stockflow_economic_results where run_id=run and source_line_id=line_id and status='unattributed') then raise exception 'Multiple identical instruments were guessed';end if;
 workspace:=private.stockflow_economic_workspace(array['management']);
 if not exists(select 1 from jsonb_array_elements(workspace->'leakage') l where l->>'targetId'=target::text and l->>'productId'='product-guid-1' and l->>'attributionComplete'='false' and l->>'potentialRevenuePaise' is null and l->>'potentialGpPaise' is null and l->>'revenueVariancePaise' is null and l->>'gpVariancePaise' is null and l->>'status'='data_review_required') then raise exception 'Ambiguous mapped purchases became fabricated monetary leakage';end if;
 doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','tiny-sale','revision',1,'date',period+5,'kind','sale','customerSourceId','customer-guid-1','siteId','site-1','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','product-guid-1','quantity','0.000001','unit','pack','netSalesPaise','1')))));
 update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc||'{"sourceVersion":"tiny-sale-v1"}') where id='suprabha';
 perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_allocation',jsonb_build_object('companyId','company-guid-1','customerSourceId','customer-guid-1','siteId','site-1','productId','product-guid-1','effectiveFrom',period,'shares',jsonb_build_array(jsonb_build_object('targetId',target,'basisPoints',5000),jsonb_build_object('targetId',second_target,'basisPoints',5000)),'reason','Verified equal usage allocation before grouping','idempotencyKey','economic-allocation-001'));
 select id into run from private.stockflow_economic_runs where active;
 if (select sum(r.quantity) from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and v.source_id='tiny-sale')<>0.000001 or (select sum(r.revenue_paise) from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and v.source_id='tiny-sale')<>1 then raise exception 'Fractional unit/paise allocation did not conserve source totals';end if;
 -- Public-command reproduction: a sale predates grouping and its credit arrives afterwards.
 declare historical_doc jsonb:=doc; historical_pool uuid; prior_recovery bigint;
 begin
  response:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','create_target',jsonb_build_object('kind','group','name','Opening recovery fixture','companyId','company-guid-1','customerId','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','customerSourceId','customer-guid-1','siteId','site-1','modelId','sys-240','effectiveFrom',period+10,'capitalPaise','0','idempotencyKey','opening-pool-create'));historical_pool:=(response->>'entityId')::uuid;
  perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_group_members',jsonb_build_object('targetId',historical_pool,'members',jsonb_build_array(jsonb_build_object('placementId',target,'effectiveFrom',period+10),jsonb_build_object('placementId',second_target,'effectiveFrom',period+10)),'idempotencyKey','opening-pool-members'));
  perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_expectation',jsonb_build_object('targetId',historical_pool,'effectiveFrom',period+10,'monthlyRevenuePaise','6000000','monthlyGpPaise','3000000','reason','Opening recovery baseline','idempotencyKey','opening-pool-expect'));
  perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','approve_target',jsonb_build_object('expectedGeneration',(select id from private.stockflow_economic_runs where active),'targetId',historical_pool,'expectedVersion',1,'decision','approved','reason','Opening recovery approval','idempotencyKey','opening-pool-approve'));
  workspace:=private.stockflow_economic_workspace(array['management']);
  select (t->>'recoveryPaise')::bigint into prior_recovery from jsonb_array_elements(workspace->'targets') t where t->>'id'=historical_pool::text;
  historical_doc:=jsonb_set(historical_doc,'{vouchers}',historical_doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','opening-late-credit','revision',1,'date',period+20,'kind','credit','customerSourceId','customer-guid-1','siteId','site-1','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','product-guid-1','quantity','0','unit','pack','netSalesPaise','-100','originalCompanyId','company-guid-1','originalVoucherId','sale-1','originalLineKey','1')))));
  update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',historical_doc||'{"sourceVersion":"opening-late-credit"}') where id='suprabha';
  workspace:=private.stockflow_economic_workspace(array['management']);
  if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=historical_pool::text and (t->>'recoveryPaise')::bigint=prior_recovery-100) then raise exception 'Public flow lost a post-group credit against opening recovery';end if;
  perform private.stockflow_rebuild_instrument_economics('opening-recovery-rebuild');
  workspace:=private.stockflow_economic_workspace(array['management']);
  if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=historical_pool::text and (t->>'recoveryPaise')::bigint=prior_recovery-100) then raise exception 'Rebuild changed opening recovery credit';end if;
  raise exception using errcode='ZT005',message='Rollback public opening recovery fixture';
 exception when sqlstate 'ZT005' then null;
 end;
 response:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','create_target',jsonb_build_object('kind','group','name','Shared economic group','companyId','company-guid-1','customerId','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','customerSourceId','customer-guid-1','siteId','site-1','modelId','sys-240','effectiveFrom',period,'capitalPaise','0','idempotencyKey','economic-pool-0001'));pool:=(response->>'entityId')::uuid;
 perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_group_members',jsonb_build_object('targetId',pool,'members',jsonb_build_array(jsonb_build_object('placementId',target,'effectiveFrom',period),jsonb_build_object('placementId',second_target,'effectiveFrom',period,'effectiveTo',period+25)),'idempotencyKey','economic-pool-members'));
 perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_expectation',jsonb_build_object('targetId',pool,'effectiveFrom',period,'monthlyRevenuePaise','6000000','monthlyGpPaise','3000000','reason','Combined group economics','items',jsonb_build_array(jsonb_build_object('productId','product-guid-1','baseUnit','pack','expectedMonthlyUnits','100','expectedUnitPricePaise','10000','expectedUnitCostPaise','6000'),jsonb_build_object('productId','product-guid-2','baseUnit','pack','expectedMonthlyUnits','25')),'idempotencyKey','economic-pool-expect'));
 perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','approve_target',jsonb_build_object('expectedGeneration',(select id from private.stockflow_economic_runs where active),'targetId',pool,'expectedVersion',1,'decision','approved','reason','Group capital payback accepted','idempotencyKey','economic-pool-approve'));
 declare original_baseline private.stockflow_economic_expectations%rowtype; current_capital numeric; extra_capital bigint; event_count integer;
 begin
  select e.* into original_baseline from private.stockflow_economic_expectations e join private.stockflow_economic_audit a on a.payload->>'approvalExpectationId'=e.id::text where a.action='approve_target' and a.entity_id=pool and a.payload->>'decision'='approved';
  select coalesce(sum(e.amount_paise),0) into current_capital from private.stockflow_economic_events e where e.kind='capital' and (e.target_id=pool or e.target_id in(select gm.placement_id from private.stockflow_economic_group_members gm where gm.group_id=pool));
  -- Make the proposed group exposure exactly 49 months on its original approval.
  extra_capital:=original_baseline.monthly_gp_paise*49+private.stockflow_economic_billed_recovery(pool)-current_capital;
  perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_expectation',jsonb_build_object('targetId',pool,'effectiveFrom',original_baseline.effective_from,'monthlyRevenuePaise',greatest(original_baseline.monthly_revenue_paise,original_baseline.monthly_gp_paise*10)::text,'monthlyGpPaise',(original_baseline.monthly_gp_paise*10)::text,'reason','Optimistic group planning must not replace the approved GP','idempotencyKey','economic-backdated-group-plan'));
  if private.stockflow_economic_approved_expectation(pool) is distinct from original_baseline.id then raise exception 'Group approved baseline follows a later planning version';end if;
  select count(*) into event_count from private.stockflow_economic_events;
  begin
   perform public.stockflow_economics_gateway('economic-test-key','economic-administrator@test.local','record_capital',jsonb_build_object('targetId',pool,'kind','capital','amountPaise',extra_capital::text,'effectiveDate',period,'directorException',true,'reason','Group increase must remain within its approved economics','idempotencyKey','economic-group-original-limit'));
   raise exception 'Group capital increase bypassed original approval payback maximum';
  exception when invalid_parameter_value then null;end;
  if (select count(*) from private.stockflow_economic_events)<>event_count or exists(select 1 from private.stockflow_command_results where idempotency_key='economic-group-original-limit') then raise exception 'Rejected group investment increase partially committed';end if;
  raise exception using errcode='ZT016',message='Rollback group original-baseline fixture';
 exception when sqlstate 'ZT016' then null;end;
 select id into run from private.stockflow_economic_runs where active;
 if not exists(select 1 from private.stockflow_economic_results where run_id=run and source_line_id=line_id and target_id=pool and revenue_paise=5000000) then raise exception 'Group attribution failed';end if;
 workspace:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','get_instrument_economics','{}');
 if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=pool::text and t->>'capitalPaise'='55000000') then raise exception 'Pooled capital omitted member investment';end if;
 if (select count(*) from jsonb_array_elements(workspace->'leakage') t where t->>'targetId'=pool::text)<>2 then raise exception 'Multi-product baseline lost reagent rows';end if;
 perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_mapping',jsonb_build_object('companyId','company-guid-1','modelId','sys-240','productId','product-guid-2','effect','include','effectiveFrom',period,'reason','Verified control reagent compatibility','idempotencyKey','economic-mapping-0002'));
 doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(
 jsonb_build_object('sourceId','purchase-foc','revision',1,'date',period,'kind','purchase','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','product-guid-2','quantity','1','unit','pack','netSalesPaise','200000'))),
 jsonb_build_object('sourceId','sale-foc','revision',1,'date',period+6,'kind','sale','customerSourceId','customer-guid-1','siteId','site-1','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','product-guid-2','quantity','1','unit','pack','netSalesPaise','0','focReason','UNKNOWN')))
 ));
 update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc||'{"sourceVersion":"foc-v1"}') where id='suprabha';
 select l.id into return_id from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.source_id='sale-foc';
 select l.id into purchase_id from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.source_id='purchase-foc';
 perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','verify_cost',jsonb_build_object('sourceLineId',return_id,'purchaseAllocations',jsonb_build_array(jsonb_build_object('purchaseLineId',purchase_id,'quantity','1')),'evidenceReference','FOC Tally historical purchase evidence','idempotencyKey','economic-foc-cost-001'));
 select id into run from private.stockflow_economic_runs where active;
 if not exists(select 1 from private.stockflow_economic_results where run_id=run and source_line_id=return_id and target_id=pool and gp_paise=-200000 and status='foc_unclassified') then raise exception 'FOC lost cost, reason exception or pool';end if;
 perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','resolve_line',jsonb_build_object('sourceLineId',return_id,'focReason','installation','reason','Approved installation starter material','idempotencyKey','economic-foc-reason-1'));
 select id into run from private.stockflow_economic_runs where active;
 if not exists(select 1 from private.stockflow_economic_results where run_id=run and source_line_id=return_id and gp_paise=-200000 and status='verified') then raise exception 'FOC classification changed actual economics';end if;
 perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','close_group_membership',jsonb_build_object('membershipId',(select id from private.stockflow_economic_group_members where placement_id=target),'effectiveTo',period+15,'reason','Member removed; historical group keeps its capital until reviewed transfer','idempotencyKey','economic-membership-close'));
 if (select effective_to from private.stockflow_economic_targets where id=target) is distinct from period+15 then raise exception 'Removed group member continued earning against historical pool capital';end if;
 perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','close_allocation',jsonb_build_object('allocationId',(select id from private.stockflow_economic_allocations where company_id='company-guid-1'),'effectiveTo',period+15,'reason','Group member removed; original allocation interval retained','idempotencyKey','economic-allocation-close'));
 doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','late-credit','revision',1,'date',period+20,'kind','credit','customerSourceId','customer-guid-1','siteId','site-1','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','product-guid-1','quantity','0','unit','pack','netSalesPaise','-100','originalCompanyId','company-guid-1','originalVoucherId','sale-1','originalLineKey','1')))));
 update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc||'{"sourceVersion":"late-credit-v1"}') where id='suprabha';
 select id into run from private.stockflow_economic_runs where active;
 if not exists(select 1 from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and v.source_id='late-credit' and r.target_id=pool and r.gp_paise=-100 and r.cost_paise=0 and r.recovery_origin_date=period+1) then raise exception 'Late value credit lost original economic group or reversed stock cost';end if;
 perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_mapping',jsonb_build_object('companyId','company-guid-1','modelId','sys-240','productId','product-guid-3','effect','exclude','effectiveFrom',period,'reason','Explicit unrelated product exclusion','idempotencyKey','economic-mapping-exclude'));
 doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','excluded-sale','revision',1,'date',period+21,'kind','sale','customerSourceId','customer-guid-1','siteId','site-1','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','product-guid-3','quantity','1','unit','pack','netSalesPaise','100')))));
 update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc||'{"sourceVersion":"excluded-v1"}') where id='suprabha';
 select id into run from private.stockflow_economic_runs where active;
 if not exists(select 1 from private.stockflow_economic_results where run_id=run and status='excluded' and revenue_paise=100 and target_id is null) then raise exception 'Explicit exclusion was forced into attribution/unattributed';end if;
 -- One sale may consume several historical purchase lots. Verification is
 -- all-or-nothing, costs come only from Tally evidence, and retry is a replay.
 doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(
 jsonb_build_object('sourceId','multi-purchase-a','revision',1,'date',period,'kind','purchase','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','product-guid-2','quantity','3','unit','pack','netSalesPaise','101'))),
 jsonb_build_object('sourceId','multi-purchase-b','revision',1,'date',period,'kind','purchase','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','product-guid-2','quantity','7','unit','pack','netSalesPaise','203'))),
 jsonb_build_object('sourceId','multi-purchase-sale','revision',1,'date',period+10,'kind','sale','customerSourceId','customer-guid-1','siteId','site-1','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','product-guid-2','quantity','10','unit','pack','netSalesPaise','500')))
 ));
 update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc||'{"sourceVersion":"multi-purchase-v1"}') where id='suprabha';
 select l.id into return_id from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.source_id='multi-purchase-sale';
 payload:=jsonb_build_object('sourceLineId',return_id,'purchaseAllocations',jsonb_build_array(
 jsonb_build_object('purchaseLineId',(select l.id from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.source_id='multi-purchase-a'),'quantity','3'),
 jsonb_build_object('purchaseLineId',(select l.id from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.source_id='multi-purchase-b'),'quantity','7')),
 'evidenceReference','Reviewed complete historical purchase lots','idempotencyKey','economic-multi-cost');
 before_count:=(select count(*) from private.stockflow_economic_cost_verifications);
 select id into run from private.stockflow_economic_runs where active;
 begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','verify_cost',jsonb_set(payload,'{purchaseAllocations,1,quantity}','"6"')||'{"idempotencyKey":"economic-multi-incomplete"}');raise exception 'Partial multi-purchase quantity accepted';exception when invalid_parameter_value then null;end;
 if (select count(*) from private.stockflow_economic_cost_verifications)<>before_count or (select id from private.stockflow_economic_runs where active)<>run then raise exception 'Failed multi-purchase verification did not roll back atomically';end if;
 response:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','verify_cost',payload);
 replay:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','verify_cost',payload);
 if response<>replay or (select count(*) from private.stockflow_economic_cost_verifications where sale_line_id=return_id)<>1 then raise exception 'Multi-purchase replay duplicated verification';end if;
 select id into run from private.stockflow_economic_runs where active;
 if not exists(select 1 from private.stockflow_economic_results where run_id=run and source_line_id=return_id and target_id=pool and revenue_paise=500 and cost_paise=304 and gp_paise=196) then raise exception 'Multi-purchase GP did not use exact Tally purchase cost';end if;
 -- Instrument acquisition is a verified Tally purchase, never customer billing.
 begin
  doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','instrument-acquisition','revision',1,'date',period+10,'kind','purchase','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','instrument-guid','quantity','1','unit','nos','netSalesPaise','55000000','gstPaise','9900000')))));
  doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','future-instrument-acquisition','revision',1,'date',period+27,'kind','purchase','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','instrument-guid-2','quantity','1','unit','nos','netSalesPaise','100')))));
  update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc||'{"sourceVersion":"instrument-acquisition-v1"}') where id='suprabha';
  select l.id into purchase_id from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.source_id='instrument-acquisition';
  payload:=jsonb_build_object('kind','placement','name','Tally acquisition fixture','companyId','company-guid-1','customerId','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','customerSourceId','customer-guid-1','siteId','site-1','modelId','sys-240','installationId','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeeb','effectiveFrom',period+26,'capitalPaise','0','acquisitionPurchaseLineId',purchase_id,'capitalEvidence','ECON-SERIAL-2 matched to purchase invoice','idempotencyKey','economic-acquisition-001');
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','create_target',payload||'{"capitalPaise":"1"}');raise exception 'Manual amount accepted with Tally purchase';exception when invalid_parameter_value then null;end;
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','create_target',payload||'{"companyId":"other-company"}');raise exception 'Foreign company acquisition accepted';exception when invalid_parameter_value then null;end;
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','create_target',payload||jsonb_build_object('acquisitionPurchaseLineId',(select l.id from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.source_id='future-instrument-acquisition')));raise exception 'Future purchase acquisition accepted';exception when invalid_parameter_value then null;end;
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','create_target',payload||jsonb_build_object('acquisitionPurchaseLineId',(select l.id from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.source_id='multi-purchase-a')));raise exception 'Bulk purchase line accepted as one instrument';exception when invalid_parameter_value then null;end;
  response:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','create_target',payload);
  replay:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','create_target',payload);
  if replay<>response then raise exception 'Acquisition retry changed receipt';end if;
  if (select sum(amount_paise) from private.stockflow_economic_events where target_id=(response->>'entityId')::uuid and kind='capital')<>55000000 then raise exception 'Acquisition did not use net Tally value excluding GST';end if;
  if (select count(*) from private.stockflow_economic_acquisition_links where purchase_line_id=purchase_id)<>1 then raise exception 'Acquisition link duplicated';end if;
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','create_target',payload||'{"installationId":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeec","idempotencyKey":"economic-acquisition-duplicate"}');raise exception 'Purchase reused for another instrument';exception when sqlstate 'PT409' then null;end;
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','verify_cost',jsonb_build_object('sourceLineId',return_id,'purchaseAllocations',jsonb_build_array(jsonb_build_object('purchaseLineId',purchase_id,'quantity','10')),'evidenceReference','Invalid instrument cost reuse','idempotencyKey','economic-acquisition-reagent'));raise exception 'Instrument purchase funded reagent cost';exception when invalid_parameter_value then null;end;
  declare saved_billing_doc jsonb:=doc; billing_line uuid; billing_payload jsonb; billing_receipt jsonb; billing_pool uuid;
  begin
   doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','instrument-selling-invoice','revision',1,'date',period+26,'kind','sale','customerSourceId','customer-guid-1','siteId','site-1','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','instrument-guid','quantity','1','unit','nos','netSalesPaise','20000000','gstPaise','3600000')))));
   update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc||'{"sourceVersion":"instrument-selling-v1"}') where id='suprabha';
   select l.id into billing_line from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.source_id='instrument-selling-invoice';
   billing_payload:=jsonb_build_object('targetId',response->>'entityId','expectedVersion',1,'sourceLineId',billing_line,'reason','Verified serial and customer selling invoice below purchase cost','idempotencyKey','economic-instrument-billing-001');
   begin perform public.stockflow_economics_gateway('economic-test-key','economic-account@test.local','link_instrument_billing',billing_payload);raise exception 'Accounts linked instrument billing';exception when insufficient_privilege then null;end;
   begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','link_instrument_billing',billing_payload||jsonb_build_object('sourceLineId',return_id));raise exception 'Reagent sales linked as instrument billing';exception when invalid_parameter_value then null;end;
   billing_receipt:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','link_instrument_billing',billing_payload);
   if billing_receipt<>public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','link_instrument_billing',billing_payload) then raise exception 'Instrument billing retry changed receipt';end if;
   workspace:=private.stockflow_economic_workspace(array['management']);
   if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=response->>'entityId' and t->>'capitalPaise'='55000000' and t->>'instrumentBillingPaise'='20000000' and t->>'netInvestmentPaise'='35000000' and t->>'outstandingPaise'='35000000' and t->>'knownGpPaise'='0' and t->>'revenuePaise'='0' and t->>'missingCostLines'='0') then raise exception 'Below-cost billing did not produce 35000000 placement investment independently of reagent GP';end if;
   if workspace->'reportingSummary'->>'instrumentBillingSalesPaise'<>'20000000' or (workspace->'reportingSummary'->>'netSalesPaise')::bigint<>(workspace->'reportingSummary'->>'attributedSalesPaise')::bigint+(workspace->'reportingSummary'->>'unattributedSalesPaise')::bigint+(workspace->'reportingSummary'->>'excludedSalesPaise')::bigint+(workspace->'reportingSummary'->>'instrumentBillingSalesPaise')::bigint then raise exception 'Instrument billing did not reconcile separately from reagent sales';end if;
   perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_expectation',jsonb_build_object('targetId',response->>'entityId','effectiveFrom',period+26,'monthlyRevenuePaise','3000000','monthlyGpPaise','1000000','reason','Investment recovery expectation','idempotencyKey','economic-billed-baseline'));
   declare covered_doc jsonb; covered_target uuid:=(response->>'entityId')::uuid;
   begin
    covered_doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','instrument-selling-invoice','revision',2,'date',period+26,'kind','sale','customerSourceId','customer-guid-1','siteId','site-1','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','instrument-guid','quantity','1','unit','nos','netSalesPaise','60000000')))));
    update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',covered_doc||'{"sourceVersion":"covered-acquisition-billing"}') where id='suprabha';
    perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_expectation',jsonb_build_object('targetId',covered_target,'effectiveFrom',period+26,'monthlyRevenuePaise','0','monthlyGpPaise','0','reason','Instrument billing covers acquisition; no reagent investment assumed','idempotencyKey','economic-covered-baseline'));
    perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','approve_target',jsonb_build_object('targetId',covered_target,'expectedVersion',2,'expectedGeneration',(select id from private.stockflow_economic_runs where active),'decision','approved','reason','No uncovered instrument investment','idempotencyKey','economic-covered-approval'));
    covered_doc:=jsonb_set(covered_doc,'{vouchers}',covered_doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','instrument-acquisition','revision',2,'date',period+10,'kind','purchase','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','instrument-guid','quantity','1','unit','nos','netSalesPaise','57000000')))));
    update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',covered_doc||'{"sourceVersion":"covered-acquisition-revision"}') where id='suprabha';
    perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','review_acquisition',jsonb_build_object('targetId',covered_target,'expectedVersion',3,'expectedSourceRevision','2','reason','Revised purchase remains covered by net instrument billing','idempotencyKey','economic-covered-review'));
    if (select sum(amount_paise) from private.stockflow_economic_events where target_id=covered_target and kind='capital')<>57000000 or not exists(select 1 from private.stockflow_economic_audit a where a.action='review_acquisition' and a.entity_id=covered_target and (a.payload->'approvalChecks'->0->>'expectedPaybackMonths')::numeric=0) then raise exception 'Covered cost correction did not preserve capital with zero investment payback';end if;
    covered_doc:=jsonb_set(covered_doc,'{vouchers}',covered_doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','instrument-acquisition','revision',3,'date',period+10,'kind','purchase','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','instrument-guid','quantity','1','unit','nos','netSalesPaise','65000000')))));
    update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',covered_doc||'{"sourceVersion":"uncovered-acquisition-revision"}') where id='suprabha';
    begin
     perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','review_acquisition',jsonb_build_object('targetId',covered_target,'expectedVersion',4,'expectedSourceRevision','3','reason','New investment needs positive approved GP','idempotencyKey','economic-uncovered-review'));
     raise exception 'New uncovered investment accepted a zero-GP approval baseline';
    exception when invalid_parameter_value then null;end;
    raise exception using errcode='ZT017',message='Rollback covered investment correction fixture';
   exception when sqlstate 'ZT017' then null;end;
   workspace:=private.stockflow_economic_workspace(array['management']);
   if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=response->>'entityId' and t->'approvalPreview'->>'capitalPaise'='55000000' and t->'approvalPreview'->>'instrumentBillingPaise'='20000000' and t->'approvalPreview'->>'netInvestmentPaise'='35000000' and (t->'approvalPreview'->>'expectedPaybackMonths')::numeric=35) then raise exception 'Proposal preview does not show below-cost billing investment';end if;
   declare saved_preview_generation uuid:=(workspace->>'generation')::uuid; changed_billing_doc jsonb; preview jsonb;
   begin
    begin
     changed_billing_doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','instrument-selling-invoice','revision',2,'date',period+26,'kind','sale','customerSourceId','customer-guid-1','amountStatus','unverified','lines','[]'::jsonb)));
     update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',changed_billing_doc||'{"sourceVersion":"approval-billing-quarantined"}') where id='suprabha';
     preview:=private.stockflow_economic_approval_preview((response->>'entityId')::uuid);
     if preview->>'status'<>'evidence_incomplete' or preview->>'expectedPaybackMonths' is not null then raise exception 'Quarantined instrument invoice still permitted approval: %',preview;end if;
     begin
      perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','approve_target',jsonb_build_object('expectedGeneration',(select id from private.stockflow_economic_runs where active),'targetId',response->>'entityId','expectedVersion',2,'decision','approved','reason','Cannot approve rejected newer billing evidence','idempotencyKey','approval-quarantined-billing'));
      raise exception 'Rejected newer instrument billing did not block approval';
     exception when sqlstate 'PT409' then null;end;
     changed_billing_doc:=jsonb_set(changed_billing_doc,'{vouchers}',changed_billing_doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','instrument-selling-invoice','revision',3,'date',period+26,'kind','sale','customerSourceId','customer-guid-1','siteId','site-1','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','instrument-guid','quantity','1','unit','nos','netSalesPaise','20000000')))));
     update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',changed_billing_doc||'{"sourceVersion":"approval-billing-resolved"}') where id='suprabha';
     preview:=private.stockflow_economic_approval_preview((response->>'entityId')::uuid);
     if preview->>'status'<>'within_limit' or not exists(select 1 from private.stockflow_economic_import_exceptions e where e.source_id='instrument-selling-invoice' and e.evidence->>'revision'='2') then raise exception 'New verified billing did not resolve the warning while preserving rejected evidence';end if;
     raise exception using errcode='ZT014',message='Rollback quarantined proposal source fixture';
    exception when sqlstate 'ZT014' then null;end;
    changed_billing_doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','instrument-selling-invoice','revision',2,'date',period+26,'kind','sale','customerSourceId','customer-guid-1','siteId','site-1','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','instrument-guid','quantity','1','unit','nos','netSalesPaise','15000000')))));
    update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',changed_billing_doc||'{"sourceVersion":"approval-billing-changed"}') where id='suprabha';
    begin
     perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','approve_target',jsonb_build_object('expectedGeneration',saved_preview_generation,'targetId',response->>'entityId','expectedVersion',2,'decision','approved','reason','Earlier billing reviewed','idempotencyKey','approval-stale-billing'));
     raise exception 'Changed billing approved using obsolete investment preview';
    exception when sqlstate 'PT409' then null;end;
    preview:=private.stockflow_economic_approval_preview((response->>'entityId')::uuid);
    if preview->>'status'<>'director_exception_required' or preview->>'netInvestmentPaise'<>'40000000' or (preview->>'expectedPaybackMonths')::numeric<>40 then raise exception 'Refreshed billing preview missed increased investment: %',preview;end if;
    begin
     perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','approve_target',jsonb_build_object('expectedGeneration',(select id from private.stockflow_economic_runs where active),'targetId',response->>'entityId','expectedVersion',2,'decision','approved','reason','Revised investment reviewed','idempotencyKey','approval-billing-no-director'));
     raise exception 'Long investment approved without director exception';
    exception when invalid_parameter_value then null;end;
    changed_billing_doc:=jsonb_set(changed_billing_doc,'{vouchers}',changed_billing_doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','instrument-selling-invoice','revision',3,'date',period+26,'kind','sale','customerSourceId','customer-guid-1','siteId','site-1','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','incompatible-instrument-guid','quantity','1','unit','nos','netSalesPaise','15000000')))));
    update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',changed_billing_doc||'{"sourceVersion":"approval-billing-incompatible"}') where id='suprabha';
    preview:=private.stockflow_economic_approval_preview((response->>'entityId')::uuid);
    if preview->>'status'<>'evidence_incomplete' or preview->>'expectedPaybackMonths' is not null then raise exception 'Incompatible invoice invented approval payback: %',preview;end if;
    begin
     perform public.stockflow_economics_gateway('economic-test-key','economic-administrator@test.local','approve_target',jsonb_build_object('expectedGeneration',(select id from private.stockflow_economic_runs where active),'targetId',response->>'entityId','expectedVersion',2,'decision','approved','directorException',true,'reason','Cannot approve incompatible evidence','idempotencyKey','approval-incompatible-billing'));
     raise exception 'Incompatible instrument billing approved';
    exception when sqlstate 'PT409' then null;end;
    raise exception using errcode='ZT013',message='Rollback stale billing preview fixture';
   exception when sqlstate 'ZT013' then null;end;
   perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','approve_target',jsonb_build_object('expectedGeneration',(select id from private.stockflow_economic_runs where active),'targetId',response->>'entityId','expectedVersion',2,'decision','approved','reason','Approve net investment, not full instrument cost','idempotencyKey','economic-billed-approve'));
   if not exists(select 1 from private.stockflow_economic_audit a where a.entity_id=(response->>'entityId')::uuid and a.action='approve_target' and a.payload->>'approvedNetInvestmentPaise'='35000000' and (a.payload->>'expectedPaybackMonths')::numeric=35) then raise exception 'Approval did not use net placement investment';end if;
   perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','rebuild','{"idempotencyKey":"economic-billed-rebuild"}');
   if (select sum(amount_paise) from private.stockflow_economic_events where target_id=(response->>'entityId')::uuid and kind<>'capital')<>20000000 then raise exception 'Rebuild duplicated billed recovery';end if;
   billing_receipt:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','create_target',jsonb_build_object('kind','group','name','Current-month instrument investment pool','companyId','company-guid-1','customerId','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','customerSourceId','customer-guid-1','siteId','site-1','modelId','sys-240','effectiveFrom',private.stockflow_economic_business_date(),'capitalPaise','0','idempotencyKey','economic-billing-pool'));
   billing_pool:=(billing_receipt->>'entityId')::uuid;
   perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_group_members',jsonb_build_object('targetId',billing_pool,'members',jsonb_build_array(jsonb_build_object('placementId',response->>'entityId','effectiveFrom',private.stockflow_economic_business_date())),'idempotencyKey','economic-billing-members'));
   perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_expectation',jsonb_build_object('targetId',billing_pool,'effectiveFrom',private.stockflow_economic_business_date(),'monthlyRevenuePaise','3000000','monthlyGpPaise','1000000','reason','Pooled net instrument investment expectation','idempotencyKey','economic-billing-pool-baseline'));
   perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','approve_target',jsonb_build_object('expectedGeneration',(select id from private.stockflow_economic_runs where active),'targetId',billing_pool,'expectedVersion',1,'decision','approved','reason','Approve pooled net investment','idempotencyKey','economic-billing-pool-approve'));
   workspace:=private.stockflow_economic_workspace(array['management']);
   if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=billing_pool::text and t->>'capitalPaise'='55000000' and t->>'instrumentBillingPaise'='20000000' and t->>'netInvestmentPaise'='35000000' and t->>'recoveryPaise'='20000000') then raise exception 'Current-month group lost member capital or upfront billing';end if;
   if private.stockflow_economic_billed_recovery((response->>'entityId')::uuid)<>0 or (select sum(amount_paise) from private.stockflow_economic_events where target_id=(response->>'entityId')::uuid and kind<>'capital')<>0 then raise exception 'Pooled upfront billing counted twice on member and group';end if;
   doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','instrument-billing-credit','revision',1,'date',period+27,'kind','credit','customerSourceId','customer-guid-1','siteId','site-1','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','instrument-guid','quantity','0','unit','nos','netSalesPaise','-5000000','originalCompanyId','company-guid-1','originalVoucherId','instrument-selling-invoice','originalLineKey','1')))));
   update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc||'{"sourceVersion":"instrument-selling-credit"}') where id='suprabha';
   workspace:=private.stockflow_economic_workspace(array['management']);
   if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=billing_pool::text and t->'investmentReview'->>'status'='review_required' and (t->'investmentReview'->>'expectedPaybackMonths')::numeric=40) then raise exception 'Instrument credit crossed the review threshold without an investment warning';end if;
   begin
    perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_expectation',jsonb_build_object('targetId',billing_pool,'effectiveFrom',private.stockflow_economic_business_date(),'monthlyRevenuePaise','6000000','monthlyGpPaise','5000000','reason','New planning assumption must not replace original approval','idempotencyKey','economic-billing-revised-plan'));
    workspace:=private.stockflow_economic_workspace(array['management']);
    if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=billing_pool::text and t->'investmentReview'->>'expectedMonthlyGpPaise'='1000000' and (t->'investmentReview'->>'expectedPaybackMonths')::numeric=40) then raise exception 'New expectation silently replaced approval baseline in investment review';end if;
    perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_policy',jsonb_build_object('attractiveMonths',20,'reviewMonths',30,'exceptionMonths',39,'forecastWindowMonths',3,'watchRevenuePercent',80,'criticalRevenuePercent',50,'reason','Current versioned policy threshold review','idempotencyKey','economic-billing-revised-policy'));
    workspace:=private.stockflow_economic_workspace(array['management']);
    if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=billing_pool::text and t->'investmentReview'->>'status'='limit_exceeded' and t->'investmentReview'->>'exceptionMonths'='39') then raise exception 'Investment review ignored current policy version';end if;
    raise exception using errcode='ZT012',message='Rollback revised planning/policy fixture';
   exception when sqlstate 'ZT012' then null;
   end;
   if private.stockflow_economic_billed_recovery(billing_pool)<>15000000 or (select sum(amount_paise) from private.stockflow_economic_events where target_id=billing_pool and kind<>'capital')<>15000000 then raise exception 'Instrument credit did not restate upfront recovery';end if;
   doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','instrument-selling-invoice','revision',2,'date',period+26,'kind','sale','customerSourceId','customer-guid-1','siteId','site-1','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','instrument-guid','quantity','1','unit','nos','netSalesPaise','25000000')))));
   update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc||'{"sourceVersion":"instrument-selling-revised"}') where id='suprabha';
   if private.stockflow_economic_billed_recovery(billing_pool)<>20000000 then raise exception 'Selling invoice revision duplicated or lost credit';end if;
   doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','instrument-billing-return','revision',1,'date',period+28,'kind','return','customerSourceId','customer-guid-1','siteId','site-1','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','instrument-guid','quantity','-1','unit','nos','netSalesPaise','-20000000','originalCompanyId','company-guid-1','originalVoucherId','instrument-selling-invoice','originalLineKey','1')))));
   update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc||'{"sourceVersion":"instrument-selling-return"}') where id='suprabha';
   workspace:=private.stockflow_economic_workspace(array['management']);
   if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=billing_pool::text and t->'investmentReview'->>'status'='limit_exceeded' and (t->'investmentReview'->>'expectedPaybackMonths')::numeric=55) then raise exception 'Instrument refund crossed the absolute threshold without an investment warning';end if;
   if not exists(select 1 from private.stockflow_economic_audit a where a.entity_id=billing_pool and a.action='approve_target' and (a.payload->>'expectedPaybackMonths')::numeric=35 and a.payload->>'approvedNetInvestmentPaise'='35000000') then raise exception 'Later billing changes rewrote the original approval basis';end if;
   if private.stockflow_economic_billed_recovery(billing_pool)<>0 or (select sum(amount_paise) from private.stockflow_economic_events where target_id=billing_pool and kind<>'capital')<>0 then raise exception 'Full instrument refund did not restore full investment';end if;
   doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','instrument-selling-invoice','revision',3,'date',period+26,'kind','sale','customerSourceId','customer-guid-1','siteId','site-1','amountStatus','verified','cancelled',true,'lines','[]'::jsonb)));
   update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc||'{"sourceVersion":"instrument-selling-cancelled"}') where id='suprabha';
   if private.stockflow_economic_billed_recovery(billing_pool)<>0 or (select sum(amount_paise) from private.stockflow_economic_events where target_id=billing_pool and kind<>'capital')<>0 then raise exception 'Cancelled instrument billing survived as upfront recovery';end if;
   raise exception using errcode='ZT003',message='Rollback isolated below-cost billing fixture';
  exception when sqlstate 'ZT003' then doc:=saved_billing_doc;
  end;
  perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_expectation',jsonb_build_object('targetId',response->>'entityId','effectiveFrom',period+26,'monthlyRevenuePaise','6000000','monthlyGpPaise','1800000','reason','Approved acquisition baseline','idempotencyKey','economic-acquisition-baseline'));
  declare changed_purchase_doc jsonb; preview jsonb;
  begin
   changed_purchase_doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','instrument-acquisition','revision',2,'date',period+10,'kind','purchase','amountStatus','unverified','lines','[]'::jsonb)));
   update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',changed_purchase_doc||'{"sourceVersion":"approval-purchase-quarantined"}') where id='suprabha';
   preview:=private.stockflow_economic_approval_preview((response->>'entityId')::uuid);
   if preview->>'status'<>'evidence_incomplete' or private.stockflow_economic_acquisition_current((response->>'entityId')::uuid) then raise exception 'Rejected newer acquisition left proposal evidence current';end if;
   begin
    perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','review_acquisition',jsonb_build_object('targetId',response->>'entityId','expectedVersion',1,'expectedSourceRevision','1','reason','Old admitted purchase cannot resolve newer quarantine','idempotencyKey','approval-purchase-review-old'));
    raise exception 'Acquisition review accepted an old source while newer evidence was quarantined';
   exception when sqlstate 'PT409' then null;end;
   changed_purchase_doc:=jsonb_set(changed_purchase_doc,'{vouchers}',changed_purchase_doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','instrument-acquisition','revision',3,'date',period+10,'kind','purchase','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','instrument-guid','quantity','1','unit','nos','netSalesPaise','55000000')))));
   update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',changed_purchase_doc||'{"sourceVersion":"approval-purchase-resolved"}') where id='suprabha';
   if private.stockflow_economic_acquisition_current((response->>'entityId')::uuid) then raise exception 'New purchase revision bypassed acquisition review';end if;
   perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','review_acquisition',jsonb_build_object('targetId',response->>'entityId','expectedVersion',1,'expectedSourceRevision','3','reason','Verified serial against resolved acquisition','idempotencyKey','approval-purchase-review-new'));
   if not private.stockflow_economic_acquisition_current((response->>'entityId')::uuid) or not exists(select 1 from private.stockflow_economic_import_exceptions e where e.source_id='instrument-acquisition' and e.evidence->>'revision'='2') then raise exception 'Acquisition review did not resolve current evidence while preserving quarantine audit';end if;
   raise exception using errcode='ZT015',message='Rollback quarantined acquisition fixture';
  exception when sqlstate 'ZT015' then null;end;
  perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','approve_target',jsonb_build_object('expectedGeneration',(select id from private.stockflow_economic_runs where active),'targetId',response->>'entityId','expectedVersion',1,'decision','approved','reason','Verified acquisition payback','idempotencyKey','economic-acquisition-approve'));
  doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','instrument-acquisition','revision',2,'date',period+10,'kind','purchase','amountStatus','verified','cancelled',true,'lines','[]'::jsonb)));
  update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc||'{"sourceVersion":"instrument-acquisition-v2"}') where id='suprabha';
  workspace:=private.stockflow_economic_workspace(array['management']);
  if not exists(select 1 from jsonb_array_elements(workspace->'targets') t where t->>'id'=response->>'entityId' and t->>'capitalSource'='tally_purchase' and t->>'capitalEvidenceCurrent'='false' and t->>'capitalPaise'='55000000' and t->>'forecastMonths' is null) then raise exception 'Changed acquisition was silently revalued or lost review flag';end if;
  payload:=jsonb_build_object('targetId',response->>'entityId','expectedVersion',2,'expectedSourceRevision','2','confirmCancellation',true,'reason','Management verified cancelled acquisition and zero capital','idempotencyKey','economic-acquisition-review-001');
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','review_acquisition',payload||'{"expectedSourceRevision":"1"}');raise exception 'Stale acquisition source review accepted';exception when sqlstate 'PT409' then null;end;
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','review_acquisition',payload||'{"confirmCancellation":false}');raise exception 'Unconfirmed zero capital cancellation accepted';exception when invalid_parameter_value then null;end;
  replay:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','review_acquisition',payload);
  if replay<>public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','review_acquisition',payload) then raise exception 'Acquisition review retry changed receipt';end if;
  if (select sum(amount_paise) from private.stockflow_economic_events where target_id=(response->>'entityId')::uuid and kind='capital')<>0 or (select count(*) from private.stockflow_economic_events where target_id=(response->>'entityId')::uuid and kind='capital')<>2 or not private.stockflow_economic_acquisition_current((response->>'entityId')::uuid) then raise exception 'Acquisition cancellation review did not preserve and compensate original capital';end if;
  if (select count(*) from private.stockflow_economic_acquisition_reviews where target_id=(response->>'entityId')::uuid)<>1 then raise exception 'Acquisition review duplicated history';end if;
  -- A replacement revision is reviewed against the last acknowledged cost (zero),
  -- not the original invoice, and increasing approved capital rechecks policy.
  perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','set_expectation',jsonb_build_object('targetId',response->>'entityId','effectiveFrom',period+26,'monthlyRevenuePaise','6000000','monthlyGpPaise','5000000','reason','Planning revision must not weaken approved acquisition limits','idempotencyKey','economic-backdated-acquisition-plan'));
  doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','instrument-acquisition','revision',3,'date',period+10,'kind','purchase','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','instrument-guid','quantity','1','unit','nos','netSalesPaise','70000000')))));
  update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc||'{"sourceVersion":"instrument-acquisition-v3"}') where id='suprabha';
  payload:=jsonb_build_object('targetId',response->>'entityId','expectedVersion',3,'expectedSourceRevision','3','reason','Verified revised purchase value and approved director exception','idempotencyKey','economic-acquisition-review-002');
  before_count:=(select count(*) from private.stockflow_economic_acquisition_reviews);
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','review_acquisition',payload||'{"expectedVersion":2}');raise exception 'Stale target acquisition review accepted';exception when sqlstate 'PT409' then null;end;
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','review_acquisition',payload);raise exception 'Increased capital bypassed director band';exception when invalid_parameter_value then null;end;
  if (select count(*) from private.stockflow_economic_acquisition_reviews)<>before_count or (select sum(amount_paise) from private.stockflow_economic_events where target_id=(response->>'entityId')::uuid and kind='capital')<>0 then raise exception 'Rejected increase partially changed capital/review';end if;
  perform public.stockflow_economics_gateway('economic-test-key','economic-administrator@test.local','review_acquisition',payload||'{"directorException":true}');
  if (select sum(amount_paise) from private.stockflow_economic_events where target_id=(response->>'entityId')::uuid and kind='capital')<>70000000 or not private.stockflow_economic_acquisition_current((response->>'entityId')::uuid) then raise exception 'Replacement acquisition capital/review incorrect';end if;
  if not exists(select 1 from private.stockflow_economic_audit a where a.action='review_acquisition' and a.entity_id=(response->>'entityId')::uuid and a.payload->>'capitalDeltaPaise'='70000000' and jsonb_array_length(a.payload->'approvalChecks')=1) then raise exception 'Acquisition correction lost policy/baseline evidence';end if;
  if not exists(select 1 from private.stockflow_economic_audit a join private.stockflow_economic_audit original on original.action='approve_target' and original.entity_id=a.entity_id and original.payload->>'decision'='approved' where a.action='review_acquisition' and a.payload->>'idempotencyKey'='economic-acquisition-review-002' and a.payload->'approvalChecks'->0->>'expectationId'=original.payload->>'approvalExpectationId' and (a.payload->'approvalChecks'->0->>'expectedPaybackMonths')::numeric>36) then raise exception 'Acquisition correction replaced the immutable approved baseline';end if;
  workspace:=private.stockflow_economic_workspace(array['management']);
  if not exists(select 1 from jsonb_array_elements(workspace->'acquisitionReviewItems') t where t->>'targetId'=response->>'entityId' and t->>'previousAmountPaise'='70000000' and t->>'changed'='false') then raise exception 'Reviewed acquisition read model is stale';end if;
  doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','instrument-acquisition','revision',4,'date',period+10,'kind','purchase','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','instrument-guid','quantity','1','unit','nos','netSalesPaise','90000000')))));
  update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc||'{"sourceVersion":"instrument-acquisition-v4"}') where id='suprabha';
  payload:=jsonb_build_object('targetId',response->>'entityId','expectedVersion',4,'expectedSourceRevision','4','reason','Over-limit revised acquisition review','directorException',true,'idempotencyKey','economic-acquisition-review-003');
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-administrator@test.local','review_acquisition',payload);raise exception 'Administrator confirmation bypassed maximum acquisition payback';exception when invalid_parameter_value then null;end;
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-account@test.local','review_acquisition',payload);raise exception 'Accounts mutated acquisition capital';exception when insufficient_privilege then null;end;
  if (select count(*) from private.stockflow_economic_acquisition_reviews where target_id=(response->>'entityId')::uuid)<>2 then raise exception 'Rejected over-limit review wrote history';end if;
  doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','instrument-acquisition','revision',5,'date',period+10,'kind','purchase','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','different-instrument','quantity','1','unit','nos','netSalesPaise','70000000')))));
  update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc||'{"sourceVersion":"instrument-acquisition-v5"}') where id='suprabha';
  begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','review_acquisition',payload||'{"expectedSourceRevision":"5"}');raise exception 'Changed product silently reassigned acquisition';exception when invalid_parameter_value then null;end;
  workspace:=private.stockflow_economic_workspace(array['management']);
  if not exists(select 1 from jsonb_array_elements(workspace->'acquisitionReviewItems') t where t->>'targetId'=response->>'entityId' and t->>'proposedAmountPaise' is null and t->>'changed'='true') then raise exception 'Incompatible acquisition became reviewable';end if;
  doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','instrument-acquisition','revision',6,'date',period+10,'kind','purchase','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','instrument-guid','quantity','1','unit','nos','netSalesPaise','70000000')))));
  update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc||'{"sourceVersion":"instrument-acquisition-v6"}') where id='suprabha';
  perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','review_acquisition',payload||'{"expectedSourceRevision":"6"}');
  if (select sum(amount_paise) from private.stockflow_economic_events where target_id=(response->>'entityId')::uuid and kind='capital')<>70000000 or (select amount_paise-previous_amount_paise from private.stockflow_economic_acquisition_reviews where target_id=(response->>'entityId')::uuid order by revision desc limit 1)<>0 or not private.stockflow_economic_acquisition_current((response->>'entityId')::uuid) then raise exception 'Unchanged cost revision reposted acquisition value';end if;
  raise exception using errcode='ZT002',message='Rollback isolated acquisition fixture';
 exception when sqlstate 'ZT002' then null;
 end;
 -- Restore the in-memory source document after the isolated database rollback.
 doc:=jsonb_set(doc,'{vouchers}',(select jsonb_agg(v) from jsonb_array_elements(doc->'vouchers') v where v->>'sourceId' not in ('instrument-acquisition','future-instrument-acquisition')));
 -- Opening recovery includes later adjustments to pre-group sales, including generation reversals.
 declare opening_result uuid; credit_result uuid; opening_event uuid; credit_event uuid; before_recovery bigint; after_recovery bigint;
 begin
  select id into run from private.stockflow_economic_runs where active;
  workspace:=private.stockflow_economic_workspace(array['management']);
  select (t->>'recoveryPaise')::bigint into before_recovery from jsonb_array_elements(workspace->'targets') t where t->>'id'=pool::text;
  insert into private.stockflow_economic_results(run_id,source_line_id,target_id,status,reason,share_bps,quantity,revenue_paise,cost_paise,gp_paise,recovery_origin_date)
  values(run,line_id,target,'verified','Opening-sale regression',10000,1,100,0,100,period-1) returning id into opening_result;
  insert into private.stockflow_economic_results(run_id,source_line_id,target_id,status,reason,share_bps,quantity,revenue_paise,cost_paise,gp_paise,recovery_origin_date)
  values(run,line_id,target,'verified','Late-credit regression',10000,0,-40,0,-40,period-1) returning id into credit_result;
  insert into private.stockflow_economic_events(target_id,kind,amount_paise,effective_date,source_result_id,request_id,actor,reason)
  values(target,'gp',100,period-1,opening_result,'opening-sale-regression','test','Opening sale') returning id into opening_event;
  insert into private.stockflow_economic_events(target_id,kind,amount_paise,effective_date,source_result_id,request_id,actor,reason)
  values(target,'gp',-40,period+20,credit_result,'late-credit-regression','test','Later credit') returning id into credit_event;
  workspace:=private.stockflow_economic_workspace(array['management']);
  select (t->>'recoveryPaise')::bigint into after_recovery from jsonb_array_elements(workspace->'targets') t where t->>'id'=pool::text;
  if not private.stockflow_economic_result_owned(credit_result,pool) then raise exception 'Late pre-group credit missing from group monthly ownership';end if;
  if after_recovery-before_recovery<>60 then raise exception 'Late pre-group credit disappeared from pooled recovery: %',after_recovery-before_recovery;end if;
  insert into private.stockflow_economic_events(target_id,kind,amount_paise,effective_date,reverses_id,request_id,actor,reason)
  values(target,'reversal',-100,period-1,opening_event,'opening-sale-reversal','test','Restatement'),(target,'reversal',40,period+20,credit_event,'late-credit-reversal','test','Restatement');
  workspace:=private.stockflow_economic_workspace(array['management']);
  select (t->>'recoveryPaise')::bigint into after_recovery from jsonb_array_elements(workspace->'targets') t where t->>'id'=pool::text;
  if after_recovery<>before_recovery then raise exception 'Opening recovery reversal lost immutable original-sale ownership';end if;
  raise exception using errcode='ZT004',message='Rollback opening recovery regression';
 exception when sqlstate 'ZT004' then null;
 end;
 -- Status-only recovery and a durable close fence never replay an absent financial payload.
 payload:=jsonb_build_object('commandAction','record_capital','commandKey','economic-close-reference-0001','closeUnresolved',false);
 receipt:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','recover_economic_command',payload);
 if receipt is distinct from '{"status":"unresolved"}'::jsonb then raise exception 'Missing economic receipt falsely proved failure';end if;
 begin perform public.stockflow_economics_gateway('economic-test-key','economic-account@test.local','recover_economic_command',payload||'{"closeUnresolved":true}');raise exception 'Accounts closed an economic request';exception when insufficient_privilege then null;end;
 receipt:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','recover_economic_command',payload||'{"closeUnresolved":true}');
 if receipt is distinct from '{"status":"not_saved"}'::jsonb then raise exception 'Economic close fence not recorded';end if;
 perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','recover_economic_command',payload||'{"closeUnresolved":true}');
 if (select count(*) from private.stockflow_economic_audit a where a.action='close_unresolved_command' and a.payload->>'commandKey'='economic-close-reference-0001')<>1 then raise exception 'Repeated close duplicated audit';end if;
 begin perform public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','record_capital',jsonb_build_object('targetId',pool,'amountPaise','100','kind','contribution','effectiveDate',period,'reason','Late financial request must be fenced','idempotencyKey','economic-close-reference-0001'));raise exception 'Closed request accepted late capital delivery';exception when invalid_parameter_value then null;end;
 if public.stockflow_economics_gateway('economic-test-key','economic-account@test.local','recover_economic_command',payload) is distinct from '{"status":"unresolved"}'::jsonb then raise exception 'Accounts read another actor receipt';end if;
 -- Cancellation is a higher immutable source revision; claims and GP cannot survive it.
 doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','sale-1','revision',2,'date',period+1,'kind','sale','customerSourceId','customer-guid-1','siteId','site-1','amountStatus','verified','cancelled',true,'lines','[]'::jsonb)));
 update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc||'{"sourceVersion":"cancel-v2"}') where id='suprabha';
 select id into run from private.stockflow_economic_runs where active;
 if exists(select 1 from private.stockflow_economic_results where run_id=run and source_line_id=line_id) or private.stockflow_economic_case_recovery(case_id,run)->>'revenuePaise'<>'0' then raise exception 'Cancelled source survived recovery';end if;
 -- Explicit non-economic documents remain immutable source evidence, but cannot
 -- create lines, GP, supply or erase a previously economic voucher.
 declare exclusion_doc jsonb;
 begin
  exclusion_doc:=jsonb_build_object('schemaVersion',1,'companyId','excluded-company-1','sourceVersion','excluded-window-1','completeWindow',true,'windowFrom',period,'windowTo',period+interval '1 month','vouchers',jsonb_build_array(
   jsonb_build_object('sourceId','excluded-proforma-1','revision',1,'date',period,'kind','non_economic','amountStatus','verified','classificationPolicy','explicit_non_economic_v1','voucherType','Proforma Invoice','exclusionReason','Accounts-approved non-revenue source document','lines','[]'::jsonb),
   jsonb_build_object('sourceId','excluded-delivery-1','revision',1,'date',period+1,'kind','non_economic','amountStatus','verified','classificationPolicy','explicit_non_economic_v1','voucherType','Delivery Challan','exclusionReason','Shipment retained separately from the invoiced sale','lines','[]'::jsonb)));
  update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',exclusion_doc) where id='suprabha';
  update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',exclusion_doc) where id='suprabha';
  if (select count(*) from private.stockflow_economic_source_vouchers where company_id='excluded-company-1')<>2 or exists(select 1 from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id='excluded-company-1') then raise exception 'Excluded documents lost identity, duplicated, or created economic lines';end if;
  if not exists(select 1 from private.stockflow_economic_source_coverage where company_id='excluded-company-1' and source_version='excluded-window-1') then raise exception 'Explicit exclusions prevented complete source coverage';end if;
  replay:=private.stockflow_economic_workspace(array['accounts']);
  if (replay->>'sourceDocumentExclusionCount')::integer<>2 or not exists(select 1 from jsonb_array_elements(replay->'sourceDocumentExclusions') e where e->>'sourceId'='excluded-proforma-1' and e->>'voucherType'='Proforma Invoice' and e->>'revision'='1') then raise exception 'Excluded source evidence missing from Accounts read model';end if;
  response:=jsonb_set(exclusion_doc,'{vouchers,0,lines}',jsonb_build_array(jsonb_build_object('lineKey','1','productId','product-guid-1','quantity','1','unit','pack','netSalesPaise','100')));
  response:=jsonb_set(response,'{vouchers,0,revision}','2');
  update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',response||'{"sourceVersion":"bad-exclusion-lines"}') where id='suprabha';
  if exists(select 1 from private.stockflow_economic_source_vouchers where source_id='excluded-proforma-1' and source_revision=2) then raise exception 'Non-economic document accepted revenue lines';end if;
  response:=jsonb_set(exclusion_doc,'{vouchers}',jsonb_build_array(jsonb_build_object('sourceId','excluded-proforma-1','revision',2,'date',period+2,'kind','sale','amountStatus','verified','classificationPolicy','native_economic_v1','voucherType','GST SALE','customerSourceId','excluded-customer-1','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','product-guid-1','quantity','1','unit','pack','netSalesPaise','100')))));
  update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',(response #- '{vouchers,0,voucherType}')||'{"sourceVersion":"bad-promotion-without-type"}') where id='suprabha';
  if exists(select 1 from private.stockflow_economic_source_vouchers where source_id='excluded-proforma-1' and source_revision=2) then raise exception 'Excluded document promotion accepted missing native type evidence';end if;
  update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',response||'{"sourceVersion":"promoted-native-invoice"}') where id='suprabha';
  update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',response||'{"sourceVersion":"promoted-native-invoice"}') where id='suprabha';
  if (select count(*) from private.stockflow_economic_source_vouchers where source_id='excluded-proforma-1')<>2 or not exists(select 1 from private.stockflow_economic_source_vouchers where source_id='excluded-proforma-1' and source_revision=2 and kind='sale') then raise exception 'Native newer invoice promotion lost history or failed replay';end if;
  replay:=private.stockflow_economic_workspace(array['accounts']);
  if (replay->>'sourceDocumentExclusionCount')::integer<>1 then raise exception 'Promoted invoice remained in current excluded documents';end if;
  response:=jsonb_set(exclusion_doc,'{companyId}','"company-guid-1"');
  response:=jsonb_set(response,'{vouchers}',jsonb_build_array(jsonb_build_object('sourceId','sale-1','revision',999,'date',period+1,'kind','non_economic','amountStatus','verified','classificationPolicy','explicit_non_economic_v1','voucherType','Changed Type','exclusionReason','Must not erase earlier economics','lines','[]'::jsonb)));
  update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',response) where id='suprabha';
  if exists(select 1 from private.stockflow_economic_source_vouchers where source_id='sale-1' and source_revision=999) then raise exception 'Exclusion erased an economic voucher';end if;
  raise exception using errcode='ZT001',message='Rollback isolated source exclusion fixture';
 exception when sqlstate 'ZT001' then null;
 end;
 insert into private.stockflow_economic_import_exceptions(company_id,reason,evidence,recorded_at) values('company-guid-1','New sync failure after last complete evidence','{}',clock_timestamp());
 if private.stockflow_economic_covered('company-guid-1',period,(period+interval '1 month')::date,run) then raise exception 'New sync failure left complete economic coverage';end if;
 workspace:=public.stockflow_economics_gateway('economic-test-key','economic-manager@test.local','get_instrument_economics','{}');
 if exists(select 1 from jsonb_array_elements(workspace->'leakage') x where x->>'potentialRevenuePaise' is not null) then raise exception 'Incomplete sync produced definitive financial leakage values';end if;
 if (workspace->'reportingSummary'->>'netSalesPaise')::bigint<>(workspace->'reportingSummary'->>'attributedSalesPaise')::bigint+(workspace->'reportingSummary'->>'unattributedSalesPaise')::bigint+(workspace->'reportingSummary'->>'excludedSalesPaise')::bigint then raise exception 'Financial buckets fail reconciliation after corrections';end if;
 if exists(select 1 from jsonb_array_elements(workspace->'targets') t where
  coalesce((select sum((i->>'revenuePaise')::numeric) from jsonb_array_elements(t->'itemBreakdown') i),0)<>(t->>'revenuePaise')::numeric
  or coalesce((select sum((i->>'knownGpPaise')::numeric) from jsonb_array_elements(t->'itemBreakdown') i),0)<>(t->>'knownGpPaise')::numeric
  or coalesce((select sum((i->>'sourceLines')::int) from jsonb_array_elements(t->'itemBreakdown') i),0)<>(t->>'attributedLines')::int
 ) then raise exception 'Monthly item read model differs from placement/group totals or includes instrument billing';end if;
end$test$;
rollback;
