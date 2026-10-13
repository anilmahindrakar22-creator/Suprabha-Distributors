begin;

-- D-15 (owner, 13 Oct 2026): automatically approve placements only (not groups),
-- when open and proposed, with a within_limit preview, positive net investment, and expected
-- payback within the same preview policy's attractive_months (24).
-- Four triggering actions: set_expectation, record_capital, review_acquisition,
-- and link_instrument_billing; never from rebuild.
-- Manual approval is unchanged: 25–36 months Management, 37–48 Administrator
-- (D-04), > 48 blocked. No existing proposals are approved by this migration.
-- automatic_approval is a switch (latest non-null value, default on), with no UI yet; turning it off restores manual-only approval.
alter table private.stockflow_economic_policy_versions add column automatic_approval boolean;

create function private.stockflow_economic_try_auto_approve(p_target uuid,p_actor text,p_trigger text)
returns jsonb language plpgsql set search_path=pg_catalog,private,public,extensions as $$
declare
 target private.stockflow_economic_targets%rowtype;
 policy private.stockflow_economic_policy_versions%rowtype;
 item jsonb;
begin
 select * into target from private.stockflow_economic_targets where id=p_target for update;
 if not found or target.kind<>'placement' or target.approval<>'proposed' or target.effective_to is not null then return null;end if;
 if not coalesce((select pv.automatic_approval from private.stockflow_economic_policy_versions pv where pv.automatic_approval is not null order by pv.recorded_at desc,pv.id desc limit 1),true) then return null;end if;
 item:=private.stockflow_economic_approval_preview(p_target);
 if (item->>'status'='within_limit' and (item->>'netInvestmentPaise')::numeric>0) is not true then return null;end if;
 select * into policy from private.stockflow_economic_policy_versions where id=(item->>'policyId')::uuid;
 if not found then return null;end if;
 if ((item->>'expectedPaybackMonths')::numeric<=policy.attractive_months) is not true then return null;end if;
 update private.stockflow_economic_targets set approval='approved',version=version+1 where id=p_target;
 insert into private.stockflow_economic_audit(action,entity_id,actor,payload) values('approve_target',p_target,p_actor,
  jsonb_build_object('decision','approved','automatic',true,'triggeredBy',p_trigger,'targetId',p_target,'reason','Automatic: payback '||round((item->>'expectedPaybackMonths')::numeric,1)||' months within the '||policy.attractive_months||'-month limit','approvalExpectationId',item->'expectationId','approvalPolicyId',item->'policyId','approvedNetInvestmentPaise',item->'netInvestmentPaise','expectedPaybackMonths',item->'expectedPaybackMonths','approvalPreview',item));
 return jsonb_build_object('targetId',p_target,'paybackMonths',item->'expectedPaybackMonths','policyId',item->'policyId','attractiveMonths',policy.attractive_months);
end$$;
revoke all on function private.stockflow_economic_try_auto_approve(uuid,text,text) from public,anon,authenticated,service_role;

do $upgrade$
declare definition text;anchor text;
begin
 definition:=replace(pg_get_functiondef('public.stockflow_economics_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
 -- Confirm the existing variables and target-loading block before using them.
 if position('item jsonb;' in definition)=0
  or position('target private.stockflow_economic_targets%rowtype;' in definition)=0
  or position(($seam$if p_action in ('set_item_group_mapping','set_expectation','record_observation','approve_target','link_instrument_billing','review_acquisition','record_capital','set_group_$seam$||$seam$members','close_target','create_case') then
  select * into target from private.stockflow_economic_targets where id=(p_payload->>'targetId')::uuid for update;$seam$) in definition)=0
 then raise exception 'Unexpected economics gateway auto-approval seam';end if;
 anchor:=$seam$if p_action not in ('create_case','update_case','claim_recovery') then run:=private.stockflow_rebuild_instrument_economics(actor);end if;$seam$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Unexpected economics gateway auto-approval seam';end if;
 definition:=replace(definition,anchor,anchor||$seam$
 item:=null; if p_action in ('set_expectation','record_capital','review_acquisition','link_instrument_billing') then item:=private.stockflow_economic_try_auto_approve(target.id,actor,p_action); if item is not null then run:=private.stockflow_rebuild_instrument_economics(actor); end if; end if;$seam$);
 anchor:=$seam$result:=jsonb_build_object('ok',true,'entityId',entity,'generation',run);$seam$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Unexpected economics gateway auto-approval seam';end if;
 definition:=replace(definition,anchor,$seam$result:=jsonb_build_object('ok',true,'entityId',entity,'generation',run)||case when item is not null and p_action in ('set_expectation','record_capital','review_acquisition','link_instrument_billing') then jsonb_build_object('autoApproved',item) else '{}'::jsonb end;$seam$);
 execute definition;
end$upgrade$;
revoke all on function public.stockflow_economics_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_economics_gateway(text,text,text,jsonb) to service_role;
commit;
