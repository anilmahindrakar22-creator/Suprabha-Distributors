create or replace function public.stockflow_order_note_gateway(
  p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, extensions as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email,''))); v_role text; v_hash text;
  v_order private.stockflow_orders%rowtype; v_note text; v_key text; v_replay jsonb; v_result jsonb;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex') <> v_hash then raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  select role into v_role from public.stockflow_members where email=v_email and status='active';
  if v_role not in ('administrator','sales','operations','warehouse','accounts','management') then raise exception 'Role cannot add order notes' using errcode='42501'; end if;
  if p_action <> 'add_order_note' then raise exception 'Unsupported order note action' using errcode='22023'; end if;

  v_key := p_payload->>'idempotencyKey';
  v_replay := private.begin_stockflow_command(v_email,p_action,v_key,p_payload);
  if v_replay is not null then return v_replay; end if;
  v_note := btrim(coalesce(p_payload->>'note',''));
  if char_length(v_note) not between 3 and 1000 then raise exception 'Order note must be between 3 and 1000 characters' using errcode='22023'; end if;

  select * into v_order from private.stockflow_orders where id=(p_payload->>'orderId')::uuid and archived_at is null for update;
  if not found then raise exception 'Order was not found' using errcode='22023'; end if;
  perform private.assert_stockflow_order_access(v_email,v_role,v_order.id);
  if v_order.version <> (p_payload->>'expectedVersion')::integer then raise exception 'Order has changed; refresh before trying again' using errcode='40001'; end if;

  insert into private.stockflow_order_events(order_id,event_type,from_status,to_status,reason,actor_email,actor_role,metadata)
  values(v_order.id,'order_note_added',v_order.status,v_order.status,v_note,v_email,v_role,jsonb_build_object('requestId',v_key));
  update private.stockflow_orders set version=version+1,updated_at=now(),updated_by_email=v_email where id=v_order.id;
  v_result := jsonb_build_object('ok',true,'orderId',v_order.id,'status',v_order.status,'version',v_order.version+1);
  perform private.finish_stockflow_command(v_email,p_action,v_key,p_payload,v_order.id,v_result);
  return v_result;
end $$;

revoke all on function public.stockflow_order_note_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_note_gateway(text,text,text,jsonb) to service_role;
