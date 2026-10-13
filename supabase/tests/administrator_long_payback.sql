begin;
-- Each scenario rolls its fixture back, including receipts, audit and source revisions.
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('d04-test-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status) values
 ('d04-management@test.local','management','active'),('d04-administrator@test.local','administrator','active');
insert into public.stockflow_snapshots(id,company,fetched_at,payload) values('suprabha','SUPRABHA DISTRIBUTORS',now()::text,'{"catalog":[]}'::jsonb) on conflict(id) do nothing;
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values('d0400000-0000-4000-8000-000000000001','D04 customer','d04-customer','test');
insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,created_by_email,updated_by_email,idempotency_key)
 values('d0400000-0000-4000-8000-000000000002','D04-ORDER','d0400000-0000-4000-8000-000000000001','D04 customer','phone','delivered','test','test','d04-order-fixture');
insert into private.stockflow_equipment_installations(id,order_id,tally_key,item_name,status,scheduled_date,serial_number,created_by_email,completed_at)
 values('d0400000-0000-4000-8000-000000000003','d0400000-0000-4000-8000-000000000002','d04-equipment','D04 instrument','completed',private.stockflow_economic_business_date()-60,'D04-SERIAL','test',now());
insert into private.stockflow_economic_policy_versions(review_months,exception_months,actor,reason) values(36,48,'test','D04 explicit policy fixture');

do $test$
declare v_command text; v_scenario integer; v_months integer; v_initial_months integer; v_actor text; v_flag boolean; v_expected_message text;
 v_day date:=private.stockflow_economic_business_date()-30; v_target uuid; v_purchase uuid; v_response jsonb; v_payload jsonb; v_doc jsonb; v_before_events integer; v_before_reviews integer; v_before_audit integer;
