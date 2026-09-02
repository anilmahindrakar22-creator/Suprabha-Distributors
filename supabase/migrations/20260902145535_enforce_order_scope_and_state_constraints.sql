create table private.stockflow_role_order_scopes (
  role text primary key check (role in ('administrator','sales','operations','warehouse','accounts','management','viewer')),
  scope text not null check (scope in ('global','created_by'))
);

alter table private.stockflow_role_order_scopes enable row level security;

insert into private.stockflow_role_order_scopes(role, scope) values
  ('administrator','global'), ('sales','global'), ('operations','global'),
  ('warehouse','global'), ('accounts','global'), ('management','global'), ('viewer','global');

comment on table private.stockflow_role_order_scopes is
  'Authoritative order row scope. Existing roles start global to preserve current operations; future assignments can narrow a role without changing gateway code.';

create or replace function private.stockflow_can_access_order(
  p_actor_email text, p_role text, p_order_id uuid
) returns boolean
language sql
stable
set search_path = pg_catalog, private
as $$
  select case scope.scope
    when 'global' then true
    when 'created_by' then exists (
      select 1 from private.stockflow_orders o
      where o.id = p_order_id and o.created_by_email = lower(btrim(p_actor_email))
    )
    else false
  end
  from private.stockflow_role_order_scopes scope
  where scope.role = p_role
$$;

create or replace function private.assert_stockflow_order_access(
  p_actor_email text, p_role text, p_order_id uuid
) returns void
language plpgsql
stable
set search_path = pg_catalog, private
as $$
begin
  if not coalesce(private.stockflow_can_access_order(p_actor_email,p_role,p_order_id),false) then
    raise exception 'Role cannot access this order' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.stockflow_can_access_order(text,text,uuid) from public, anon, authenticated;
revoke all on function private.assert_stockflow_order_access(text,text,uuid) from public, anon, authenticated;

alter table private.stockflow_orders
  add constraint stockflow_orders_status_fk
  foreign key (status) references private.stockflow_order_states(status) not valid;
alter table private.stockflow_orders validate constraint stockflow_orders_status_fk;

alter table private.stockflow_order_events
  add constraint stockflow_order_events_from_status_fk
  foreign key (from_status) references private.stockflow_order_states(status) not valid,
  add constraint stockflow_order_events_to_status_fk
  foreign key (to_status) references private.stockflow_order_states(status) not valid;
alter table private.stockflow_order_events validate constraint stockflow_order_events_from_status_fk;
alter table private.stockflow_order_events validate constraint stockflow_order_events_to_status_fk;

alter table private.stockflow_order_transition_rules
  add constraint stockflow_transition_roles_known check (
    allowed_roles <@ array['administrator','sales','operations','warehouse','accounts','management','viewer']::text[]
  );

create or replace function private.enforce_stockflow_order_status_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, private
as $$
begin
  if new.status is distinct from old.status and not exists (
    select 1 from private.stockflow_order_transition_rules
    where from_status = old.status and to_status = new.status
  ) then
    raise exception 'Invalid order status transition' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger stockflow_orders_valid_transition
before update of status on private.stockflow_orders
for each row execute function private.enforce_stockflow_order_status_transition();

create or replace function private.stockflow_operations_summary(p_actor_email text, p_role text)
returns jsonb
language sql
stable
set search_path = pg_catalog, private
as $$
  select jsonb_build_object(
    'phoneOrdersToday', (select count(*) from private.stockflow_orders o where private.stockflow_can_access_order(p_actor_email,p_role,o.id) and o.created_at >= date_trunc('day', now()) and o.source='phone'),
    'awaitingConfirmation', (select count(*) from private.stockflow_orders o where private.stockflow_can_access_order(p_actor_email,p_role,o.id) and o.status='awaiting_confirmation'),
    'awaitingApproval', (select count(*) from private.stockflow_orders o where private.stockflow_can_access_order(p_actor_email,p_role,o.id) and o.status='awaiting_approval'),
    'awaitingStock', (select count(*) from private.stockflow_orders o where private.stockflow_can_access_order(p_actor_email,p_role,o.id) and o.status='partially_reserved'),
    'readyForPicking', (select count(*) from private.stockflow_orders o where private.stockflow_can_access_order(p_actor_email,p_role,o.id) and o.status in ('fully_reserved','ready_for_picking')),
    'packed', (select count(*) from private.stockflow_orders o where private.stockflow_can_access_order(p_actor_email,p_role,o.id) and o.status='packed'),
    'awaitingTallyBilling', (select count(*) from private.stockflow_orders o where private.stockflow_can_access_order(p_actor_email,p_role,o.id) and o.status='awaiting_tally_billing'),
    'billedNotDispatched', (select count(*) from private.stockflow_orders o where private.stockflow_can_access_order(p_actor_email,p_role,o.id) and o.status in ('billed_in_tally','ready_for_dispatch')),
    'dispatchedToday', (select count(*) from private.stockflow_order_events e join private.stockflow_orders o on o.id=e.order_id where private.stockflow_can_access_order(p_actor_email,p_role,o.id) and e.to_status='dispatched' and e.created_at >= date_trunc('day',now())),
    'urgentExceptions', (select count(*) from private.stockflow_orders o where private.stockflow_can_access_order(p_actor_email,p_role,o.id) and o.status in ('awaiting_approval','partially_reserved') and o.updated_at < now()-interval '24 hours')
  )
