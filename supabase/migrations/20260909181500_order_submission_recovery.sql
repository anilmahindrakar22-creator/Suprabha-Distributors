create or replace function public.stockflow_submission_recovery_gateway(
  p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, extensions as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email,''))); v_role text; v_hash text;
  v_key text := btrim(coalesce(p_payload->>'idempotencyKey','')); v_order private.stockflow_orders%rowtype;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex') <> v_hash then raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  select role into v_role from public.stockflow_members where email=v_email and status='active';
  if v_role is null then raise exception 'Account is not approved' using errcode='42501'; end if;
  if p_action <> 'recover_order_submission' or char_length(v_key) not between 16 and 200 then raise exception 'Valid submission key is required' using errcode='22023'; end if;
  select * into v_order from private.stockflow_orders where created_by_email=v_email and idempotency_key=v_key order by created_at desc limit 1;
  if not found then return jsonb_build_object('status','not_found'); end if;
  perform private.assert_stockflow_order_access(v_email,v_role,v_order.id);
  return jsonb_build_object('status','accepted','orderId',v_order.id,'orderNumber',v_order.order_number);
end $$;

revoke all on function public.stockflow_submission_recovery_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_submission_recovery_gateway(text,text,text,jsonb) to service_role;