begin
 -- Keep the policy success isolated so the existing approval scenarios retain their 36-month boundary.
 begin
  v_payload:='{"attractiveMonths":24,"reviewMonths":40,"exceptionMonths":48,"forecastWindowMonths":3,"watchRevenuePercent":80,"criticalRevenuePercent":50,"reason":"D04 policy authorization","idempotencyKey":"d04-policy-fixture"}'::jsonb;
  begin
   perform public.stockflow_economics_gateway('d04-test-key','d04-management@test.local','set_policy',v_payload);
   raise exception 'D04 management changed the payback approval policy';
  exception when insufficient_privilege then
   if sqlerrm<>'Administrator required to change the payback approval policy' then raise exception 'D04 wrong policy authorization error: %',sqlerrm;end if;
  end;
  v_response:=public.stockflow_economics_gateway('d04-test-key','d04-administrator@test.local','set_policy',v_payload);
  if v_response->>'ok' is distinct from 'true' or not exists(select 1 from private.stockflow_economic_policy_versions where id=(v_response->>'entityId')::uuid and review_months=40 and actor='d04-administrator@test.local') then raise exception 'D04 administrator policy change did not persist';end if;
  raise exception using errcode='ZD004',message='Rollback D04 policy scenario';
 exception when sqlstate 'ZD004' then null;end;
 foreach v_command in array array['approve_target','record_capital','review_acquisition'] loop
  for v_scenario in 1..5 loop
   begin
    -- 1 management+flag, 2 administrator without flag, 3 administrator+flag,
    -- 4 management within review band (36), 5 administrator beyond maximum (49).
    v_months:=case v_scenario when 4 then 36 when 5 then 49 else 40 end;
    v_initial_months:=case when v_command='approve_target' then v_months else 30 end;
    v_actor:=case when v_scenario in (1,4) then 'd04-management@test.local' else 'd04-administrator@test.local' end;
    v_flag:=v_scenario in (1,3,5);
    v_doc:=jsonb_build_object('schemaVersion',1,'companyId','d04-company','sourceVersion','d04-source-1','completeWindow',true,'windowFrom',v_day-1,'windowTo',v_day+interval '1 month','vouchers',jsonb_build_array(
     jsonb_build_object('sourceId','d04-acquisition','revision',1,'date',v_day,'kind','purchase','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','d04-instrument','quantity','1','unit','nos','netSalesPaise',(v_initial_months*1000000)::text)))));
    update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',v_doc) where id='suprabha';
    select l.id into v_purchase from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id='d04-company' and v.source_id='d04-acquisition' and v.source_revision=1;
    if v_purchase is null then raise exception 'D04 purchase fixture did not import';end if;
    v_payload:=jsonb_build_object('kind','placement','name','D04 placement','companyId','d04-company','customerId','d0400000-0000-4000-8000-000000000001','customerSourceId','d04-customer-guid','siteId','d04-site','modelId','d04-model','installationId','d0400000-0000-4000-8000-000000000003','effectiveFrom',v_day,'capitalPaise','0','acquisitionPurchaseLineId',v_purchase,'capitalEvidence','D04-SERIAL verified acquisition','idempotencyKey','d04-create-fixture');
    v_response:=public.stockflow_economics_gateway('d04-test-key','d04-management@test.local','create_target',v_payload);v_target:=(v_response->>'entityId')::uuid;
    perform public.stockflow_economics_gateway('d04-test-key','d04-management@test.local','set_expectation',jsonb_build_object('targetId',v_target,'effectiveFrom',v_day,'monthlyRevenuePaise','2000000','monthlyGpPaise','1000000','reason','D04 placement-start baseline','idempotencyKey','d04-expectation-fixture'));
    v_payload:=jsonb_build_object('targetId',v_target,'expectedVersion',1,'expectedGeneration',(select id from private.stockflow_economic_runs where active),'decision','approved','reason','D04 approval','idempotencyKey','d04-approval-fixture');
    if v_command<>'approve_target' then
     perform public.stockflow_economics_gateway('d04-test-key','d04-management@test.local','approve_target',v_payload);
     if v_command='record_capital' then
      v_payload:=jsonb_build_object('targetId',v_target,'kind','capital','amountPaise',((v_months-30)*1000000)::text,'effectiveDate',v_day,'reason','D04 additional capital','idempotencyKey','d04-capital-fixture');
     else
      v_doc:=jsonb_set(v_doc,'{vouchers}',v_doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','d04-acquisition','revision',2,'date',v_day,'kind','purchase','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','d04-instrument','quantity','1','unit','nos','netSalesPaise',(v_months*1000000)::text)))));
      update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',v_doc||'{"sourceVersion":"d04-source-2"}') where id='suprabha';
      v_payload:=jsonb_build_object('targetId',v_target,'expectedVersion',2,'expectedSourceRevision','2','reason','D04 revised acquisition','idempotencyKey','d04-acquisition-fixture');
     end if;
    end if;
    if v_flag then v_payload:=v_payload||'{"directorException":true}';end if;
    v_before_events:=(select count(*) from private.stockflow_economic_events where target_id=v_target);
    v_before_reviews:=(select count(*) from private.stockflow_economic_acquisition_reviews where target_id=v_target);
    v_before_audit:=(select count(*) from private.stockflow_economic_audit where entity_id=v_target);
    if v_scenario in (1,2,5) then
     v_expected_message:=case when v_scenario=5 then case v_command when 'approve_target' then 'Payback exceeds configured approval limit' when 'record_capital' then 'Capital increase exceeds configured approval limit' else 'Revised acquisition exceeds configured approval limit' end
      else case v_command when 'approve_target' then 'Administrator approval required for payback beyond the review band' when 'record_capital' then 'Administrator approval required for increased capital payback beyond the review band' else 'Administrator approval required for revised acquisition payback beyond the review band' end end;
     begin
      perform public.stockflow_economics_gateway('d04-test-key',v_actor,v_command,v_payload);
      raise exception 'D04 accepted forbidden % scenario %',v_command,v_scenario;
     exception when invalid_parameter_value then
      if sqlerrm<>v_expected_message then raise exception 'D04 wrong error for % scenario %: %',v_command,v_scenario,sqlerrm;end if;
     end;
     if (select count(*) from private.stockflow_economic_events where target_id=v_target)<>v_before_events or (select count(*) from private.stockflow_economic_acquisition_reviews where target_id=v_target)<>v_before_reviews or (select count(*) from private.stockflow_economic_audit where entity_id=v_target)<>v_before_audit then raise exception 'D04 denial partially mutated financial records';end if;
     if exists(select 1 from private.stockflow_command_results r where r.idempotency_key=v_payload->>'idempotencyKey') then raise exception 'D04 denial retained a command receipt';end if;
    else
     v_response:=public.stockflow_economics_gateway('d04-test-key',v_actor,v_command,v_payload);
     if v_response->>'ok'<>'true' or (select approval from private.stockflow_economic_targets where id=v_target)<>'approved' or (select sum(amount_paise) from private.stockflow_economic_events where target_id=v_target and kind='capital')<>v_months*1000000 then raise exception 'D04 successful % scenario % did not persist expected approval/capital',v_command,v_scenario;end if;
     if not exists(select 1 from private.stockflow_economic_audit a where a.action=v_command and a.payload->>'idempotencyKey'=v_payload->>'idempotencyKey') then raise exception 'D04 approval audit missing';end if;
    end if;
    raise exception using errcode='ZD004',message='Rollback D04 scenario';
   exception when sqlstate 'ZD004' then null;end;
  end loop;
 end loop;
end$test$;
rollback;
