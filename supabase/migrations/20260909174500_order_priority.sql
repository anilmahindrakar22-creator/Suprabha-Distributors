alter table private.stockflow_orders
  add column priority text not null default 'normal'
  check (priority in ('normal','high','urgent'));

create index stockflow_orders_active_priority_idx
  on private.stockflow_orders(priority, created_at desc)
  where archived_at is null and status not in ('delivered','cancelled');

create or replace function public.stockflow_priority_gateway(
  p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, extensions as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email,''))); v_role text; v_hash text;
  v_order private.stockflow_orders%rowtype; v_priority text; v_key text; v_replay jsonb; v_result jsonb;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex') <> v_hash then raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  select role into v_role from public.stockflow_members where email=v_email and status='active';
  if v_role not in ('administrator','sales','operations','management') then raise exception 'Role cannot change order priority' using errcode='42501'; end if;
  if p_action <> 'set_order_priority' then raise exception 'Unsupported priority action' using errcode='22023'; end if;
  v_priority := p_payload->>'priority';
  if v_priority not in ('normal','high','urgent') then raise exception 'Valid order priority is required' using errcode='22023'; end if;
  v_key := p_payload->>'idempotencyKey';
  v_replay := private.begin_stockflow_command(v_email,p_action,v_key,p_payload);
  if v_replay is not null then return v_replay; end if;
  select * into v_order from private.stockflow_orders where id=(p_payload->>'orderId')::uuid and archived_at is null for update;
  if not found then raise exception 'Order was not found' using errcode='22023'; end if;
  perform private.assert_stockflow_order_access(v_email,v_role,v_order.id);
  if v_order.version <> (p_payload->>'expectedVersion')::integer then raise exception 'Order has changed; refresh before trying again' using errcode='40001'; end if;
  if v_order.status in ('delivered','cancelled') then raise exception 'Closed order priority cannot be changed' using errcode='22023'; end if;
  update private.stockflow_orders set priority=v_priority,version=version+1,updated_at=now(),updated_by_email=v_email where id=v_order.id;
  insert into private.stockflow_order_events(order_id,event_type,from_status,to_status,reason,actor_email,actor_role,metadata)
  values(v_order.id,'order_priority_changed',v_order.status,v_order.status,null,v_email,v_role,jsonb_build_object('before',v_order.priority,'after',v_priority,'requestId',v_key));
  v_result := jsonb_build_object('ok',true,'orderId',v_order.id,'status',v_order.status,'priority',v_priority,'version',v_order.version+1);
  perform private.finish_stockflow_command(v_email,p_action,v_key,p_payload,v_order.id,v_result);
  return v_result;
end $$;

revoke all on function public.stockflow_priority_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_priority_gateway(text,text,text,jsonb) to service_role;

do $$
declare f text; updated text;
begin
  select pg_get_functiondef('public.stockflow_order_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated := replace(f, 'x.status, x.source, x.notes, x.version,', 'x.status, x.priority, x.source, x.notes, x.version,');
  if updated=f then raise exception 'Expected bootstrap priority projection was not found'; end if;
  f := updated;
  updated := replace(f,
    'customer_id, customer_name, customer_phone, source, notes,',
    'customer_id, customer_name, customer_phone, source, notes, priority,');
  if updated=f then raise exception 'Expected order insert columns were not found'; end if;
  f := updated;
  updated := replace(f,
    $$nullif(btrim(coalesce(p_payload->>'notes', '')), ''),
      p_payload->>'idempotencyKey'$$,
    $$nullif(btrim(coalesce(p_payload->>'notes', '')), ''),
      coalesce(nullif(p_payload->>'priority',''),'normal'),
      p_payload->>'idempotencyKey'$$);
  if updated=f then raise exception 'Expected order insert values were not found'; end if;
  execute updated;
  select pg_get_functiondef('public.stockflow_order_list_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated := replace(f, $old$'status',o.status,'source',o.source$old$, $new$'status',o.status,'priority',o.priority,'source',o.source$new$);
  if updated=f then raise exception 'Expected list priority projection was not found'; end if;
  execute updated;
end $$;

revoke all on function public.stockflow_order_gateway(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.stockflow_order_list_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_gateway(text,text,text,jsonb) to service_role;
grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb) to service_role;
