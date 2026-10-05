begin;
create function private.assert_stockflow_order_access(
  p_actor_email text, p_roles text[], p_order_id uuid
) returns void language plpgsql stable
set search_path=pg_catalog,private
as $$
begin
  if not exists(select 1 from private.stockflow_orders o
    where o.id=p_order_id and o.archived_at is null
      and private.stockflow_role_can_read_order(p_actor_email,p_roles,o.created_by_email)) then
    raise exception 'Role cannot access this order' using errcode='42501';
  end if;
end $$;
revoke all on function private.assert_stockflow_order_access(text,text[],uuid)
  from public,anon,authenticated;

-- Preserve the established gateway implementation rather than rewriting its
-- command locking, idempotency, financial wrapper or outbox behavior.
do $migration$
declare f text; updated text; old_fragment text; new_fragment text; pair text[];
begin
  select pg_get_functiondef('public.stockflow_order_gateway_before_auto_pricing(text,text,text,jsonb)'::regprocedure) into f;
  foreach pair slice 1 in array array[
    array['  v_role text;', '  v_role text; v_roles text[];'],
    array['  select role into v_role', '  select role, roles into v_role, v_roles'],
    array['  if v_role is null then', '  if v_role is null or not private.stockflow_valid_roles(v_roles) then'],
    array['private.assert_stockflow_permission(v_role, ''orders.create'')', 'private.assert_stockflow_permission(v_roles, ''orders.create'')'],
    array['v_actor_email,v_role,(p_payload->>''orderId'')::uuid', 'v_actor_email,v_roles,(p_payload->>''orderId'')::uuid'],
    array['v_role, v_from_status, v_to_status, v_reason, v_invoice', 'v_roles, v_from_status, v_to_status, v_reason, v_invoice'],
    array['jsonb_build_object(''source'', coalesce(p_payload->>''source'', ''phone''))',
      'jsonb_build_object(''source'', coalesce(p_payload->>''source'', ''phone''), ''assignedRoles'', v_roles)'],
    array['jsonb_build_object(''requestId'', v_idempotency_key)',
      'jsonb_build_object(''requestId'', v_idempotency_key, ''assignedRoles'', v_roles)']
  ] loop
    old_fragment:=pair[1]; new_fragment:=pair[2];
    if (length(f)-length(replace(f,old_fragment,'')))/length(old_fragment)<>1 then
      raise exception 'Expected exactly one order gateway fragment: %',old_fragment;
    end if;
    updated:=replace(f,old_fragment,new_fragment);
    f:=updated;
  end loop;
  execute f;
end $migration$;
-- Internal implementation remains inaccessible even to direct service clients.
revoke all on function public.stockflow_order_gateway_before_auto_pricing(text,text,text,jsonb)
  from public,anon,authenticated,service_role;
commit;
