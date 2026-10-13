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
declare command text; scenario integer; months integer; initial_months integer; actor text; flag boolean; expected_message text;
 day date:=private.stockflow_economic_business_date()-30; target uuid; purchase uuid; response jsonb; v_payload jsonb; doc jsonb; before_events integer; before_reviews integer; before_audit integer;
begin
 if (public.stockflow_economics_gateway('d04-test-key','d04-management@test.local','get_instrument_economics','{}')->>'canAdministrator')::boolean is distinct from false or (public.stockflow_economics_gateway('d04-test-key','d04-administrator@test.local','get_instrument_economics','{}')->>'canAdministrator')::boolean is distinct from true then raise exception 'D04 workspace administrator permission is incorrect';end if;
 foreach command in array array['approve_target','record_capital','review_acquisition'] loop
  for scenario in 1..5 loop
   begin
    -- 1 management+flag, 2 administrator without flag, 3 administrator+flag,
    -- 4 management within review band (36), 5 administrator beyond maximum (49).
    months:=case scenario when 4 then 36 when 5 then 49 else 40 end;
    initial_months:=case when command='approve_target' then months else 30 end;
    actor:=case when scenario in (1,4) then 'd04-management@test.local' else 'd04-administrator@test.local' end;
    flag:=scenario in (1,3,5);
    doc:=jsonb_build_object('schemaVersion',1,'companyId','d04-company','sourceVersion','d04-source-1','completeWindow',true,'windowFrom',day-1,'windowTo',day+interval '1 month','vouchers',jsonb_build_array(
     jsonb_build_object('sourceId','d04-acquisition','revision',1,'date',day,'kind','purchase','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','d04-instrument','quantity','1','unit','nos','netSalesPaise',(initial_months*1000000)::text)))));
    update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc) where id='suprabha';
    select l.id into purchase from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id='d04-company' and v.source_id='d04-acquisition' and v.source_revision=1;
    if purchase is null then raise exception 'D04 purchase fixture did not import';end if;
    v_payload:=jsonb_build_object('kind','placement','name','D04 placement','companyId','d04-company','customerId','d0400000-0000-4000-8000-000000000001','customerSourceId','d04-customer-guid','siteId','d04-site','modelId','d04-model','installationId','d0400000-0000-4000-8000-000000000003','effectiveFrom',day,'capitalPaise','0','acquisitionPurchaseLineId',purchase,'capitalEvidence','D04-SERIAL verified acquisition','idempotencyKey','d04-create-fixture');
    response:=public.stockflow_economics_gateway('d04-test-key','d04-management@test.local','create_target',v_payload);target:=(response->>'entityId')::uuid;
    perform public.stockflow_economics_gateway('d04-test-key','d04-management@test.local','set_expectation',jsonb_build_object('targetId',target,'effectiveFrom',day,'monthlyRevenuePaise','2000000','monthlyGpPaise','1000000','reason','D04 placement-start baseline','idempotencyKey','d04-expectation-fixture'));
    v_payload:=jsonb_build_object('targetId',target,'expectedVersion',1,'expectedGeneration',(select id from private.stockflow_economic_runs where active),'decision','approved','reason','D04 approval','idempotencyKey','d04-approval-fixture');
    if command<>'approve_target' then
     perform public.stockflow_economics_gateway('d04-test-key','d04-management@test.local','approve_target',v_payload);
     if command='record_capital' then
      v_payload:=jsonb_build_object('targetId',target,'kind','capital','amountPaise',((months-30)*1000000)::text,'effectiveDate',day,'reason','D04 additional capital','idempotencyKey','d04-capital-fixture');
     else
      doc:=jsonb_set(doc,'{vouchers}',doc->'vouchers'||jsonb_build_array(jsonb_build_object('sourceId','d04-acquisition','revision',2,'date',day,'kind','purchase','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','d04-instrument','quantity','1','unit','nos','netSalesPaise',(months*1000000)::text)))));
      update public.stockflow_snapshots s set payload=s.payload||jsonb_build_object('economicEvidence',doc||'{"sourceVersion":"d04-source-2"}') where id='suprabha';
      v_payload:=jsonb_build_object('targetId',target,'expectedVersion',2,'expectedSourceRevision','2','reason','D04 revised acquisition','idempotencyKey','d04-acquisition-fixture');
     end if;
    end if;
    if flag then v_payload:=v_payload||'{"directorException":true}';end if;
    before_events:=(select count(*) from private.stockflow_economic_events where target_id=target);
    before_reviews:=(select count(*) from private.stockflow_economic_acquisition_reviews where target_id=target);
    before_audit:=(select count(*) from private.stockflow_economic_audit where entity_id=target);
    if scenario in (1,2,5) then
     expected_message:=case when scenario=5 then case command when 'approve_target' then 'Payback exceeds configured approval limit' when 'record_capital' then 'Capital increase exceeds configured approval limit' else 'Revised acquisition exceeds configured approval limit' end
      else case command when 'approve_target' then 'Administrator approval required for payback beyond the review band' when 'record_capital' then 'Administrator approval required for increased capital payback beyond the review band' else 'Administrator approval required for revised acquisition payback beyond the review band' end end;
     begin
      perform public.stockflow_economics_gateway('d04-test-key',actor,command,v_payload);
      raise exception 'D04 accepted forbidden % scenario %',command,scenario;
     exception when invalid_parameter_value then
      if sqlerrm<>expected_message then raise exception 'D04 wrong error for % scenario %: %',command,scenario,sqlerrm;end if;
     end;
     if (select count(*) from private.stockflow_economic_events where target_id=target)<>before_events or (select count(*) from private.stockflow_economic_acquisition_reviews where target_id=target)<>before_reviews or (select count(*) from private.stockflow_economic_audit where entity_id=target)<>before_audit then raise exception 'D04 denial partially mutated financial records';end if;
     if exists(select 1 from private.stockflow_command_results r where r.idempotency_key=v_payload->>'idempotencyKey') then raise exception 'D04 denial retained a command receipt';end if;
    else
     response:=public.stockflow_economics_gateway('d04-test-key',actor,command,v_payload);
     if response->>'ok'<>'true' or (select approval from private.stockflow_economic_targets where id=target)<>'approved' or (select sum(amount_paise) from private.stockflow_economic_events where target_id=target and kind='capital')<>months*1000000 then raise exception 'D04 successful % scenario % did not persist expected approval/capital',command,scenario;end if;
     if not exists(select 1 from private.stockflow_economic_audit a where a.action=command and a.payload->>'idempotencyKey'=v_payload->>'idempotencyKey') then raise exception 'D04 approval audit missing';end if;
    end if;
    raise exception using errcode='ZD004',message='Rollback D04 scenario';
   exception when sqlstate 'ZD004' then null;end;
  end loop;
 end loop;
end$test$;
rollback;
