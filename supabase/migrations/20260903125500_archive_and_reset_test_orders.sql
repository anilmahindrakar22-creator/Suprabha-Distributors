alter table private.stockflow_orders
  add column if not exists archived_at timestamptz;

comment on column private.stockflow_orders.archived_at is
  'Removes an order from operational views without deleting the protected business transaction or audit history.';

create or replace function private.stockflow_can_access_order(
  p_actor_email text,
  p_role text,
  p_order_id uuid
)
returns boolean
language sql
stable
set search_path = pg_catalog, private
as $function$
  select exists (
    select 1
    from private.stockflow_orders orders
    join private.stockflow_role_order_scopes scope on scope.role = p_role
    where orders.id = p_order_id
      and orders.archived_at is null
      and (
        scope.scope = 'global'
        or (
          scope.scope = 'created_by'
          and orders.created_by_email = lower(btrim(p_actor_email))
        )
      )
  )
$function$;

update private.stockflow_orders
set archived_at = now(),
    updated_at = now(),
    updated_by_email = 'administrator reset'
where archived_at is null;
