create or replace function private.stockflow_role_can_read_order(
  p_actor_email text,
  p_role text,
  p_created_by_email text
) returns boolean
language sql
stable
set search_path = pg_catalog, private
as $$
  select exists (
    select 1
    from private.stockflow_role_order_scopes scope
    where scope.role = p_role
      and (
        scope.scope = 'global'
        or (
          scope.scope = 'created_by'
          and lower(btrim(p_created_by_email)) = lower(btrim(p_actor_email))
        )
      )
  )
$$;

comment on function private.stockflow_role_can_read_order(text,text,text) is
  'Checks an already-loaded order row against the authoritative role scope without reading stockflow_orders again.';

revoke all on function private.stockflow_role_can_read_order(text,text,text) from public, anon, authenticated;

do $migration$
declare
  f text;
  updated text;
begin
  select pg_get_functiondef('public.stockflow_order_list_gateway(text,text,text,jsonb)'::regprocedure) into f;

  updated := replace(
    f,
    'private.stockflow_can_access_order(v_email,v_role,o.id)',
    'private.stockflow_role_can_read_order(v_email,v_role,o.created_by_email)'
  );

  if updated = f then
    raise exception 'Expected paginated order scope checks were not found';
  end if;

  if (length(f) - length(replace(f, 'private.stockflow_can_access_order(v_email,v_role,o.id)', '')))
      / length('private.stockflow_can_access_order(v_email,v_role,o.id)') <> 2 then
    raise exception 'Expected exactly two paginated order scope checks';
  end if;

  execute updated;
end $migration$;

revoke all on function public.stockflow_order_list_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb) to service_role;
