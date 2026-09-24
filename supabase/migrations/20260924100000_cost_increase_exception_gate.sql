-- Preserve customer rates when cost is unchanged or lower. A verified cost
-- increase is an explicit pricing exception, including for fixed agreements.
-- Keep the previous functions for the established evidence and audit logic.
alter function private.stockflow_customer_price(uuid,text,date)
  rename to stockflow_customer_price_before_cost_exception;
revoke all on function private.stockflow_customer_price_before_cost_exception(uuid,text,date)
  from public,anon,authenticated,service_role;

create or replace function private.stockflow_customer_price(
  p_customer uuid,p_item text,p_date date
) returns jsonb language plpgsql stable
set search_path=pg_catalog,private as $$
declare
  price_row jsonb;
begin
  price_row:=private.stockflow_customer_price_before_cost_exception(
    p_customer,p_item,p_date
  );
  if coalesce(nullif(price_row->>'costChange','')::numeric,0)>0
     and nullif(price_row->>'currentDecisionId','') is null then
    return price_row||jsonb_build_object(
      'status','REVIEW_REQUIRED',
      'riskStatus','RED',
      'recommendationReason',
        'Purchase cost increased. Keep the existing customer rate until an administrator reviews the exception.'
    );
  end if;
  return price_row;
end $$;
revoke all on function private.stockflow_customer_price(uuid,text,date)
  from public,anon,authenticated,service_role;

alter function private.stockflow_resolve_pricing_line(uuid,date)
  rename to stockflow_resolve_pricing_line_before_cost_exception;
revoke all on function private.stockflow_resolve_pricing_line_before_cost_exception(uuid,date)
  from public,anon,authenticated,service_role;

create or replace function private.stockflow_resolve_pricing_line(
  p_order_line_id uuid,p_pricing_date date
) returns jsonb language plpgsql stable
set search_path=pg_catalog,private as $$
declare
  resolved jsonb;
  rate numeric;
  current_cost numeric;
  margin_percent numeric;
  previous_margin numeric;
  guardrail text;
begin
  resolved:=private.stockflow_resolve_pricing_line_before_cost_exception(
    p_order_line_id,p_pricing_date
  );
  rate:=nullif(resolved->>'proposedRate','')::numeric;
  current_cost:=nullif(resolved->>'currentCost','')::numeric;

  -- A target-margin recommendation is advice, never an automatic increase.
  -- For ordinary repeat business, use the last genuine customer invoice rate.
  if resolved->'source'->>'type'='LAST_TALLY_INVOICE'
     and nullif(resolved->>'currentDecisionId','') is null then
    rate:=nullif(resolved->>'lastRate','')::numeric;
  end if;
  if rate is not null and current_cost is not null then
    margin_percent:=round((rate-current_cost)/nullif(rate,0)*100,2);
  end if;
  previous_margin:=nullif(resolved->'margin'->>'previousGrossMarginPercent','')::numeric;

  guardrail:=case
    when coalesce(nullif(resolved->>'costChange','')::numeric,0)>0
      and (resolved->'source'->>'type'='APPROVED_CONTRACT'
        or nullif(resolved->>'currentDecisionId','') is null)
      then 'PRICE_REVIEW_REQUIRED'
    when rate is null or current_cost is null or margin_percent is null
      then 'PRICE_REVIEW_REQUIRED'
    when margin_percent<(resolved->'policy'->>'minimumMarginPercent')::numeric
      then 'PRICE_REVIEW_REQUIRED'
    else 'PRICE_OK'
  end;

  return resolved||jsonb_build_object(
    'proposedRate',rate,
    'guardrail',guardrail,
    'resolution',case when guardrail='PRICE_REVIEW_REQUIRED'
      then 'PRICE_REVIEW_REQUIRED' else resolved->>'resolution' end,
    'margin',coalesce(resolved->'margin','{}'::jsonb)||jsonb_build_object(
      'grossProfitAmount',case when rate is null or current_cost is null
        then null else rate-current_cost end,
      'grossMarginPercent',margin_percent,
      'erosionPercentagePoints',case when margin_percent is null
        or previous_margin is null then null
        else margin_percent-previous_margin end
    )
  );
end $$;
revoke all on function private.stockflow_resolve_pricing_line(uuid,date)
  from public,anon,authenticated,service_role;

-- An unchanged-cost repeat sale is governed by its exact Tally sales evidence;
-- it needs no separate price-book approval. An increased-cost sale does.
create or replace function private.stockflow_is_governed_order_price(
  p_customer uuid,p_item text,p_pricing_date date,p_resolution jsonb
) returns boolean language plpgsql stable
set search_path=pg_catalog,private as $$
declare
  base_resolution jsonb;
  proposed numeric:=nullif(p_resolution->>'proposedRate','')::numeric;
begin
  if proposed is null or p_resolution->>'guardrail'='PRICE_REVIEW_REQUIRED' then
    return false;
  end if;
  if p_resolution->'source'->>'type'='APPROVED_CONTRACT' then
    return exists(
      select 1 from private.stockflow_customer_product_prices p
      where p.id=(p_resolution->'source'->>'reference')::uuid
        and p.status in ('approved','superseded')
        and p.price_amount=proposed
    );
  end if;
  if p_resolution->'source'->>'type'='STANDARD_ITEM_PRICE' then
    return exists(
      select 1 from private.stockflow_standard_item_prices p
      where p.id=(p_resolution->'source'->>'reference')::uuid
        and p.status in ('approved','superseded')
        and p.price_amount=proposed
    );
  end if;
  if p_resolution->'source'->>'type'<>'LAST_TALLY_INVOICE' then
    return false;
  end if;
  base_resolution:=private.stockflow_customer_price(p_customer,p_item,p_pricing_date);
  if nullif(base_resolution->>'currentDecisionId','') is null then
    return base_resolution->>'status'<>'REVIEW_REQUIRED'
      and nullif(base_resolution->>'costChange','')::numeric<=0
      and proposed=nullif(base_resolution->>'lastRate','')::numeric
      and base_resolution->'source'->>'type'='LAST_TALLY_INVOICE';
  end if;
  return exists(
    select 1 from private.stockflow_price_book_decisions d
    where d.customer_id=p_customer and d.tally_item_key=p_item
      and d.evidence_hash=base_resolution->>'evidenceHash'
      and d.price=proposed
  );
end $$;
revoke all on function private.stockflow_is_governed_order_price(uuid,text,date,jsonb)
  from public,anon,authenticated,service_role;
