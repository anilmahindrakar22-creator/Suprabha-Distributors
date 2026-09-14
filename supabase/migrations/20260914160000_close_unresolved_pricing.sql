-- Extend the existing recovery boundary; never return commercial command results.
create or replace function public.stockflow_submission_recovery_gateway(
  p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, extensions as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email,''))); v_role text; v_hash text;
  v_key text := btrim(coalesce(p_payload->>'idempotencyKey','')); v_order private.stockflow_orders%rowtype; v_result_hash text; v_receipt_id uuid;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex') <> v_hash then raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  select role into v_role from public.stockflow_members where email=v_email and status='active';
  if v_role is null then raise exception 'Account is not approved' using errcode='42501'; end if;
  if p_action <> 'recover_order_submission' or char_length(v_key) not between 16 and 200 then raise exception 'Valid submission key is required' using errcode='22023'; end if;
  if p_payload ? 'pricingAction' then
    perform private.stockflow_assert_pricing_role(v_role);
    if coalesce(p_payload->>'pricingAction','') not in ('apply_price_book','apply_product_price_impact','set_standard_item_price','create_price_contract','approve_price_contract','reject_price_contract','create_pricing_policy') then raise exception 'Invalid pricing action' using errcode='22023'; end if;
    if coalesce((p_payload->>'closeUnresolved')::boolean,false) then
      if not pg_try_advisory_xact_lock(hashtextextended(v_email || ':' || (p_payload->>'pricingAction') || ':' || v_key,0)) then
        return jsonb_build_object('status','unresolved');
      end if;
    end if;
    select request_hash into v_result_hash from private.stockflow_command_results
      where actor_email=v_email and action=p_payload->>'pricingAction' and idempotency_key=v_key;
    if found then
      if v_result_hash='closed-before-save' then return jsonb_build_object('status','not_saved'); end if;
      return jsonb_build_object('status','accepted');
    end if;
    if coalesce((p_payload->>'closeUnresolved')::boolean,false) then
      v_receipt_id:=extensions.gen_random_uuid();
      -- Non-SHA marker always conflicts with a late begin_stockflow_command payload hash.
      insert into private.stockflow_command_results(actor_email,action,idempotency_key,request_hash,aggregate_id,result)
        values(v_email,p_payload->>'pricingAction',v_key,'closed-before-save',v_receipt_id,'{"status":"not_saved"}');
      insert into private.stockflow_pricing_events(entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata)
        values('price_book',v_receipt_id,'pricing.request_closed_before_save',v_email,v_role,v_key,
          jsonb_build_object('action',p_payload->>'pricingAction'));
      return jsonb_build_object('status','not_saved');
    end if;
    -- Absence is not proof of failure: the original transaction may still be running.
    return jsonb_build_object('status','unresolved');
  end if;
  select * into v_order from private.stockflow_orders where created_by_email=v_email and idempotency_key=v_key order by created_at desc limit 1;
  if not found then return jsonb_build_object('status','not_found'); end if;
  perform private.assert_stockflow_order_access(v_email,v_role,v_order.id);
  return jsonb_build_object('status','accepted','orderId',v_order.id,'orderNumber',v_order.order_number);
end $$;
revoke all on function public.stockflow_submission_recovery_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_submission_recovery_gateway(text,text,text,jsonb) to service_role;
