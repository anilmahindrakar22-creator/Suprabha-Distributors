begin;
-- A rejected newer or conflicting revision is unresolved evidence, even when
-- the last admitted Tally revision remains in the immutable source ledger.
create function private.stockflow_economic_source_unresolved(p_company text,p_source text) returns boolean language sql stable set search_path=pg_catalog,private as $$
 select exists(select 1 from private.stockflow_economic_import_exceptions e
 join lateral(select v.* from private.stockflow_economic_source_vouchers v where v.company_id=p_company and v.source_id=p_source order by v.source_revision desc limit 1) latest on true
 where e.company_id=p_company and e.source_id=p_source and e.recorded_at>=latest.imported_at
 and case when e.evidence->>'revision' ~ '^[0-9]{1,19}$' then (e.evidence->>'revision')::numeric>=latest.source_revision else true end)
$$;
revoke all on function private.stockflow_economic_source_unresolved(text,text) from public,anon,authenticated;
create function private.stockflow_economic_billed_recovery(p_target uuid) returns bigint language sql stable set search_path=pg_catalog,private as $$
 select coalesce(sum(r.revenue_paise),0)::bigint from private.stockflow_economic_results r join private.stockflow_economic_runs g on g.id=r.run_id and g.active
 where r.status='instrument_billing' and (r.target_id=p_target or r.target_id in(select placement_id from private.stockflow_economic_group_members where group_id=p_target))
