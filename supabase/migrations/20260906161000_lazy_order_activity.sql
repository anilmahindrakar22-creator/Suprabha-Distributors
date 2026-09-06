create or replace function public.stockflow_order_activity_gateway(
  p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email, '')));
  v_role text;
  v_hash text;
  v_order_id uuid;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name = 'orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key, ''), 'sha256'), 'hex') <> v_hash then
    raise exception 'Unauthorized gateway' using errcode = '42501';
  end if;
  if p_action <> 'get_order_events' then raise exception 'Unsupported activity action' using errcode = '22023'; end if;
  select role into v_role from public.stockflow_members where email = v_email and status = 'active';
  if v_role is null then raise exception 'Account is not approved' using errcode = '42501'; end if;
  begin v_order_id := (p_payload->>'orderId')::uuid;
  exception when invalid_text_representation then raise exception 'Valid order ID is required' using errcode = '22023'; end;
  if v_order_id is null or not exists(select 1 from private.stockflow_orders where id = v_order_id and archived_at is null) then
    raise exception 'Order was not found' using errcode = '22023';
  end if;
  perform private.assert_stockflow_order_access(v_email, v_role, v_order_id);
  return jsonb_build_object('events', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', event.id, 'eventType', event.event_type,
      'fromStatus', event.from_status, 'toStatus', event.to_status,
      'reason', event.reason, 'actorEmail', event.actor_email,
      'actorRole', event.actor_role, 'metadata', event.metadata,
      'createdAt', event.created_at
    ) order by event.created_at, event.id)
    from private.stockflow_order_events event where event.order_id = v_order_id
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.stockflow_order_activity_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_activity_gateway(text,text,text,jsonb) to service_role;

do $$
declare f text; updated text;
begin
  select pg_get_functiondef('public.stockflow_order_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated := replace(f,
    $old$            coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', event.id,
                'eventType', event.event_type,
                'fromStatus', event.from_status,
                'toStatus', event.to_status,
                'reason', event.reason,
                'actorEmail', event.actor_email,
                'actorRole', event.actor_role,
                'metadata', event.metadata,
                'createdAt', event.created_at
              ) order by event.created_at, event.id)
              from private.stockflow_order_events event
              where event.order_id = x.id
            ), '[]'::jsonb) as events,$old$,
    $new$            '[]'::jsonb as events,$new$);
  if updated = f then raise exception 'Expected eager order activity projection was not found'; end if;
  execute updated;
end;
$$;

revoke all on function public.stockflow_order_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_gateway(text,text,text,jsonb) to service_role;
