alter function public.stockflow_pricing_gateway(text,text,text,jsonb) rename to stockflow_pricing_gateway_before_price_change;
revoke all on function public.stockflow_pricing_gateway_before_price_change(text,text,text,jsonb) from public, anon, authenticated;

create function public.stockflow_pricing_gateway(p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'private', 'extensions'
as $function$
declare
  v_actor_email text := lower(btrim(coalesce(p_actor_email, '')));
  actor_role text;
  assigned_roles text[];
  secret text;
  changed_rate numeric;
  changed_margin numeric;
  from_rate numeric;
  reason text;
  ex private.stockflow_price_exceptions%rowtype;
  decision private.stockflow_order_pricing_decisions%rowtype;
begin
  if not (p_action = 'approve_price_exception' and p_payload ? 'changedRate') then
    return public.stockflow_pricing_gateway_before_price_change(p_gateway_key, p_actor_email, p_action, p_payload);
  end if;
  select secret_sha256 into secret from private.stockflow_gateway_config where name = 'orders';
  if secret is null or encode(extensions.digest(coalesce(p_gateway_key, ''), 'sha256'), 'hex') <> secret then
    raise exception 'Unauthorized gateway' using errcode = '42501';
  end if;
  select m.role, m.roles into actor_role, assigned_roles from public.stockflow_members m
  where m.email = v_actor_email and m.status = 'active';
  if not private.stockflow_valid_roles(assigned_roles)
     or not (assigned_roles && array['administrator','management']::text[]) then
    raise exception 'Only administrators and management can change a price' using errcode = '42501';
  end if;
  begin
    changed_rate := (p_payload->>'changedRate')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Enter a valid price' using errcode = '22023';
  end;
  if changed_rate is null or not (changed_rate > 0 and changed_rate <= 99999999) then
    raise exception 'Enter a valid price' using errcode = '22023';
  end if;
  changed_rate := round(changed_rate, 2);
  if changed_rate <= 0 then raise exception 'Enter a valid price' using errcode = '22023'; end if;
  reason := btrim(coalesce(p_payload->>'reason', ''));
  if length(reason) not between 3 and 1000 then
    raise exception 'A reason is required to change a price' using errcode = '22023';
  end if;

  -- Match the delegated approval's evidence-before-exception lock order.
  lock table private.stockflow_tally_sales_prices,private.stockflow_tally_purchase_costs,
    private.stockflow_pricing_policies,private.stockflow_customer_product_prices,
    private.stockflow_standard_item_prices,private.stockflow_price_book_decisions in share row exclusive mode;
  select * into ex from private.stockflow_price_exceptions where id = (p_payload->>'exceptionId')::uuid for update;
  if ex.state = 'approved' then
    -- Rebuild the original delegated payload so its stored request hash still matches.
    select (e.metadata->>'fromRate')::numeric into from_rate from private.stockflow_pricing_events e
    where e.entity_type = 'price_exception' and e.entity_id = ex.id
      and e.event_type = 'price_exception_rate_changed' and e.actor_email = v_actor_email
      and e.request_id = p_payload->>'idempotencyKey';
    if found then
      return public.stockflow_pricing_gateway_before_price_change(p_gateway_key, p_actor_email, 'approve_price_exception',
        (p_payload - 'changedRate') || jsonb_build_object('reason', 'Price changed from ' || from_rate || ' to ' || changed_rate || ': ' || reason));
    end if;
  end if;
  if ex.id is null or ex.state <> 'pending' or ex.version <> (p_payload->>'expectedVersion')::integer then
    return public.stockflow_pricing_gateway_before_price_change(p_gateway_key, p_actor_email, p_action, p_payload);
  end if;
  select * into decision from private.stockflow_order_pricing_decisions where id = ex.decision_id for update;
  from_rate := coalesce(decision.approved_rate, ex.entered_rate);
  if decision.cost_amount is not null then
    changed_margin := (changed_rate - decision.cost_amount) / changed_rate * 100;
    if changed_margin < -999.9999 or changed_margin > 999.9999 then
      raise exception 'Price is too far below cost to record; check the amount' using errcode = '22023';
    end if;
  end if;
  update private.stockflow_order_pricing_decisions
  set approved_rate = changed_rate,
      gross_profit_amount = case when cost_amount is not null then changed_rate - coalesce(cost_amount, 0) end,
      gross_margin_percent = changed_margin,
      margin_erosion_points = case when changed_margin is null or previous_gross_margin_percent is null then null
        else round(changed_margin, 2) - previous_gross_margin_percent end
  where id = decision.id;
  insert into private.stockflow_pricing_events(entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata)
  values('price_exception',ex.id,'price_exception_rate_changed',v_actor_email,actor_role,p_payload->>'idempotencyKey',
    jsonb_build_object('orderId',ex.order_id,'fromRate',from_rate,'toRate',changed_rate,'reason',reason));
  return public.stockflow_pricing_gateway_before_price_change(p_gateway_key, p_actor_email, 'approve_price_exception',
    (p_payload - 'changedRate') || jsonb_build_object('reason', 'Price changed from ' || from_rate || ' to ' || changed_rate || ': ' || reason));
end $function$;
revoke all on function public.stockflow_pricing_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_pricing_gateway(text,text,text,jsonb) to service_role;

notify pgrst, 'reload schema';