$$;
create function private.stockflow_economic_billing_current(p_target uuid) returns boolean language sql stable set search_path=pg_catalog,private as $$
 select not exists(select 1 from private.stockflow_economic_instrument_billings b where (b.target_id=p_target or b.target_id in(select placement_id from private.stockflow_economic_group_members where group_id=p_target)) and (private.stockflow_economic_source_unresolved(b.company_id,b.source_id) or not exists(
  select 1 from private.stockflow_economic_source_vouchers v where v.company_id=b.company_id and v.source_id=b.source_id and not exists(select 1 from private.stockflow_economic_source_vouchers n where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
  and (v.cancelled or exists(select 1 from private.stockflow_economic_source_lines l join private.stockflow_economic_results r on r.source_line_id=l.id join private.stockflow_economic_runs g on g.id=r.run_id and g.active where l.voucher_id=v.id and l.line_key=b.line_key and r.status='instrument_billing')))))
$$;
create function private.stockflow_economic_acquisition_current(p_target uuid) returns boolean language sql stable set search_path=pg_catalog,private as $$
 select not exists(select 1 from private.stockflow_economic_acquisition_links a
 join private.stockflow_economic_source_lines l on l.id=a.purchase_line_id
 join private.stockflow_economic_source_vouchers v on v.id=coalesce((select r.voucher_id from private.stockflow_economic_acquisition_reviews r where r.target_id=a.target_id order by r.revision desc limit 1),l.voucher_id)
 where (a.target_id=p_target or a.target_id in(select placement_id from private.stockflow_economic_group_members where group_id=p_target))
 and (private.stockflow_economic_source_unresolved(a.company_id,a.source_id) or exists(select 1 from private.stockflow_economic_source_vouchers n where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)))
$$;
create function private.stockflow_economic_covered(p_company text,p_from date,p_to date,p_run uuid) returns boolean language sql stable set search_path=pg_catalog,private as $$
 select p_run is not null and p_to>p_from and exists(select 1 from private.stockflow_economic_source_coverage cov
  join private.stockflow_economic_runs g on g.id=p_run where cov.company_id=p_company and cov.window_from<=p_from and cov.window_to>=p_to and cov.imported_at>now()-interval '48 hours'
  and not exists(select 1 from private.stockflow_economic_source_vouchers v where v.company_id=p_company and (v.imported_at>cov.imported_at or v.imported_at>g.created_at))
  and not exists(select 1 from private.stockflow_economic_import_exceptions e where (e.company_id=p_company or e.company_id is null) and e.recorded_at>cov.imported_at))
$$;
-- A later adjustment keeps its original sale attribution but is reported by the group holding that opening recovery.
create function private.stockflow_economic_result_owned(p_result uuid,p_target uuid) returns boolean language sql stable set search_path=pg_catalog,private as $$
 select exists(select 1 from private.stockflow_economic_results r
 join private.stockflow_economic_source_lines l on l.id=r.source_line_id
 join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
 where r.id=p_result and (r.target_id=p_target or exists(select 1 from private.stockflow_economic_group_members gm
 join private.stockflow_economic_targets g on g.id=gm.group_id
 where gm.group_id=p_target and g.approval='approved' and gm.placement_id=r.target_id and gm.effective_from<=private.stockflow_economic_business_date()
 and r.recovery_origin_date<gm.effective_from and v.business_date>=gm.effective_from)))
$$;
revoke all on function private.stockflow_economic_result_owned(uuid,uuid) from public,anon,authenticated;
-- Tally restatements change current exposure; they never rewrite the immutable approval basis.
create function private.stockflow_economic_approved_expectation(p_target uuid) returns uuid language sql stable set search_path=pg_catalog,private as $$
 select e.id from private.stockflow_economic_expectations e
 join lateral(select a.payload from private.stockflow_economic_audit a where a.action='approve_target' and a.entity_id=p_target and a.payload->>'decision'='approved' order by a.recorded_at desc,a.id desc limit 1) original on original.payload->>'approvalExpectationId'=e.id::text
 where e.target_id=p_target
$$;
revoke all on function private.stockflow_economic_approved_expectation(uuid) from public,anon,authenticated;
create function private.stockflow_economic_investment_review(p_target uuid,p_capital numeric) returns jsonb
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
 elsif not private.stockflow_economic_billing_current(p_target) or not private.stockflow_economic_acquisition_current(p_target) or baseline.id is null then status:='evidence_incomplete';
 elsif exposure=0 then status:='not_applicable';payback:=0;
 elsif baseline.monthly_gp_paise<=0 then status:='positive_gp_required';
 else
  payback:=exposure/baseline.monthly_gp_paise;
  status:=case when payback>policy.exception_months then 'limit_exceeded' when payback>policy.review_months then 'review_required' else 'within_limit' end;
 end if;
 return jsonb_build_object('status',status,'expectedPaybackMonths',round(payback,2),'netInvestmentPaise',exposure::text,'expectationId',baseline.id,'expectedMonthlyGpPaise',baseline.monthly_gp_paise::text,'policyId',policy.id,'reviewMonths',policy.review_months,'exceptionMonths',policy.exception_months,'approvedNetInvestmentPaise',approval_basis->>'approvedNetInvestmentPaise','approvedPaybackMonths',approval_basis->'expectedPaybackMonths','approvedDirectorException',coalesce((approval_basis->>'directorException')::boolean,false));
end$$;
revoke all on function private.stockflow_economic_investment_review(uuid,numeric) from public,anon,authenticated;
-- One calculation serves the proposal screen and the locked approval command.
-- This is the baseline effective at placement start, not the reporting-month baseline.
create function private.stockflow_economic_approval_preview(p_target uuid) returns jsonb
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
 elsif baseline.id is null then status:='missing_baseline';
 elsif investment>0 and baseline.monthly_gp_paise<=0 then status:='positive_gp_required';
 else
  payback:=case when investment>0 then investment/baseline.monthly_gp_paise else 0 end;
  status:=case when payback>policy.exception_months then 'limit_exceeded' when payback>policy.review_months then 'director_exception_required' else 'within_limit' end;
 end if;
 return jsonb_build_object('status',status,'capitalPaise',capital::text,'instrumentBillingPaise',billing::text,'netInvestmentPaise',investment::text,'expectedMonthlyGpPaise',baseline.monthly_gp_paise::text,'expectedPaybackMonths',payback,'expectationId',baseline.id,'expectationEffectiveFrom',baseline.effective_from,'policyId',policy.id,'reviewMonths',policy.review_months,'exceptionMonths',policy.exception_months);
end$$;
revoke all on function private.stockflow_economic_approval_preview(uuid) from public,anon,authenticated;
create function private.stockflow_economic_workspace(p_roles text[]) returns jsonb language plpgsql stable
set search_path=pg_catalog,private,public as $$
declare result jsonb; run uuid; period_from date:=(date_trunc('month',private.stockflow_economic_business_date())-interval '1 month')::date;period_to date:=date_trunc('month',private.stockflow_economic_business_date())::date;policy private.stockflow_economic_policy_versions%rowtype;
begin
 select id into run from private.stockflow_economic_runs where active;
 select * into policy from private.stockflow_economic_policy_versions order by recorded_at desc,id desc limit 1;
 with facts as(
  select t.*,c.name customer_name,
   coalesce((select sum(e.amount_paise) from private.stockflow_economic_events e where e.kind='capital' and (e.target_id=t.id or (t.kind='group' and e.target_id in(select placement_id from private.stockflow_economic_group_members gm where gm.group_id=t.id and gm.effective_from<=private.stockflow_economic_business_date())))),0) capital,
   coalesce((select sum(e.amount_paise) from private.stockflow_economic_events e where e.kind<>'capital' and (e.target_id=t.id or (t.kind='group' and e.target_id in(select placement_id from private.stockflow_economic_group_members gm where gm.group_id=t.id and gm.effective_from<=private.stockflow_economic_business_date() and coalesce((select r.recovery_origin_date from private.stockflow_economic_results r where r.id=coalesce(e.source_result_id,(select parent.source_result_id from private.stockflow_economic_events parent where parent.id=e.reverses_id))),e.effective_date)<gm.effective_from)))),0) recovery,
   (select gm.group_id from private.stockflow_economic_group_members gm join private.stockflow_economic_targets g on g.id=gm.group_id where gm.placement_id=t.id and g.approval='approved' and gm.effective_from<=private.stockflow_economic_business_date() order by gm.effective_from desc limit 1) pooled_in,
   coalesce((select sum(r.revenue_paise) from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and r.status<>'instrument_billing' and private.stockflow_economic_result_owned(r.id,t.id) and v.business_date>=period_from and v.business_date<period_to),0) revenue,
   coalesce((select sum(r.gp_paise) from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and r.status<>'instrument_billing' and private.stockflow_economic_result_owned(r.id,t.id) and v.business_date>=period_from and v.business_date<period_to),0) gp,
   (select count(*) from private.stockflow_economic_results r where r.run_id=run and r.status<>'instrument_billing' and private.stockflow_economic_result_owned(r.id,t.id) and r.cost_paise is null) missing_cost,
   (select count(*) from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and r.status<>'instrument_billing' and private.stockflow_economic_result_owned(r.id,t.id) and v.business_date>=period_from and v.business_date<period_to) lines
  from private.stockflow_economic_targets t join private.stockflow_customers c on c.id=t.customer_id
 ), enriched as(
  select f.*,ex.id expectation_id,ex.effective_from expectation_from,ex.monthly_revenue_paise,ex.monthly_gp_paise,ex.reason expectation_reason,
   private.stockflow_economic_covered(f.company_id,least(f.effective_from,coalesce((select min(p.effective_from) from private.stockflow_economic_group_members gm join private.stockflow_economic_targets p on p.id=gm.placement_id where gm.group_id=f.id),f.effective_from)),least(period_to,coalesce(f.effective_to,period_to)),run) covered,
   coalesce((select sum(e.amount_paise)::numeric/policy.forecast_window_months from private.stockflow_economic_events e where (e.target_id=f.id or private.stockflow_economic_result_owned(coalesce(e.source_result_id,(select parent.source_result_id from private.stockflow_economic_events parent where parent.id=e.reverses_id)),f.id)) and (e.kind='gp' or (e.kind='reversal' and exists(select 1 from private.stockflow_economic_events original_event where original_event.id=e.reverses_id and original_event.kind='gp'))) and e.effective_date>=period_to-make_interval(months=>policy.forecast_window_months) and e.effective_date<period_to),0) trailing_gp,
   exists(select 1 from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and r.status not in ('verified','excluded','instrument_billing') and v.company_id=f.company_id and v.customer_source_id=f.customer_source_id) has_unattributed
  from facts f left join lateral(select * from private.stockflow_economic_expectations e where e.target_id=f.id and e.effective_from<=period_from order by effective_from desc,recorded_at desc limit 1) ex on true
 ), reviewed as(select enriched.*,case when pooled_in is null then private.stockflow_economic_investment_review(id,capital) else null end investment_review from enriched)
 , forecast_ready as(select reviewed.*,(pooled_in is null and private.stockflow_economic_billing_current(id) and private.stockflow_economic_acquisition_current(id) and approval='approved' and effective_from<=private.stockflow_economic_business_date() and (effective_to is null or effective_to>private.stockflow_economic_business_date()) and covered and not has_unattributed and missing_cost=0 and capital>0 and effective_from<=period_to-make_interval(months=>policy.forecast_window_months) and exists(select 1 from private.stockflow_economic_source_coverage cov where cov.company_id=reviewed.company_id and cov.window_from<=period_to-make_interval(months=>policy.forecast_window_months) and cov.window_to>=period_to)) actual_forecast_ready from reviewed),
 projected as(select forecast_ready.*,case when actual_forecast_ready and trailing_gp>0 then greatest(0,capital-recovery)/trailing_gp else null end actual_forecast,
 case when not coalesce(actual_forecast_ready,false) then 'not_available' when trailing_gp<=0 then case when capital-recovery>0 then 'non_positive_gp' else 'not_available' end when greatest(0,capital-recovery)/trailing_gp>policy.exception_months then 'limit_exceeded' when greatest(0,capital-recovery)/trailing_gp>policy.review_months then 'review_required' else 'within_limit' end forecast_status from forecast_ready)
 select jsonb_build_object('targets',coalesce(jsonb_agg(jsonb_build_object(
  'id',id,'kind',kind,'name',name,'companyId',company_id,'customerId',customer_id,'customerName',customer_name,'customerSourceId',customer_source_id,'siteId',site_id,'modelId',model_id,
  'installationId',installation_id,'effectiveFrom',effective_from,'effectiveTo',effective_to,'approval',approval,'version',version,'pooledIn',pooled_in,
   'capitalPaise',capital::text,'instrumentBillingPaise',private.stockflow_economic_billed_recovery(id)::text,'netInvestmentPaise',greatest(0,capital-private.stockflow_economic_billed_recovery(id))::text,'instrumentBillingCurrent',private.stockflow_economic_billing_current(id),'acquisitionProductId',(select l.product_id from private.stockflow_economic_acquisition_links a join private.stockflow_economic_source_lines l on l.id=a.purchase_line_id where a.target_id=enriched.id),'acquisitionUnit',(select l.unit from private.stockflow_economic_acquisition_links a join private.stockflow_economic_source_lines l on l.id=a.purchase_line_id where a.target_id=enriched.id),'capitalSource',case when exists(select 1 from private.stockflow_economic_acquisition_links a where a.target_id=enriched.id) then 'tally_purchase' when kind='group' then 'pooled_capital' else 'manual_evidence' end,'capitalEvidenceCurrent',private.stockflow_economic_acquisition_current(id),'revenuePaise',revenue::text,'knownGpPaise',gp::text,'missingCostLines',missing_cost,'attributedLines',lines,'recoveryPaise',recovery::text,'outstandingPaise',greatest(0,capital-recovery)::text,
  'health',case when approval='proposed' then 'proposed' when approval='rejected' or effective_to<=private.stockflow_economic_business_date() then 'inactive' when not private.stockflow_economic_billing_current(id) or not private.stockflow_economic_acquisition_current(id) or run is null or not covered or missing_cost>0 or has_unattributed or expectation_id is null or investment_review->>'status'='evidence_incomplete' then 'data_incomplete' when forecast_status in ('limit_exceeded','non_positive_gp') or investment_review->>'status' in ('limit_exceeded','positive_gp_required') or gp<0 or revenue*100<monthly_revenue_paise*policy.critical_revenue_percent then 'critical' when forecast_status='review_required' or investment_review->>'status'='review_required' or revenue*100<monthly_revenue_paise*policy.watch_revenue_percent then 'watch' else 'healthy' end,
  'itemBreakdown',coalesce((select jsonb_agg(jsonb_build_object(
   'productId',items.product_id,'productName',items.product_name,'unit',items.unit,'quantity',items.quantity::text,
   'revenuePaise',items.revenue::text,'knownCostPaise',items.known_cost::text,'knownGpPaise',items.known_gp::text,
   'sourceLines',items.source_lines,'missingCostLines',items.missing_cost_lines) order by items.product_name,items.product_id,items.unit)
   from (select l.product_id,l.unit,
    (array_agg(coalesce(l.evidence->>'label',l.product_id) order by v.business_date desc,v.source_revision desc,r.id))[1] product_name,
    sum(r.quantity) quantity,sum(r.revenue_paise) revenue,sum(r.cost_paise) known_cost,sum(r.gp_paise) known_gp,
    count(*) source_lines,count(*) filter(where r.cost_paise is null) missing_cost_lines
    from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id
    join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
    where r.run_id=run and r.status<>'instrument_billing' and private.stockflow_economic_result_owned(r.id,enriched.id)
    and v.business_date>=period_from and v.business_date<period_to
    group by l.product_id,l.unit) items),'[]'::jsonb),
  'investmentReview',investment_review,
  'approvalPreview',case when approval='proposed' then private.stockflow_economic_approval_preview(id) else null end,
  'forecastMonths',round(actual_forecast,1),'forecastReview',case when pooled_in is null then jsonb_build_object('status',forecast_status,'policyId',policy.id,'reviewMonths',policy.review_months,'exceptionMonths',policy.exception_months) else null end,
  'expectation',case when expectation_id is null then null else jsonb_build_object('id',expectation_id,'monthlyRevenuePaise',monthly_revenue_paise::text,'monthlyGpPaise',monthly_gp_paise::text,'effectiveFrom',expectation_from,'reason',expectation_reason) end
 ) order by name),'[]'::jsonb)) into result from projected enriched;
 return result||jsonb_build_object(
  'canManage',p_roles&&array['administrator','management'],'canApprove',p_roles&&array['administrator','management'],'canAct',p_roles&&array['administrator','management'],
  'businessDate',private.stockflow_economic_business_date(),'businessTimezone','Asia/Kolkata','reportingFrom',period_from,'reportingTo',period_to,'generation',run,'lastRebuiltAt',(select created_at from private.stockflow_economic_runs where id=run),
  'sourceImportedAt',(select max(imported_at) from private.stockflow_economic_source_vouchers),
  'sourceLineCount',(select count(distinct source_line_id) from private.stockflow_economic_results where run_id=run),
  'unattributedPaise',coalesce((select sum(r.revenue_paise)::text from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and r.status='unattributed' and v.business_date>=period_from and v.business_date<period_to),'0'),
  'reportingSummary',(select jsonb_build_object('netSalesPaise',coalesce(sum(r.revenue_paise),0)::text,'attributedSalesPaise',coalesce(sum(r.revenue_paise) filter(where r.target_id is not null and r.status<>'instrument_billing'),0)::text,'unattributedSalesPaise',coalesce(sum(r.revenue_paise) filter(where r.status='unattributed'),0)::text,'instrumentBillingSalesPaise',coalesce(sum(r.revenue_paise) filter(where r.status='instrument_billing'),0)::text,'excludedSalesPaise',coalesce(sum(r.revenue_paise) filter(where r.status='excluded'),0)::text,'verifiedCostPaise',coalesce(sum(r.cost_paise),0)::text,'knownGpPaise',coalesce(sum(r.gp_paise),0)::text,'missingCostLines',count(*) filter(where r.target_id is not null and r.status<>'instrument_billing' and r.cost_paise is null),'missingCostSalesPaise',coalesce(sum(r.revenue_paise) filter(where r.target_id is not null and r.status<>'instrument_billing' and r.cost_paise is null),0)::text) from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and v.business_date>=period_from and v.business_date<period_to),
  'instrumentBillings',coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('billedRecoveryPaise',private.stockflow_economic_billed_recovery(b.target_id)::text,'current',private.stockflow_economic_billing_current(b.target_id))) from private.stockflow_economic_instrument_billings b),'[]'::jsonb),
  'acquisitionLinks',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('current',private.stockflow_economic_acquisition_current(a.target_id))) from private.stockflow_economic_acquisition_links a),'[]'::jsonb),
  'acquisitionReviews',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('amount_paise',r.amount_paise::text,'previous_amount_paise',r.previous_amount_paise::text) order by r.recorded_at desc,r.id desc) from private.stockflow_economic_acquisition_reviews r),'[]'::jsonb),
  'acquisitionReviewItems',coalesce((select jsonb_agg(jsonb_build_object('targetId',a.target_id,'targetName',t.name,'expectedVersion',t.version,'voucherId',v.source_id,'expectedSourceRevision',v.source_revision::text,'changed',v.id<>coalesce(review.voucher_id,old.voucher_id),'cancelled',v.cancelled,'previousAmountPaise',coalesce(review.amount_paise,old.net_sales_paise)::text,'proposedAmountPaise',proposed.amount::text,'capitalDeltaPaise',(proposed.amount-coalesce(review.amount_paise,old.net_sales_paise))::text,'productId',old.product_id,'lineKey',old.line_key) order by t.name)
   from private.stockflow_economic_acquisition_links a join private.stockflow_economic_targets t on t.id=a.target_id join private.stockflow_economic_source_lines old on old.id=a.purchase_line_id
   join lateral(select * from private.stockflow_economic_source_vouchers s where s.company_id=a.company_id and s.source_id=a.source_id order by s.source_revision desc limit 1) v on true
   left join lateral(select * from private.stockflow_economic_acquisition_reviews r where r.target_id=a.target_id order by r.revision desc limit 1) review on true
   left join private.stockflow_economic_source_lines revised on revised.voucher_id=v.id and revised.line_key=a.line_key
   cross join lateral(select case when v.cancelled then 0 when v.kind='purchase' and revised.product_id=old.product_id and revised.unit=old.unit and revised.quantity=1 and revised.net_sales_paise>0 and v.business_date<=t.effective_from then revised.net_sales_paise else null end amount) proposed),'[]'::jsonb),
  'itemGroupCatalogs',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'companyId',c.company_id,'sourceVersion',c.source_version,'observedAt',c.observed_at,'current',private.stockflow_economic_item_catalog_current(c.company_id),'products',c.content->'products','groups',(select jsonb_agg(g||jsonb_build_object('itemCount',(select count(*) from private.stockflow_economic_group_products(c.content,g->>'id'))) order by g->>'name',g->>'id') from jsonb_array_elements(c.content->'groups') g))) from (select distinct on (company_id) * from private.stockflow_economic_item_catalogs order by company_id,observed_at desc,id desc) c),'[]'::jsonb),
  'itemGroupMappings',coalesce((select jsonb_agg(jsonb_build_object('id',id,'companyId',company_id,'modelId',model_id,'groupId',group_id,'targetId',target_id,'effect',effect,'effectiveFrom',effective_from,'effectiveTo',effective_to,'catalogId',catalog_id,'reason',reason) order by recorded_at desc,id desc) from private.stockflow_economic_item_group_mappings),'[]'::jsonb),
  'groupMemberships',coalesce((select jsonb_agg(jsonb_build_object('id',id,'groupId',group_id,'placementId',placement_id,'effectiveFrom',effective_from,'effectiveTo',effective_to)) from private.stockflow_economic_group_members),'[]'::jsonb),
  'allocations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'companyId',company_id,'customerSourceId',customer_source_id,'siteId',site_id,'productId',product_id,'effectiveFrom',effective_from,'effectiveTo',effective_to,'reason',reason,'shares',shares)) from private.stockflow_economic_allocations),'[]'::jsonb),
  'observations',coalesce((select jsonb_agg(to_jsonb(o)) from private.stockflow_economic_consumption_observations o),'[]'::jsonb),
  'attributionLines',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'sourceLineId',r.source_line_id,'targetId',r.target_id,'status',r.status,'reason',r.reason,'shareBasisPoints',r.share_bps,'quantity',r.quantity::text,'revenuePaise',r.revenue_paise::text,'costPaise',r.cost_paise::text,'gpPaise',r.gp_paise::text,'date',v.business_date,'voucherId',v.source_id,'revision',v.source_revision::text,'productId',l.product_id,'productName',coalesce(l.evidence->>'label',l.product_id),'unit',l.unit,'costEvidence',case when v.kind in ('return','credit') then 'Inherited original-sale attribution and cost; adjustment review retained' else (select cv.evidence_reference||' · policy '||cv.policy_version||' · '||coalesce((select string_agg(pv.source_id||' rev '||pv.source_revision::text||' / line '||pl.line_key, '; ' order by pv.source_id,pl.line_key) from private.stockflow_economic_cost_links cl join private.stockflow_economic_source_lines pl on pl.id=cl.purchase_line_id join private.stockflow_economic_source_vouchers pv on pv.id=pl.voucher_id where cl.verification_id=cv.id),'No purchase links') from private.stockflow_economic_cost_verifications cv where cv.sale_line_id=l.id order by cv.revision desc limit 1) end)) from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run),'[]'::jsonb),
  'sourceLines',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'companyId',v.company_id,'voucherId',v.source_id,'revision',v.source_revision::text,'lineKey',l.line_key,'date',v.business_date,'kind',v.kind,'customerSourceId',v.customer_source_id,'productId',l.product_id,'productName',coalesce(l.evidence->>'label',l.product_id),'quantity',l.quantity::text,'unit',l.unit,'netSalesPaise',l.net_sales_paise::text,'batchId',l.batch_id)) from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where not v.cancelled and not exists(select 1 from private.stockflow_economic_source_vouchers n where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)),'[]'::jsonb),
  'sourceDocumentExclusionCount',(select count(*) from private.stockflow_economic_source_vouchers v where v.kind='non_economic' and not exists(select 1 from private.stockflow_economic_source_vouchers n where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)),
  'sourceDocumentExclusions',coalesce((select jsonb_agg(jsonb_build_object('sourceId',v.source_id,'revision',v.source_revision::text,'date',v.business_date,'voucherType',v.evidence->>'voucherType','reason',v.evidence->>'exclusionReason','cancelled',v.cancelled) order by v.business_date desc,v.source_id) from (select v.* from private.stockflow_economic_source_vouchers v where v.kind='non_economic' and not exists(select 1 from private.stockflow_economic_source_vouchers n where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision) order by v.business_date desc,v.source_id limit 100) v),'[]'::jsonb),
  'ledger',coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('amount_paise',e.amount_paise::text)) from (select * from private.stockflow_economic_events order by recorded_at desc,id desc limit 500) e),'[]'::jsonb),
  'expectationHistory',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'targetId',e.target_id,'effectiveFrom',e.effective_from,'monthlyRevenuePaise',e.monthly_revenue_paise::text,'monthlyGpPaise',e.monthly_gp_paise::text,'reason',e.reason,'actor',e.created_by,'recordedAt',e.recorded_at,'items',(select jsonb_agg(to_jsonb(i)||jsonb_build_object('expected_unit_price_paise',i.expected_unit_price_paise::text,'expected_unit_cost_paise',i.expected_unit_cost_paise::text)) from private.stockflow_economic_expectation_items i where i.expectation_id=e.id))) from private.stockflow_economic_expectations e),'[]'::jsonb),
  'policy',jsonb_build_object('attractiveMonths',policy.attractive_months,'reviewMonths',policy.review_months,'exceptionMonths',policy.exception_months,'forecastWindowMonths',policy.forecast_window_months,'watchRevenuePercent',policy.watch_revenue_percent,'criticalRevenuePercent',policy.critical_revenue_percent),
  'customers',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from private.stockflow_customers where active),'[]'::jsonb),
  'installations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.item_name,'serialNumber',i.serial_number,'customerName',o.customer_name) order by i.completed_at desc) from private.stockflow_equipment_installations i join private.stockflow_orders o on o.id=i.order_id where i.status='completed'),'[]'::jsonb),
  'mappings',coalesce((select jsonb_agg(jsonb_build_object('id',id,'companyId',company_id,'modelId',model_id,'productId',product_id,'targetId',target_id,'effect',effect,'effectiveFrom',effective_from,'effectiveTo',effective_to,'reason',reason) order by recorded_at desc) from private.stockflow_economic_mappings),'[]'::jsonb),
  'exceptions',coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('sourceId',v.source_id||':'||l.line_key,'sourceLineId',l.id,'productId',l.product_id,'date',v.business_date,'netSalesPaise',sum(r.revenue_paise)::text,'status',r.status,'reason',r.reason) x
    from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and r.status not in ('verified','instrument_billing') group by v.source_id,l.id,v.business_date,r.status,r.reason
    union all select jsonb_build_object('sourceId',coalesce(source_id,'import'),'productId','','date',private.stockflow_economic_business_date(recorded_at),'netSalesPaise','0','status','import_rejected','reason',reason) from private.stockflow_economic_import_exceptions
   ) errors),'[]'::jsonb),
  'leakage',private.stockflow_economic_leakage(run,period_from,period_to),
  'caseHistory',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'caseId',coalesce(cl.case_id,a.entity_id),'action',a.action,'actor',a.actor,'recordedAt',a.recorded_at,'payload',a.payload) order by a.recorded_at desc,a.id desc) from (select * from private.stockflow_economic_audit where action in ('create_case','update_case','claim_recovery') order by recorded_at desc,id desc limit 200) a left join private.stockflow_leakage_recovery_claims cl on a.action='claim_recovery' and cl.id=a.entity_id),'[]'::jsonb),
  'caseHistoryTruncated',(select count(*)>200 from private.stockflow_economic_audit where action in ('create_case','update_case','claim_recovery')),
  'cases',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'targetId',c.target_id,'title',c.title,'evaluation',c.evaluation,'reason',c.reason,'primaryReason',c.primary_reason,'reasonCodes',c.reason_codes,'confidence',c.confidence,'evidenceReference',c.evidence_reference,'status',c.status,'owner',c.owner,'dueDate',c.due_date,'action',c.action,'outcome',c.outcome,'version',c.version,'potentialRevenuePaise',c.potential_revenue_paise::text,'potentialGpPaise',c.potential_gp_paise::text,
    'recoveredRevenuePaise',(private.stockflow_economic_case_recovery(c.id,run)->>'revenuePaise'),
    'recoveredGpPaise',(private.stockflow_economic_case_recovery(c.id,run)->>'gpPaise'),
    'recoveryReviewRequired',c.status in ('recovered','partially_recovered') and coalesce((private.stockflow_economic_case_recovery(c.id,run)->>'revenuePaise')::numeric,0)<=0
  ) order by c.created_at desc) from private.stockflow_leakage_cases c),'[]'::jsonb)
 );