$$;

revoke all on function private.stockflow_operations_summary(text,text) from public, anon, authenticated;

do $$
declare
  f text;
  old_operations text := $old$      'operations', jsonb_build_object(
        'phoneOrdersToday', (select count(*) from private.stockflow_orders where created_at >= date_trunc('day', now()) and source = 'phone'),
        'awaitingConfirmation', (select count(*) from private.stockflow_orders where status = 'awaiting_confirmation'),
        'awaitingApproval', (select count(*) from private.stockflow_orders where status = 'awaiting_approval'),
        'awaitingStock', (select count(*) from private.stockflow_orders where status = 'partially_reserved'),
        'readyForPicking', (select count(*) from private.stockflow_orders where status in ('fully_reserved', 'ready_for_picking')),
        'packed', (select count(*) from private.stockflow_orders where status = 'packed'),
        'awaitingTallyBilling', (select count(*) from private.stockflow_orders where status = 'awaiting_tally_billing'),
        'billedNotDispatched', (select count(*) from private.stockflow_orders where status in ('billed_in_tally', 'ready_for_dispatch')),
        'dispatchedToday', (select count(*) from private.stockflow_order_events where to_status = 'dispatched' and created_at >= date_trunc('day', now())),
        'urgentExceptions', (select count(*) from private.stockflow_orders where status in ('awaiting_approval', 'partially_reserved') and updated_at < now() - interval '24 hours')
      )$old$;
begin
  select pg_get_functiondef('public.stockflow_order_gateway(text,text,text,jsonb)'::regprocedure) into f;
  if position(old_operations in f)=0
     or position('          group by x.id order by x.created_at desc limit 500' in f)=0
     or position($old$  v_replayed_result := private.begin_stockflow_command($old$ in f)=0 then
    raise exception 'Expected order gateway scope blocks were not found';
  end if;
  f := replace(f,
    '          group by x.id order by x.created_at desc limit 500',
    $new$          where private.stockflow_can_access_order(v_actor_email,v_role,x.id)
          group by x.id order by x.created_at desc limit 500$new$);
  f := replace(f, old_operations,
    $new$      'operations', private.stockflow_operations_summary(v_actor_email,v_role)$new$);
  f := replace(f,
    $old$  v_replayed_result := private.begin_stockflow_command(
    v_actor_email, p_action, v_idempotency_key, p_payload
  );$old$,
    $new$  perform private.assert_stockflow_order_access(
    v_actor_email,v_role,(p_payload->>'orderId')::uuid
  );
  v_replayed_result := private.begin_stockflow_command(
    v_actor_email, p_action, v_idempotency_key, p_payload
  );$new$);
  execute f;
end;
$$;

do $$
declare
  gateway regprocedure;
  f text;
  updated text;
begin
  foreach gateway in array array[
    'public.stockflow_fulfilment_gateway(text,text,text,jsonb)'::regprocedure,
    'public.stockflow_edit_gateway(text,text,text,jsonb)'::regprocedure,
    'public.stockflow_exception_gateway(text,text,text,jsonb)'::regprocedure,
    'public.stockflow_installation_gateway(text,text,text,jsonb)'::regprocedure
  ] loop
    f := pg_get_functiondef(gateway);
    updated := replace(f,
      $old$  v_replayed_result := private.begin_stockflow_command(v_email,p_action,v_idempotency_key,p_payload);$old$,
      $new$  perform private.assert_stockflow_order_access(v_email,v_role,(p_payload->>'orderId')::uuid);
  v_replayed_result := private.begin_stockflow_command(v_email,p_action,v_idempotency_key,p_payload);$new$);
    if updated=f then raise exception 'Expected row-scope hook was not found in %',gateway; end if;
    execute updated;
  end loop;
end;
$$;

revoke all on function public.stockflow_order_gateway(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.stockflow_fulfilment_gateway(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.stockflow_edit_gateway(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.stockflow_exception_gateway(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.stockflow_installation_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_gateway(text,text,text,jsonb) to service_role;
grant execute on function public.stockflow_fulfilment_gateway(text,text,text,jsonb) to service_role;
grant execute on function public.stockflow_edit_gateway(text,text,text,jsonb) to service_role;
grant execute on function public.stockflow_exception_gateway(text,text,text,jsonb) to service_role;
grant execute on function public.stockflow_installation_gateway(text,text,text,jsonb) to service_role;
