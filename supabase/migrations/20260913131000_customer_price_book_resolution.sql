-- Prices accepted in the book are decisions tied to evidence, never permanent contracts.
create table private.stockflow_price_book_decisions (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null references private.stockflow_customers(id),
  tally_item_key text not null,
  pricing_date date not null,
  evidence_hash text not null,
  choice text not null check (choice in ('continuity','recommended','custom')),
  price numeric(18,2) not null check (price>0),
  reason text not null check (length(btrim(reason))>=3),
  actor_email text not null,
  request_id text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(customer_id,tally_item_key,request_id)
);
alter table private.stockflow_price_book_decisions enable row level security;
create index stockflow_book_latest on private.stockflow_price_book_decisions(customer_id,tally_item_key,created_at desc);
create trigger stockflow_book_immutable before update on private.stockflow_price_book_decisions for each row execute function private.prevent_immutable_pricing_update();
create trigger stockflow_book_no_delete before delete on private.stockflow_price_book_decisions for each row execute function private.prevent_business_delete();

create or replace function private.stockflow_customer_price(p_customer uuid,p_item text,p_date date)
returns jsonb language plpgsql stable set search_path=pg_catalog,private,extensions as $$
declare
  agreement private.stockflow_customer_product_prices%rowtype;
  base private.stockflow_standard_item_prices%rowtype;
  sale private.stockflow_tally_sales_prices%rowtype;
  cost private.stockflow_tally_purchase_costs%rowtype;
  historic private.stockflow_tally_purchase_costs%rowtype;
  policy private.stockflow_pricing_policies%rowtype;
  result jsonb; continuity numeric; target numeric; recommended numeric; delta numeric;
  source text:='NONE'; warnings jsonb:='[]'; ambiguous boolean:=false; cost_ambiguous boolean:=false;
