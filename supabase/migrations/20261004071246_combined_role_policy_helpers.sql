-- Internal policy building blocks. Existing gateways continue to use scalar
-- overloads until their full role-set integration is validated.
begin;

create function private.stockflow_valid_roles(p_roles text[])
returns boolean language sql immutable
set search_path = pg_catalog
as $$
  select coalesce(
    array_ndims(p_roles) = 1 and array_lower(p_roles,1) = 1
    and cardinality(p_roles) between 1 and 7
    and array_position(p_roles,null) is null
    and p_roles <@ array['administrator','sales','operations','warehouse','accounts','management','viewer']::text[]
    and cardinality(p_roles) = (select count(distinct r) from unnest(p_roles) r), false)
$$;

-- Caller must be an authenticated gateway with a verified actor email. This
-- invoker function cannot itself bypass membership RLS or accept JWT roles.
create function private.stockflow_active_member_roles(p_actor_email text)
returns text[] language plpgsql stable
set search_path = pg_catalog, public, private
as $$
declare v_roles text[];
begin
  select roles into v_roles from public.stockflow_members
    where email=lower(btrim(p_actor_email)) and status='active';
  if not private.stockflow_valid_roles(v_roles) then
    raise exception 'Active membership required' using errcode='42501';
  end if;
  return v_roles;
end;
$$;

create function private.assert_stockflow_permission(p_roles text[], p_permission text)
returns void language plpgsql
set search_path = pg_catalog, private
as $$
begin
  if not private.stockflow_valid_roles(p_roles) or not exists (
    select 1 from private.stockflow_role_permissions
    where role=any(p_roles) and permission=p_permission
  ) then
    raise exception 'Role is not permitted to perform this order action' using errcode='42501';
  end if;
end;
$$;

create function private.assert_stockflow_order_transition(
  p_roles text[], p_from_status text, p_to_status text,
  p_reason text default null, p_tally_invoice text default null
) returns void language plpgsql
set search_path = pg_catalog, private
as $$
declare v_role text;
begin
  perform private.assert_stockflow_permission(p_roles,'orders.transition');
  if not exists(select 1 from private.stockflow_order_transition_rules
    where from_status=p_from_status and to_status=p_to_status) then
    raise exception 'Invalid order status transition' using errcode='22023';
  end if;
  -- Choose a role authorized for this exact action, never a highest role.
  select r.role into v_role from private.stockflow_role_permissions r
    join private.stockflow_order_transition_rules t on r.role=any(t.allowed_roles)
    where r.role=any(p_roles) and r.permission='orders.transition'
      and t.from_status=p_from_status and t.to_status=p_to_status
    order by r.role limit 1;
  if v_role is null then
    raise exception 'Role cannot make this order transition' using errcode='42501';
  end if;
  -- Reuse existing reason/invoice invariants rather than duplicate policy.
  perform private.assert_stockflow_order_transition(v_role,p_from_status,p_to_status,p_reason,p_tally_invoice);
end;
$$;

create function private.stockflow_role_can_read_order(
  p_actor_email text, p_roles text[], p_created_by_email text
) returns boolean language sql stable
set search_path = pg_catalog, private
as $$
  select private.stockflow_valid_roles(p_roles) and exists (
    select 1 from private.stockflow_role_order_scopes scope
    where scope.role=any(p_roles) and (
      scope.scope='global' or (scope.scope='created_by'
        and lower(btrim(p_created_by_email))=lower(btrim(p_actor_email)))
    )
  )
$$;

revoke all on function private.stockflow_valid_roles(text[]) from public,anon,authenticated;
revoke all on function private.stockflow_active_member_roles(text) from public,anon,authenticated;
revoke all on function private.assert_stockflow_permission(text[],text) from public,anon,authenticated;
revoke all on function private.assert_stockflow_order_transition(text[],text,text,text,text) from public,anon,authenticated;
revoke all on function private.stockflow_role_can_read_order(text,text[],text) from public,anon,authenticated;
commit;
