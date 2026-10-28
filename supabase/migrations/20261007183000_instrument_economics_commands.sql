begin;
create function public.stockflow_economics_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare item_catalog private.stockflow_economic_item_catalogs%rowtype;acquisition_reason text;original_request jsonb:=p_payload;actor text:=lower(btrim(p_actor_email));roles text[];hash text;key text;replay jsonb;result jsonb;entity uuid;
 target private.stockflow_economic_targets%rowtype;current_case private.stockflow_leakage_cases%rowtype;policy private.stockflow_economic_policy_versions%rowtype;
 expectation private.stockflow_economic_expectations%rowtype;other private.stockflow_economic_targets%rowtype;
 acquisition private.stockflow_economic_acquisition_links%rowtype;source_voucher private.stockflow_economic_source_vouchers%rowtype;original_purchase private.stockflow_economic_source_lines%rowtype;current_purchase private.stockflow_economic_source_lines%rowtype;previous_amount bigint;review_revision integer;review_original uuid;
 item jsonb;shares jsonb;monthly_payback numeric;capital numeric;amount bigint;member uuid;count_ids integer;run uuid;verification uuid;sale record;purchase record;qty numeric;total_qty numeric;used_qty numeric;used_cost numeric;
begin
 select secret_sha256 into hash from private.stockflow_gateway_config where name='orders';
 if hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>hash then raise exception 'Unauthorized gateway' using errcode='42501';end if;
 roles:=private.stockflow_active_member_roles(actor);
 if not(roles&&array['administrator','management','accounts']) then raise exception 'Instrument economics access required' using errcode='42501';end if;
 if p_action='get_instrument_economics' then return private.stockflow_economic_workspace(roles);end if;
 if p_action='recover_economic_command' then
  key:=p_payload->>'commandKey';
  if coalesce(p_payload->>'commandAction','') not in ('create_target','set_mapping','set_item_group_mapping','set_expectation','record_observation','approve_target','link_instrument_billing','review_acquisition','record_capital','set_group_members','close_group_membership','set_allocation','close_allocation','close_target','set_policy','rebuild','create_case','update_case','claim_recovery','verify_cost','resolve_line') or key is null or key !~ '^[a-zA-Z0-9_-]{16,200}$' or jsonb_typeof(p_payload->'closeUnresolved') is distinct from 'boolean' then raise exception 'Invalid economic recovery reference' using errcode='22023';end if;
  if (p_payload->>'closeUnresolved')::boolean then
   if not(roles&&array['administrator','management']) then raise exception 'Management approval required' using errcode='42501';end if;
   -- Same order as original writers. If a write has committed, report it; otherwise fence late delivery.
   perform pg_advisory_xact_lock(hashtextextended('instrument-economics-v1',0));
   perform pg_advisory_xact_lock(hashtextextended(actor||':'||(p_payload->>'commandAction')||':'||key,0));
  end if;
  select request_hash into hash from private.stockflow_command_results where actor_email=actor and action=p_payload->>'commandAction' and idempotency_key=key;
  if found then return jsonb_build_object('status',case when hash='economic-closed-before-save' then 'not_saved' else 'accepted' end);end if;
  if not (p_payload->>'closeUnresolved')::boolean then return jsonb_build_object('status','unresolved');end if;
  entity:=extensions.gen_random_uuid();
  insert into private.stockflow_command_results(actor_email,action,idempotency_key,request_hash,aggregate_id,result) values(actor,p_payload->>'commandAction',key,'economic-closed-before-save',entity,'{"status":"not_saved"}');
  insert into private.stockflow_economic_audit(action,entity_id,actor,payload) values('close_unresolved_command',entity,actor,jsonb_build_object('commandAction',p_payload->>'commandAction','commandKey',key));
  return jsonb_build_object('status','not_saved');
 end if;
 if p_action not in ('create_target','set_mapping','set_item_group_mapping','set_expectation','record_observation','approve_target','link_instrument_billing','review_acquisition','record_capital','set_group_members','close_group_membership','set_allocation','close_allocation','close_target','set_policy','rebuild','create_case','update_case','claim_recovery','verify_cost','resolve_line') then raise exception 'Unsupported economic action' using errcode='22023';end if;
 if not(roles&&array['administrator','management']) then raise exception 'Management approval required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('instrument-economics-v1',0));
 key:=p_payload->>'idempotencyKey';replay:=private.begin_stockflow_command(actor,p_action,key,p_payload);if replay is not null then return replay;end if;
 if p_action in ('set_item_group_mapping','set_expectation','record_observation','approve_target','link_instrument_billing','review_acquisition','record_capital','set_group_members','close_target','create_case') then
  select * into target from private.stockflow_economic_targets where id=(p_payload->>'targetId')::uuid for update;
  if not found then raise exception 'Economic target not found' using errcode='22023';end if;
  entity:=target.id;
 end if;
 if p_action in ('approve_target','link_instrument_billing','review_acquisition','close_target') and target.version is distinct from (p_payload->>'expectedVersion')::integer then raise exception 'Placement changed; refresh before retrying' using errcode='PT409';end if;
 if p_action='create_target' then
  if nullif(p_payload->>'customerSourceId','') is null or nullif(p_payload->>'companyId','') is null or nullif(p_payload->>'siteId','') is null or nullif(p_payload->>'modelId','') is null then raise exception 'Canonical company/customer, site and model IDs required' using errcode='22023';end if;
  if p_payload->>'kind'='placement' and not exists(select 1 from private.stockflow_equipment_installations where id=nullif(p_payload->>'installationId','')::uuid and status='completed') then raise exception 'Completed installation required' using errcode='22023';end if;
  if p_payload->>'kind'='placement' and not exists(select 1 from private.stockflow_equipment_installations i join private.stockflow_orders o on o.id=i.order_id where i.id=(p_payload->>'installationId')::uuid and o.customer_id=(p_payload->>'customerId')::uuid) then raise exception 'Installation customer does not match the selected canonical customer' using errcode='22023';end if;
  insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
  values(btrim(p_payload->>'companyId'),btrim(p_payload->>'customerSourceId'),(p_payload->>'customerId')::uuid,actor) on conflict(company_id,source_id) do nothing;
  insert into private.stockflow_economic_targets(kind,name,company_id,customer_id,customer_source_id,site_id,model_id,installation_id,effective_from,created_by)
  values(p_payload->>'kind',btrim(p_payload->>'name'),btrim(p_payload->>'companyId'),(p_payload->>'customerId')::uuid,btrim(p_payload->>'customerSourceId'),btrim(p_payload->>'siteId'),btrim(p_payload->>'modelId'),nullif(p_payload->>'installationId','')::uuid,(p_payload->>'effectiveFrom')::date,actor) returning id into entity;
  acquisition_reason:=coalesce(nullif(p_payload->>'capitalEvidence',''),'Zero initial capital exposure');
  amount:=coalesce(nullif(p_payload->>'capitalPaise','')::bigint,0);if amount<0 then raise exception 'Capital exposure cannot be negative' using errcode='22023';end if;
  if nullif(p_payload->>'acquisitionPurchaseLineId','') is not null then
   select l.*,v.company_id,v.business_date,v.kind,v.cancelled,v.source_id,v.source_revision into purchase from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where l.id=(p_payload->>'acquisitionPurchaseLineId')::uuid;
   if not found or p_payload->>'kind'<>'placement' or purchase.kind<>'purchase' or purchase.cancelled or purchase.company_id<>btrim(p_payload->>'companyId') or purchase.quantity<>1 or purchase.net_sales_paise<=0 or purchase.business_date>(p_payload->>'effectiveFrom')::date then raise exception 'Acquisition requires one individually billed instrument from a matching company purchase dated on or before placement' using errcode='22023';end if;
   if private.stockflow_economic_source_unresolved(purchase.company_id,purchase.source_id) or exists(select 1 from private.stockflow_economic_source_vouchers v where v.company_id=purchase.company_id and v.source_id=purchase.source_id and v.source_revision>purchase.source_revision) then raise exception 'Acquisition purchase changed or requires source review' using errcode='PT409';end if;
   if exists(select 1 from private.stockflow_economic_acquisition_links a where a.company_id=purchase.company_id and a.source_id=purchase.source_id and a.line_key=purchase.line_key) or exists(select 1 from private.stockflow_economic_cost_links cl join private.stockflow_economic_source_lines l on l.id=cl.purchase_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id=purchase.company_id and v.source_id=purchase.source_id and l.line_key=purchase.line_key) then raise exception 'Purchase line already assigned to capital or reagent cost' using errcode='PT409';end if;
   if amount<>0 then raise exception 'Do not submit manual capital together with a Tally acquisition link' using errcode='22023';end if;
   amount:=purchase.net_sales_paise;
   acquisition_reason:='Tally purchase '||purchase.source_id||' rev '||purchase.source_revision||' / line '||purchase.line_key||' / product '||purchase.product_id||': '||(p_payload->>'capitalEvidence');
   insert into private.stockflow_economic_acquisition_links(target_id,purchase_line_id,company_id,source_id,line_key,actor,reason) values(entity,purchase.id,purchase.company_id,purchase.source_id,purchase.line_key,actor,p_payload->>'capitalEvidence');
  end if;
  if amount>0 and length(btrim(coalesce(p_payload->>'capitalEvidence','')))<3 then raise exception 'Capital purchase or approval evidence is required for nonzero exposure' using errcode='22023';end if;
  insert into private.stockflow_economic_events(target_id,kind,amount_paise,effective_date,request_id,actor,reason) values(entity,'capital',amount,(p_payload->>'effectiveFrom')::date,key||':capital',actor,acquisition_reason);
 elsif p_action='link_instrument_billing' then
  if target.kind<>'placement' or length(btrim(coalesce(p_payload->>'reason','')))<3 then raise exception 'Instrument placement and billing verification evidence required' using errcode='22023';end if;
  select * into acquisition from private.stockflow_economic_acquisition_links where target_id=target.id;
  if not found or not private.stockflow_economic_acquisition_current(target.id) then raise exception 'Verify the Tally acquisition before linking its selling invoice' using errcode='22023';end if;
  select * into original_purchase from private.stockflow_economic_source_lines where id=acquisition.purchase_line_id;
  select l.*,v.company_id,v.customer_source_id,v.business_date,v.kind,v.cancelled,v.source_id,v.source_revision into sale from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where l.id=(p_payload->>'sourceLineId')::uuid;
  if not found or sale.kind<>'sale' or sale.cancelled or sale.company_id<>target.company_id or sale.customer_source_id is distinct from target.customer_source_id or sale.product_id<>original_purchase.product_id or sale.unit<>original_purchase.unit or sale.quantity<>1 or sale.net_sales_paise<=0 or sale.business_date>private.stockflow_economic_business_date() or sale.business_date<(select business_date from private.stockflow_economic_source_vouchers where id=original_purchase.voucher_id) then raise exception 'Selling invoice must match the instrument product, unit, company and customer, with one billed instrument and a valid net value/date' using errcode='22023';end if;
  if private.stockflow_economic_source_unresolved(sale.company_id,sale.source_id) or exists(select 1 from private.stockflow_economic_source_vouchers v where v.company_id=sale.company_id and v.source_id=sale.source_id and v.source_revision>sale.source_revision) then raise exception 'Instrument selling invoice changed or requires source review; refresh before linking' using errcode='PT409';end if;
  if exists(select 1 from private.stockflow_economic_instrument_billings b where b.target_id=target.id or (b.company_id=sale.company_id and b.source_id=sale.source_id and b.line_key=sale.line_key)) then raise exception 'Instrument or selling line already has a billing link' using errcode='PT409';end if;
  if exists(select 1 from private.stockflow_leakage_recovery_claims c join private.stockflow_economic_source_lines l on l.id=c.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id=sale.company_id and v.source_id=sale.source_id and l.line_key=sale.line_key) then raise exception 'Selling line already claimed as reagent recovery; reconcile the claim first' using errcode='22023';end if;
  insert into private.stockflow_economic_instrument_billings(target_id,source_line_id,company_id,source_id,line_key,actor,reason) values(target.id,sale.id,sale.company_id,sale.source_id,sale.line_key,actor,p_payload->>'reason');
  update private.stockflow_economic_targets set version=version+1 where id=target.id;
 elsif p_action='review_acquisition' then
  p_payload:=p_payload-'approvalChecks'-'reviewedPolicyId';
  if length(btrim(coalesce(p_payload->>'reason','')))<3 then raise exception 'Acquisition review evidence required' using errcode='22023';end if;
  select * into acquisition from private.stockflow_economic_acquisition_links where target_id=target.id;
  if not found then raise exception 'Target has no Tally acquisition link' using errcode='22023';end if;
  select * into original_purchase from private.stockflow_economic_source_lines where id=acquisition.purchase_line_id;
  select * into source_voucher from private.stockflow_economic_source_vouchers where company_id=acquisition.company_id and source_id=acquisition.source_id order by source_revision desc limit 1;
  if private.stockflow_economic_source_unresolved(acquisition.company_id,acquisition.source_id) then raise exception 'Latest acquisition evidence could not be verified; resolve the source exception before reviewing capital' using errcode='PT409';end if;
  if source_voucher.source_revision is distinct from nullif(p_payload->>'expectedSourceRevision','')::bigint then raise exception 'Acquisition source changed; refresh before review' using errcode='PT409';end if;
  if private.stockflow_economic_acquisition_current(target.id) then raise exception 'Acquisition revision is already verified' using errcode='PT409';end if;
  select coalesce(max(revision),0)+1 into review_revision from private.stockflow_economic_acquisition_reviews where target_id=target.id;
  select amount_paise into previous_amount from private.stockflow_economic_acquisition_reviews where target_id=target.id order by revision desc limit 1;
  previous_amount:=coalesce(previous_amount,original_purchase.net_sales_paise);
  if source_voucher.cancelled then
   if not coalesce((p_payload->>'confirmCancellation')::boolean,false) then raise exception 'Explicit confirmation required to reduce cancelled acquisition capital to zero' using errcode='22023';end if;
   amount:=0;
  else
   select * into current_purchase from private.stockflow_economic_source_lines where voucher_id=source_voucher.id and line_key=acquisition.line_key;
   if not found or source_voucher.kind<>'purchase' or current_purchase.product_id<>original_purchase.product_id or current_purchase.unit<>original_purchase.unit or current_purchase.quantity<>1 or current_purchase.net_sales_paise<=0 or source_voucher.business_date>target.effective_from then raise exception 'Revised acquisition must retain the individually billed instrument product, unit, line and valid date; missing or incompatible evidence requires separate investigation' using errcode='22023';end if;
   amount:=current_purchase.net_sales_paise;
  end if;
  -- Recheck affected approved placement/group limits before adding capital.
  -- The historical member event remains on its original placement; the group
  -- read model already includes that member capital without another posting.
  select * into policy from private.stockflow_economic_policy_versions order by recorded_at desc,id desc limit 1;
  for other in select * from private.stockflow_economic_targets t where t.id=target.id or t.id in(select group_id from private.stockflow_economic_group_members where placement_id=target.id) loop
   select coalesce(sum(e.amount_paise),0)+amount-previous_amount into capital from private.stockflow_economic_events e where e.kind='capital' and (e.target_id=other.id or (other.kind='group' and e.target_id in(select placement_id from private.stockflow_economic_group_members where group_id=other.id)));
   if capital<0 then raise exception 'Acquisition correction would make capital negative; reconcile existing adjustments first' using errcode='22023';end if;
   capital:=greatest(0,capital-private.stockflow_economic_billed_recovery(other.id));
   if other.approval='approved' and amount>previous_amount then
    select * into expectation from private.stockflow_economic_expectations where id=private.stockflow_economic_approved_expectation(other.id) and target_id=other.id;
    if expectation.id is null or (capital>0 and expectation.monthly_gp_paise<=0) then raise exception 'Approved positive-GP baseline required for increased acquisition investment' using errcode='22023';end if;
    monthly_payback:=case when capital>0 then capital/expectation.monthly_gp_paise else 0 end;
    if monthly_payback>policy.exception_months then raise exception 'Revised acquisition exceeds configured approval limit' using errcode='22023';end if;
    if monthly_payback>policy.review_months and not coalesce((p_payload->>'directorException')::boolean,false) then raise exception 'Director exception required for revised acquisition payback' using errcode='22023';end if;
    p_payload:=p_payload||jsonb_build_object('reviewedPolicyId',policy.id,'approvalChecks',coalesce(p_payload->'approvalChecks','[]'::jsonb)||jsonb_build_array(jsonb_build_object('targetId',other.id,'expectationId',expectation.id,'expectedPaybackMonths',monthly_payback)));
   end if;
  end loop;
  acquisition_reason:='Acquisition review '||source_voucher.source_id||' rev '||source_voucher.source_revision||': '||(p_payload->>'reason');
  insert into private.stockflow_economic_events(target_id,kind,amount_paise,effective_date,request_id,actor,reason) values(target.id,'capital',amount-previous_amount,private.stockflow_economic_business_date(),key||':capital',actor,acquisition_reason) returning id into verification;
  insert into private.stockflow_economic_acquisition_reviews(target_id,revision,voucher_id,purchase_line_id,amount_paise,previous_amount_paise,capital_event_id,actor,reason) values(target.id,review_revision,source_voucher.id,current_purchase.id,amount,previous_amount,verification,actor,p_payload->>'reason');
  update private.stockflow_economic_targets set version=version+1 where id=target.id;
  p_payload:=p_payload||jsonb_build_object('reviewedVoucherId',source_voucher.id,'previousAmountPaise',previous_amount::text,'reviewedAmountPaise',amount::text,'capitalDeltaPaise',(amount-previous_amount)::text,'capitalEventId',verification);
 elsif p_action='set_item_group_mapping' then
  if target.kind<>'placement' then raise exception 'Select an instrument placement for item-group mapping' using errcode='22023';end if;
  select * into item_catalog from private.stockflow_economic_item_catalogs c where c.company_id=target.company_id order by c.observed_at desc,c.id desc limit 1;
  if item_catalog.id is null or item_catalog.id::text is distinct from p_payload->>'expectedCatalogId' or not private.stockflow_economic_item_catalog_current(target.company_id) then raise exception 'Tally item-group catalog changed or is unavailable; refresh before mapping' using errcode='PT409';end if;
  if not exists(select 1 from jsonb_array_elements(item_catalog.content->'groups') g where g->>'id'=p_payload->>'groupId') then raise exception 'Select a canonical item group from the instrument company' using errcode='22023';end if;
  insert into private.stockflow_economic_item_group_mappings(company_id,model_id,group_id,target_id,catalog_id,effect,effective_from,effective_to,reason,verified_by)
   values(target.company_id,target.model_id,p_payload->>'groupId',target.id,item_catalog.id,p_payload->>'effect',(p_payload->>'effectiveFrom')::date,nullif(p_payload->>'effectiveTo','')::date,btrim(p_payload->>'reason'),actor) returning id into entity;
  p_payload:=p_payload-'mappedProductIds'-'catalogSourceVersion'||jsonb_build_object('companyId',target.company_id,'modelId',target.model_id,'catalogSourceVersion',item_catalog.source_version,'mappedProductIds',coalesce((select jsonb_agg(product_id order by product_id) from private.stockflow_economic_group_products(item_catalog.content,p_payload->>'groupId')),'[]'::jsonb));
 elsif p_action='set_mapping' then
  if nullif(p_payload->>'targetId','') is not null then
   select * into other from private.stockflow_economic_targets where id=(p_payload->>'targetId')::uuid;
   if not found or other.kind<>'placement' or other.company_id<>p_payload->>'companyId' or other.model_id<>p_payload->>'modelId' then raise exception 'Override requires matching placement company/model' using errcode='22023';end if;
  end if;
  insert into private.stockflow_economic_mappings(company_id,model_id,product_id,target_id,effect,effective_from,effective_to,reason,verified_by)
  values(btrim(p_payload->>'companyId'),btrim(p_payload->>'modelId'),btrim(p_payload->>'productId'),nullif(p_payload->>'targetId','')::uuid,p_payload->>'effect',(p_payload->>'effectiveFrom')::date,nullif(p_payload->>'effectiveTo','')::date,btrim(p_payload->>'reason'),actor) returning id into entity;
 elsif p_action='set_expectation' then
  if nullif(p_payload->>'expectedMonthlyUnits','') is not null and (nullif(p_payload->>'productId','') is null or nullif(p_payload->>'baseUnit','') is null) then raise exception 'Consumption expectation requires canonical product and base unit' using errcode='22023';end if;
  insert into private.stockflow_economic_expectations(target_id,effective_from,monthly_revenue_paise,monthly_gp_paise,reason,created_by)
  values(target.id,(p_payload->>'effectiveFrom')::date,(p_payload->>'monthlyRevenuePaise')::bigint,(p_payload->>'monthlyGpPaise')::bigint,p_payload->>'reason',actor) returning id into entity;
  shares:=case when jsonb_typeof(p_payload->'items')='array' then p_payload->'items' when nullif(p_payload->>'expectedMonthlyUnits','') is not null then jsonb_build_array(p_payload) else '[]'::jsonb end;
  for item in select value from jsonb_array_elements(shares) loop
   insert into private.stockflow_economic_expectation_items(expectation_id,product_id,base_unit,expected_monthly_units,expected_unit_price_paise,expected_unit_cost_paise)
   values(entity,item->>'productId',item->>'baseUnit',(item->>'expectedMonthlyUnits')::numeric,nullif(item->>'expectedUnitPricePaise','')::bigint,nullif(item->>'expectedUnitCostPaise','')::bigint);
  end loop;
 elsif p_action='record_observation' then
  if exists(select 1 from private.stockflow_economic_consumption_observations o where o.target_id=target.id and o.product_id=p_payload->>'productId' and daterange(o.window_from,o.window_to,'[)') && daterange((p_payload->>'windowFrom')::date,(p_payload->>'windowTo')::date,'[)') and (o.window_from<>(p_payload->>'windowFrom')::date or o.window_to<>(p_payload->>'windowTo')::date)) then raise exception 'Observation windows must match exactly for revisions or must not overlap' using errcode='PT409';end if;
  insert into private.stockflow_economic_consumption_observations(target_id,product_id,base_unit,window_from,window_to,test_count,tests_per_unit,qc_units,opening_stock,closing_stock,net_transfers,external_supply,evidence_reference,actor)
  values(target.id,p_payload->>'productId',p_payload->>'baseUnit',(p_payload->>'windowFrom')::date,(p_payload->>'windowTo')::date,(p_payload->>'testCount')::numeric,(p_payload->>'testsPerUnit')::numeric,coalesce(nullif(p_payload->>'qcUnits','')::numeric,0),nullif(p_payload->>'openingStock','')::numeric,nullif(p_payload->>'closingStock','')::numeric,coalesce(nullif(p_payload->>'netTransfers','')::numeric,0),coalesce(nullif(p_payload->>'externalSupply','')::numeric,0),p_payload->>'evidenceReference',actor) returning id into entity;
 elsif p_action='approve_target' then
  p_payload:=p_payload-'approvalExpectationId'-'approvalPolicyId'-'approvedNetInvestmentPaise'-'expectedPaybackMonths'-'approvalPreview';
  if target.approval<>'proposed' then raise exception 'Target already decided' using errcode='PT409';end if;
  if p_payload->>'decision' not in ('approved','rejected') then raise exception 'Invalid approval decision' using errcode='22023';end if;
  if p_payload->>'decision'='approved' then
   select id into run from private.stockflow_economic_runs where active;
   if run is null or run::text is distinct from p_payload->>'expectedGeneration' then raise exception 'Financial preview changed; refresh before approval' using errcode='PT409';end if;
   item:=private.stockflow_economic_approval_preview(target.id);
   if item->>'status' in ('evidence_incomplete','not_applicable') then raise exception 'Instrument evidence or placement lifecycle requires review before approval' using errcode='PT409';end if;
   if item->>'status' in ('missing_baseline','positive_gp_required') then raise exception 'Approved baseline with positive expected GP required for capital exposure' using errcode='22023';end if;
   if item->>'status'='limit_exceeded' then raise exception 'Payback exceeds configured approval limit' using errcode='22023';end if;
   if item->>'status'='director_exception_required' and not coalesce((p_payload->>'directorException')::boolean,false) then raise exception 'Explicit director exception required for long payback' using errcode='22023';end if;
   p_payload:=p_payload||jsonb_build_object('approvalExpectationId',item->'expectationId','approvalPolicyId',item->'policyId','approvedNetInvestmentPaise',item->'netInvestmentPaise','expectedPaybackMonths',item->'expectedPaybackMonths','approvalPreview',item);
  end if;
  if length(btrim(coalesce(p_payload->>'reason','')))<3 then raise exception 'Decision reason required' using errcode='22023';end if;
  update private.stockflow_economic_targets set approval=p_payload->>'decision',version=version+1 where id=target.id;
 elsif p_action='close_target' then
  if length(btrim(coalesce(p_payload->>'reason','')))<3 then raise exception 'Closure evidence reason required' using errcode='22023';end if;
  if target.effective_to is not null then raise exception 'Target already closed' using errcode='PT409';end if;
  if exists(select 1 from private.stockflow_economic_group_members where (group_id=target.id or placement_id=target.id) and (effective_to is null or effective_to>(p_payload->>'effectiveTo')::date)) then raise exception 'Close group memberships before closing this target' using errcode='22023';end if;
  update private.stockflow_economic_targets set effective_to=(p_payload->>'effectiveTo')::date,version=version+1 where id=target.id;
 elsif p_action='record_capital' then
  p_payload:=p_payload-'approvalExpectationId'-'approvalPolicyId'-'approvedNetInvestmentPaise'-'expectedPaybackMonths';
  if exists(select 1 from private.stockflow_economic_group_members gm join private.stockflow_economic_targets g on g.id=gm.group_id where gm.placement_id=target.id and g.approval='approved') then raise exception 'Record pooled capital and contribution adjustments against the approved economic group' using errcode='22023';end if;
  if p_payload->>'kind' not in ('capital','contribution') or length(btrim(coalesce(p_payload->>'reason','')))<3 then raise exception 'Valid capital event type and evidence reason required' using errcode='22023';end if;
  if (p_payload->>'effectiveDate')::date<target.effective_from or (target.effective_to is not null and (p_payload->>'effectiveDate')::date>=target.effective_to) then raise exception 'Capital/contribution date is outside target lifecycle' using errcode='22023';end if;
  if (p_payload->>'effectiveDate')::date>private.stockflow_economic_business_date() then raise exception 'Actual capital and contributions cannot be future-dated' using errcode='22023';end if;
  amount:=(p_payload->>'amountPaise')::bigint;
  if p_payload->>'kind'='capital' and amount+coalesce((select sum(amount_paise) from private.stockflow_economic_events where kind='capital' and (target_id=target.id or (target.kind='group' and target_id in(select placement_id from private.stockflow_economic_group_members where group_id=target.id)))),0)<0 then raise exception 'Capital adjustment exceeds deployed exposure' using errcode='22023';end if;
  if p_payload->>'kind'='capital' and amount>0 and target.approval='approved' then
   if not private.stockflow_economic_acquisition_current(target.id) or not private.stockflow_economic_billing_current(target.id) then raise exception 'Reconcile changed instrument evidence before increasing capital' using errcode='PT409';end if;
   select coalesce(sum(e.amount_paise),0)+amount into capital from private.stockflow_economic_events e where e.kind='capital' and (e.target_id=target.id or (target.kind='group' and e.target_id in(select placement_id from private.stockflow_economic_group_members where group_id=target.id)));
   capital:=greatest(0,capital-private.stockflow_economic_billed_recovery(target.id));
   select * into expectation from private.stockflow_economic_expectations where id=private.stockflow_economic_approved_expectation(target.id) and target_id=target.id;
   select * into policy from private.stockflow_economic_policy_versions order by recorded_at desc,id desc limit 1;
   if expectation.id is null or (capital>0 and expectation.monthly_gp_paise<=0) then raise exception 'Approved positive-GP baseline required for increased capital exposure' using errcode='22023';end if;
   monthly_payback:=case when capital>0 then capital/expectation.monthly_gp_paise else 0 end;
   if monthly_payback>policy.exception_months then raise exception 'Capital increase exceeds configured approval limit' using errcode='22023';end if;
   if monthly_payback>policy.review_months and not coalesce((p_payload->>'directorException')::boolean,false) then raise exception 'Director exception required for increased capital payback' using errcode='22023';end if;
   p_payload:=p_payload||jsonb_build_object('approvalExpectationId',expectation.id,'approvalPolicyId',policy.id,'approvedNetInvestmentPaise',capital::text,'expectedPaybackMonths',monthly_payback);
  end if;
  insert into private.stockflow_economic_events(target_id,kind,amount_paise,effective_date,request_id,actor,reason) values(target.id,p_payload->>'kind',amount,(p_payload->>'effectiveDate')::date,key||':capital',actor,p_payload->>'reason') returning id into entity;
 elsif p_action='set_group_members' then
  if target.kind<>'group' or jsonb_typeof(p_payload->'members')<>'array' or jsonb_array_length(p_payload->'members')=0 then raise exception 'Group and member list required' using errcode='22023';end if;
  if target.approval<>'proposed' then raise exception 'Set group membership before approval; create a new dated group for composition changes' using errcode='PT409';end if;
  for item in select value from jsonb_array_elements(p_payload->'members') loop
   select * into other from private.stockflow_economic_targets where id=(item->>'placementId')::uuid;
   if not found or other.kind<>'placement' or other.company_id<>target.company_id or other.customer_id<>target.customer_id or other.customer_source_id<>target.customer_source_id or other.site_id<>target.site_id then raise exception 'Group members must share canonical customer/company/site' using errcode='22023';end if;
   if (item->>'effectiveFrom')::date<greatest(target.effective_from,other.effective_from) or (coalesce(target.effective_to,other.effective_to) is not null and (nullif(item->>'effectiveTo','') is null or (item->>'effectiveTo')::date>least(target.effective_to,other.effective_to))) then raise exception 'Membership is outside placement/group lifecycle' using errcode='22023';end if;
   if nullif(item->>'effectiveTo','') is not null then
    if exists(select 1 from private.stockflow_economic_group_members gm where gm.placement_id=other.id and (gm.effective_to is null or gm.effective_to>(item->>'effectiveTo')::date)) then raise exception 'A later membership must be resolved before ending this logical placement' using errcode='22023';end if;
    update private.stockflow_economic_targets set effective_to=(item->>'effectiveTo')::date,version=version+1 where id=other.id and effective_to is null;
   end if;
   insert into private.stockflow_economic_group_members(group_id,placement_id,effective_from,effective_to) values(target.id,other.id,(item->>'effectiveFrom')::date,nullif(item->>'effectiveTo','')::date);
  end loop;
 elsif p_action='close_group_membership' then
  select to_jsonb(gm) into item from private.stockflow_economic_group_members gm where gm.id=(p_payload->>'membershipId')::uuid for update;
  if item is null or item->>'effective_to' is not null then raise exception 'Open membership required' using errcode='PT409';end if;
  if length(btrim(coalesce(p_payload->>'reason','')))<3 then raise exception 'Membership closure evidence required' using errcode='22023';end if;
  if exists(select 1 from private.stockflow_economic_group_members gm where gm.placement_id=(item->>'placement_id')::uuid and gm.id<>(item->>'id')::uuid and (gm.effective_to is null or gm.effective_to>(p_payload->>'effectiveTo')::date)) then raise exception 'Resolve later memberships before ending this logical placement' using errcode='22023';end if;
  update private.stockflow_economic_group_members set effective_to=(p_payload->>'effectiveTo')::date where id=(p_payload->>'membershipId')::uuid and effective_to is null;
  if not found then raise exception 'Membership already closed' using errcode='PT409';end if;
  -- A former member must not continue earning against capital owned by its
  -- historical pool. A replacement dated placement needs reviewed residual
  -- capital and a new approval; physical installation evidence is preserved.
  update private.stockflow_economic_targets set effective_to=(p_payload->>'effectiveTo')::date,version=version+1 where id=(item->>'placement_id')::uuid and effective_to is null;
  entity:=(p_payload->>'membershipId')::uuid;
 elsif p_action='set_allocation' then
  shares:=p_payload->'shares';
  if jsonb_typeof(shares)<>'array' or jsonb_array_length(shares)<2 or (select sum((s->>'basisPoints')::integer) from jsonb_array_elements(shares) s)<>10000 or exists(select 1 from jsonb_array_elements(shares) s where (s->>'basisPoints')::integer not between 1 and 10000) or (select count(distinct s->>'targetId') from jsonb_array_elements(shares) s)<>jsonb_array_length(shares) then raise exception 'Unique complete allocation shares totaling 100%% required' using errcode='22023';end if;
  for item in select value from jsonb_array_elements(shares) loop
   select * into other from private.stockflow_economic_targets where id=(item->>'targetId')::uuid;
   if not found or other.kind<>'placement' or other.company_id<>p_payload->>'companyId' or other.customer_source_id<>p_payload->>'customerSourceId' or other.site_id<>p_payload->>'siteId' then raise exception 'Allocation target scope mismatch' using errcode='22023';end if;
  end loop;
  insert into private.stockflow_economic_allocations(company_id,customer_source_id,site_id,product_id,effective_from,effective_to,shares,reason,verified_by)
  values(p_payload->>'companyId',p_payload->>'customerSourceId',p_payload->>'siteId',p_payload->>'productId',(p_payload->>'effectiveFrom')::date,nullif(p_payload->>'effectiveTo','')::date,shares,p_payload->>'reason',actor) returning id into entity;
 elsif p_action='close_allocation' then
  if length(btrim(coalesce(p_payload->>'reason','')))<3 then raise exception 'Allocation closure evidence required' using errcode='22023';end if;
  update private.stockflow_economic_allocations set effective_to=(p_payload->>'effectiveTo')::date where id=(p_payload->>'allocationId')::uuid and effective_to is null;
  if not found then raise exception 'Open allocation not found; refresh before retrying' using errcode='PT409';end if;
  entity:=(p_payload->>'allocationId')::uuid;
 elsif p_action='set_policy' then
  insert into private.stockflow_economic_policy_versions(attractive_months,review_months,exception_months,forecast_window_months,watch_revenue_percent,critical_revenue_percent,actor,reason)
  values((p_payload->>'attractiveMonths')::integer,(p_payload->>'reviewMonths')::integer,(p_payload->>'exceptionMonths')::integer,(p_payload->>'forecastWindowMonths')::integer,(p_payload->>'watchRevenuePercent')::integer,(p_payload->>'criticalRevenuePercent')::integer,actor,p_payload->>'reason') returning id into entity;
 elsif p_action='resolve_line' then
  select l.*,v.company_id,v.customer_source_id,v.business_date,v.kind,v.cancelled,v.source_id,v.source_revision into sale from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where l.id=(p_payload->>'sourceLineId')::uuid;
  if not found or sale.cancelled or exists(select 1 from private.stockflow_economic_source_vouchers n where n.company_id=sale.company_id and n.source_id=sale.source_id and n.source_revision>sale.source_revision) then raise exception 'Current source line required' using errcode='PT409';end if;
  if sale.kind in ('return','credit') then
   select l.*,v.company_id,v.customer_source_id,v.business_date,v.kind,v.cancelled,v.source_id,v.source_revision into purchase from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where l.id=(p_payload->>'originalSaleLineId')::uuid;
   if not found or purchase.kind<>'sale' or purchase.cancelled or purchase.company_id<>sale.company_id or purchase.customer_source_id is distinct from sale.customer_source_id or purchase.product_id<>sale.product_id or purchase.unit<>sale.unit or purchase.business_date>sale.business_date or exists(select 1 from private.stockflow_economic_source_vouchers n where n.company_id=purchase.company_id and n.source_id=purchase.source_id and n.source_revision>purchase.source_revision) then raise exception 'Verified original sale must match company, customer, product, unit and date' using errcode='22023';end if;
  elsif sale.kind<>'sale' or sale.net_sales_paise<>0 or sale.quantity<=0 or nullif(p_payload->>'focReason','') is null then raise exception 'Review requires a stock return, value credit or FOC line' using errcode='22023';end if;
  if sale.kind in ('return','credit') then review_original:=purchase.id;end if;
  insert into private.stockflow_economic_line_reviews(source_line_id,original_sale_line_id,foc_reason,reason,actor) values(sale.id,review_original,nullif(p_payload->>'focReason',''),p_payload->>'reason',actor) returning id into entity;
 elsif p_action='verify_cost' then
  select l.*,v.company_id,v.business_date,v.kind,v.cancelled,v.source_id,v.source_revision into sale from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where l.id=(p_payload->>'sourceLineId')::uuid;
  if not found or sale.kind<>'sale' or sale.cancelled or sale.quantity<=0 then raise exception 'Active sale line required' using errcode='22023';end if;
  if exists(select 1 from private.stockflow_economic_instrument_billings b where b.company_id=sale.company_id and b.source_id=sale.source_id and b.line_key=sale.line_key) then raise exception 'Instrument selling invoice is upfront recovery, not reagent GP' using errcode='22023';end if;
  if exists(select 1 from private.stockflow_economic_source_vouchers v where v.company_id=sale.company_id and v.source_id=sale.source_id and v.source_revision>sale.source_revision) then raise exception 'Source sale revision superseded' using errcode='PT409';end if;
  if length(btrim(coalesce(p_payload->>'evidenceReference','')))<3 or jsonb_typeof(p_payload->'purchaseAllocations')<>'array' then raise exception 'Purchase linkage evidence required' using errcode='22023';end if;
  insert into private.stockflow_economic_cost_verifications(sale_line_id,evidence_reference,actor) values(sale.id,p_payload->>'evidenceReference',actor) returning id into verification;
  total_qty:=0;
  for item in select value from jsonb_array_elements(p_payload->'purchaseAllocations') loop
   select l.*,v.company_id,v.business_date,v.kind,v.cancelled,v.source_id,v.source_revision into purchase from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where l.id=(item->>'purchaseLineId')::uuid;
   if exists(select 1 from private.stockflow_economic_acquisition_links a where a.company_id=purchase.company_id and a.source_id=purchase.source_id and a.line_key=purchase.line_key) then raise exception 'Instrument acquisition purchase cannot fund reagent cost' using errcode='22023';end if;
   qty:=(item->>'quantity')::numeric;
   if not found or purchase.kind<>'purchase' or purchase.cancelled or qty<=0 or purchase.quantity<=0 or purchase.company_id<>sale.company_id or purchase.product_id<>sale.product_id or purchase.unit<>sale.unit or purchase.business_date>sale.business_date or (sale.batch_id is not null and purchase.batch_id is distinct from sale.batch_id) then raise exception 'Purchase evidence is incompatible or later than sale' using errcode='22023';end if;
   if exists(select 1 from private.stockflow_economic_source_vouchers v where v.company_id=purchase.company_id and v.source_id=purchase.source_id and v.source_revision>purchase.source_revision) then raise exception 'Purchase revision superseded' using errcode='PT409';end if;
   select coalesce(sum(cl.quantity),0),coalesce(sum(cl.cost_paise),0) into used_qty,used_cost from private.stockflow_economic_cost_links cl
   join private.stockflow_economic_source_lines sl on sl.id=cl.sale_line_id join private.stockflow_economic_source_vouchers sv on sv.id=sl.voucher_id
   where cl.purchase_line_id=purchase.id and cl.sale_line_id<>sale.id and cl.verification_id=(select id from private.stockflow_economic_cost_verifications cv where cv.sale_line_id=cl.sale_line_id order by cv.revision desc limit 1) and not sv.cancelled and not exists(select 1 from private.stockflow_economic_source_vouchers nv where nv.company_id=sv.company_id and nv.source_id=sv.source_id and nv.source_revision>sv.source_revision);
   if qty+used_qty>purchase.quantity then raise exception 'Purchase quantity already allocated' using errcode='PT409';end if;
   total_qty:=total_qty+qty;
   insert into private.stockflow_economic_cost_links(sale_line_id,purchase_line_id,verification_id,quantity,cost_paise,evidence_reference,verified_by)
   values(sale.id,purchase.id,verification,qty,(round(purchase.net_sales_paise::numeric*(qty+used_qty)/purchase.quantity)-used_cost)::bigint,p_payload->>'evidenceReference',actor);
  end loop;
  if total_qty<>sale.quantity then raise exception 'Cost linkage must cover the complete sale quantity' using errcode='22023';end if;
  entity:=sale.id;
 elsif p_action='create_case' then
  if nullif(p_payload->>'opportunityProductId','') is not null then
   if nullif(p_payload->>'windowFrom','') is null or nullif(p_payload->>'windowTo','') is null or (p_payload->>'windowTo')::date<=(p_payload->>'windowFrom')::date or (p_payload->>'windowTo')::date>(date_trunc('month',(p_payload->>'windowFrom')::date)+interval '1 month')::date then raise exception 'V1 opportunity window must fit within one calendar month with an exclusive end date' using errcode='22023';end if;
   if nullif(p_payload->>'expectedGeneration','') is not null and p_payload->>'expectedGeneration' is distinct from (select id::text from private.stockflow_economic_runs where active) then raise exception 'Economic evidence changed; refresh the opportunity before creating a case' using errcode='PT409';end if;
   select value into item from jsonb_array_elements(private.stockflow_economic_leakage((select id from private.stockflow_economic_runs where active),(p_payload->>'windowFrom')::date,(p_payload->>'windowTo')::date)) where value->>'targetId'=target.id::text and value->>'productId'=p_payload->>'opportunityProductId' and (value->>'windowFrom')::date=(p_payload->>'windowFrom')::date and (value->>'windowTo')::date=(p_payload->>'windowTo')::date;
   if item is null then raise exception 'Opportunity evidence is unavailable for this target, product and window' using errcode='22023';end if;
  else item:=null;end if;
  if exists(select 1 from private.stockflow_leakage_cases where target_id=target.id and opportunity_product_id=p_payload->>'opportunityProductId' and daterange(window_from,window_to,'[)') && daterange((p_payload->>'windowFrom')::date,(p_payload->>'windowTo')::date,'[)') and status not in ('dismissed','no_recovery')) then raise exception 'An opportunity case overlaps this window' using errcode='PT409';end if;
  insert into private.stockflow_leakage_cases(target_id,title,reason,primary_reason,reason_codes,confidence,evidence_reference,owner,due_date,action,opportunity_product_id,window_from,window_to,potential_revenue_paise,potential_gp_paise,evaluation,created_by)
  values(target.id,p_payload->>'title',p_payload->>'reason',coalesce(p_payload->>'primaryReason','unknown'),array(select distinct code from jsonb_array_elements_text(coalesce(p_payload->'reasonCodes',jsonb_build_array(coalesce(p_payload->>'primaryReason','unknown')))) code),coalesce(p_payload->>'confidence','unknown'),btrim(coalesce(p_payload->>'evidenceReference','')),lower(btrim(p_payload->>'owner')),nullif(p_payload->>'dueDate','')::date,p_payload->>'action',nullif(p_payload->>'opportunityProductId',''),nullif(p_payload->>'windowFrom','')::date,nullif(p_payload->>'windowTo','')::date,(item->>'potentialRevenuePaise')::bigint,(item->>'potentialGpPaise')::bigint,coalesce(item,'{}'::jsonb)||jsonb_build_object('evaluatedAt',now()),actor) returning id into entity;
 elsif p_action='update_case' then
  select * into current_case from private.stockflow_leakage_cases where id=(p_payload->>'caseId')::uuid for update;
  if not found then raise exception 'Leakage case not found' using errcode='22023';end if;
  if current_case.version is distinct from (p_payload->>'expectedVersion')::integer then raise exception 'Case changed; refresh before retrying' using errcode='PT409';end if;
  if current_case.opportunity_product_id is not null and p_payload->>'status' not in ('dismissed','no_recovery') and exists(select 1 from private.stockflow_leakage_cases c where c.id<>current_case.id and c.target_id=current_case.target_id and c.opportunity_product_id=current_case.opportunity_product_id and c.status not in ('dismissed','no_recovery') and daterange(c.window_from,c.window_to,'[)') && daterange(current_case.window_from,current_case.window_to,'[)')) then raise exception 'Another opportunity case overlaps this window; resolve it before reopening' using errcode='PT409';end if;
  if p_payload->>'status' in ('recovered','partially_recovered','no_recovery','dismissed') and length(btrim(coalesce(p_payload->>'outcome','')))<3 then raise exception 'Closing outcome evidence required' using errcode='22023';end if;
  if p_payload->>'status' in ('recovered','partially_recovered') and coalesce((private.stockflow_economic_case_recovery(current_case.id,(select id from private.stockflow_economic_runs where active))->>'revenuePaise')::numeric,0)<=0 then raise exception 'Verified positive follow-up recovery evidence is required before closing as recovered' using errcode='22023';end if;
  update private.stockflow_leakage_cases set status=p_payload->>'status',reason=p_payload->>'reason',primary_reason=coalesce(p_payload->>'primaryReason',current_case.primary_reason),reason_codes=array(select distinct code from jsonb_array_elements_text(coalesce(p_payload->'reasonCodes',case when p_payload?'primaryReason' then jsonb_build_array(p_payload->>'primaryReason') else to_jsonb(current_case.reason_codes) end)) code),confidence=coalesce(p_payload->>'confidence',current_case.confidence),evidence_reference=btrim(coalesce(p_payload->>'evidenceReference',current_case.evidence_reference)),owner=lower(btrim(p_payload->>'owner')),due_date=nullif(p_payload->>'dueDate','')::date,action=p_payload->>'action',outcome=coalesce(p_payload->>'outcome',''),version=version+1 where id=current_case.id;
  entity:=current_case.id;
 elsif p_action='claim_recovery' then
  select * into current_case from private.stockflow_leakage_cases where id=(p_payload->>'caseId')::uuid for update;
  if not found then raise exception 'Case not found' using errcode='22023';end if;
  if current_case.status in ('dismissed','no_recovery') then raise exception 'Reopen this case before recording new recovery evidence' using errcode='PT409';end if;
  select id into run from private.stockflow_economic_runs where active;
  if not exists(select 1 from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and r.source_line_id=(p_payload->>'sourceLineId')::uuid and r.target_id=current_case.target_id and v.kind='sale' and r.status<>'instrument_billing' and l.net_sales_paise>0 and (current_case.opportunity_product_id is null or current_case.opportunity_product_id=l.product_id) and v.business_date>=coalesce(current_case.window_to,private.stockflow_economic_business_date(current_case.created_at))) then raise exception 'Follow-up positive sale must match this case target/product after the baseline window' using errcode='22023';end if;
  if coalesce((select sum(cl.share_bps) from private.stockflow_leakage_recovery_claims cl join private.stockflow_economic_source_lines old on old.id=cl.source_line_id join private.stockflow_economic_source_vouchers ov on ov.id=old.voucher_id join private.stockflow_economic_source_lines selected on selected.id=(p_payload->>'sourceLineId')::uuid join private.stockflow_economic_source_vouchers sv on sv.id=selected.voucher_id where ov.company_id=sv.company_id and ov.source_id=sv.source_id and old.line_key=selected.line_key),0)+(p_payload->>'shareBasisPoints')::integer>10000 then raise exception 'Source recovery already claimed across revisions' using errcode='PT409';end if;
  insert into private.stockflow_leakage_recovery_claims(case_id,source_line_id,share_bps,reason,actor) values(current_case.id,(p_payload->>'sourceLineId')::uuid,(p_payload->>'shareBasisPoints')::integer,p_payload->>'reason',actor) returning id into entity;
 end if;
 -- Every domain mutation, audit record, ledger restatement and command receipt
 -- commits together. GET never observes half-applied financial generations.
 if p_action not in ('create_case','update_case','claim_recovery') then run:=private.stockflow_rebuild_instrument_economics(actor);end if;
 if p_action in ('create_case','update_case') then
  p_payload:=p_payload||jsonb_build_object('evaluation',(select c.evaluation from private.stockflow_leakage_cases c where c.id=entity),'classification',(select jsonb_build_object('primaryReason',c.primary_reason,'reasonCodes',c.reason_codes,'confidence',c.confidence,'evidenceReference',c.evidence_reference) from private.stockflow_leakage_cases c where c.id=entity));
 end if;
 insert into private.stockflow_economic_audit(action,entity_id,actor,payload) values(p_action,entity,actor,p_payload);
 result:=jsonb_build_object('ok',true,'entityId',entity,'generation',run);
 -- Use the original request for replay hashing; enriched approval evidence is audit-only.
 perform private.finish_stockflow_command(actor,p_action,key,original_request,entity,result);
 return result;
end$$;
revoke all on function public.stockflow_economics_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_economics_gateway(text,text,text,jsonb) to service_role;
commit;