end$$;
-- Claims are annotations on economic sources, never extra GP postings. Resolve
-- the latest source revision and linked adjustments on every read.
create function private.stockflow_economic_case_recovery(p_case uuid,p_run uuid) returns jsonb language sql stable set search_path=pg_catalog,private as $$
 with claims as(select cl.*,c.target_id,l.line_key,l.product_id,l.unit,v.company_id,v.source_id from private.stockflow_leakage_recovery_claims cl join private.stockflow_leakage_cases c on c.id=cl.case_id join private.stockflow_economic_source_lines l on l.id=cl.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where cl.case_id=p_case),
 amounts as(select cl.share_bps,r.revenue_paise,r.gp_paise from claims cl join private.stockflow_economic_source_vouchers v on v.company_id=cl.company_id
 join private.stockflow_economic_source_lines l on l.voucher_id=v.id
 left join lateral(select * from private.stockflow_economic_line_reviews d where d.source_line_id=l.id order by recorded_at desc,id desc limit 1) review on true
 left join private.stockflow_economic_source_lines ol on ol.id=review.original_sale_line_id left join private.stockflow_economic_source_vouchers ov on ov.id=ol.voucher_id
 join private.stockflow_economic_results r on r.run_id=p_run and r.source_line_id=l.id and r.target_id=cl.target_id
 where not v.cancelled and l.product_id=cl.product_id and l.unit=cl.unit and
 ((v.kind='sale' and v.source_id=cl.source_id and l.line_key=cl.line_key) or (v.kind in ('return','credit') and coalesce(ov.source_id,l.original_voucher_id)=cl.source_id and coalesce(ol.line_key,l.original_line_key)=cl.line_key)))
 select jsonb_build_object('revenuePaise',coalesce(sum(trunc(revenue_paise::numeric*share_bps/10000)),0)::text,'gpPaise',case when count(*) filter(where gp_paise is null)>0 then null else coalesce(sum(trunc(gp_paise::numeric*share_bps/10000)),0)::text end) from amounts
