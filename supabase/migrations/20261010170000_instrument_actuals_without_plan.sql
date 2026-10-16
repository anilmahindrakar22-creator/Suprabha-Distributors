begin;

-- Expected economics is optional planning information. A placement with
-- verified acquisition and billing evidence may be approved for actual Tally
-- attribution even when management has not set a monthly sales/GP target.
create or replace function private.stockflow_economic_approval_preview(p_target uuid) returns jsonb
language plpgsql stable set search_path=pg_catalog,private as $$
declare target private.stockflow_economic_targets%rowtype; baseline private.stockflow_economic_expectations%rowtype;
 policy private.stockflow_economic_policy_versions%rowtype; capital numeric; billing bigint; investment numeric; payback numeric; status text;
begin
 select * into target from private.stockflow_economic_targets where id=p_target;
 select * into baseline from private.stockflow_economic_expectations where target_id=p_target and effective_from<=target.effective_from order by effective_from desc,recorded_at desc,id desc limit 1;
 select * into policy from private.stockflow_economic_policy_versions order by recorded_at desc,id desc limit 1;
 select coalesce(sum(amount_paise),0) into capital from private.stockflow_economic_events where kind='capital' and (target_id=p_target or (target.kind='group' and target_id in(select placement_id from private.stockflow_economic_group_members where group_id=p_target and effective_from<=target.effective_from and (effective_to is null or effective_to>target.effective_from))));
 billing:=private.stockflow_economic_billed_recovery(p_target);
 investment:=greatest(0,capital-billing);
 if target.approval is distinct from 'proposed' or target.effective_to is not null then status:='not_applicable';
 elsif not private.stockflow_economic_acquisition_current(p_target) or not private.stockflow_economic_billing_current(p_target) then status:='evidence_incomplete';
 elsif baseline.id is null then status:='actuals_only';
 elsif investment>0 and baseline.monthly_gp_paise<=0 then status:='positive_gp_required';
 else
  payback:=case when investment>0 then investment/baseline.monthly_gp_paise else 0 end;
  status:=case when payback>policy.exception_months then 'limit_exceeded' when payback>policy.review_months then 'director_exception_required' else 'within_limit' end;
 end if;
 return jsonb_build_object('status',status,'capitalPaise',capital::text,'instrumentBillingPaise',billing::text,'netInvestmentPaise',investment::text,'expectedMonthlyGpPaise',baseline.monthly_gp_paise::text,'expectedPaybackMonths',payback,'expectationId',baseline.id,'expectationEffectiveFrom',baseline.effective_from,'policyId',policy.id,'reviewMonths',policy.review_months,'exceptionMonths',policy.exception_months);
end$$;
revoke all on function private.stockflow_economic_approval_preview(uuid) from public,anon,authenticated;

create or replace function private.stockflow_economic_investment_review(p_target uuid,p_capital numeric) returns jsonb
language plpgsql stable set search_path=pg_catalog,private as $$
declare
 target private.stockflow_economic_targets%rowtype;
 baseline private.stockflow_economic_expectations%rowtype;
 policy private.stockflow_economic_policy_versions%rowtype;
 approval_basis jsonb; exposure numeric; payback numeric; status text;
begin
 select * into target from private.stockflow_economic_targets where id=p_target;
 select payload into approval_basis from private.stockflow_economic_audit where action='approve_target' and entity_id=p_target and payload->>'decision'='approved' order by recorded_at desc,id desc limit 1;
 select * into baseline from private.stockflow_economic_expectations where id=private.stockflow_economic_approved_expectation(p_target) and target_id=p_target;
 select * into policy from private.stockflow_economic_policy_versions order by recorded_at desc,id desc limit 1;
 exposure:=greatest(0,p_capital-private.stockflow_economic_billed_recovery(p_target));
 if target.approval is distinct from 'approved' then status:='not_applicable';
 elsif not private.stockflow_economic_billing_current(p_target) or not private.stockflow_economic_acquisition_current(p_target) then status:='evidence_incomplete';
 elsif exposure=0 then status:='not_applicable';payback:=0;
 elsif baseline.id is null then status:='planning_not_set';
 elsif baseline.monthly_gp_paise<=0 then status:='positive_gp_required';
 else
  payback:=exposure/baseline.monthly_gp_paise;
  status:=case when payback>policy.exception_months then 'limit_exceeded' when payback>policy.review_months then 'review_required' else 'within_limit' end;
 end if;
 return jsonb_build_object('status',status,'expectedPaybackMonths',round(payback,2),'netInvestmentPaise',exposure::text,'expectationId',baseline.id,'expectedMonthlyGpPaise',baseline.monthly_gp_paise::text,'policyId',policy.id,'reviewMonths',policy.review_months,'exceptionMonths',policy.exception_months,'approvedNetInvestmentPaise',approval_basis->>'approvedNetInvestmentPaise','approvedPaybackMonths',approval_basis->'expectedPaybackMonths','approvedDirectorException',coalesce((approval_basis->>'directorException')::boolean,false));
end$$;
revoke all on function private.stockflow_economic_investment_review(uuid,numeric) from public,anon,authenticated;

commit;
