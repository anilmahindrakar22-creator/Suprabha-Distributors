begin;

do $patch$
declare f text; anchor text; replacement text;
begin
 select replace(pg_get_functiondef('private.stockflow_growth_margin_detail(date,jsonb)'::regprocedure),chr(13),'') into f;
 anchor:=$old$||jsonb_build_object('approvedPricePaise',(
    select round(c.price_amount*100) from private.stockflow_customer_product_prices c
    where c.customer_id=(l->>'customerId')::uuid and c.tally_item_key=i->>'tallyItemKey'
     and c.status='approved' and c.valid_from<=p_today and (c.valid_to is null or c.valid_to>=p_today)
    order by c.valid_from desc,c.created_at desc,c.id desc limit 1)) order by ordinal),'[]')) into result from enriched;$old$;
 replacement:=$new$||jsonb_build_object('approvedPricePaise',(
    select round(c.price_amount*100) from private.stockflow_customer_product_prices c
    where c.customer_id=(l->>'customerId')::uuid and c.tally_item_key=i->>'tallyItemKey'
     and c.status='approved' and c.valid_from<=p_today and (c.valid_to is null or c.valid_to>=p_today)
    order by c.valid_from desc,c.created_at desc,c.id desc limit 1))
   || case when is_item then jsonb_build_object('liftToPricePaise',lift.lift_paise,'minimumPricePaise',lift.minimum_paise,
    'belowMinimum',lift.below_minimum,'belowTarget',lift.below_target) else '{}'::jsonb end
   order by ordinal),'[]')) into result from enriched
  left join lateral (
   select case when calc.valid and calc.margin_now<calc.target_eff and calc.lift is not null then round(calc.lift*100) end lift_paise,
    case when calc.valid then round(calc.minimum_price*100) end minimum_paise,
    case when calc.valid and calc.margin_now is not null then calc.margin_now<calc.min_pct end below_minimum,
    case when calc.valid and calc.margin_now is not null and calc.target_eff is not null and calc.lift is not null then calc.margin_now<calc.target_eff end below_target
   from (
    select base.*,
     case when base.cost>0 and base.increment>0 and base.min_pct is not null
      then private.stockflow_round_price_up(base.cost/(1-base.min_pct/100),base.increment) end minimum_price,
     case when base.unit_rupees>0 then (base.unit_rupees-base.cost)/base.unit_rupees*100 end margin_now,
     base.price_json is not null and base.cost>0 and base.min_pct is not null
      and base.increment is not null and not base.ambiguous valid
    from (
     select gate.price_json,nullif(gate.price_json->'cost'->>'amount','')::numeric cost,
      (gate.price_json->'policy'->>'minimumMarginPercent')::numeric min_pct,
      coalesce(nullif(gate.price_json->>'groupGrossMarginPercent','')::numeric,nullif(gate.price_json->'policy'->>'targetMarginPercent','')::numeric) target_eff,
      coalesce(nullif(gate.price_json->>'targetMarginPrice','')::numeric,nullif(gate.price_json->'suggestion'->>'amount','')::numeric) lift,
      (select pp.rounding_increment from private.stockflow_pricing_policies pp where pp.id=(gate.price_json->'policy'->>'id')::uuid) increment,
      (r->>'unitPricePaise')::numeric/100 unit_rupees,
      coalesce(gate.price_json->'warnings' ? 'AMBIGUOUS_PURCHASE_COST',false) ambiguous
     from (select case when eligible then private.stockflow_customer_price((l->>'customerId')::uuid,i->>'tallyItemKey',p_today) end price_json,eligible
      from (select is_item and l->>'customerId' is not null and i->>'tallyItemKey' is not null
        and coalesce((r->>'packDifference')::boolean,false)=false
        and p.base_unit<>''
        and lower(btrim(regexp_replace(r->>'itemKey','^.*\|','')))=lower(btrim(p.base_unit)) eligible
       from (select base_unit from private.stockflow_products where tally_item_key=i->>'tallyItemKey' limit 1) p
       right join (select 1) one on true) eligibility) gate
    ) base
   ) calc
  ) lift on true;$new$;
 if (length(f)-length(replace(f,anchor,'')))/length(anchor)<>1 then
  raise exception 'Unexpected growth lift seam';
 end if;
 f:=replace(f,anchor,replacement);
 anchor:=$old$return result||jsonb_build_object('kind','item','itemKey',item_key,'name',entity->'name',
   'typicalPricePaise',entity->'typicalPricePaise','labs',entity->'labs','marginPct',entity->'marginPct','tallyItemKey',entity->'tallyItemKey');$old$;
 replacement:=$new$return result||jsonb_build_object('kind','item','itemKey',item_key,'name',entity->'name',
   'typicalPricePaise',entity->'typicalPricePaise','labs',entity->'labs','marginPct',entity->'marginPct','tallyItemKey',entity->'tallyItemKey',
   'pricePolicy',(select jsonb_build_object('minimumMarginPct',pp.minimum_margin_percent,'targetMarginPct',pp.target_margin_percent)
    from private.stockflow_pricing_policies pp
     where pp.active and pp.effective_from<=p_today and (pp.effective_to is null or pp.effective_to>=p_today)
     order by pp.effective_from desc limit 1));$new$;
 if (length(f)-length(replace(f,anchor,'')))/length(anchor)<>1 then
  raise exception 'Unexpected growth lift policy seam';
 end if;
 f:=replace(f,anchor,replacement);
 execute f;
 revoke all on function private.stockflow_growth_margin_detail(date,jsonb) from public,anon,authenticated,service_role;
end$patch$;

commit;