begin
  select * into policy from private.stockflow_pricing_policies where active and effective_from<=p_date and (effective_to is null or effective_to>=p_date) order by effective_from desc limit 1;
  if not found then raise exception 'Pricing policy is not configured' using errcode='55000'; end if;
  select * into agreement from private.stockflow_customer_product_prices where customer_id=p_customer and tally_item_key=p_item and status in ('approved','superseded') and valid_from<=p_date and (valid_to is null or valid_to>=p_date) order by valid_from desc limit 1;
  select * into base from private.stockflow_standard_item_prices where tally_item_key=p_item and status in ('approved','superseded') and valid_from<=p_date and (valid_to is null or valid_to>=p_date) order by valid_from desc limit 1;
  select * into sale from private.stockflow_tally_sales_prices where customer_id=p_customer and tally_item_key=p_item and invoice_date<=p_date and not exceptional and exception_type is null and invoice_rate>0 order by invoice_date desc,imported_at desc,id limit 1;
  if sale.id is not null then
    -- Without a reliable intraday sequence, differing rates on the latest date are ambiguous.
    select count(distinct invoice_rate)>1 into ambiguous from private.stockflow_tally_sales_prices where customer_id=p_customer and tally_item_key=p_item and invoice_date=sale.invoice_date and not exceptional and exception_type is null and invoice_rate>0;
  end if;
  select * into cost from private.stockflow_tally_purchase_costs where tally_item_key=p_item and effective_at<=p_date order by effective_at desc,imported_at desc,id limit 1;
  if cost.id is not null then
    select count(distinct (cost_amount,cost_kind))>1 into cost_ambiguous from private.stockflow_tally_purchase_costs where tally_item_key=p_item and effective_at=cost.effective_at;
  end if;
  if sale.id is not null then
    select * into historic from private.stockflow_tally_purchase_costs where tally_item_key=p_item and effective_at<=sale.invoice_date order by effective_at desc,imported_at desc,id limit 1;
    if historic.id is not null and (select count(distinct (cost_amount,cost_kind)) from private.stockflow_tally_purchase_costs where tally_item_key=p_item and effective_at=historic.effective_at)>1 then
      historic:=null;
    end if;
  end if;
  if cost_ambiguous then warnings:=warnings||jsonb_build_array('AMBIGUOUS_PURCHASE_COST'); cost:=null; end if;
  if ambiguous then warnings:=warnings||jsonb_build_array('AMBIGUOUS_SALES_HISTORY'); end if;
  if cost.id is null then warnings:=warnings||jsonb_build_array('MISSING_PURCHASE_COST'); end if;
  if historic.id is not null and cost.id is not null and historic.cost_kind=cost.cost_kind then delta:=cost.cost_amount-historic.cost_amount; end if;
  if sale.id is not null and delta is null then warnings:=warnings||jsonb_build_array('MISSING_COMPARABLE_HISTORIC_COST'); end if;
  if delta>0 then warnings:=warnings||jsonb_build_array('PURCHASE_PRICE_INCREASED'); end if;
  if cost.id is not null and policy.target_margin_percent is not null then target:=private.stockflow_round_price_up(cost.cost_amount/(1-policy.target_margin_percent/100),policy.rounding_increment); end if;
  if agreement.id is not null then
    source:='APPROVED_CONTRACT'; recommended:=agreement.price_amount;
  elsif sale.id is not null then
    source:='LAST_TALLY_INVOICE';
    if not ambiguous and delta is not null then continuity:=sale.invoice_rate+greatest(delta,0); recommended:=greatest(continuity,coalesce(target,continuity)); end if;
  elsif base.id is not null then
    source:='STANDARD_ITEM_PRICE';
    if cost.id is not null then continuity:=base.price_amount; recommended:=greatest(base.price_amount,coalesce(target,base.price_amount)); end if;
  else warnings:=warnings||jsonb_build_array('NO_ELIGIBLE_PRICE_HISTORY'); end if;
  if recommended is not null and cost.id is not null and (recommended<cost.cost_amount or (recommended-cost.cost_amount)/recommended*100<policy.minimum_margin_percent) then warnings:=warnings||jsonb_build_array('BELOW_MINIMUM_MARGIN'); end if;
  if recommended is not null and cost.id is not null and recommended<cost.cost_amount then warnings:=warnings||jsonb_build_array('LOSS_MAKING'); end if;
  result:=jsonb_build_object(
    'customerId',p_customer,'tallyKey',p_item,'pricingDate',p_date,
    'itemName',coalesce((select name from private.stockflow_products where tally_item_key=p_item),p_item),
    'customerName',(select name from private.stockflow_customers where id=p_customer),
    'fixed',agreement.id is not null,'lastRate',case when not ambiguous then sale.invoice_rate end,
    'lastInvoiceDate',sale.invoice_date,'lastInvoiceReference',sale.invoice_reference,
    'historicCost',historic.cost_amount,'currentCost',cost.cost_amount,'costChange',delta,
    'continuity',continuity,'target',target,'recommended',recommended,
    'continuityPrice',continuity,'targetMarginPrice',target,'recommendedPrice',recommended,
    'recommendationReason',case
      when agreement.id is not null then 'Fixed agreement retained; review margin before changing its terms.'
      when recommended is null then 'Reliable pricing evidence is incomplete; review is required.'
      when source='STANDARD_ITEM_PRICE' then 'No genuine customer history; use the governed base price checked against target margin.'
      when target>continuity then 'Target-margin price exceeds continuity and improves gross profit.'
      when delta>0 then 'Pass through the absolute cost increase while preserving established customer economics.'
      else 'Preserve the last customer rate; lower purchase cost does not trigger a price reduction.' end,
    'continuityGP',continuity-cost.cost_amount,'continuityMargin',round((continuity-cost.cost_amount)/nullif(continuity,0)*100,2),
    'recommendedGP',recommended-cost.cost_amount,'recommendedMargin',round((recommended-cost.cost_amount)/nullif(recommended,0)*100,2),
    'differenceToCustomer',recommended-sale.invoice_rate,'additionalGP',recommended-continuity,
    'monthlyGPImpact',null,'currentMonthlyGP',null,'continuityMonthlyGP',null,'recommendedMonthlyGP',null,'monthlyVolume',null,'volumeStatus','NO_RELIABLE_VOLUME_EVIDENCE',
    'status',case when recommended is null or cost.id is null or warnings ? 'BELOW_MINIMUM_MARGIN' then 'REVIEW_REQUIRED' when agreement.id is not null then 'FIXED_AGREEMENT' when target is not null and recommended>=target then 'RECOMMENDED' else 'CONTINUITY' end,
    'source',jsonb_build_object('type',source,'reference',case source when 'APPROVED_CONTRACT' then agreement.id::text when 'STANDARD_ITEM_PRICE' then base.id::text else sale.invoice_reference end,'date',case source when 'APPROVED_CONTRACT' then agreement.valid_from when 'STANDARD_ITEM_PRICE' then base.valid_from else sale.invoice_date end,'version',case source when 'APPROVED_CONTRACT' then agreement.version::text when 'STANDARD_ITEM_PRICE' then base.version::text else sale.source_version end,'contractId',agreement.id),
    'cost',case when cost.id is null then null else jsonb_build_object('id',cost.id,'amount',cost.cost_amount,'kind',cost.cost_kind,'effectiveAt',cost.effective_at,'sourceReference',cost.source_reference,'sourceVersion',cost.source_version,'previousAmount',historic.cost_amount,'changeAmount',delta,'changePercent',round(delta/nullif(historic.cost_amount,0)*100,2)) end,
    'policy',jsonb_build_object('id',policy.id,'version',policy.policy_version,'minimumMarginPercent',policy.minimum_margin_percent,'targetMarginPercent',policy.target_margin_percent,'overrideApprovalPercent',policy.override_approval_percent,'roundingRuleVersion',policy.rounding_rule_version),
    'suggestion',case when target is null then null else jsonb_build_object('amount',target,'unroundedAmount',round(cost.cost_amount/(1-policy.target_margin_percent/100),6),'targetMarginPercent',policy.target_margin_percent,'policyVersion',policy.policy_version,'roundingRuleVersion',policy.rounding_rule_version,'costSourceVersion',cost.source_version) end,
    'recentRates',coalesce((select jsonb_agg(to_jsonb(r)) from (select invoice_rate as rate,invoice_date as "invoiceDate",invoice_reference as "invoiceReference",source_version as "sourceVersion" from private.stockflow_tally_sales_prices where customer_id=p_customer and tally_item_key=p_item and invoice_date<=p_date and not exceptional and exception_type is null and invoice_rate>0 order by invoice_date desc,imported_at desc,id limit 5) r),'[]'),
    'historicCostId',historic.id,'baseId',base.id,'agreementId',agreement.id,'warnings',warnings,'ruleVersion','continuity-target-v1'
  );
  return result||jsonb_build_object('evidenceHash',encode(extensions.digest((result-'pricingDate')::text,'sha256'),'hex'),
    'currentDecisionId',(select id from private.stockflow_price_book_decisions where customer_id=p_customer and tally_item_key=p_item order by created_at desc,id limit 1));