$$;
-- Definition precedes the first execution of the workspace function.
create function private.stockflow_economic_leakage(p_run uuid,p_from date,p_to date) returns jsonb language sql stable
set search_path=pg_catalog,private as $$
 with versions as(select distinct on(target_id,effective_from) * from private.stockflow_economic_expectations where effective_from<p_to order by target_id,effective_from,recorded_at desc,id desc),
 dated as(select *,lead(effective_from) over(partition by target_id order by effective_from) next_from from versions),
 expectations as(select *,greatest(p_from,effective_from) segment_from,least(p_to,coalesce(next_from,p_to)) segment_to from dated where coalesce(next_from,p_to)>p_from),
 observations as(select e.*,i.product_id,i.base_unit,i.expected_monthly_units,i.expected_unit_price_paise,i.expected_unit_cost_paise,t.effective_from target_from,t.effective_to target_to,
  wo.id observation_id,wo.test_count,wo.tests_per_unit,wo.qc_units,wo.opening_stock,wo.closing_stock,wo.net_transfers,wo.external_supply,wo.evidence_reference,
  totals.actual,totals.actual_revenue,totals.actual_gp,
  exists(select 1 from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=p_run and r.status<>'instrument_billing' and private.stockflow_economic_result_owned(r.id,e.target_id) and l.product_id=i.product_id and l.unit is distinct from i.base_unit and v.business_date>=p_from and v.business_date<p_to) unit_mismatch,
  exists(select 1 from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=p_run and r.status='unattributed' and r.target_id is null and v.company_id=t.company_id and v.customer_source_id=t.customer_source_id and l.product_id=i.product_id and v.business_date>=e.segment_from and v.business_date<e.segment_to) attribution_uncertain,
  private.stockflow_economic_covered(t.company_id,p_from,p_to,p_run) covered
  from expectations e join private.stockflow_economic_expectation_items i on i.expectation_id=e.id join private.stockflow_economic_targets t on t.id=e.target_id
  left join lateral(select * from private.stockflow_economic_consumption_observations o where o.target_id=e.target_id and o.product_id=i.product_id and o.base_unit=i.base_unit and o.window_from=e.segment_from and o.window_to=e.segment_to order by revision desc limit 1) wo on true
  left join lateral(select coalesce(sum(r.quantity),0) actual,coalesce(sum(r.revenue_paise),0) actual_revenue,
   case when count(*) filter(where r.cost_paise is null)=0 then coalesce(sum(r.gp_paise),0) else null end actual_gp
   from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
   where r.run_id=p_run and r.status<>'instrument_billing' and private.stockflow_economic_result_owned(r.id,e.target_id) and l.product_id=i.product_id and l.unit=i.base_unit and v.business_date>=e.segment_from and v.business_date<e.segment_to) totals on true
  where t.approval='approved' and t.effective_from<e.segment_to and (t.effective_to is null or t.effective_to>e.segment_from)
  and not exists(select 1 from private.stockflow_economic_group_members gm join private.stockflow_economic_targets g on g.id=gm.group_id where gm.placement_id=t.id and g.approval='approved' and gm.effective_from<e.segment_to and (gm.effective_to is null or gm.effective_to>e.segment_from))
 ), gaps as(select *,round(case when observation_id is not null then greatest(0,test_count/tests_per_unit+qc_units+coalesce(closing_stock-opening_stock,0)-net_transfers) else expected_monthly_units*greatest(0,least(segment_to,coalesce(target_to,segment_to))-greatest(segment_from,target_from))::numeric/((date_trunc('month',segment_from)+interval '1 month')::date-date_trunc('month',segment_from)::date) end,6) expected,covered and not attribution_uncertain and not unit_mismatch and base_unit is not null and (opening_stock is null or opening_stock+actual+external_supply+net_transfers-closing_stock>=0) economic_evidence_complete from observations)
 select coalesce(jsonb_agg(jsonb_build_object('targetId',target_id,'expectationId',id,'generationId',p_run,'productId',product_id,'windowFrom',segment_from,'windowTo',segment_to,'expectedUnits',expected::text,'actualUnits',actual::text,'shortfallUnits',greatest(0,expected-actual)::text,
  'potentialRevenuePaise',case when not economic_evidence_complete or expected_unit_price_paise is null or unit_mismatch or base_unit is null then null else round(greatest(0,expected-actual)*expected_unit_price_paise)::bigint::text end,
  'potentialGpPaise',case when not economic_evidence_complete or expected_unit_cost_paise is null or expected_unit_price_paise is null or unit_mismatch or base_unit is null then null else round(greatest(0,expected-actual)*(expected_unit_price_paise-expected_unit_cost_paise))::bigint::text end,
  'expectedRevenuePaise',case when economic_evidence_complete and expected_unit_price_paise is not null then round(expected*expected_unit_price_paise)::bigint::text else null end,
  'actualRevenuePaise',case when economic_evidence_complete then actual_revenue::bigint::text else null end,
  'expectedGpPaise',case when economic_evidence_complete and expected_unit_price_paise is not null and expected_unit_cost_paise is not null then round(expected*(expected_unit_price_paise-expected_unit_cost_paise))::bigint::text else null end,
  'actualGpPaise',case when economic_evidence_complete then actual_gp::bigint::text else null end,
  'revenueVariancePaise',case when economic_evidence_complete and expected_unit_price_paise is not null then (actual_revenue-round(expected*expected_unit_price_paise))::bigint::text else null end,
  'gpVariancePaise',case when economic_evidence_complete and expected_unit_price_paise is not null and expected_unit_cost_paise is not null then (actual_gp-round(expected*(expected_unit_price_paise-expected_unit_cost_paise)))::bigint::text else null end,
  'financialVarianceStatus',case when not economic_evidence_complete then 'data_review_required' when actual_gp is null then 'missing_cost' when expected_unit_price_paise is null or expected_unit_cost_paise is null then 'baseline_incomplete' else 'verified' end,
  'attributionComplete',not attribution_uncertain,'evidenceTier',case when observation_id is null then 'supply_proxy' when opening_stock is null then 'observed_test_workload' else 'inventory_reconciled' end,
  'observationId',observation_id,'evidenceReference',evidence_reference,'externalSupplyUnits',external_supply::text,
  'actualConsumptionUnits',case when opening_stock is null or not covered then null else (opening_stock+actual+external_supply+net_transfers-closing_stock)::text end,
  'status',case when not covered or attribution_uncertain or unit_mismatch or base_unit is null or (opening_stock is not null and opening_stock+actual+external_supply+net_transfers-closing_stock<0) then 'data_review_required' else 'potential_shortfall' end)),'[]'::jsonb) from gaps
$$;
revoke all on function private.stockflow_economic_billed_recovery(uuid),private.stockflow_economic_billing_current(uuid),private.stockflow_economic_acquisition_current(uuid),private.stockflow_economic_workspace(text[]),private.stockflow_economic_case_recovery(uuid,uuid),private.stockflow_economic_leakage(uuid,date,date),private.stockflow_economic_covered(text,date,date,uuid) from public,anon,authenticated;
commit;
