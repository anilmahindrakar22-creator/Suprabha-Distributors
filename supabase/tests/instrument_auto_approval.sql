begin;
-- Own fixtures; every scenario and the test-only preview capture roll back.
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('d15-test-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status) values('d15-management@test.local','management','active');
insert into public.stockflow_snapshots(id,company,fetched_at,payload) values('suprabha','SUPRABHA DISTRIBUTORS',now()::text,'{"catalog":[]}'::jsonb) on conflict(id) do nothing;
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values('d1500000-0000-4000-8000-000000000001','D15 customer','d15-customer','test');
insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,created_by_email,updated_by_email,idempotency_key)
 values('d1500000-0000-4000-8000-000000000002','D15-ORDER','d1500000-0000-4000-8000-000000000001','D15 customer','phone','delivered','test','test','d15-order-fixture');
insert into private.stockflow_equipment_installations(id,order_id,tally_key,item_name,status,scheduled_date,serial_number,created_by_email,completed_at)
 values('d1500000-0000-4000-8000-000000000003','d1500000-0000-4000-8000-000000000002','d15-equipment','D15 instrument','completed',private.stockflow_economic_business_date()-60,'D15-SERIAL','test',now());
insert into private.stockflow_economic_policy_versions(attractive_months,review_months,exception_months,actor,reason,automatic_approval) values(24,36,48,'test','D15 explicit policy fixture',true);

-- Observe the real preview immediately before the approval update, after the
-- triggering mutation. This checks frozen IDs as well as monetary values without
-- substituting a preview computed after approval (which is not_applicable).
create temporary table d15_approval_previews(target_id uuid,preview jsonb);
create function pg_temp.d15_capture_approval_preview() returns trigger language plpgsql as $$
begin
 if old.approval='proposed' and new.approval='approved' then
  insert into pg_temp.d15_approval_previews values(old.id,private.stockflow_economic_approval_preview(old.id));
 end if;
 return new;
end$$;
create trigger d15_capture_approval_preview before update on private.stockflow_economic_targets for each row execute function pg_temp.d15_capture_approval_preview();

do $test$
declare
 v_scenario integer;v_months numeric;v_target uuid;v_version integer;v_preview jsonb;v_audit jsonb;v_payload jsonb;v_response jsonb;v_replay jsonb;v_audit_count integer;
 v_day date:=private.stockflow_economic_business_date()-30;