end $$;
revoke all on function private.stockflow_customer_price(uuid,text,date) from public,anon,authenticated;

create or replace function private.stockflow_resolve_pricing_line(p_order_line_id uuid,p_pricing_date date)
returns jsonb language plpgsql stable set search_path=pg_catalog,private as $$
declare l private.stockflow_order_lines%rowtype; customer uuid; r jsonb; rate numeric; selected private.stockflow_price_book_decisions%rowtype;
begin
  select * into l from private.stockflow_order_lines where id=p_order_line_id;
  if not found then raise exception 'Order line was not found' using errcode='22023'; end if;
  select customer_id into customer from private.stockflow_orders where id=l.order_id;
  r:=private.stockflow_customer_price(customer,l.tally_item_key,p_pricing_date);
  rate:=(r->>'recommended')::numeric;
  -- An accepted recommendation expires whenever its material evidence changes.
  select * into selected from private.stockflow_price_book_decisions where customer_id=customer and tally_item_key=l.tally_item_key and evidence_hash=r->>'evidenceHash' order by created_at desc,id limit 1;
  if selected.id is not null and not (r->>'fixed')::boolean then rate:=selected.price; end if;
  return r||jsonb_build_object('evidenceHash',encode(extensions.digest((r->>'evidenceHash')||coalesce(selected.id::text,''),'sha256'),'hex'),'lineId',l.id,'itemName',l.item_name,'quantity',l.quantity,'proposedRate',rate,
    'resolution',case when rate is null then 'PRICE_REVIEW_REQUIRED' when r->'source'->>'type'='APPROVED_CONTRACT' then 'APPROVED_CONTRACT_PRICE' when r->'source'->>'type'='STANDARD_ITEM_PRICE' then 'STANDARD_ITEM_PRICE' else 'LAST_TALLY_INVOICE_PRICE' end,
    'guardrail',case when rate is null or r->>'currentCost' is null or (rate-(r->>'currentCost')::numeric)/nullif(rate,0)*100<(r->'policy'->>'minimumMarginPercent')::numeric then 'PRICE_REVIEW_REQUIRED' when (r->>'costChange')::numeric>0 then 'COST_INCREASE' else 'PRICE_OK' end,
    'margin',jsonb_build_object('grossProfitAmount',rate-(r->>'currentCost')::numeric,'grossMarginPercent',round((rate-(r->>'currentCost')::numeric)/nullif(rate,0)*100,2),'previousGrossMarginPercent',round(((r->>'lastRate')::numeric-(r->>'historicCost')::numeric)/nullif((r->>'lastRate')::numeric,0)*100,2),'erosionPercentagePoints',null));
end $$;