begin
 -- 1 capital then baseline (inclusive 24); 2 baseline then capital;
 -- 3 Management band; 4 Administrator band; 5 zero investment;
 -- 6 rebuild only; 9 existing eligible proposal until touched;
 -- 10 just above 24, to ensure the comparison never rounds down.
 -- 11 otherwise eligible, with automatic approval switched off (last case).
 foreach v_scenario in array array[1,2,3,4,5,6,9,10,11] loop
  begin
   if v_scenario=11 then
    insert into private.stockflow_economic_policy_versions(actor,reason,automatic_approval) values('test','D15 switch off',false);
   end if;
   v_months:=case v_scenario when 3 then 30 when 4 then 40 when 10 then 24.000001 else 24 end;
   v_response:=public.stockflow_economics_gateway('d15-test-key','d15-management@test.local','create_target',jsonb_build_object(
    'kind','placement','name','D15 placement','companyId','d15-company','customerId','d1500000-0000-4000-8000-000000000001','customerSourceId','d15-customer-guid','siteId','d15-site','modelId','d15-model','installationId','d1500000-0000-4000-8000-000000000003','effectiveFrom',v_day,
    'capitalPaise',case when v_scenario in (2,5) then '0' else (v_months*1000000)::bigint::text end,'capitalEvidence','D15 verified capital fixture','idempotencyKey','d15-create-fixture'));
   v_target:=(v_response->>'entityId')::uuid;
   select version into v_version from private.stockflow_economic_targets where id=v_target;
   if (select approval from private.stockflow_economic_targets where id=v_target)<>'proposed' or v_response?'autoApproved' then raise exception 'D15 create_target unexpectedly approved';end if;

   if v_scenario in (6,9) then
    -- Seed an already eligible proposal without any of the five commands.
    insert into private.stockflow_economic_expectations(target_id,effective_from,monthly_revenue_paise,monthly_gp_paise,reason,created_by)
     values(v_target,v_day,2000000,1000000,'D15 pre-existing placement-start baseline','test');
    v_preview:=private.stockflow_economic_approval_preview(v_target);
    if v_preview->>'status'<>'within_limit' or (v_preview->>'expectedPaybackMonths')::numeric<>24 then raise exception 'D15 existing proposal is not eligible';end if;
    v_response:=public.stockflow_economics_gateway('d15-test-key','d15-management@test.local','rebuild','{"idempotencyKey":"d15-rebuild-fixture"}'::jsonb);
    if (select approval from private.stockflow_economic_targets where id=v_target)<>'proposed' or (select version from private.stockflow_economic_targets where id=v_target)<>v_version or v_response?'autoApproved' or exists(select 1 from private.stockflow_economic_audit where action='approve_target' and entity_id=v_target) then raise exception 'D15 rebuild changed an existing proposed target';end if;
    if v_scenario=6 then
     raise exception using errcode='ZD015',message='Rollback D15 scenario';
    end if;
    v_payload:=jsonb_build_object('targetId',v_target,'kind','capital','amountPaise','0','effectiveDate',v_day,'reason','D15 touch existing proposal','idempotencyKey','d15-capital-fixture');
   else
    v_payload:=jsonb_build_object('targetId',v_target,'effectiveFrom',v_day,'monthlyRevenuePaise','2000000','monthlyGpPaise','1000000','reason','D15 placement-start baseline','idempotencyKey','d15-expectation-fixture');
    if v_scenario=2 then
     v_response:=public.stockflow_economics_gateway('d15-test-key','d15-management@test.local','set_expectation',v_payload);
     if (select approval from private.stockflow_economic_targets where id=v_target)<>'proposed' or v_response?'autoApproved' then raise exception 'D15 baseline with no investment was approved';end if;
     v_payload:=jsonb_build_object('targetId',v_target,'kind','capital','amountPaise','24000000','effectiveDate',v_day,'reason','D15 capital after baseline','idempotencyKey','d15-capital-fixture');
    end if;
   end if;
   v_response:=public.stockflow_economics_gateway('d15-test-key','d15-management@test.local',case when v_scenario in (2,9) then 'record_capital' else 'set_expectation' end,v_payload);

   if v_scenario in (1,2,9) then
    select preview into v_preview from pg_temp.d15_approval_previews where target_id=v_target;
    select payload into v_audit from private.stockflow_economic_audit where action='approve_target' and entity_id=v_target;
    if (select approval from private.stockflow_economic_targets where id=v_target)<>'approved' or (select version from private.stockflow_economic_targets where id=v_target)<>v_version+1 then raise exception 'D15 approval/version incorrect for scenario %',v_scenario;end if;
    if (select count(*) from private.stockflow_economic_audit where action='approve_target' and entity_id=v_target)<>1
     or v_audit->>'automatic' is distinct from 'true'
     or v_audit->>'triggeredBy' is distinct from (case when v_scenario in (2,9) then 'record_capital' else 'set_expectation' end)
     or v_audit->>'decision' is distinct from 'approved'
     or v_audit->>'targetId' is distinct from v_target::text
     or v_audit->>'reason' is distinct from 'Automatic: payback 24.0 months within the 24-month limit'
     or v_preview is null or v_audit->'approvalPreview' is distinct from v_preview
     or v_audit->'approvalExpectationId' is distinct from v_preview->'expectationId'
     or v_audit->'approvalPolicyId' is distinct from v_preview->'policyId'
     or v_audit->'approvedNetInvestmentPaise' is distinct from v_preview->'netInvestmentPaise'
     or v_audit->'expectedPaybackMonths' is distinct from v_preview->'expectedPaybackMonths'
     or private.stockflow_economic_approved_expectation(v_target) is distinct from (v_preview->>'expectationId')::uuid
     then raise exception 'D15 frozen automatic approval audit incorrect for scenario %',v_scenario;end if;
    if v_response->'autoApproved' is distinct from jsonb_build_object('targetId',v_target,'paybackMonths',v_preview->'expectedPaybackMonths','policyId',v_preview->'policyId','attractiveMonths',24) then raise exception 'D15 automatic approval receipt incorrect';end if;
    if not exists(select 1 from private.stockflow_economic_audit a where a.action=case when v_scenario in (2,9) then 'record_capital' else 'set_expectation' end and a.payload->>'idempotencyKey'=v_payload->>'idempotencyKey') then raise exception 'D15 triggering command audit missing';end if;
    if v_scenario=1 then
     -- 7: replay includes the original automatic approval result, with no writes.
     select count(*) into v_audit_count from private.stockflow_economic_audit;
     v_replay:=public.stockflow_economics_gateway('d15-test-key','d15-management@test.local','set_expectation',v_payload);
     if v_replay is distinct from v_response or (select count(*) from private.stockflow_economic_audit)<>v_audit_count then raise exception 'D15 idempotent replay changed result or audit';end if;
     -- 8: the stale manual decision conflicts after automatic version increment.
     begin
      perform public.stockflow_economics_gateway('d15-test-key','d15-management@test.local','approve_target',jsonb_build_object('targetId',v_target,'expectedVersion',v_version,'expectedGeneration',v_response->>'generation','decision','approved','reason','D15 stale manual approval','idempotencyKey','d15-stale-manual-fixture'));
      raise exception 'D15 stale manual approval accepted';
     exception when sqlstate 'PT409' then null;end;
     if (select count(*) from private.stockflow_economic_audit)<>v_audit_count then raise exception 'D15 stale manual approval added audit';end if;
    end if;
   else
    if (select approval from private.stockflow_economic_targets where id=v_target)<>'proposed' or (select version from private.stockflow_economic_targets where id=v_target)<>v_version or v_response?'autoApproved' or exists(select 1 from private.stockflow_economic_audit where action='approve_target' and entity_id=v_target) then raise exception 'D15 ineligible scenario % was automatically approved',v_scenario;end if;
    if v_scenario=11 then
     v_preview:=private.stockflow_economic_approval_preview(v_target);
     if v_preview->>'status' is distinct from 'within_limit' or (v_preview->>'netInvestmentPaise')::numeric is distinct from 24000000 or (v_preview->>'expectedPaybackMonths')::numeric is distinct from 24 then raise exception 'D15 switch-off target is not otherwise eligible';end if;
    end if;
    if v_scenario=3 then
     v_response:=public.stockflow_economics_gateway('d15-test-key','d15-management@test.local','approve_target',jsonb_build_object('targetId',v_target,'expectedVersion',v_version,'expectedGeneration',v_response->>'generation','decision','approved','reason','D15 Management manual approval','idempotencyKey','d15-manual-approval-fixture'));
     if (select approval from private.stockflow_economic_targets where id=v_target)<>'approved' or v_response?'autoApproved' then raise exception 'D15 manual Management approval changed';end if;
    end if;
   end if;
   raise exception using errcode='ZD015',message='Rollback D15 scenario';
  exception when sqlstate 'ZD015' then null;end;
 end loop;
end$test$;
rollback;
